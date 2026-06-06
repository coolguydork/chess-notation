import { describe, it, expect } from "vitest";
import { parseFEN, serializeFEN } from "../../src/core/fen";
import type { BoardState } from "../../src/core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("parseFEN", () => {
  describe("starting position", () => {
    let state: BoardState;
    beforeEach(() => { state = parseFEN(STARTING_FEN); });

    it("places white rook on a1 (index 56)", () => {
      expect(state.board[56]).toEqual({ type: "r", color: "w" });
    });

    it("places black rook on a8 (index 0)", () => {
      expect(state.board[0]).toEqual({ type: "r", color: "b" });
    });

    it("places white king on e1 (index 60)", () => {
      expect(state.board[60]).toEqual({ type: "k", color: "w" });
    });

    it("places black king on e8 (index 4)", () => {
      expect(state.board[4]).toEqual({ type: "k", color: "b" });
    });

    it("leaves the 3rd rank empty", () => {
      const rank3 = Array.from({ length: 8 }, (_, i) => state.board[40 + i]);
      expect(rank3.every(sq => sq === null)).toBe(true);
    });

    it("sets active color to white", () => {
      expect(state.activeColor).toBe("w");
    });

    it("sets all castling rights", () => {
      expect(state.castling).toEqual({
        whiteKingside: true,
        whiteQueenside: true,
        blackKingside: true,
        blackQueenside: true,
      });
    });

    it("sets en passant to null", () => {
      expect(state.enPassant).toBeNull();
    });

    it("sets halfmove clock to 0", () => {
      expect(state.halfmoveClock).toBe(0);
    });

    it("sets fullmove number to 1", () => {
      expect(state.fullmoveNumber).toBe(1);
    });
  });

  describe("active color", () => {
    it("parses black to move", () => {
      const state = parseFEN("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
      expect(state.activeColor).toBe("b");
    });
  });

  describe("castling rights", () => {
    it("parses no castling rights", () => {
      const state = parseFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1");
      expect(state.castling).toEqual({
        whiteKingside: false,
        whiteQueenside: false,
        blackKingside: false,
        blackQueenside: false,
      });
    });

    it("parses partial castling rights (white kingside only)", () => {
      const state = parseFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w K - 0 1");
      expect(state.castling).toEqual({
        whiteKingside: true,
        whiteQueenside: false,
        blackKingside: false,
        blackQueenside: false,
      });
    });
  });

  describe("en passant", () => {
    it("parses an en passant square", () => {
      const state = parseFEN("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
      expect(state.enPassant).toEqual({ file: 4, rank: 2 }); // e3 = file 4, rank 2 (0-indexed)
    });
  });

  describe("move clocks", () => {
    it("parses halfmove clock and fullmove number", () => {
      const state = parseFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 42");
      expect(state.halfmoveClock).toBe(5);
      expect(state.fullmoveNumber).toBe(42);
    });
  });

  describe("error handling", () => {
    it("throws on empty string", () => {
      expect(() => parseFEN("")).toThrow();
    });

    it("throws on wrong number of fields", () => {
      expect(() => parseFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -")).toThrow();
    });

    it("throws on wrong number of ranks", () => {
      expect(() => parseFEN("rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toThrow();
    });

    it("throws on invalid piece character", () => {
      expect(() => parseFEN("rnbqkXnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toThrow();
    });
  });
});

describe("serializeFEN", () => {
  it("round-trips the starting position", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(serializeFEN(parseFEN(fen))).toBe(fen);
  });

  it("round-trips a mid-game position with en passant", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4pP2/8/8/PPPPP1PP/RNBQKBNR w KQkq e6 0 3";
    expect(serializeFEN(parseFEN(fen))).toBe(fen);
  });

  it("round-trips a position with partial castling rights", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R b Kq - 5 20";
    expect(serializeFEN(parseFEN(fen))).toBe(fen);
  });

  it("serializes no castling rights as '-'", () => {
    const fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    expect(serializeFEN(parseFEN(fen))).toBe(fen);
  });
});
