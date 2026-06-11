import { describe, it, expect } from "vitest";
import { parseGames, hasTopLevelResult } from "../../src/pgn-editor/parseGames";
import { isMove, isVariation } from "../../src/pgn-editor/types";
import type { PgnItem, PgnNode } from "../../src/pgn-editor/types";

const moves = (items: PgnItem[]): PgnNode[] => items.filter(isMove);

describe("pgn-editor parseGames", () => {
  it("returns a single game for ordinary PGN", () => {
    const games = parseGames("1. e4 e5 *");
    expect(games).toHaveLength(1);
    expect(moves(games[0].items).map((m) => m.san)).toEqual(["e4", "e5"]);
  });

  it("returns [] for empty / whitespace input", () => {
    expect(parseGames("")).toEqual([]);
    expect(parseGames("   \n  ")).toEqual([]);
  });

  it("splits header-separated games and keeps each game's headers/result", () => {
    const db = `[White "Alice"][Result "1-0"]

1. e4 e5 1-0

[White "Carol"][Result "0-1"]

1. d4 d5 0-1`;
    const games = parseGames(db);
    expect(games).toHaveLength(2);
    expect(games[0].headers.White).toBe("Alice");
    expect(games[0].result).toBe("1-0");
    expect(moves(games[0].items).map((m) => m.san)).toEqual(["e4", "e5"]);
    expect(games[1].headers.White).toBe("Carol");
    expect(games[1].result).toBe("0-1");
    expect(moves(games[1].items).map((m) => m.san)).toEqual(["d4", "d5"]);
  });

  it("splits headerless games on result tokens", () => {
    expect(parseGames("1. e4 * \n 1. d4 * \n 1. c4 *")).toHaveLength(3);
  });

  it("throws when a header block interrupts un-terminated movetext", () => {
    expect(() =>
      parseGames('[White "Carol"]\n1. e4 e5\n[White "Dave"]\n1. d4 d5 *'),
    ).toThrow();
  });

  it("does not split on a result token inside a comment", () => {
    const games = parseGames("1. e4 e5 { White wins 1-0 here } 2. Nf3 1-0");
    expect(games).toHaveLength(1);
    expect(moves(games[0].items).map((m) => m.san)).toEqual(["e4", "e5", "Nf3"]);
  });

  it("does not split inside a variation", () => {
    const games = parseGames("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 1-0");
    expect(games).toHaveLength(1);
    const variation = games[0].items.find(isVariation)!;
    expect(moves(variation.items).map((m) => m.san)).toEqual(["c5", "Nf3"]);
  });

  it("keeps a ']' inside a quoted header value (quote-aware split)", () => {
    const games = parseGames('[Site "a]b"]\n\n1. e4 *');
    expect(games).toHaveLength(1);
    expect(games[0].headers.Site).toBe("a]b");
  });
});

describe("hasTopLevelResult", () => {
  it("detects a top-level result token", () => {
    expect(hasTopLevelResult("1. e4 e5 1-0")).toBe(true);
    expect(hasTopLevelResult("1. e4 e5")).toBe(false);
  });

  it("ignores result-like text inside a comment", () => {
    expect(hasTopLevelResult("1. e4 { 1-0 in 40 }")).toBe(false);
  });
});
