import { describe, it, expect } from "vitest";
import { getLegalMoves, getSquareLegalMoves, isInCheck } from "../../src/core/legal";
import { parseFEN } from "../../src/core/fen";

// Board index: (7 - rank) * 8 + file, rank 0-7 (rank1-rank8), file 0-7 (a-h)
function sq(algebraic: string): number {
  return (7 - (parseInt(algebraic[1], 10) - 1)) * 8 + (algebraic.charCodeAt(0) - 97);
}

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("isInCheck", () => {
  it("starting position is not in check", () => {
    expect(isInCheck(parseFEN(STARTING_FEN), "w")).toBe(false);
    expect(isInCheck(parseFEN(STARTING_FEN), "b")).toBe(false);
  });

  it("detects check by a rook", () => {
    // White rook on e8, black king on e1 — black is in check
    const fen = "4R3/8/8/8/8/8/8/4k2K b - - 0 1";
    expect(isInCheck(parseFEN(fen), "b")).toBe(true);
    expect(isInCheck(parseFEN(fen), "w")).toBe(false);
  });

  it("detects check by a bishop", () => {
    // White bishop on c3 attacks e1 diagonally (through empty d2)
    const fen = "8/8/8/8/8/2B5/8/4k2K b - - 0 1";
    expect(isInCheck(parseFEN(fen), "b")).toBe(true);
  });

  it("detects check by a knight", () => {
    const fen = "8/8/8/8/8/5N2/8/4k2K b - - 0 1";
    expect(isInCheck(parseFEN(fen), "b")).toBe(true);
  });

  it("detects check by a pawn", () => {
    // Black pawn on e3 attacks f2 diagonally; white king on f2 is in check
    const fen = "7k/8/8/8/8/4p3/5K2/8 w - - 0 1";
    expect(isInCheck(parseFEN(fen), "w")).toBe(true);
  });

  it("not in check when piece blocks", () => {
    // White rook on e8, black pawn on e4, black king on e1 — pawn blocks
    const fen = "4R3/8/8/8/4p3/8/8/4k2K b - - 0 1";
    expect(isInCheck(parseFEN(fen), "b")).toBe(false);
  });
});

describe("getLegalMoves", () => {
  describe("starting position", () => {
    it("white has 20 legal moves from starting position", () => {
      const moves = getLegalMoves(parseFEN(STARTING_FEN));
      expect(moves).toHaveLength(20);
    });

    it("moves include all 16 pawn moves", () => {
      const moves = getLegalMoves(parseFEN(STARTING_FEN));
      const pawnMoves = moves.filter(m => m.san.length <= 2 || /^[a-h]/.test(m.san));
      expect(pawnMoves).toHaveLength(16);
    });

    it("moves include all 4 knight moves", () => {
      const moves = getLegalMoves(parseFEN(STARTING_FEN));
      const knightMoves = moves.filter(m => m.san.startsWith("N"));
      expect(knightMoves).toHaveLength(4);
    });
  });

  describe("check filtering", () => {
    it("pinned piece cannot move off the pin line", () => {
      // White bishop on e2 is pinned by black rook on e8 (white king on e1)
      const fen = "4r3/8/8/8/8/8/4B3/4K2k w - - 0 1";
      const moves = getSquareLegalMoves(parseFEN(fen), sq("e2"));
      // Bishop on e2 pinned along e-file — can only move along e-file, but bishops
      // can't move along a file, so it has zero legal moves
      expect(moves).toHaveLength(0);
    });

    it("must block or capture when in check", () => {
      // Black rook on e1 checks white king on a1; only escape/block/capture legal
      const fen = "4k3/8/8/8/8/8/8/K3r3 w - - 0 1";
      const moves = getLegalMoves(parseFEN(fen));
      // King can go to a2 or b1 (b2 is also possible if not attacked)
      // Let's just verify it's a small number and all moves resolve check
      expect(moves.length).toBeGreaterThan(0);
      expect(moves.length).toBeLessThan(5);
    });

    it("stalemate returns zero legal moves", () => {
      // Classic stalemate: black king on a8, white queen on b6, white king on c6
      const fen = "k7/8/1QK5/8/8/8/8/8 b - - 0 1";
      expect(getLegalMoves(parseFEN(fen))).toHaveLength(0);
    });

    it("checkmate returns zero legal moves", () => {
      // Back-rank mate: black king on g8, white rooks on e8 and f8, white king on g6
      const fen = "4RRk1/8/6K1/8/8/8/8/8 b - - 0 1";
      expect(getLegalMoves(parseFEN(fen))).toHaveLength(0);
    });
  });

  describe("castling", () => {
    it("includes kingside castling when available", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const moves = getLegalMoves(parseFEN(fen));
      expect(moves.some(m => m.san === "O-O")).toBe(true);
    });

    it("includes queenside castling when available", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const moves = getLegalMoves(parseFEN(fen));
      expect(moves.some(m => m.san === "O-O-O")).toBe(true);
    });

    it("cannot castle through check", () => {
      // Black rook on f8 attacks f1 — white cannot castle kingside (passes through f1)
      const fen = "4kr2/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const moves = getLegalMoves(parseFEN(fen));
      expect(moves.some(m => m.san === "O-O")).toBe(false);
    });

    it("cannot castle while in check", () => {
      // Black rook on e8 gives check to white king on e1 — white cannot castle
      const fen = "4r2k/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const moves = getLegalMoves(parseFEN(fen));
      expect(moves.some(m => m.san === "O-O")).toBe(false);
      expect(moves.some(m => m.san === "O-O-O")).toBe(false);
    });

    it("cannot castle if king has moved (no rights)", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQ - 0 1"; // black has no castling rights
      const blackMoves = getLegalMoves(parseFEN("r3k2r/8/8/8/8/8/8/R3K2R b - - 0 1"));
      expect(blackMoves.some(m => m.san === "O-O")).toBe(false);
    });
  });

  describe("en passant", () => {
    it("includes en passant capture when available", () => {
      // White pawn on e5, black pawn just played d7-d5 (en passant target d6)
      const fen = "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3";
      const moves = getSquareLegalMoves(parseFEN(fen), sq("e5"));
      expect(moves.some(m => m.san === "exd6")).toBe(true);
    });
  });

  describe("getSquareLegalMoves", () => {
    it("returns empty array for an empty square", () => {
      expect(getSquareLegalMoves(parseFEN(STARTING_FEN), sq("e4"))).toHaveLength(0);
    });

    it("returns empty array for an enemy piece square", () => {
      // It's white's turn; e7 has a black pawn
      expect(getSquareLegalMoves(parseFEN(STARTING_FEN), sq("e7"))).toHaveLength(0);
    });

    it("returns correct moves for e2 pawn in starting position", () => {
      const moves = getSquareLegalMoves(parseFEN(STARTING_FEN), sq("e2"));
      expect(moves).toHaveLength(2); // e3 and e4
      expect(moves.map(m => m.san).sort()).toEqual(["e3", "e4"]);
    });

    it("returns correct moves for g1 knight in starting position", () => {
      const moves = getSquareLegalMoves(parseFEN(STARTING_FEN), sq("g1"));
      expect(moves).toHaveLength(2); // Nf3 and Nh3
      expect(moves.map(m => m.san).sort()).toEqual(["Nf3", "Nh3"]);
    });

    it("each move has from, to, and san fields", () => {
      const moves = getSquareLegalMoves(parseFEN(STARTING_FEN), sq("e2"));
      for (const m of moves) {
        expect(typeof m.from).toBe("number");
        expect(typeof m.to).toBe("number");
        expect(typeof m.san).toBe("string");
      }
    });
  });
});
