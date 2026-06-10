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
  idleTimeoutMs?: number;                 // quit the engine process after this much inactivity (default 5 min)
  spawnFn?: (binaryPath: string) => ChildProcess; // injectable for tests; defaults to child_process.spawn
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the setoption commands for a session. Strict UCI: these must not be
 * sent until the engine has answered `uci` with `uciok`.
 */
export function buildSetOptionCommands(
  multiPV: number,
  userOptions: Record<string, string> = {}
): string[] {
  return [
    `setoption name MultiPV value ${multiPV}`,
    ...Object.entries(userOptions).map(([k, v]) => `setoption name ${k} value ${v}`),
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

export type ChildProcess = {
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

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
// Any UCI engine answers `uci` immediately, before loading anything heavy.
const UCIOK_TIMEOUT_MS = 10_000;
// `readyok` is where heavyweight engines (e.g. Lc0) load network weights.
const READYOK_TIMEOUT_MS = 60_000;

/** Probe a candidate binary by running a real UCI handshake (uci → uciok). */
async function probeUciBinary(
  candidate: string,
  spawnFn: (binaryPath: string) => ChildProcess
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawnFn(candidate);
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
      try { proc.stdin.write("quit\n"); } catch { /* ignore */ }
      try { proc.kill(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), 3000);
    proc.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.includes("uciok")) finish(true);
    });
    proc.on("error", () => finish(false));
    proc.on("close", () => finish(false));

    try { proc.stdin.write("uci\n"); } catch { finish(false); }
  });
}

/** Find the first auto-discovery candidate that speaks UCI. */
async function findDiscoveredBinary(
  spawnFn: (binaryPath: string) => ChildProcess
): Promise<string | null> {
  for (const candidate of DEFAULT_SEARCH_PATHS) {
    if (await probeUciBinary(candidate, spawnFn)) return candidate;
  }
  return null;
}

/**
 * Check whether a usable UCI engine is reachable — the explicit path when
 * configured, otherwise the auto-discovery candidates. Used to decide whether
 * analysis panels are shown by default; spawns only a short-lived probe, never
 * the persistent process.
 */
export async function probeEngineAvailable(
  explicitPath?: string,
  spawnFn: (binaryPath: string) => ChildProcess = defaultSpawn
): Promise<boolean> {
  if (explicitPath) return probeUciBinary(explicitPath, spawnFn);
  return (await findDiscoveredBinary(spawnFn)) !== null;
}

function defaultSpawn(binaryPath: string): ChildProcess {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { spawn } = (globalThis as any).require("child_process") as typeof import("child_process");
  return spawn(binaryPath, [], { stdio: "pipe" }) as unknown as ChildProcess;
}

interface LineWaiter {
  onLine: (line: string) => void;
  fail: (err: Error) => void;
}

/**
 * Owns a persistent UCI engine process. The process is spawned lazily on the
 * first command, handshaken once (uci → uciok → setoption… → isready →
 * readyok → ucinewgame), reused across analyses, and quit after an idle
 * period so a heavyweight engine doesn't sit in memory between sessions.
 * Commands are serialized through an internal queue; the engine sees one
 * search at a time.
 */
