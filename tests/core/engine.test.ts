import { describe, it, expect } from "vitest";
import {
  positionToUci,
  parseInfoLine,
  parseBestMove,
  parseOptionLine,
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

describe("parseOptionLine", () => {
  it("returns null for non-option lines", () => {
    expect(parseOptionLine("uciok")).toBeNull();
    expect(parseOptionLine("info depth 20 score cp 30 pv e2e4")).toBeNull();
  });

  it("parses a spin option", () => {
    const result = parseOptionLine("option name Hash type spin default 16 min 1 max 33554432");
    expect(result).toEqual({ name: "Hash", type: "spin", default: 16, min: 1, max: 33554432 });
  });

  it("parses a spin option with spaces in the name", () => {
    const result = parseOptionLine("option name Skill Level type spin default 20 min 0 max 20");
    expect(result).toEqual({ name: "Skill Level", type: "spin", default: 20, min: 0, max: 20 });
  });

  it("parses a check option (default true)", () => {
    const result = parseOptionLine("option name Syzygy50MoveRule type check default true");
    expect(result).toEqual({ name: "Syzygy50MoveRule", type: "check", default: true });
  });

  it("parses a check option (default false)", () => {
    const result = parseOptionLine("option name Ponder type check default false");
    expect(result).toEqual({ name: "Ponder", type: "check", default: false });
  });

  it("parses a string option", () => {
    const result = parseOptionLine("option name EvalFile type string default nn-abc123.nnue");
    expect(result).toEqual({ name: "EvalFile", type: "string", default: "nn-abc123.nnue" });
  });

  it("maps <empty> default to empty string for string options", () => {
    const result = parseOptionLine("option name SyzygyPath type string default <empty>");
    expect(result).toEqual({ name: "SyzygyPath", type: "string", default: "" });
  });

  it("parses a button option", () => {
    const result = parseOptionLine("option name Clear Hash type button");
    expect(result).toEqual({ name: "Clear Hash", type: "button" });
  });

  it("parses a combo option", () => {
    const result = parseOptionLine("option name Style type combo default Risky var Solid var Risky var Crazy");
    expect(result).toEqual({ name: "Style", type: "combo", default: "Risky", vars: ["Solid", "Risky", "Crazy"] });
  });

  it("returns null for spin missing min/max", () => {
    expect(parseOptionLine("option name Hash type spin default 16")).toBeNull();
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
