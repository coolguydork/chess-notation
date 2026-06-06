import type { BoardState } from "../core/types";
import type { AnalysisResult, EngineMove, EngineMode } from "../core/engine";
import { positionToUci, parseInfoLine, parseBestMove } from "../core/engine";

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export interface EngineWorkerConfig {
  mode: EngineMode;
  externalPath?: string; // explicit binary path; auto-discovered when absent
  multiPV?: number;      // default 3
  depth?: number;        // default 20
}

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
      multiPV: config.multiPV ?? 3,
      depth: config.depth ?? 20,
    };
  }

  /** Check whether a usable engine is reachable. */
  async probe(): Promise<boolean> {
    if (this.config.mode === "wasm") {
      return false; // WASM not yet bundled
    }
    const path = await findExternalBinary(this.config.externalPath || undefined);
    if (path) this.binaryPath = path;
    return path !== null;
  }

  /** Analyse a position. Resolves with the best lines found at the configured depth. */
  async analyse(state: BoardState, history: string[]): Promise<AnalysisResult> {
    if (this.config.mode === "wasm") {
      throw new Error("WASM engine not yet available");
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