export class EngineWorker {
  readonly path: string;
  readonly userOptionsKey: string;
  readonly depth: number;
  readonly multiPV: number;
  private config: Required<Omit<EngineWorkerConfig, "spawnFn">>;
  private spawnFn: (binaryPath: string) => ChildProcess;
  private binaryPath: string | null = null;
  private proc: ChildProcess | null = null;
  private handshakeDone = false;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private waiter: LineWaiter | null = null;
  private advertisedOptions: UciOptionDef[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(config: EngineWorkerConfig) {
    this.path = config.externalPath ?? "";
    this.userOptionsKey = JSON.stringify(config.userOptions ?? {});
    this.config = {
      externalPath: config.externalPath ?? "",
      multiPV: config.multiPV ?? 3,
      depth: config.depth ?? 20,
      userOptions: config.userOptions ?? {},
      idleTimeoutMs: config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    };
    this.spawnFn = config.spawnFn ?? defaultSpawn;
    this.depth = this.config.depth;
    this.multiPV = this.config.multiPV;
  }

  /** Analyze a position. Resolves with the best lines found at the configured depth. */
  async analyze(state: BoardState, history: string[]): Promise<AnalysisResult> {
    return this.enqueue(async () => {
      this.clearIdleTimer();
      try {
        await this.ensureProcess();
        const lines: string[] = [];
        this.send(positionToUci(state, history));
        this.send(`go depth ${this.config.depth}`);
        // No timeout: deep searches may legitimately run long. If the engine
        // dies instead, the close handler fails this waiter.
        await this.waitFor((l) => l.startsWith("bestmove"), (l) => lines.push(l), null);
        return collectAnalysis(lines);
      } catch (err) {
        this.quitProcess(); // engine state is unknown — start fresh next time
        throw err;
      } finally {
        this.scheduleIdleQuit();
      }
    });
  }

  /**
   * Return all UCI options the engine advertises (collected during the
   * handshake). Returns an empty array if the engine is unreachable.
   */
  async discoverOptions(): Promise<UciOptionDef[]> {
    return this.enqueue(async () => {
      this.clearIdleTimer();
      try {
        await this.ensureProcess();
        return [...this.advertisedOptions];
      } catch {
        // Options are collected during the uciok phase, so they survive an
        // engine that dies later in the handshake — e.g. Lc0 without weights
        // exits at isready, and WeightsFile is exactly the option the user
        // needs to see to fix that.
        return [...this.advertisedOptions];
      } finally {
        this.scheduleIdleQuit();
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.quitProcess();
  }

  // -- process lifecycle ----------------------------------------------------

  private async ensureProcess(): Promise<void> {
    if (this.disposed) throw new Error("Engine worker disposed");
    if (this.proc && this.handshakeDone) return;

    if (!this.binaryPath) {
      if (this.config.externalPath) {
        // Explicit path: spawn directly — the strict handshake below is itself
        // the probe, and heavyweight engines shouldn't be started twice.
        this.binaryPath = this.config.externalPath;
      } else {
        const found = await findDiscoveredBinary(this.spawnFn);
        if (!found) throw new Error("UCI engine binary not found");
        this.binaryPath = found;
      }
    }

    this.proc = this.startProcess(this.binaryPath);
    this.advertisedOptions = [];

    // Strict UCI handshake: nothing but `uci` goes out until the engine
    // answers `uciok`; options are set before the readiness check.
    this.send("uci");
    await this.waitFor(
      (l) => l === "uciok",
      (l) => {
        if (l.startsWith("option ")) {
          const opt = parseOptionLine(l);
          if (opt) this.advertisedOptions.push(opt);
        }
      },
      UCIOK_TIMEOUT_MS
    );
    for (const cmd of buildSetOptionCommands(this.config.multiPV, this.config.userOptions)) {
      this.send(cmd);
    }
    this.send("isready");
    await this.waitFor((l) => l === "readyok", undefined, READYOK_TIMEOUT_MS);
    this.send("ucinewgame");
    this.send("isready");
    await this.waitFor((l) => l === "readyok", undefined, READYOK_TIMEOUT_MS);
    this.handshakeDone = true;
  }

  private startProcess(binaryPath: string): ChildProcess {
    const proc = this.spawnFn(binaryPath);
    this.stderrBuffer = "";
    proc.stdout.on("data", (chunk) => {
      if (this.proc !== proc) return; // late flush from a replaced process
      this.stdoutBuffer += chunk.toString();
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (line) this.waiter?.onLine(line);
      }
    });
    // Drain stderr so chatty engines (Lc0 logs there) never fill the pipe and
    // stall; keep a short tail because fatal config errors (e.g. Lc0 missing
    // weights) are reported there right before the process exits.
    proc.stderr.on("data", (chunk) => {
      if (this.proc !== proc) return;
      this.stderrBuffer = (this.stderrBuffer + chunk.toString()).slice(-500);
    });
    proc.on("error", (err) => {
      if (this.proc === proc) this.onProcessGone(err instanceof Error ? err : new Error(String(err)));
    });
    proc.on("close", () => {
      if (this.proc !== proc) return;
      const tail = this.stderrBuffer.trim().split("\n").slice(-3).join(" | ").trim();
      this.onProcessGone(new Error(tail ? `Engine process exited: ${tail}` : "Engine process exited"));
    });
    return proc;
  }

  private onProcessGone(err: Error): void {
    this.proc = null;
    this.handshakeDone = false;
    this.stdoutBuffer = "";
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.fail(err);
  }

  private quitProcess(): void {
    this.clearIdleTimer();
    const proc = this.proc;
    if (!proc) return;
    this.proc = null; // before kill, so the close handler's guard skips onProcessGone
    this.handshakeDone = false;
    this.stdoutBuffer = "";
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.fail(new Error("Engine process stopped"));
    try { proc.stdin.write("quit\n"); } catch { /* engine may already be gone */ }
    try { proc.kill(); } catch { /* ignore */ }
  }

  private scheduleIdleQuit(): void {
    if (!this.proc) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.quitProcess(), this.config.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // -- protocol plumbing ----------------------------------------------------

  private send(cmd: string): void {
    if (!this.proc) throw new Error("Engine process not running");
    this.proc.stdin.write(cmd + "\n");
  }

  private waitFor(
    predicate: (line: string) => boolean,
    onLine: ((line: string) => void) | undefined,
    timeoutMs: number | null
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = timeoutMs !== null
        ? setTimeout(() => {
            this.waiter = null;
            reject(new Error("Engine did not respond in time"));
          }, timeoutMs)
        : null;
      this.waiter = {
        onLine: (line) => {
          onLine?.(line);
          if (predicate(line)) {
            if (timer) clearTimeout(timer);
            this.waiter = null;
            resolve();
          }
        },
        fail: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      };
    });
  }

  /** Run tasks one at a time; a failed task doesn't poison later ones. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
