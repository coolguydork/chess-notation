import { describe, it, expect, vi } from "vitest";
import {
  buildSetOptionCommands,
  collectAnalysis,
  probeEngineAvailable,
  EngineWorker,
  type ChildProcess,
  type EngineWorkerConfig,
} from "../../src/plugin/engine-worker";
import { parseFEN } from "../../src/core/fen";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// buildSetOptionCommands
// ---------------------------------------------------------------------------

describe("buildSetOptionCommands", () => {
  it("includes setoption for MultiPV", () => {
    const cmds = buildSetOptionCommands(3);
    expect(cmds).toContain("setoption name MultiPV value 3");
  });

  it("includes user options as setoption commands", () => {
    const cmds = buildSetOptionCommands(3, { "Skill Level": "10", "Threads": "2" });
    expect(cmds).toContain("setoption name Skill Level value 10");
    expect(cmds).toContain("setoption name Threads value 2");
  });
});

// ---------------------------------------------------------------------------
// collectAnalysis
// ---------------------------------------------------------------------------

describe("collectAnalysis", () => {
  it("returns null bestMove and empty moves for empty output", () => {
    const result = collectAnalysis([]);
    expect(result.bestMove).toBeNull();
    expect(result.moves).toHaveLength(0);
  });

  it("picks up bestmove line", () => {
    const lines = [
      "info depth 20 multipv 1 score cp 30 pv e2e4 e7e5",
      "bestmove e2e4 ponder e7e5",
    ];
    const result = collectAnalysis(lines);
    expect(result.bestMove).toBe("e2e4");
  });

  it("collects one move per multipv index (last update wins)", () => {
    const lines = [
      "info depth 10 multipv 1 score cp 30 pv e2e4",
      "info depth 10 multipv 2 score cp 20 pv d2d4",
      "info depth 20 multipv 1 score cp 35 pv e2e4 e7e5",
      "info depth 20 multipv 2 score cp 22 pv d2d4 d7d5",
      "bestmove e2e4",
    ];
    const result = collectAnalysis(lines);
    expect(result.moves).toHaveLength(2);
    expect(result.moves[0].depth).toBe(20);
    expect(result.moves[1].depth).toBe(20);
  });

  it("sorts moves by multipv index", () => {
    const lines = [
      "info depth 20 multipv 2 score cp 20 pv d2d4",
      "info depth 20 multipv 1 score cp 35 pv e2e4",
      "info depth 20 multipv 3 score cp 10 pv c2c4",
      "bestmove e2e4",
    ];
    const result = collectAnalysis(lines);
    expect(result.moves.map((m) => m.multipv)).toEqual([1, 2, 3]);
  });

  it("handles mate score in info lines", () => {
    const lines = [
      "info depth 5 multipv 1 score mate 2 pv d1h5 f7f6 h5e5",
      "bestmove d1h5",
    ];
    const result = collectAnalysis(lines);
    expect(result.moves[0].score).toEqual({ type: "mate", value: 2 });
  });

  it("returns null bestMove when bestmove is (none)", () => {
    const lines = ["bestmove (none)"];
    expect(collectAnalysis(lines).bestMove).toBeNull();
  });

  it("ignores non-info non-bestmove lines", () => {
    const lines = ["uciok", "readyok", "bestmove e2e4"];
    const result = collectAnalysis(lines);
    expect(result.bestMove).toBe("e2e4");
    expect(result.moves).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// EngineWorker state machine (persistent process, strict UCI handshake)
// ---------------------------------------------------------------------------

/**
 * Scripted fake engine. Records every command it receives ("> cmd") and every
 * line it emits ("< line") in one chronological log, and answers like a UCI
 * engine on the next macrotask (real engines reply asynchronously).
 */
class FakeEngine implements ChildProcess {
  log: string[] = [];
  killed = false;
  /** Override the response to `go` (e.g. to simulate an engine crash). */
  onGo: (() => void) | null = null;
  /** Override the response to `isready` (e.g. an engine that dies loading weights). */
  onIsReady: (() => void) | null = null;
  /** Override the response to `uci` (e.g. a binary that isn't a UCI engine). */
  onUci: (() => void) | null = null;
  private stdoutCb: ((chunk: Buffer | string) => void) | null = null;
  private stderrCb: ((chunk: Buffer | string) => void) | null = null;
  private closeCb: ((...args: unknown[]) => void) | null = null;
  private errorCb: ((...args: unknown[]) => void) | null = null;

  stdin = {
    write: (data: string): void => {
      for (const cmd of data.split("\n")) {
        if (!cmd) continue;
        this.log.push(`> ${cmd}`);
        setTimeout(() => this.respond(cmd), 0);
      }
    },
  };
  stdout = {
    on: (_event: "data", cb: (chunk: Buffer | string) => void): void => {
      this.stdoutCb = cb;
    },
  };
  stderr = {
    on: (_event: "data", cb: (chunk: Buffer | string) => void): void => {
      this.stderrCb = cb;
    },
  };

  on(event: "close" | "error", cb: (...args: unknown[]) => void): void {
    if (event === "close") this.closeCb = cb;
    else this.errorCb = cb;
  }

  kill(): void {
    this.killed = true;
  }

  emit(line: string): void {
    this.log.push(`< ${line}`);
    this.stdoutCb?.(line + "\n");
  }

  emitClose(): void {
    this.closeCb?.(1);
  }

  emitStderr(text: string): void {
    this.stderrCb?.(text + "\n");
  }

  emitError(err: Error): void {
    this.errorCb?.(err);
  }

  defaultGo(): void {
    this.emit("info depth 12 multipv 1 score cp 30 pv e2e4 e7e5");
    this.emit("bestmove e2e4");
  }

  private respond(cmd: string): void {
    if (cmd === "uci") {
      if (this.onUci) {
        this.onUci();
        return;
      }
      this.emit("id name FakeEngine 1.0");
      this.emit("option name MultiPV type spin default 1 min 1 max 500");
      this.emit("option name Threads type spin default 1 min 1 max 512");
      this.emit("uciok");
    } else if (cmd === "isready") {
      if (this.onIsReady) this.onIsReady();
      else this.emit("readyok");
    } else if (cmd.startsWith("go")) {
      if (this.onGo) this.onGo();
      else this.defaultGo();
    }
  }
}

function makeWorker(
  overrides: Partial<EngineWorkerConfig> = {},
  configureProc?: (proc: FakeEngine) => void
): { worker: EngineWorker; procs: FakeEngine[]; spawnFn: ReturnType<typeof vi.fn> } {
  const procs: FakeEngine[] = [];
  const spawnFn = vi.fn((_binaryPath: string): ChildProcess => {
    const proc = new FakeEngine();
    configureProc?.(proc);
    procs.push(proc);
    return proc;
  });
  const worker = new EngineWorker({
    externalPath: "/fake/engine",
    multiPV: 3,
    depth: 12,
    idleTimeoutMs: 20,
    spawnFn,
    ...overrides,
  });
  return { worker, procs, spawnFn };
}

describe("probeEngineAvailable", () => {
  it("probes the explicit path and resolves true on uciok", async () => {
    const procs: FakeEngine[] = [];
    const spawnFn = vi.fn((_p: string): ChildProcess => {
      const proc = new FakeEngine();
      procs.push(proc);
      return proc;
    });
    await expect(probeEngineAvailable("/fake/lc0", spawnFn)).resolves.toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith("/fake/lc0");
    expect(procs[0].killed).toBe(true); // the probe cleans up after itself
  });

  it("resolves false when the binary exits without uciok", async () => {
    const spawnFn = vi.fn((_p: string): ChildProcess => {
      const proc = new FakeEngine();
      proc.onUci = () => proc.emitClose();
      return proc;
    });
    await expect(probeEngineAvailable("/fake/not-an-engine", spawnFn)).resolves.toBe(false);
  });

  it("walks the auto-discovery candidates when no path is given", async () => {
    const spawnFn = vi.fn((_p: string): ChildProcess => new FakeEngine());
    await expect(probeEngineAvailable(undefined, spawnFn)).resolves.toBe(true);
    expect(spawnFn.mock.calls[0][0]).toBe("/usr/local/bin/stockfish");
  });

  it("resolves false when no candidate can be spawned", async () => {
    const spawnFn = vi.fn((_p: string): ChildProcess => {
      throw new Error("ENOENT");
    });
    await expect(probeEngineAvailable(undefined, spawnFn)).resolves.toBe(false);
    expect(spawnFn.mock.calls.length).toBeGreaterThan(1); // tried every candidate
  });
});

describe("EngineWorker", () => {
  const state = parseFEN(STARTING_FEN);

  it("sends nothing but uci until the engine answers uciok", async () => {
    const { worker, procs } = makeWorker({ userOptions: { Threads: "2" } });
    await worker.analyze(state, []);
    const log = procs[0].log;
    expect(log[0]).toBe("> uci");
    const uciokIdx = log.indexOf("< uciok");
    const writesBeforeUciok = log.slice(0, uciokIdx).filter((e) => e.startsWith("> "));
    expect(writesBeforeUciok).toEqual(["> uci"]);
  });

  it("sends setoptions after uciok, then isready", async () => {
    const { worker, procs } = makeWorker({ userOptions: { Threads: "2" } });
    await worker.analyze(state, []);
    const log = procs[0].log;
    const uciokIdx = log.indexOf("< uciok");
    const multiPvIdx = log.indexOf("> setoption name MultiPV value 3");
    const threadsIdx = log.indexOf("> setoption name Threads value 2");
    const isreadyIdx = log.indexOf("> isready");
    expect(multiPvIdx).toBeGreaterThan(uciokIdx);
    expect(threadsIdx).toBeGreaterThan(uciokIdx);
    expect(isreadyIdx).toBeGreaterThan(multiPvIdx);
    expect(isreadyIdx).toBeGreaterThan(threadsIdx);
  });

  it("waits for readyok before sending ucinewgame, position, and go", async () => {
    const { worker, procs } = makeWorker();
    await worker.analyze(state, []);
    const log = procs[0].log;
    const firstReadyokIdx = log.indexOf("< readyok");
    const newGameIdx = log.indexOf("> ucinewgame");
    const lastReadyokIdx = log.lastIndexOf("< readyok");
    const positionIdx = log.indexOf("> position startpos");
    const goIdx = log.indexOf("> go depth 12");
    expect(newGameIdx).toBeGreaterThan(firstReadyokIdx);
    expect(positionIdx).toBeGreaterThan(lastReadyokIdx);
    expect(goIdx).toBeGreaterThan(positionIdx);
  });

  it("resolves with the parsed analysis", async () => {
    const { worker } = makeWorker();
    const result = await worker.analyze(state, []);
    expect(result.bestMove).toBe("e2e4");
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0].score).toEqual({ type: "cp", value: 30 });
  });

  it("reuses the process and handshake across analyses", async () => {
    const { worker, procs, spawnFn } = makeWorker();
    await worker.analyze(state, []);
    await worker.analyze(state, ["e2e4"]);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const log = procs[0].log;
    expect(log.filter((e) => e === "> uci")).toHaveLength(1);
    expect(log.filter((e) => e.startsWith("> go"))).toHaveLength(2);
    expect(log).toContain("> position startpos moves e2e4");
  });

  it("serializes overlapping analyses through one process", async () => {
    const { worker, procs, spawnFn } = makeWorker();
    const [r1, r2] = await Promise.all([
      worker.analyze(state, []),
      worker.analyze(state, ["e2e4"]),
    ]);
    expect(r1.bestMove).toBe("e2e4");
    expect(r2.bestMove).toBe("e2e4");
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const log = procs[0].log;
    const firstBestIdx = log.indexOf("< bestmove e2e4");
    const secondPositionIdx = log.indexOf("> position startpos moves e2e4");
    expect(secondPositionIdx).toBeGreaterThan(firstBestIdx);
  });

  it("quits the engine after the idle timeout and respawns on next use", async () => {
    const { worker, procs, spawnFn } = makeWorker();
    await worker.analyze(state, []);
    await sleep(60); // idleTimeoutMs is 20
    expect(procs[0].log).toContain("> quit");
    expect(procs[0].killed).toBe(true);

    const result = await worker.analyze(state, []);
    expect(result.bestMove).toBe("e2e4");
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(procs[1].log.filter((e) => e === "> uci")).toHaveLength(1);
  });

  it("returns the options advertised during the handshake from discoverOptions", async () => {
    const { worker, spawnFn } = makeWorker();
    const opts = await worker.discoverOptions();
    expect(opts).toEqual([
      { name: "MultiPV", type: "spin", default: 1, min: 1, max: 500 },
      { name: "Threads", type: "spin", default: 1, min: 1, max: 512 },
    ]);
    // discoverOptions and a following analyze share one process
    await worker.analyze(state, []);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("rejects when the engine dies mid-search and recovers on the next analyze", async () => {
    let dieOnGo = true;
    const { worker, spawnFn } = makeWorker({}, (proc) => {
      proc.onGo = () => {
        if (dieOnGo) proc.emitClose();
        else proc.defaultGo();
      };
    });

    await expect(worker.analyze(state, [])).rejects.toThrow();

    dieOnGo = false;
    const result = await worker.analyze(state, []);
    expect(result.bestMove).toBe("e2e4");
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });

  it("returns options from the uciok phase even when the engine dies at isready", async () => {
    // Lc0 without a weights file: answers uci/uciok fine, exits while loading
    // the network at isready. The advertised options must still come through —
    // they include the very option (WeightsFile) needed to fix the setup.
    const { worker } = makeWorker({}, (proc) => {
      proc.onIsReady = () => proc.emitClose();
    });
    const opts = await worker.discoverOptions();
    expect(opts.map((o) => o.name)).toEqual(["MultiPV", "Threads"]);
  });

  it("includes the stderr tail in the error when the engine exits", async () => {
    const { worker } = makeWorker({}, (proc) => {
      proc.onGo = () => {
        proc.emitStderr("Cannot open weights file: <autodiscover>");
        proc.emitClose();
      };
    });
    await expect(worker.analyze(state, [])).rejects.toThrow(
      /Engine process exited: Cannot open weights file/
    );
  });

  it("dispose kills the process and later analyses reject", async () => {
    const { worker, procs } = makeWorker();
    await worker.analyze(state, []);
    worker.dispose();
    expect(procs[0].killed).toBe(true);
    await expect(worker.analyze(state, [])).rejects.toThrow(/disposed/);
  });
});
