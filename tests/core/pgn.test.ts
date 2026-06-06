import { describe, it, expect } from "vitest";
import { parsePGN } from "../../src/core/pgn";
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

    it("handles multiline comments", () => {
      const game = parsePGN("1. e4 {\nLine one\nLine two\n} *");
      expect(game.moves[0].comment).toBe("Line one\nLine two");
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
});
