import type { BoardState } from "../core/types";
import type { AnalysisResult, EngineMove, UciOptionDef } from "../core/engine";
import { positionToUci, parseInfoLine, parseBestMove, parseOptionLine } from "../core/engine";

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export interface EngineWorkerConfig {
  externalPath?: string;                  // explicit binary path; auto-discovered when absent
  multiPV?: number;                       // default 3
  depth?: number;                         // default 20
  userOptions?: Record<string, string>;   // engine options set by the user (setoption name X value Y)
}

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
  readonly path: string;
  readonly userOptionsKey: string;
  private config: Required<EngineWorkerConfig>;
  private proc: ChildProcess | null = null;
  private binaryPath: string | null = null;

  constructor(config: EngineWorkerConfig) {
    this.path = config.externalPath ?? "";
    this.userOptionsKey = JSON.stringify(config.userOptions ?? {});
    this.config = {
      externalPath: config.externalPath ?? "",
      multiPV: config.multiPV ?? 3,
      depth: config.depth ?? 20,
      userOptions: config.userOptions ?? {},
    };
  }

  /** Check whether a usable engine is reachable. */
  async probe(): Promise<boolean> {
    const path = await findExternalBinary(this.config.externalPath || undefined);
    if (path) this.binaryPath = path;
    return path !== null;
  }

  /** Analyze a position. Resolves with the best lines found at the configured depth. */
  async analyze(state: BoardState, history: string[]): Promise<AnalysisResult> {
    const { depth, multiPV, userOptions } = this.config;
    const session = buildUciCommands(state, history, depth, multiPV, userOptions);

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
   * Returns an empty array if the binary is unreachable.
   */
  async discoverOptions(): Promise<UciOptionDef[]> {
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
  }
}
