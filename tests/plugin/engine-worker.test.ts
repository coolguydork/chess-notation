import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildUciCommands,
  collectAnalysis,
} from "../../src/plugin/engine-worker";
import { parseFEN } from "../../src/core/fen";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ---------------------------------------------------------------------------
// buildUciCommands
// ---------------------------------------------------------------------------

describe("buildUciCommands", () => {
  it("opens with uci and isready", () => {
    const state = parseFEN(STARTING_FEN);
    const cmds = buildUciCommands(state, [], 15, 3);
    expect(cmds[0]).toBe("uci");
    expect(cmds).toContain("isready");
  });

  it("includes setoption for MultiPV", () => {
    const state = parseFEN(STARTING_FEN);
    const cmds = buildUciCommands(state, [], 15, 3);
    expect(cmds).toContain("setoption name MultiPV value 3");
  });

  it("sends position then go depth", () => {
    const state = parseFEN(STARTING_FEN);
    const cmds = buildUciCommands(state, [], 15, 3);
    const posIdx = cmds.findIndex((c) => c.startsWith("position"));
    const goIdx = cmds.findIndex((c) => c.startsWith("go depth"));
    expect(posIdx).toBeGreaterThan(-1);
    expect(goIdx).toBeGreaterThan(posIdx);
  });

  it("includes history in position command", () => {
    const state = parseFEN(STARTING_FEN);
    const cmds = buildUciCommands(state, ["e2e4", "e7e5"], 15, 1);
    expect(cmds).toContain("position startpos moves e2e4 e7e5");
  });

  it("uses the specified depth in go command", () => {
    const state = parseFEN(STARTING_FEN);
    const cmds = buildUciCommands(state, [], 20, 1);
    expect(cmds).toContain("go depth 20");
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
