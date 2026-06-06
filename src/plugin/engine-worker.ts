import type { BoardState } from "../core/types";
import type { AnalysisResult, EngineMove, EngineMode } from "../core/engine";
import { positionToUci, parseInfoLine, parseBestMove } from "../core/engine";

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export interface EngineWorkerConfig {
  mode: EngineMode;
  externalPath?: string; // explicit binary path; auto-discovered when absent
  wasmDir?: string;      // directory containing stockfish-18-lite-single.{js,wasm}
  multiPV?: number;      // default 3
  depth?: number;        // default 20
}

const STOCKFISH_JS = "stockfish-18-lite-single.js";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Build the full sequence of UCI commands to send for one analysis request. */
export function buildUciCommands(
  state: BoardState,
  history: string[],
  depth: number,
  multiPV: number
): string[] {
  return [
    "uci",
    `setoption name MultiPV value ${multiPV}`,
    "isready",
    positionToUci(state, history),
    `go depth ${depth}`,
  ];
}

/**
 * Fold a list of raw engine output lines into an AnalysisResult.
 * The last info line seen for each multipv index wins.
 */
export function collectAnalysis(lines: string[]): AnalysisResult {
  const byMultiPV = new Map<number, EngineMove>();
  let bestMove: string | null = null;

  for (const line of lines) {
    const info = parseInfoLine(line);
    if (info) {
      byMultiPV.set(info.multipv, info);
      continue;
    }
    const bm = parseBestMove(line);
    if (bm !== null) {
      bestMove = bm;
    }
  }

  const moves = [...byMultiPV.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, move]) => move);

  return { moves, bestMove };
}

// ---------------------------------------------------------------------------
// WASM worker helpers (exported for testing)
// ---------------------------------------------------------------------------

export interface WorkerLike {
  postMessage(msg: string): void;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

/**
 * Run a full UCI analysis session over an abstract worker.
 * Sends the first three commands (uci, setoption, isready) immediately;
 * position + go are sent after readyok is received.
 */
export function runWasmAnalysis(
  worker: WorkerLike,
  commands: string[]
): Promise<AnalysisResult> {
  return new Promise<AnalysisResult>((resolve, reject) => {
    const outputLines: string[] = [];
    let readyOkSeen = false;
    let resolved = false;

    const finish = (result: AnalysisResult): void => {
      resolved = true;
      worker.terminate();
      resolve(result);
    };

    worker.onmessage = ({ data }: { data: string }): void => {
      const line = data.trim();
      if (!line) return;
      outputLines.push(line);

      if (!readyOkSeen && line === "readyok") {
        readyOkSeen = true;
        worker.postMessage(commands[3]); // position
        worker.postMessage(commands[4]); // go depth
        return;
      }

      if (!resolved && line.startsWith("bestmove")) {
        finish(collectAnalysis(outputLines));
      }
    };

    worker.onerror = (event: ErrorEvent): void => {
      if (!resolved) {
        resolved = true;
        worker.terminate();
        reject(new Error(event.message));
      }
    };

    worker.postMessage(commands[0]); // uci
    worker.postMessage(commands[1]); // setoption
    worker.postMessage(commands[2]); // isready
  });
}

// ---------------------------------------------------------------------------
// WASM worker creation (Electron / Node.js worker_threads)
// ---------------------------------------------------------------------------

const BRIDGE_JS = "stockfish-worker-bridge.js";

/**
 * Wraps a worker_threads Worker in the WorkerLike interface so runWasmAnalysis
 * can drive it without knowing about the Node.js event-emitter API.
 */
function adaptWorkerThreads(wt: {
  postMessage(msg: unknown): void;
  terminate(): void;
  on(event: "message", cb: (data: string) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
}): WorkerLike {
  const adapter: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (msg) => wt.postMessage(msg),
    terminate: () => wt.terminate(),
  };
  wt.on("message", (data) => adapter.onmessage?.({ data }));
  wt.on("error", (err) => adapter.onerror?.({ message: err.message } as ErrorEvent));
  return adapter;
}

// ---------------------------------------------------------------------------
// Engine worker class
// ---------------------------------------------------------------------------

type ChildProcess = {
  stdin: { write: (data: string) => void };
  stdout: { on: (event: "data", cb: (chunk: Buffer | string) => void) => void };
  stderr: { on: (event: "data", cb: (chunk: Buffer | string) => void) => void };
  on: (event: "close" | "error", cb: (...args: unknown[]) => void) => void;
  kill: () => void;
};

const DEFAULT_SEARCH_PATHS = [
  "/usr/local/bin/stockfish",
  "/usr/bin/stockfish",
  "/opt/homebrew/bin/stockfish",
  "stockfish", // on PATH
];

async function findExternalBinary(explicit?: string): Promise<string | null> {
  // Node's child_process is accessed via require inside Obsidian's renderer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { execFile } = (globalThis as any).require("child_process") as typeof import("child_process");
  const candidates = explicit ? [explicit] : DEFAULT_SEARCH_PATHS;

  for (const candidate of candidates) {
    const found = await new Promise<boolean>((resolve) => {
      execFile(candidate, ["--version"], { timeout: 2000 }, (err: unknown) => {
        resolve(!err);
      });
    });
    if (found) return candidate;
  }
  return null;
}

function spawnProcess(binaryPath: string): ChildProcess {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { spawn } = (globalThis as any).require("child_process") as typeof import("child_process");
  return spawn(binaryPath, [], { stdio: "pipe" }) as unknown as ChildProcess;
}

export class EngineWorker {
  readonly mode: EngineMode;
  readonly path: string;
  private config: Required<EngineWorkerConfig>;
  private proc: ChildProcess | null = null;
  private binaryPath: string | null = null;

