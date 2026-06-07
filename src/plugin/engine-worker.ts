import { Platform } from "obsidian";
import type { BoardState } from "../core/types";
import type { AnalysisResult, EngineMove, EngineMode, UciOptionDef } from "../core/engine";
import { positionToUci, parseInfoLine, parseBestMove, parseOptionLine } from "../core/engine";

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export interface EngineWorkerConfig {
  mode: EngineMode;
  externalPath?: string;                  // explicit binary path; auto-discovered when absent
  wasmDir?: string;                       // directory containing the WASM engine files
  wasmJs?: string;                        // JS loader filename (default "stockfish-18-lite-single.js")
  multiPV?: number;                       // default 3
  depth?: number;                         // default 20
  userOptions?: Record<string, string>;   // engine options set by the user (setoption name X value Y)
}

const DEFAULT_WASM_JS = "stockfish-18-lite-single.js";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export interface UciSession {
  /** Sent immediately in order: uci, setoptions, isready. */
  setup: string[];
  /** Sent after readyok. */
  position: string;
  /** Sent immediately after position. */
  go: string;
}

/** Build a UCI analysis session for a position. */
export function buildUciCommands(
  state: BoardState,
  history: string[],
  depth: number,
  multiPV: number,
  userOptions: Record<string, string> = {}
): UciSession {
  const setoptions = [
    `setoption name MultiPV value ${multiPV}`,
    ...Object.entries(userOptions).map(([k, v]) => `setoption name ${k} value ${v}`),
  ];
  return {
    setup: ["uci", ...setoptions, "isready"],
    position: positionToUci(state, history),
    go: `go depth ${depth}`,
  };
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
 * Sends setup commands (uci, setoptions, isready) immediately;
 * position + go are sent after readyok is received.
 */
export function runWasmAnalysis(
  worker: WorkerLike,
  session: UciSession
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
        worker.postMessage(session.position);
        worker.postMessage(session.go);
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

    for (const cmd of session.setup) {
      worker.postMessage(cmd);
    }
  });
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

// Well-known install locations for common UCI engines (Stockfish is most prevalent).
// Only consulted when no explicit path is configured.
const DEFAULT_SEARCH_PATHS = [
  "/usr/local/bin/stockfish",
  "/usr/bin/stockfish",
  "/opt/homebrew/bin/stockfish",
  "stockfish",
];

/** Probe a candidate binary by running a real UCI handshake (uci → uciok). */
async function probeUciBinary(candidate: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { spawn } = (globalThis as any).require("child_process") as typeof import("child_process");
  return new Promise<boolean>((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(candidate, [], { stdio: "pipe" });
    } catch {
      resolve(false);
      return;
    }

    let output = "";
    let done = false;
    const finish = (result: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { proc.stdin?.write("quit\n"); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), 3000);
    proc.stdout?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.includes("uciok")) finish(true);
    });
    proc.on("error", () => finish(false));
    proc.on("close", () => finish(false));

    if (proc.stdin) {
      try { proc.stdin.write("uci\n"); } catch { finish(false); }
    } else {
      finish(false);
    }
  });
}

