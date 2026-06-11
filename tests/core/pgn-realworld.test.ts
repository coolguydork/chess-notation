import { describe, it, expect } from "vitest";
import { parsePGN, parseMultiPGN, cleanComment } from "../../src/core/pgn";
import { isMove, isComment, isVariation } from "../../src/pgn-editor";
import type { PgnItem, PgnNode, PgnComment, PgnVariation } from "../../src/pgn-editor";

// Real-world exports (Lichess/study/multi-game). These exercise the robustness
// of our own pgn-editor parser through the core parsePGN/parseMultiPGN API.

const movesOf = (items: PgnItem[]): PgnNode[] => items.filter(isMove);
const commentsOf = (items: PgnItem[]): PgnComment[] => items.filter(isComment);
const variationsOf = (items: PgnItem[]): PgnVariation[] => items.filter(isVariation);

describe("real-world PGN", () => {
  it("parses a Lichess blitz export with per-move clock annotations", () => {
    const pgn = `[Event "Rated Blitz game"]
[Site "https://lichess.org/abcd1234"]
[White "alice"]
[Black "bob"]
[Result "1-0"]
[UTCDate "2024.03.15"]
[WhiteElo "1623"]
[BlackElo "1601"]
[TimeControl "180+2"]
[ECO "C50"]
[Opening "Italian Game"]
[Termination "Normal"]

1. e4 { [%clk 0:03:00] } e5 { [%clk 0:03:00] } 2. Nf3 { [%clk 0:02:58] } Nc6 { [%clk 0:02:57] } 3. Bc4 { [%clk 0:02:55] } Bc5 { [%clk 0:02:56] } 1-0`;
    const game = parsePGN(pgn);
    expect(game.headers["Opening"]).toBe("Italian Game");
    expect(game.headers["ECO"]).toBe("C50");
    expect(game.result).toBe("1-0");
    expect(movesOf(game.items).map((m) => m.san)).toEqual(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
    // the raw clock annotations survive in the stream (write-back fidelity)…
    expect(commentsOf(game.items)).toHaveLength(6);
    // …but every one of them cleans to nothing for display
    expect(commentsOf(game.items).every((c) => cleanComment(c.text) === "")).toBe(true);
  });

  it("keeps the text and strips the annotations in mixed eval/clock comments", () => {
    const pgn = `[Result "*"]

1. d4 { [%eval 0.17] [%clk 0:10:00] A quiet start } d5 { [%eval 0.12] } *`;
    const game = parsePGN(pgn);
    const comments = commentsOf(game.items);
    expect(cleanComment(comments[0].text)).toBe("A quiet start");
    expect(cleanComment(comments[1].text)).toBe("");
  });

  it("parses a study export with nested variations, NAGs and comments", () => {
    const pgn = `[Event "?"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 $1 { Morphy Defence }
( 3... Nf6 $5 { Berlin } 4. O-O Nxe4 ( 4... Bc5 ) 5. d4 )
4. Ba4 Nf6 5. O-O *`;
    const game = parsePGN(pgn);
    const moves = movesOf(game.items);
    expect(moves[5].san).toBe("a6");
    expect(moves[5].nags).toContain(1);
    // "{ Morphy Defence }" is the stream item right after a6
    const a6Index = game.items.indexOf(moves[5]);
    expect(game.items[a6Index + 1]).toMatchObject({ kind: "comment", text: "Morphy Defence" });

    const berlin = variationsOf(game.items)[0];
    const berlinMoves = movesOf(berlin.items);
    expect(berlinMoves.map((m) => m.san)).toEqual(["Nf6", "O-O", "Nxe4", "d4"]);
    expect(berlinMoves[0].nags).toContain(5);
    expect(berlin.items[1]).toMatchObject({ kind: "comment", text: "Berlin" });
    // nested variation on 4. O-O Nxe4 -> (4... Bc5)
    const nested = variationsOf(berlin.items)[0];
    expect(movesOf(nested.items).map((m) => m.san)).toEqual(["Bc5"]);
  });

  it("parses higher-numbered NAGs ($14 unclear, $16 advantage)", () => {
    const game = parsePGN("[Result \"*\"]\n\n1. e4 $14 e5 $16 *");
    expect(movesOf(game.items)[0].nags).toEqual([14]);
    expect(movesOf(game.items)[1].nags).toEqual([16]);
  });

  it("preserves -- and Z0 null moves distinctly (round-trip fidelity)", () => {
    const game = parsePGN("[Result \"*\"]\n\n1. e4 -- 2. d4 Z0 *");
    expect(movesOf(game.items).map((m) => m.san)).toEqual(["e4", "--", "d4", "Z0"]);
  });

  it("parses a multi-game database export (PGN with several games)", () => {
    const db = `[Event "Round 1"]
[White "Carlsen, Magnus"]
[Black "Nakamura, Hikaru"]
[Result "1/2-1/2"]

1. c4 e5 2. g3 Nf6 1/2-1/2

[Event "Round 2"]
[White "Caruana, Fabiano"]
[Black "Ding, Liren"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 1-0`;
    const games = parseMultiPGN(db);
    expect(games).toHaveLength(2);
    expect(games[0].headers["White"]).toBe("Carlsen, Magnus");
    expect(games[0].result).toBe("1/2-1/2");
    expect(games[1].headers["Black"]).toBe("Ding, Liren");
    expect(movesOf(games[1].items).map((m) => m.san)).toEqual(["e4", "c5", "Nf3", "d6"]);
  });
});
