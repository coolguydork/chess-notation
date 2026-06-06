// Piece colors
export type Color = "w" | "b";

// Piece types (uppercase = white convention in FEN, but here they are type-only)
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
  type: PieceType;
  color: Color;
}

// 64-element array, index 0 = a8 (top-left), index 63 = h1 (bottom-right)
// Matches FEN rank order: rank 8 first, rank 1 last.
export type Square = Piece | null;
export type Board = readonly Square[];

export interface CastlingRights {
  whiteKingside: boolean;
  whiteQueenside: boolean;
  blackKingside: boolean;
  blackQueenside: boolean;
}

// File: 0–7 (a–h), Rank: 0–7 (1–8)
export interface EnPassantSquare {
  file: number;
  rank: number;
}

export interface BoardState {
  board: Board;
  activeColor: Color;
  castling: CastlingRights;
  enPassant: EnPassantSquare | null;
  halfmoveClock: number;
  fullmoveNumber: number;
}
