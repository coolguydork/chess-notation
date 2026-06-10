import { describe, it, expect } from "vitest";
import { parsePGN, parseMultiPGN, serializeMoveTree } from "../../src/core/pgn";
import { buildMoveTree } from "../../src/render/controls";
import type { PgnGame } from "../../src/core/types";

describe("parsePGN", () => {
  describe("headers", () => {
    it("parses standard seven-tag roster", () => {
      const pgn = `[Event "Casual Game"]
[Site "London"]
[Date "2024.01.01"]
[Round "1"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 1-0`;
      const game = parsePGN(pgn);
      expect(game.headers["Event"]).toBe("Casual Game");
      expect(game.headers["White"]).toBe("Alice");
      expect(game.headers["Black"]).toBe("Bob");
      expect(game.headers["Result"]).toBe("1-0");
    });

    it("handles headers with special characters in value", () => {
      const pgn = `[White "O'Brien, Dr. James"]
[Result "*"]

*`;
      const game = parsePGN(pgn);
      expect(game.headers["White"]).toBe("O'Brien, Dr. James");
    });

    it("parses game with no headers", () => {
      const game = parsePGN("1. e4 e5 *");
      expect(game.headers).toEqual({});
    });
  });

  describe("result", () => {
    it("parses 1-0", () => {
      expect(parsePGN("1. e4 1-0").result).toBe("1-0");
    });

    it("parses 0-1", () => {
      expect(parsePGN("1. e4 e5 0-1").result).toBe("0-1");
    });

    it("parses 1/2-1/2", () => {
      expect(parsePGN("1. e4 e5 1/2-1/2").result).toBe("1/2-1/2");
    });

    it("parses * (ongoing)", () => {
      expect(parsePGN("1. e4 e5 *").result).toBe("*");
    });
  });

  describe("moves — basic", () => {
    it("parses a single white move", () => {
      const game = parsePGN("1. e4 *");
      expect(game.moves).toHaveLength(1);
      expect(game.moves[0]).toMatchObject({ san: "e4", moveNumber: 1, color: "w" });
    });

    it("parses white and black move in one turn", () => {
      const game = parsePGN("1. e4 e5 *");
      expect(game.moves).toHaveLength(2);
      expect(game.moves[0]).toMatchObject({ san: "e4", moveNumber: 1, color: "w" });
      expect(game.moves[1]).toMatchObject({ san: "e5", moveNumber: 1, color: "b" });
    });

    it("parses multiple turns with correct move numbers", () => {
      const game = parsePGN("1. e4 e5 2. Nf3 Nc6 3. Bb5 *");
      expect(game.moves).toHaveLength(5);
      expect(game.moves[2]).toMatchObject({ san: "Nf3", moveNumber: 2, color: "w" });
      expect(game.moves[3]).toMatchObject({ san: "Nc6", moveNumber: 2, color: "b" });
      expect(game.moves[4]).toMatchObject({ san: "Bb5", moveNumber: 3, color: "w" });
    });

    it("handles black-to-move continuation marker (e.g. '3... Nc6')", () => {
      const game = parsePGN("1. e4 e5 2. Nf3 {comment} 2... Nc6 *");
      expect(game.moves[3]).toMatchObject({ san: "Nc6", moveNumber: 2, color: "b" });
    });
  });

  describe("moves — SAN notation variety", () => {
    it("parses kingside castling", () => {
      const game = parsePGN("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *");
      expect(game.moves[6]).toMatchObject({ san: "O-O", color: "w" });
    });

    it("parses queenside castling", () => {
      const game = parsePGN("1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. O-O-O *");
      expect(game.moves[6]).toMatchObject({ san: "O-O-O", color: "w" });
    });

    it("parses promotion", () => {
      const game = parsePGN("1. e8=Q *");
      expect(game.moves[0]).toMatchObject({ san: "e8=Q", color: "w" });
    });

    it("parses check and checkmate suffixes", () => {
      const game = parsePGN("1. e4 e5 2. Qh5+ *");
      expect(game.moves[2]).toMatchObject({ san: "Qh5+", color: "w" });
    });

    it("parses disambiguation (file, rank, full square)", () => {
      const game = parsePGN("1. Raa1 Rbb8 2. R1a2 *");
      expect(game.moves[0].san).toBe("Raa1");
      expect(game.moves[1].san).toBe("Rbb8");
      expect(game.moves[2].san).toBe("R1a2");
    });
  });

  describe("comments", () => {
    it("attaches a comment after a move", () => {
      const game = parsePGN("1. e4 {This opens the center} e5 *");
      expect(game.moves[0].comment).toBe("This opens the center");
    });

    it("attaches comment to the correct move", () => {
      const game = parsePGN("1. e4 e5 {A solid reply} 2. Nf3 *");
      expect(game.moves[0].comment).toBeUndefined();
      expect(game.moves[1].comment).toBe("A solid reply");
      expect(game.moves[2].comment).toBeUndefined();
    });

    it("trims whitespace from comments", () => {
      const game = parsePGN("1. e4 {  spaces  } *");
      expect(game.moves[0].comment).toBe("spaces");
    });

    it("handles multiline comments (whitespace normalised to spaces)", () => {
      const game = parsePGN("1. e4 {\nLine one\nLine two\n} *");
      expect(game.moves[0].comment).toBe("Line one Line two");
    });

    it("projects a pre-move comment to commentBefore", () => {
      // A comment before the move (here, before move 1) is the AST's commentMove,
      // surfaced as commentBefore on the move it precedes.
      const game = parsePGN("{ Opening intro } 1. e4 e5 *");
      expect(game.moves[0].commentBefore).toBe("Opening intro");
      expect(game.moves[0].comment).toBeUndefined();
    });

    it("projects a between-number-and-move comment to commentMid", () => {
      // A comment between the move number and the SAN is the AST's commentBefore
      // (the rare middle slot), surfaced as commentMid on the move.
      const game = parsePGN("1. { sharpest } e4 e5 *");
      expect(game.moves[0].commentMid).toBe("sharpest");
      expect(game.moves[0].commentBefore).toBeUndefined();
      expect(game.moves[0].comment).toBeUndefined();
    });

    it("absorbs consecutive comments into the preceding move's after-slot", () => {
      // PGN can't unambiguously split a comment between "after move A" and
      // "before move B": both attach to A. commentBefore is produced only for a
      // genuinely leading comment (e.g. a game or variation intro).
      const game = parsePGN("1. e4 { good } { also good } e5 *");
      expect(game.moves[0].comment).toBe("good also good");
      expect(game.moves[1].commentBefore).toBeUndefined();
    });
  });

  describe("NAGs (Numeric Annotation Glyphs)", () => {
    it("parses $1 (good move)", () => {
      const game = parsePGN("1. e4! *");
      expect(game.moves[0].nags).toContain(1);
    });

    it("parses $2 (poor move)", () => {
      const game = parsePGN("1. e4? *");
      expect(game.moves[0].nags).toContain(2);
    });

    it("parses $3 (brilliant)", () => {
      const game = parsePGN("1. e4!! *");
      expect(game.moves[0].nags).toContain(3);
    });

    it("parses $4 (blunder)", () => {
      const game = parsePGN("1. e4?? *");
      expect(game.moves[0].nags).toContain(4);
    });

    it("parses $5 (interesting)", () => {
      const game = parsePGN("1. e4!? *");
      expect(game.moves[0].nags).toContain(5);
    });

    it("parses $6 (dubious)", () => {
      const game = parsePGN("1. e4?! *");
      expect(game.moves[0].nags).toContain(6);
    });

    it("parses explicit $N notation", () => {
      const game = parsePGN("1. e4 $10 *");
      expect(game.moves[0].nags).toContain(10);
    });

    it("parses multiple NAGs on one move", () => {
      const game = parsePGN("1. e4!? $10 *");
      expect(game.moves[0].nags).toContain(5);
      expect(game.moves[0].nags).toContain(10);
    });
  });

  describe("variations", () => {
    it("parses a single variation", () => {
      const game = parsePGN("1. e4 (1. d4 d5) e5 *");
      expect(game.moves[0].variations).toHaveLength(1);
      expect(game.moves[0].variations![0][0]).toMatchObject({ san: "d4", moveNumber: 1, color: "w" });
    });

    it("parses moves inside a variation", () => {
      const game = parsePGN("1. e4 e5 2. Nf3 (2. Nc3 Nc6) Nc6 *");
      const variation = game.moves[2].variations![0];
      expect(variation[0]).toMatchObject({ san: "Nc3", moveNumber: 2, color: "w" });
      expect(variation[1]).toMatchObject({ san: "Nc6", moveNumber: 2, color: "b" });
    });

    it("parses multiple variations on the same move", () => {
      const game = parsePGN("1. e4 (1. d4) (1. c4) e5 *");
      expect(game.moves[0].variations).toHaveLength(2);
      expect(game.moves[0].variations![0][0].san).toBe("d4");
      expect(game.moves[0].variations![1][0].san).toBe("c4");
    });

    it("parses nested variations", () => {
      const game = parsePGN("1. e4 (1. d4 (1. c4) d5) e5 *");
      const outerVar = game.moves[0].variations![0];
      expect(outerVar[0].san).toBe("d4");
      expect(outerVar[0].variations).toHaveLength(1);
      expect(outerVar[0].variations![0][0].san).toBe("c4");
    });

    it("does not add variations property when there are none", () => {
      const game = parsePGN("1. e4 e5 *");
      expect(game.moves[0].variations).toBeUndefined();
    });
  });

  describe("whitespace and formatting", () => {
    it("handles extra whitespace between tokens", () => {
      const game = parsePGN("1.  e4   e5   2.  Nf3  *");
      expect(game.moves).toHaveLength(3);
    });

    it("handles move text with no space after move number dot", () => {
      const game = parsePGN("1.e4 e5 *");
      expect(game.moves[0].san).toBe("e4");
    });

    it("handles Windows-style line endings", () => {
      const game = parsePGN("[White \"Alice\"]\r\n[Black \"Bob\"]\r\n\r\n1. e4 e5 *");
      expect(game.headers["White"]).toBe("Alice");
      expect(game.moves).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("throws on empty string", () => {
      expect(() => parsePGN("")).toThrow();
    });

    it("throws when result token is missing", () => {
      expect(() => parsePGN("1. e4 e5")).toThrow();
    });
  });

  describe("clock/eval annotation stripping", () => {
    it("strips [%clk ...] from comment text", () => {
      const game = parsePGN("1. e4 { [%clk 1:30:00] } e5 *");
      // comment is purely a clock annotation → no comment token emitted
      expect(game.moves[0].comment).toBeUndefined();
    });

    it("strips [%eval ...] and keeps surrounding text", () => {
      const game = parsePGN("1. e4 { [%eval +0.54] Good move } e5 *");
      expect(game.moves[0].comment).toBe("Good move");
    });

    it("strips multiple annotations from one comment", () => {
      const game = parsePGN("1. e4 { [%clk 1:00:00][%eval +0.3] Solid opening } e5 *");
      expect(game.moves[0].comment).toBe("Solid opening");
    });

    it("preserves comments that contain no annotations", () => {
      const game = parsePGN("1. e4 { This is fine } e5 *");
      expect(game.moves[0].comment).toBe("This is fine");
    });

    it("strips any [%xxx ...] pattern regardless of command name", () => {
      const game = parsePGN("1. e4 { [%emt 0:00:03][%mct 1:00:00] } e5 *");
      expect(game.moves[0].comment).toBeUndefined();
    });
  });

  describe("null moves", () => {
    it("parses -- as a san token", () => {
      const game = parsePGN("1. e4 e5 2. -- Nc6 *");
      expect(game.moves[2].san).toBe("--");
      expect(game.moves[2].moveNumber).toBe(2);
      expect(game.moves[2].color).toBe("w");
    });

    it("parses Z0 as a san token", () => {
      const game = parsePGN("1. e4 e5 2. Z0 Nc6 *");
      expect(game.moves[2].san).toBe("Z0");
    });

    it("null move in a variation", () => {
      const game = parsePGN("1. e4 (1. -- e5) e5 *");
      expect(game.moves[0].variations![0][0].san).toBe("--");
    });
  });
});

// ---------------------------------------------------------------------------
// parseMultiPGN
// ---------------------------------------------------------------------------

describe("parseMultiPGN", () => {
  const twoGames = `[White "Alice"][Black "Bob"][Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0

[White "Carol"][Black "Dave"][Result "0-1"]

1. d4 d5 2. c4 e6 0-1`;

  it("returns a single game for ordinary PGN", () => {
    const games = parseMultiPGN("1. e4 e5 *");
    expect(games).toHaveLength(1);
    expect(games[0].moves[0].san).toBe("e4");
  });

  it("parses two games and preserves headers for each", () => {
    const games = parseMultiPGN(twoGames);
    expect(games).toHaveLength(2);
    expect(games[0].headers["White"]).toBe("Alice");
    expect(games[1].headers["White"]).toBe("Carol");
  });

  it("parses moves for each game independently", () => {
    const games = parseMultiPGN(twoGames);
    expect(games[0].moves[0].san).toBe("e4");
    expect(games[1].moves[0].san).toBe("d4");
  });

  it("records the correct result for each game", () => {
    const games = parseMultiPGN(twoGames);
    expect(games[0].result).toBe("1-0");
    expect(games[1].result).toBe("0-1");
  });

  it("handles three or more games", () => {
    const three = "1. e4 * \n 1. d4 * \n 1. c4 *";
    expect(parseMultiPGN(three)).toHaveLength(3);
  });

  it("throws on empty input", () => {
    expect(() => parseMultiPGN("")).toThrow();
  });

  it("throws when a game is missing its result token before the next header block", () => {
    // The header signals a new game; the first game has no result before it
    expect(() => parseMultiPGN('[White "Carol"]\n1. e4 e5\n[White "Dave"]\n1. d4 d5 *')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// serializeMoveTree
// ---------------------------------------------------------------------------

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function roundTrip(pgn: string): string {
  const { moves, result } = parsePGN(pgn);
  const root = buildMoveTree(STARTING_FEN, moves);
  return serializeMoveTree(root, result);
}

describe("serializeMoveTree", () => {
  it("serializes a simple mainline", () => {
    const out = roundTrip("1. e4 e5 2. Nf3 Nc6 *");
    const { moves } = parsePGN(out);
    expect(moves.map(m => m.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  it("preserves the result token", () => {
    const out = roundTrip("1. e4 e5 1-0");
    expect(out.trim().endsWith("1-0")).toBe(true);
  });

  it("emits * for an unknown result", () => {
    const { moves } = parsePGN("1. d4 *");
    const root = buildMoveTree(STARTING_FEN, moves);
    const out = serializeMoveTree(root);
    expect(out.trim().endsWith("*")).toBe(true);
  });

  it("serializes NAGs as $N tokens", () => {
    const out = roundTrip("1. e4! e5? *");
    // $1 = !, $2 = ?
    expect(out).toContain("$1");
    expect(out).toContain("$2");
    const { moves } = parsePGN(out);
    expect(moves[0].nags).toEqual([1]);
    expect(moves[1].nags).toEqual([2]);
  });

  it("serializes inline comments", () => {
    const out = roundTrip("1. e4 { good move } e5 *");
    expect(out).toContain("{ good move }");
    const { moves } = parsePGN(out);
    expect(moves[0].comment).toBe("good move");
  });

  it("serializes a single variation", () => {
    const out = roundTrip("1. e4 e5 ( 1... c5 ) 2. Nf3 *");
    expect(out).toContain("(");
    expect(out).toContain(")");
    const { moves } = parsePGN(out);
    // mainline: e4 e5 Nf3
    expect(moves.map(m => m.san)).toEqual(["e4", "e5", "Nf3"]);
    // variation on e5's move: c5
    expect(moves[1].variations?.[0].map(m => m.san)).toEqual(["c5"]);
  });

  it("serializes nested variations", () => {
    const out = roundTrip("1. e4 e5 ( 1... c5 2. Nf3 ( 2. d4 ) ) *");
    const { moves } = parsePGN(out);
    const outerVar = moves[1].variations?.[0];
    expect(outerVar?.map(m => m.san)).toEqual(["c5", "Nf3"]);
    const innerVar = outerVar?.[1].variations?.[0];
    expect(innerVar?.map(m => m.san)).toEqual(["d4"]);
  });

  it("serializes multiple variations on the same move", () => {
    const out = roundTrip("1. e4 e5 ( 1... c5 ) ( 1... e6 ) *");
    const { moves } = parsePGN(out);
    expect(moves[1].variations?.length).toBe(2);
    expect(moves[1].variations?.[0].map(m => m.san)).toEqual(["c5"]);
    expect(moves[1].variations?.[1].map(m => m.san)).toEqual(["e6"]);
  });

  it("round-trips a realistic game fragment with variations and comments", () => {
    const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 { Ruy Lopez } a6 ( 3... Nf6 { Berlin } 4. O-O ) 4. Ba4 *";
    const out = roundTrip(pgn);
    const { moves } = parsePGN(out);
    expect(moves[4].comment).toBe("Ruy Lopez");
    expect(moves[5].variations?.[0].map(m => m.san)).toEqual(["Nf6", "O-O"]);
    expect(moves[5].variations?.[0][0].comment).toBe("Berlin");
  });

  it("emits move numbers correctly after variations", () => {
    const out = roundTrip("1. e4 e5 ( 1... c5 ) 2. Nf3 *");
    // After the variation closes, black's reply was e5 (mainline),
    // then 2. Nf3 — the serialized form should have "2." before Nf3
    expect(out).toMatch(/2\.\s*Nf3/);
  });

  it("produces output that is parseable by parsePGN", () => {
    const complex = "1. d4 d5 2. c4 e6 ( 2... c6 3. Nf3 ) 3. Nc3 Nf6 *";
    const out = roundTrip(complex);
    expect(() => parsePGN(out)).not.toThrow();
  });
});
