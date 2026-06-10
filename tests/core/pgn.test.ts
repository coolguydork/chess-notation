import { describe, it, expect } from "vitest";
import { parsePGN, parseMultiPGN } from "../../src/core/pgn";
import { buildMoveTree } from "../../src/core/tree";
import { isMove, isComment, isVariation } from "../../src/pgn-editor";
import type { PgnItem, PgnNode, PgnVariation } from "../../src/pgn-editor";

// The moves of one line in order, skipping comment/variation items.
const movesOf = (items: PgnItem[]): PgnNode[] => items.filter(isMove);

// Compact stream shape for position assertions: "e4" | "{text}" | "(...)".
const shape = (items: PgnItem[]): string[] =>
  items.map((it) => (it.kind === "move" ? it.san : it.kind === "comment" ? `{${it.text}}` : "(...)"));

const variationsOf = (items: PgnItem[]): PgnVariation[] => items.filter(isVariation);

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
      expect(movesOf(game.items)).toHaveLength(1);
      expect(movesOf(game.items)[0]).toMatchObject({ san: "e4", moveNumber: 1, color: "w" });
    });

    it("parses white and black move in one turn", () => {
      const game = parsePGN("1. e4 e5 *");
      expect(movesOf(game.items)).toHaveLength(2);
      expect(movesOf(game.items)[0]).toMatchObject({ san: "e4", moveNumber: 1, color: "w" });
      expect(movesOf(game.items)[1]).toMatchObject({ san: "e5", moveNumber: 1, color: "b" });
    });

    it("parses multiple turns with correct move numbers", () => {
      const game = parsePGN("1. e4 e5 2. Nf3 Nc6 3. Bb5 *");
      const moves = movesOf(game.items);
      expect(moves).toHaveLength(5);
      expect(moves[2]).toMatchObject({ san: "Nf3", moveNumber: 2, color: "w" });
      expect(moves[3]).toMatchObject({ san: "Nc6", moveNumber: 2, color: "b" });
      expect(moves[4]).toMatchObject({ san: "Bb5", moveNumber: 3, color: "w" });
    });

    it("handles black-to-move continuation marker (e.g. '3... Nc6')", () => {
      const game = parsePGN("1. e4 e5 2. Nf3 {comment} 2... Nc6 *");
      expect(movesOf(game.items)[3]).toMatchObject({ san: "Nc6", moveNumber: 2, color: "b" });
    });
  });

  describe("moves — SAN notation variety", () => {
    it("parses kingside castling", () => {
      const game = parsePGN("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *");
      expect(movesOf(game.items)[6]).toMatchObject({ san: "O-O", color: "w" });
    });

    it("parses queenside castling", () => {
      const game = parsePGN("1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. O-O-O *");
      expect(movesOf(game.items)[6]).toMatchObject({ san: "O-O-O", color: "w" });
    });

    it("parses promotion", () => {
      const game = parsePGN("1. e8=Q *");
      expect(movesOf(game.items)[0]).toMatchObject({ san: "e8=Q", color: "w" });
    });

    it("parses check and checkmate suffixes", () => {
      const game = parsePGN("1. e4 e5 2. Qh5+ *");
      expect(movesOf(game.items)[2]).toMatchObject({ san: "Qh5+", color: "w" });
    });

    it("parses disambiguation (file, rank, full square)", () => {
      const game = parsePGN("1. Raa1 Rbb8 2. R1a2 *");
      const moves = movesOf(game.items);
      expect(moves[0].san).toBe("Raa1");
      expect(moves[1].san).toBe("Rbb8");
      expect(moves[2].san).toBe("R1a2");
    });
  });

  describe("comments — positional stream items", () => {
    it("keeps a comment where it was written, after the move it follows", () => {
      const game = parsePGN("1. e4 {This opens the center} e5 *");
      expect(shape(game.items)).toEqual(["e4", "{This opens the center}", "e5"]);
    });

    it("trims whitespace from comments", () => {
      const game = parsePGN("1. e4 {  spaces  } *");
      expect(shape(game.items)).toEqual(["e4", "{spaces}"]);
    });

    it("handles multiline comments (whitespace normalised to spaces)", () => {
      const game = parsePGN("1. e4 {\nLine one\nLine two\n} *");
      expect(shape(game.items)).toEqual(["e4", "{Line one Line two}"]);
    });

    it("keeps a leading comment as the first stream item", () => {
      const game = parsePGN("{ Opening intro } 1. e4 e5 *");
      expect(shape(game.items)).toEqual(["{Opening intro}", "e4", "e5"]);
    });

    it("keeps a between-number-and-move comment on the move (commentMid)", () => {
      const game = parsePGN("1. { sharpest } e4 e5 *");
      expect(movesOf(game.items)[0].commentMid).toBe("sharpest");
      expect(shape(game.items)).toEqual(["e4", "e5"]);
    });

    it("keeps consecutive comments as separate items (no merging)", () => {
      const game = parsePGN("1. e4 { good } { also good } e5 *");
      expect(shape(game.items)).toEqual(["e4", "{good}", "{also good}", "e5"]);
    });
  });

  describe("NAGs (Numeric Annotation Glyphs)", () => {
    it("parses $1 (good move)", () => {
      expect(movesOf(parsePGN("1. e4! *").items)[0].nags).toContain(1);
    });

    it("parses $2 (poor move)", () => {
      expect(movesOf(parsePGN("1. e4? *").items)[0].nags).toContain(2);
    });

    it("parses $3 (brilliant)", () => {
      expect(movesOf(parsePGN("1. e4!! *").items)[0].nags).toContain(3);
    });

    it("parses $4 (blunder)", () => {
      expect(movesOf(parsePGN("1. e4?? *").items)[0].nags).toContain(4);
    });

    it("parses $5 (interesting)", () => {
      expect(movesOf(parsePGN("1. e4!? *").items)[0].nags).toContain(5);
    });

    it("parses $6 (dubious)", () => {
      expect(movesOf(parsePGN("1. e4?! *").items)[0].nags).toContain(6);
    });

    it("parses explicit $N notation", () => {
      expect(movesOf(parsePGN("1. e4 $10 *").items)[0].nags).toContain(10);
    });

    it("parses multiple NAGs on one move", () => {
      const nags = movesOf(parsePGN("1. e4!? $10 *").items)[0].nags;
      expect(nags).toContain(5);
      expect(nags).toContain(10);
    });
  });

  describe("variations", () => {
    it("parses a single variation as a stream item after the move", () => {
      const game = parsePGN("1. e4 (1. d4 d5) e5 *");
      expect(shape(game.items)).toEqual(["e4", "(...)", "e5"]);
      const v = variationsOf(game.items)[0];
      expect(movesOf(v.items)[0]).toMatchObject({ san: "d4", moveNumber: 1, color: "w" });
    });

    it("parses moves inside a variation", () => {
      const game = parsePGN("1. e4 e5 2. Nf3 (2. Nc3 Nc6) Nc6 *");
      const v = variationsOf(game.items)[0];
      expect(movesOf(v.items)[0]).toMatchObject({ san: "Nc3", moveNumber: 2, color: "w" });
      expect(movesOf(v.items)[1]).toMatchObject({ san: "Nc6", moveNumber: 2, color: "b" });
    });

    it("parses multiple variations on the same move", () => {
      const game = parsePGN("1. e4 (1. d4) (1. c4) e5 *");
      const vs = variationsOf(game.items);
      expect(vs).toHaveLength(2);
      expect(movesOf(vs[0].items)[0].san).toBe("d4");
      expect(movesOf(vs[1].items)[0].san).toBe("c4");
    });

    it("parses nested variations", () => {
      const game = parsePGN("1. e4 (1. d4 (1. c4) d5) e5 *");
      const outer = variationsOf(game.items)[0];
      expect(movesOf(outer.items)[0].san).toBe("d4");
      const inner = variationsOf(outer.items)[0];
      expect(movesOf(inner.items)[0].san).toBe("c4");
    });
  });

  describe("whitespace and formatting", () => {
    it("handles extra whitespace between tokens", () => {
      const game = parsePGN("1.  e4   e5   2.  Nf3  *");
      expect(movesOf(game.items)).toHaveLength(3);
    });

    it("handles move text with no space after move number dot", () => {
      const game = parsePGN("1.e4 e5 *");
      expect(movesOf(game.items)[0].san).toBe("e4");
    });

    it("handles Windows-style line endings", () => {
      const game = parsePGN("[White \"Alice\"]\r\n[Black \"Bob\"]\r\n\r\n1. e4 e5 *");
      expect(game.headers["White"]).toBe("Alice");
      expect(movesOf(game.items)).toHaveLength(2);
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

  describe("null moves", () => {
    it("parses -- as a san token", () => {
      const game = parsePGN("1. e4 e5 2. -- Nc6 *");
      const moves = movesOf(game.items);
      expect(moves[2].san).toBe("--");
      expect(moves[2].moveNumber).toBe(2);
      expect(moves[2].color).toBe("w");
    });

    it("parses Z0 as a san token", () => {
      expect(movesOf(parsePGN("1. e4 e5 2. Z0 Nc6 *").items)[2].san).toBe("Z0");
    });

    it("null move in a variation", () => {
      const game = parsePGN("1. e4 (1. -- e5) e5 *");
      expect(movesOf(variationsOf(game.items)[0].items)[0].san).toBe("--");
    });
  });
});

// ---------------------------------------------------------------------------
// clock/eval annotation stripping — a display concern: the AST keeps the raw
// text (so write-back preserves [%clk]/[%eval]); the projection cleans it.
// ---------------------------------------------------------------------------

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// The display comments following the first move of the projected tree.
function firstMoveComments(pgn: string): string[] {
  const game = parsePGN(pgn);
  const root = buildMoveTree(STARTING_FEN, game.items);
  return root.next!.tail
    .filter((t): t is Extract<typeof t, { kind: "comment" }> => t.kind === "comment")
    .map((t) => t.comment.text);
}

describe("clock/eval annotation stripping (projection)", () => {
  it("keeps the raw annotation in the AST", () => {
    const game = parsePGN("1. e4 { [%clk 1:30:00] } e5 *");
    expect(shape(game.items)).toEqual(["e4", "{[%clk 1:30:00]}", "e5"]);
  });

  it("drops a comment that is purely a clock annotation from display", () => {
    expect(firstMoveComments("1. e4 { [%clk 1:30:00] } e5 *")).toEqual([]);
  });

  it("strips [%eval ...] and keeps surrounding text", () => {
    expect(firstMoveComments("1. e4 { [%eval +0.54] Good move } e5 *")).toEqual(["Good move"]);
  });

  it("strips multiple annotations from one comment", () => {
    expect(firstMoveComments("1. e4 { [%clk 1:00:00][%eval +0.3] Solid opening } e5 *")).toEqual(["Solid opening"]);
  });

  it("preserves comments that contain no annotations", () => {
    expect(firstMoveComments("1. e4 { This is fine } e5 *")).toEqual(["This is fine"]);
  });

  it("strips any [%xxx ...] pattern regardless of command name", () => {
    expect(firstMoveComments("1. e4 { [%emt 0:00:03][%mct 1:00:00] } e5 *")).toEqual([]);
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
    expect(movesOf(games[0].items)[0].san).toBe("e4");
  });

  it("parses two games and preserves headers for each", () => {
    const games = parseMultiPGN(twoGames);
    expect(games).toHaveLength(2);
    expect(games[0].headers["White"]).toBe("Alice");
    expect(games[1].headers["White"]).toBe("Carol");
  });

  it("parses moves for each game independently", () => {
    const games = parseMultiPGN(twoGames);
    expect(movesOf(games[0].items)[0].san).toBe("e4");
    expect(movesOf(games[1].items)[0].san).toBe("d4");
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
