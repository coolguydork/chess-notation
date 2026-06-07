import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildUciCommands,
  collectAnalysis,
  runWasmAnalysis,
  type WorkerLike,
  type UciSession,
} from "../../src/plugin/engine-worker";
import { parseFEN } from "../../src/core/fen";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ---------------------------------------------------------------------------
// buildUciCommands
// ---------------------------------------------------------------------------

describe("buildUciCommands", () => {
  it("setup begins with uci and ends with isready", () => {
    const state = parseFEN(STARTING_FEN);
    const session = buildUciCommands(state, [], 15, 3);
    expect(session.setup[0]).toBe("uci");
    expect(session.setup.at(-1)).toBe("isready");
  });

  it("includes setoption for MultiPV in setup", () => {
    const state = parseFEN(STARTING_FEN);
    const session = buildUciCommands(state, [], 15, 3);
    expect(session.setup).toContain("setoption name MultiPV value 3");
  });

  it("includes user options as setoption commands", () => {
    const state = parseFEN(STARTING_FEN);
    const session = buildUciCommands(state, [], 15, 3, { "Skill Level": "10", "Threads": "2" });
    expect(session.setup).toContain("setoption name Skill Level value 10");
    expect(session.setup).toContain("setoption name Threads value 2");
  });

  it("position starts with 'position'", () => {
    const state = parseFEN(STARTING_FEN);
    const session = buildUciCommands(state, [], 15, 3);
    expect(session.position).toMatch(/^position/);
  });

  it("includes history in position command", () => {
    const state = parseFEN(STARTING_FEN);
    const session = buildUciCommands(state, ["e2e4", "e7e5"], 15, 1);
    expect(session.position).toBe("position startpos moves e2e4 e7e5");
  });

  it("uses the specified depth in go command", () => {
    const state = parseFEN(STARTING_FEN);
    const session = buildUciCommands(state, [], 20, 1);
    expect(session.go).toBe("go depth 20");
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
// runWasmAnalysis
// ---------------------------------------------------------------------------

/** Build a fake WorkerLike that emits a scripted sequence of messages. */
function makeFakeWorker(responses: string[]): WorkerLike & { sent: string[] } {
  const sent: string[] = [];
  const worker = {
    sent,
    onmessage: null as ((e: { data: string }) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    terminate: vi.fn(),
    postMessage(msg: string) {
      sent.push(msg);
      // After isready is sent, reply with readyok; after go, reply with info+bestmove
      if (msg === "isready") {
        setTimeout(() => worker.onmessage?.({ data: "readyok" }), 0);
      }
      if (msg.startsWith("go depth")) {
        setTimeout(() => {
          worker.onmessage?.({ data: "info depth 20 multipv 1 score cp 30 pv e2e4 e7e5" });
          worker.onmessage?.({ data: "bestmove e2e4 ponder e7e5" });
        }, 0);
      }
    },
  };
  // Silence unused-variable lint for responses param
  void responses;
  return worker;
}

describe("runWasmAnalysis", () => {
  const session: UciSession = {
    setup: ["uci", "setoption name MultiPV value 3", "isready"],
    position: "position startpos",
    go: "go depth 20",
  };

  it("sends all setup commands immediately", async () => {
    const worker = makeFakeWorker([]);
    await runWasmAnalysis(worker, session);
    expect(worker.sent.slice(0, 3)).toEqual(["uci", "setoption name MultiPV value 3", "isready"]);
  });

  it("sends position and go only after readyok", async () => {
    const worker = makeFakeWorker([]);
    await runWasmAnalysis(worker, session);
    const readyIdx = worker.sent.indexOf("isready");
    const posIdx = worker.sent.indexOf("position startpos");
    expect(posIdx).toBeGreaterThan(readyIdx);
  });

  it("resolves with bestmove from engine output", async () => {
    const worker = makeFakeWorker([]);
    const result = await runWasmAnalysis(worker, session);
    expect(result.bestMove).toBe("e2e4");
  });

  it("collects info lines before bestmove", async () => {
    const worker = makeFakeWorker([]);
    const result = await runWasmAnalysis(worker, session);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0].uci).toBe("e2e4");
  });

  it("terminates the worker after bestmove", async () => {
    const worker = makeFakeWorker([]);
    await runWasmAnalysis(worker, session);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("rejects when worker emits an error", async () => {
    const worker = makeFakeWorker([]);
    const fakeError = { message: "wasm load failed" } as ErrorEvent;
    setTimeout(() => worker.onerror?.(fakeError), 0);
    await expect(runWasmAnalysis(worker, session)).rejects.toThrow("wasm load failed");
  });
});
