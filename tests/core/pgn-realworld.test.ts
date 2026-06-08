import { describe, it, expect } from "vitest";
import { parsePGN, parseMultiPGN } from "../../src/core/pgn";

// Real-world exports the hand-rolled parser was never tested against. These
// exercise the robustness gained by delegating to @mliebelt/pgn-parser.

describe("real-world PGN (library-backed)", () => {
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
    expect(game.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
    // pure-clock comments leave no text comment behind
    expect(game.moves.every((m) => m.comment === undefined)).toBe(true);
  });

  it("keeps the text and strips the annotations in mixed eval/clock comments", () => {
    const pgn = `[Result "*"]

1. d4 { [%eval 0.17] [%clk 0:10:00] A quiet start } d5 { [%eval 0.12] } *`;
    const game = parsePGN(pgn);
    expect(game.moves[0].comment).toBe("A quiet start");
    expect(game.moves[1].comment).toBeUndefined();
  });

  it("parses a study export with nested variations, NAGs and comments", () => {
    const pgn = `[Event "?"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 $1 { Morphy Defence }
( 3... Nf6 $5 { Berlin } 4. O-O Nxe4 ( 4... Bc5 ) 5. d4 )
4. Ba4 Nf6 5. O-O *`;
    const game = parsePGN(pgn);
    expect(game.moves[5].san).toBe("a6");
    expect(game.moves[5].nags).toContain(1);
    expect(game.moves[5].comment).toBe("Morphy Defence");
    const berlin = game.moves[5].variations![0];
    expect(berlin.map((m) => m.san)).toEqual(["Nf6", "O-O", "Nxe4", "d4"]);
    expect(berlin[0].nags).toContain(5);
    expect(berlin[0].comment).toBe("Berlin");
    // nested variation on 4. O-O Nxe4 -> (4... Bc5)
    expect(berlin[2].variations![0].map((m) => m.san)).toEqual(["Bc5"]);
  });

  it("parses higher-numbered NAGs ($14 unclear, $16 advantage)", () => {
    const game = parsePGN("[Result \"*\"]\n\n1. e4 $14 e5 $16 *");
    expect(game.moves[0].nags).toEqual([14]);
    expect(game.moves[1].nags).toEqual([16]);
  });

  it("preserves -- and Z0 null moves distinctly (round-trip fidelity)", () => {
    const game = parsePGN("[Result \"*\"]\n\n1. e4 -- 2. d4 Z0 *");
    expect(game.moves.map((m) => m.san)).toEqual(["e4", "--", "d4", "Z0"]);
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
    expect(games[1].moves.map((m) => m.san)).toEqual(["e4", "c5", "Nf3", "d6"]);
  });
});
