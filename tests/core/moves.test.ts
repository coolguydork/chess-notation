import { describe, it, expect } from "vitest";
import { applyMove } from "../../src/core/moves";
import { parseFEN } from "../../src/core/fen";
import type { BoardState } from "../../src/core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Board index helpers (matches fen.ts convention: index 0 = a8, 63 = h1)
function idx(file: number, rank: number): number {
  return (7 - rank) * 8 + file; // file 0-7 (a-h), rank 0-7 (rank1-rank8)
}
function sq(algebraic: string): number {
  return idx(algebraic.charCodeAt(0) - 97, parseInt(algebraic[1], 10) - 1);
}

describe("applyMove", () => {
  describe("pawn moves", () => {
    it("moves a white pawn one square forward", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "e3");
      expect(s.board[sq("e3")]).toEqual({ type: "p", color: "w" });
      expect(s.board[sq("e2")]).toBeNull();
    });

    it("moves a white pawn two squares from starting rank", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "e4");
      expect(s.board[sq("e4")]).toEqual({ type: "p", color: "w" });
      expect(s.board[sq("e2")]).toBeNull();
    });

    it("sets en passant square after double pawn push", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "e4");
      expect(s.enPassant).toEqual({ file: 4, rank: 2 }); // e3
    });

    it("clears en passant square after non-double-push", () => {
      const s1 = applyMove(parseFEN(STARTING_FEN), "e4");
      const s2b = applyMove(s1, "Nc6");
      const s3b = applyMove(s2b, "Nf3");
      expect(s3b.enPassant).toBeNull();
    });

    it("moves a black pawn", () => {
      const s1 = applyMove(parseFEN(STARTING_FEN), "e4");
      const s2 = applyMove(s1, "e5");
      expect(s2.board[sq("e5")]).toEqual({ type: "p", color: "b" });
      expect(s2.board[sq("e7")]).toBeNull();
    });

    it("handles pawn capture", () => {
      // 1.e4 d5 2.exd5
      const s = [STARTING_FEN, "e4", "d5", "exd5"].slice(1).reduce(
        (state, move) => applyMove(state, move),
        parseFEN(STARTING_FEN)
      );
      expect(s.board[sq("d5")]).toEqual({ type: "p", color: "w" });
      expect(s.board[sq("e4")]).toBeNull();
    });

    it("en passant capture removes the captured pawn", () => {
      // 1.e4 e5 2.Nf3 Nf6 3.Ng1 Ng8 4.Nf3 d5 5.e5 d4 ... no, need f5 d4 exd6
      // Simpler: position after 1.e4 d5 2.e5 f5 3.exf6
      const fens = [
        "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3",
      ];
      const s = applyMove(parseFEN(fens[0]), "exd6");
      expect(s.board[sq("d6")]).toEqual({ type: "p", color: "w" });
      expect(s.board[sq("d5")]).toBeNull(); // captured pawn removed
      expect(s.board[sq("e5")]).toBeNull(); // capturing pawn gone
    });

    it("white pawn promotes to queen", () => {
      // White pawn on e7, black to move then white promotes
      const fen = "8/4P3/8/8/8/8/8/4K2k w - - 0 1";
      const s = applyMove(parseFEN(fen), "e8=Q");
      expect(s.board[sq("e8")]).toEqual({ type: "q", color: "w" });
      expect(s.board[sq("e7")]).toBeNull();
    });

    it("pawn promotes to knight", () => {
      const fen = "8/4P3/8/8/8/8/8/4K2k w - - 0 1";
      const s = applyMove(parseFEN(fen), "e8=N");
      expect(s.board[sq("e8")]).toEqual({ type: "n", color: "w" });
    });

    it("pawn captures and promotes", () => {
      const fen = "3r4/4P3/8/8/8/8/8/4K2k w - - 0 1";
      const s = applyMove(parseFEN(fen), "exd8=Q");
      expect(s.board[sq("d8")]).toEqual({ type: "q", color: "w" });
      expect(s.board[sq("e7")]).toBeNull();
    });
  });

  describe("piece moves", () => {
    it("moves a knight", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "Nf3");
      expect(s.board[sq("f3")]).toEqual({ type: "n", color: "w" });
      expect(s.board[sq("g1")]).toBeNull();
    });

    it("moves a bishop after pawns open the diagonal", () => {
      const s1 = applyMove(parseFEN(STARTING_FEN), "e4");
      const s2 = applyMove(s1, "e5");
      const s3 = applyMove(s2, "Bc4");
      expect(s3.board[sq("c4")]).toEqual({ type: "b", color: "w" });
    });

    it("moves a rook", () => {
      const fen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
      const s = applyMove(parseFEN(fen), "Ra4");
      expect(s.board[sq("a4")]).toEqual({ type: "r", color: "w" });
      expect(s.board[sq("a1")]).toBeNull();
    });

    it("moves a queen", () => {
      const fen = "4k3/8/8/8/8/8/8/3QK3 w - - 0 1";
      const s = applyMove(parseFEN(fen), "Qd5");
      expect(s.board[sq("d5")]).toEqual({ type: "q", color: "w" });
    });

    it("moves the king one square", () => {
      const fen = "8/8/8/8/8/8/8/4K3 w - - 0 1";
      const s = applyMove(parseFEN(fen), "Kd1");
      expect(s.board[sq("d1")]).toEqual({ type: "k", color: "w" });
      expect(s.board[sq("e1")]).toBeNull();
    });

    it("handles file disambiguation", () => {
      // Two rooks on a1 and h1, moving the a-file rook to d1
      const fen = "4k3/8/8/8/8/8/8/R2QKB1R w KQ - 0 1";
      const s = applyMove(parseFEN(fen), "Rh4");
      expect(s.board[sq("h4")]).toEqual({ type: "r", color: "w" });
      expect(s.board[sq("h1")]).toBeNull();
    });

    it("handles rank disambiguation", () => {
      const fen = "4k3/8/8/8/8/3N4/8/3NK3 w - - 0 1";
      const s = applyMove(parseFEN(fen), "N1c3");
      expect(s.board[sq("c3")]).toEqual({ type: "n", color: "w" });
      expect(s.board[sq("e1")]).toEqual({ type: "k", color: "w" }); // king untouched
      expect(s.board[sq("d1")]).toBeNull();
    });

    it("handles full-square disambiguation", () => {
      const fen = "4k3/8/8/3N4/8/8/8/3NK3 w - - 0 1";
      const s = applyMove(parseFEN(fen), "Nd1c3");
      expect(s.board[sq("c3")]).toEqual({ type: "n", color: "w" });
      expect(s.board[sq("d1")]).toBeNull();
      expect(s.board[sq("d5")]).toEqual({ type: "n", color: "w" }); // other knight unmoved
    });

    it("captures an enemy piece", () => {
      const s = [STARTING_FEN, "e4", "d5", "exd5"].reduce(
        (state, move, i) => i === 0 ? state : applyMove(state, move),
        parseFEN(STARTING_FEN)
      );
      expect(s.board[sq("d5")]).toEqual({ type: "p", color: "w" });
    });
  });

  describe("castling", () => {
    it("white kingside castling", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const s = applyMove(parseFEN(fen), "O-O");
      expect(s.board[sq("g1")]).toEqual({ type: "k", color: "w" });
      expect(s.board[sq("f1")]).toEqual({ type: "r", color: "w" });
      expect(s.board[sq("e1")]).toBeNull();
      expect(s.board[sq("h1")]).toBeNull();
    });

    it("white queenside castling", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const s = applyMove(parseFEN(fen), "O-O-O");
      expect(s.board[sq("c1")]).toEqual({ type: "k", color: "w" });
      expect(s.board[sq("d1")]).toEqual({ type: "r", color: "w" });
      expect(s.board[sq("e1")]).toBeNull();
      expect(s.board[sq("a1")]).toBeNull();
    });

    it("black kingside castling", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";
      const s = applyMove(parseFEN(fen), "O-O");
      expect(s.board[sq("g8")]).toEqual({ type: "k", color: "b" });
      expect(s.board[sq("f8")]).toEqual({ type: "r", color: "b" });
      expect(s.board[sq("e8")]).toBeNull();
      expect(s.board[sq("h8")]).toBeNull();
    });

    it("black queenside castling", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";
      const s = applyMove(parseFEN(fen), "O-O-O");
      expect(s.board[sq("c8")]).toEqual({ type: "k", color: "b" });
      expect(s.board[sq("d8")]).toEqual({ type: "r", color: "b" });
    });
  });

  describe("castling rights", () => {
    it("removes both white rights when white king moves", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const s = applyMove(parseFEN(fen), "Ke2");
      expect(s.castling.whiteKingside).toBe(false);
      expect(s.castling.whiteQueenside).toBe(false);
      expect(s.castling.blackKingside).toBe(true);
      expect(s.castling.blackQueenside).toBe(true);
    });

    it("removes white kingside right when h1 rook moves", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const s = applyMove(parseFEN(fen), "Rh4");
      expect(s.castling.whiteKingside).toBe(false);
      expect(s.castling.whiteQueenside).toBe(true);
    });

    it("removes white queenside right when a1 rook moves", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const s = applyMove(parseFEN(fen), "Ra4");
      expect(s.castling.whiteQueenside).toBe(false);
      expect(s.castling.whiteKingside).toBe(true);
    });

    it("removes black queenside right when a8 rook is captured", () => {
      // White rook on a7 captures black rook on a8
      const fen = "r3k2r/R7/8/8/8/8/8/4K2R w Kkq - 0 1";
      const s = applyMove(parseFEN(fen), "Rxa8+");
      expect(s.castling.blackQueenside).toBe(false);
      expect(s.castling.blackKingside).toBe(true);
    });

    it("removes all white castling rights after O-O", () => {
      const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
      const s = applyMove(parseFEN(fen), "O-O");
      expect(s.castling.whiteKingside).toBe(false);
      expect(s.castling.whiteQueenside).toBe(false);
    });
  });

  describe("active color", () => {
    it("flips to black after white move", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "e4");
      expect(s.activeColor).toBe("b");
    });

    it("flips to white after black move", () => {
      const s1 = applyMove(parseFEN(STARTING_FEN), "e4");
      const s2 = applyMove(s1, "e5");
      expect(s2.activeColor).toBe("w");
    });
  });

  describe("move clocks", () => {
    it("increments halfmove clock on quiet piece move", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "Nf3");
      expect(s.halfmoveClock).toBe(1);
    });

    it("resets halfmove clock on pawn move", () => {
      const fen = "4k3/8/8/8/8/5N2/8/4K3 w - - 5 10";
      const s = applyMove(parseFEN(fen), "Nh4");
      expect(s.halfmoveClock).toBe(6);
      const s2 = applyMove(parseFEN(STARTING_FEN), "e4");
      expect(s2.halfmoveClock).toBe(0);
    });

    it("resets halfmove clock on capture", () => {
      const fen = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 5 10";
      const s = applyMove(parseFEN(fen), "exd5");
      expect(s.halfmoveClock).toBe(0);
    });

    it("does not increment fullmove number after white move", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "e4");
      expect(s.fullmoveNumber).toBe(1);
    });

    it("increments fullmove number after black move", () => {
      const s1 = applyMove(parseFEN(STARTING_FEN), "e4");
      const s2 = applyMove(s1, "e5");
      expect(s2.fullmoveNumber).toBe(2);
    });
  });

  describe("move sequences", () => {
    it("plays through the Italian Game opening", () => {
      const moves = ["e4", "e5", "Nf3", "Nc6", "Bc4"];
      const s = moves.reduce((state, m) => applyMove(state, m), parseFEN(STARTING_FEN));
      expect(s.board[sq("c4")]).toEqual({ type: "b", color: "w" });
      expect(s.board[sq("c6")]).toEqual({ type: "n", color: "b" });
      expect(s.board[sq("f3")]).toEqual({ type: "n", color: "w" });
      expect(s.activeColor).toBe("b");
      expect(s.fullmoveNumber).toBe(3);
    });

    it("plays through the Scholar's Mate", () => {
      const moves = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];
      const s = moves.reduce((state, m) => applyMove(state, m), parseFEN(STARTING_FEN));
      expect(s.board[sq("f7")]).toEqual({ type: "q", color: "w" });
      expect(s.activeColor).toBe("b");
    });
  });

  describe("error handling", () => {
    it("throws on unrecognised SAN", () => {
      expect(() => applyMove(parseFEN(STARTING_FEN), "Ke4")).toThrow();
    });

    it("throws on ambiguous move with no disambiguation", () => {
      // Two knights can reach the same square
      const fen = "4k3/8/8/8/8/8/8/1N1NK3 w - - 0 1";
      expect(() => applyMove(parseFEN(fen), "Nc3")).toThrow();
    });
  });

  describe("null moves", () => {
    it("-- flips active color from white to black", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "--");
      expect(s.activeColor).toBe("b");
    });

    it("Z0 flips active color from white to black", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "Z0");
      expect(s.activeColor).toBe("b");
    });

    it("-- flips active color from black to white", () => {
      const blackToMove = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
      const s = applyMove(parseFEN(blackToMove), "--");
      expect(s.activeColor).toBe("w");
    });

    it("-- clears en passant square", () => {
      // After 1. e4, en passant is e3
      const withEp = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
      const s = applyMove(parseFEN(withEp), "--");
      expect(s.enPassant).toBeNull();
    });

    it("-- does not move any piece on the board", () => {
      const before = parseFEN(STARTING_FEN);
      const after = applyMove(before, "--");
      expect(after.board).toEqual(before.board);
    });

    it("-- increments halfmove clock", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "--");
      expect(s.halfmoveClock).toBe(1);
    });

    it("-- increments fullmove number when black passes", () => {
      const blackToMove = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
      const s = applyMove(parseFEN(blackToMove), "--");
      expect(s.fullmoveNumber).toBe(2);
    });

    it("-- does not increment fullmove number when white passes", () => {
      const s = applyMove(parseFEN(STARTING_FEN), "--");
      expect(s.fullmoveNumber).toBe(1);
    });
  });
});