  constructor(config: EngineWorkerConfig) {
    this.mode = config.mode;
    this.path = config.externalPath ?? "";
    this.config = {
      mode: config.mode,
      externalPath: config.externalPath ?? "",
      wasmDir: config.wasmDir ?? "",
      multiPV: config.multiPV ?? 3,
      depth: config.depth ?? 20,
    };
  }

  /** Check whether a usable engine is reachable. */
  async probe(): Promise<boolean> {
    if (this.config.mode === "wasm") {
      if (!this.config.wasmDir) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodePath = (globalThis as any).require("path") as typeof import("path");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fs = (globalThis as any).require("fs") as typeof import("fs");
      const jsPath = nodePath.join(this.config.wasmDir, STOCKFISH_JS);
      return fs.existsSync(jsPath);
    }
    const path = await findExternalBinary(this.config.externalPath || undefined);
    if (path) this.binaryPath = path;
    return path !== null;
  }

  /** Analyse a position. Resolves with the best lines found at the configured depth. */
  async analyse(state: BoardState, history: string[]): Promise<AnalysisResult> {
    if (this.config.mode === "wasm") {
      if (!this.config.wasmDir) throw new Error("wasmDir not configured");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodePath = (globalThis as any).require("path") as typeof import("path");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Worker: NodeWorker } = (globalThis as any).require("worker_threads") as typeof import("worker_threads");
      const jsPath = nodePath.join(this.config.wasmDir, STOCKFISH_JS);
      const bridgePath = nodePath.join(this.config.wasmDir, BRIDGE_JS);
      const wt = new NodeWorker(bridgePath, { workerData: { jsPath, wasmDir: this.config.wasmDir } });
      const worker = adaptWorkerThreads(wt);
      const { depth, multiPV } = this.config;
      const commands = buildUciCommands(state, history, depth, multiPV);
      return runWasmAnalysis(worker, commands);
    }

    if (!this.binaryPath) {
      const path = await findExternalBinary(this.config.externalPath || undefined);
      if (!path) throw new Error("Stockfish binary not found");
      this.binaryPath = path;
    }

    const { depth, multiPV } = this.config;
    const commands = buildUciCommands(state, history, depth, multiPV);

    return new Promise<AnalysisResult>((resolve, reject) => {
      const proc = spawnProcess(this.binaryPath!);
      this.proc = proc;

      const outputLines: string[] = [];
      let buffer = "";
      let resolved = false;
      let readyOkSeen = false;

      const send = (cmd: string): void => { proc.stdin.write(cmd + "\n"); };

      proc.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          outputLines.push(trimmed);

          if (!readyOkSeen && trimmed === "readyok") {
            readyOkSeen = true;
            send(commands[3]); // position
            send(commands[4]); // go depth
          }

          if (!resolved && trimmed.startsWith("bestmove")) {
            resolved = true;
            proc.kill();
            resolve(collectAnalysis(outputLines));
          }
        }
      });

      proc.on("error", (err) => { if (!resolved) reject(err); });
      proc.on("close", (code) => {
        if (!resolved && code !== 0 && code !== null) {
          reject(new Error(`Engine exited with code ${code}`));
        }
      });

      // uci + setoption + isready go immediately; position + go wait for readyok
      send(commands[0]); // uci
      send(commands[1]); // setoption MultiPV
      send(commands[2]); // isready
    });
  }

  dispose(): void {
    this.proc?.kill();
    this.proc = null;
  }
}
