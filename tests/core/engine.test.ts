import { describe, it, expect } from "vitest";
import {
  positionToUci,
  parseInfoLine,
  parseBestMove,
  scoreToString,
  type EngineMove,
  type AnalysisResult,
} from "../../src/core/engine";
import { parseFEN } from "../../src/core/fen";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("positionToUci", () => {
  it("emits startpos when FEN is the starting position", () => {
    const state = parseFEN(STARTING_FEN);
    expect(positionToUci(state, [])).toBe("position startpos");
  });

  it("emits startpos with moves when history is present", () => {
    const state = parseFEN(STARTING_FEN);
    expect(positionToUci(state, ["e2e4", "e7e5"])).toBe(
      "position startpos moves e2e4 e7e5"
    );
  });

  it("emits fen for non-starting positions", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const state = parseFEN(fen);
    expect(positionToUci(state, [])).toBe(`position fen ${fen}`);
  });

  it("emits fen with moves for non-starting positions", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const state = parseFEN(fen);
    expect(positionToUci(state, ["e7e5"])).toBe(
      `position fen ${fen} moves e7e5`
    );
  });
});

describe("parseInfoLine", () => {
  it("returns null for non-info lines", () => {
    expect(parseInfoLine("bestmove e2e4")).toBeNull();
    expect(parseInfoLine("uciok")).toBeNull();
    expect(parseInfoLine("readyok")).toBeNull();
  });

  it("parses a complete info line with pv", () => {
    const line =
      "info depth 20 seldepth 28 multipv 1 score cp 30 nodes 1234567 nps 800000 time 1543 pv e2e4 e7e5 g1f3";
    const result = parseInfoLine(line);
    expect(result).not.toBeNull();
    expect(result!.depth).toBe(20);
    expect(result!.score).toEqual({ type: "cp", value: 30 });
    expect(result!.pv).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(result!.multipv).toBe(1);
  });

  it("parses mate score", () => {
    const line = "info depth 5 score mate 3 pv d1h5 f7f6 h5e5";
    const result = parseInfoLine(line);
    expect(result!.score).toEqual({ type: "mate", value: 3 });
  });

  it("parses negative mate score (mated)", () => {
    const line = "info depth 4 score mate -2 pv e1d1";
    const result = parseInfoLine(line);
    expect(result!.score).toEqual({ type: "mate", value: -2 });
  });

  it("parses negative centipawn score", () => {
    const line = "info depth 18 score cp -45 pv e7e5";
    const result = parseInfoLine(line);
    expect(result!.score).toEqual({ type: "cp", value: -45 });
  });

  it("parses multipv index", () => {
    const line = "info depth 15 multipv 3 score cp -10 pv d7d5";
    const result = parseInfoLine(line);
    expect(result!.multipv).toBe(3);
  });

  it("returns null for info lines without pv", () => {
    const line = "info depth 1 seldepth 1 nodes 20 nps 10000 time 2";
    expect(parseInfoLine(line)).toBeNull();
  });
});

describe("parseBestMove", () => {
  it("parses a bestmove line", () => {
    expect(parseBestMove("bestmove e2e4 ponder e7e5")).toBe("e2e4");
  });

  it("parses bestmove without ponder", () => {
    expect(parseBestMove("bestmove d2d4")).toBe("d2d4");
  });

  it("parses promotion moves", () => {
    expect(parseBestMove("bestmove e7e8q")).toBe("e7e8q");
  });

  it("returns null for non-bestmove lines", () => {
    expect(parseBestMove("info depth 20 score cp 30 pv e2e4")).toBeNull();
    expect(parseBestMove("uciok")).toBeNull();
  });

  it("returns null for bestmove (none)", () => {
    expect(parseBestMove("bestmove (none)")).toBeNull();
  });
});

describe("scoreToString", () => {
  it("formats centipawn scores with sign", () => {
    expect(scoreToString({ type: "cp", value: 30 })).toBe("+0.30");
    expect(scoreToString({ type: "cp", value: -45 })).toBe("-0.45");
    expect(scoreToString({ type: "cp", value: 0 })).toBe("0.00");
    expect(scoreToString({ type: "cp", value: 150 })).toBe("+1.50");
  });

  it("formats mate scores", () => {
    expect(scoreToString({ type: "mate", value: 3 })).toBe("M3");
    expect(scoreToString({ type: "mate", value: -2 })).toBe("M-2");
  });
});