async function findExternalBinary(explicit?: string): Promise<string | null> {
  const candidates = explicit ? [explicit] : DEFAULT_SEARCH_PATHS;
  for (const candidate of candidates) {
    if (await probeUciBinary(candidate)) return candidate;
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
  readonly userOptionsKey: string;
  private config: Required<EngineWorkerConfig>;
  private proc: ChildProcess | null = null;
  private binaryPath: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wasmEngine: any = null;

  constructor(config: EngineWorkerConfig) {
    this.mode = config.mode;
    this.path = config.externalPath ?? "";
    this.userOptionsKey = JSON.stringify(config.userOptions ?? {});
    this.config = {
      mode: config.mode,
      externalPath: config.externalPath ?? "",
      wasmDir: config.wasmDir ?? "",
      wasmJs: config.wasmJs ?? DEFAULT_WASM_JS,
      multiPV: config.multiPV ?? 3,
      depth: config.depth ?? 20,
      userOptions: config.userOptions ?? {},
    };
  }

  private get useWasm(): boolean {
    return this.config.mode === "wasm" || (this.config.mode === "auto" && Platform.isMobile);
  }

  /** Check whether a usable engine is reachable. */
  async probe(): Promise<boolean> {
    if (this.useWasm) {
      if (!this.config.wasmDir) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodePath = (globalThis as any).require("path") as typeof import("path");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fs = (globalThis as any).require("fs") as typeof import("fs");
      const jsPath = nodePath.join(this.config.wasmDir, this.config.wasmJs);
      return fs.existsSync(jsPath);
    }
    const path = await findExternalBinary(this.config.externalPath || undefined);
    if (path) this.binaryPath = path;
    return path !== null;
  }

  /** Initialise the WASM engine once and cache it on the instance. */
  private async getWasmEngine(): Promise<unknown> {
    if (this.wasmEngine) return this.wasmEngine;
    if (!this.config.wasmDir) throw new Error("wasmDir not configured");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = (globalThis as any).require as NodeRequire;
    const nodePath = req("path") as typeof import("path");
    const wasmDir = this.config.wasmDir;
    const wasmJs = this.config.wasmJs;
    // Derive the .wasm filename from the .js filename; override with a separate
    // config key if a future WASM engine uses a different naming convention.
    const wasmBin = wasmJs.replace(/\.js$/, ".wasm");
    const wasmPath = nodePath.join(wasmDir, wasmBin);

    // The JS file exports an outer factory; calling it returns the inner
    // Emscripten factory. Calling the inner factory with a config object extends
    // that object in-place with the full WASM module (ccall, _isReady, etc).
    // NOTE: this loading strategy is specific to Stockfish's Emscripten build.
    const outerFactory = req(nodePath.join(wasmDir, wasmJs)) as () => (cfg: object) => Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine: any = {
      // The Emscripten module internally requests "stockfish.wasm" (hardcoded).
      // Redirect any .wasm request to the actual versioned file alongside main.js.
      locateFile: (file: string) =>
        file.includes(".wasm") && !file.includes(".wasm.map")
          ? wasmPath
          : nodePath.join(wasmDir, file),
    };
    await outerFactory()(engine);

    // Poll until Stockfish's UCI loop has started (mirrors what the package's index.js does).
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (!engine._isReady || engine._isReady()) return resolve();
        setTimeout(check, 10);
      };
      check();
    });

    this.wasmEngine = engine;
    return engine;
  }

  /** Analyze a position. Resolves with the best lines found at the configured depth. */
  async analyze(state: BoardState, history: string[]): Promise<AnalysisResult> {
    const { depth, multiPV, userOptions } = this.config;
    const session = buildUciCommands(state, history, depth, multiPV, userOptions);

    if (this.useWasm) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const engine: any = await this.getWasmEngine();
      const outputLines: string[] = [];
      let readyOkSeen = false;

      // Wrap ccall so every command is deferred via setImmediate.
      // This matches what the package's index.js does and prevents nested ccall
      // calls from breaking asyncify's state machine.
      const send = (cmd: string): void => {
        setImmediate(() => {
          engine.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
        });
      };

      return new Promise<AnalysisResult>((resolve, reject) => {
        engine.listener = (line: string): void => {
          const trimmed = line.trim();
          if (!trimmed) return;
          outputLines.push(trimmed);

          if (!readyOkSeen && trimmed === "readyok") {
            readyOkSeen = true;
            send(session.position);
            send(session.go);
            return;
          }

          if (trimmed.startsWith("bestmove")) {
            resolve(collectAnalysis(outputLines));
          }
        };

        engine.onAbort = (err: unknown): void => reject(new Error(String(err)));

        // On re-analysis, reset engine state before sending a new position.
        send("ucinewgame");
        // Send all setoptions (skipping "uci" at index 0, "isready" at end)
        for (const cmd of session.setup.slice(1, -1)) send(cmd);
        send("isready"); // wait for readyok before position + go
      });
    }

    if (!this.binaryPath) {
      const path = await findExternalBinary(this.config.externalPath || undefined);
      if (!path) throw new Error("UCI engine binary not found");
      this.binaryPath = path;
    }

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
            send(session.position);
            send(session.go);
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

      for (const cmd of session.setup) send(cmd);
    });
  }

  /**
   * Probe the engine binary and return all UCI options it advertises.
   * Returns an empty array when using WASM mode or if the binary is unreachable.
   */
  async discoverOptions(): Promise<UciOptionDef[]> {
    if (this.useWasm) return [];

    const binaryPath = this.binaryPath
      ?? await findExternalBinary(this.config.externalPath || undefined);
    if (!binaryPath) return [];

    return new Promise<UciOptionDef[]>((resolve) => {
      let proc: ChildProcess;
      try { proc = spawnProcess(binaryPath); }
      catch { resolve([]); return; }

      const options: UciOptionDef[] = [];
      let buffer = "";
      let done = false;

      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { proc.kill(); } catch { /* ignore */ }
        resolve(options);
      };

      const timer = setTimeout(finish, 3000);

      proc.stdout.on("data", (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("option ")) {
            const opt = parseOptionLine(trimmed);
            if (opt) options.push(opt);
          }
          if (trimmed === "uciok") finish();
        }
      });

      proc.on("error", () => { clearTimeout(timer); resolve([]); });
      proc.on("close", () => { clearTimeout(timer); resolve(options); });

      proc.stdin.write("uci\n");
    });
  }

  dispose(): void {
    this.proc?.kill();
    this.proc = null;
    if (this.wasmEngine) {
      try { this.wasmEngine.ccall("command", null, ["string"], ["quit"], { async: false }); } catch { /* ignore */ }
      this.wasmEngine = null;
    }
  }
}
