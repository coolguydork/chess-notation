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

// ---------------------------------------------------------------------------
// PGN types
// ---------------------------------------------------------------------------

export interface PgnMove {
  san: string;
  moveNumber: number;
  color: Color;
  comment?: string;
  nags?: number[];
  variations?: PgnMove[][];
}

export interface PgnGame {
  headers: Record<string, string>;
  moves: PgnMove[];
  result: string; // "1-0" | "0-1" | "1/2-1/2" | "*"
}

// ---------------------------------------------------------------------------
// Move tree (used by render/controls for navigation)
// ---------------------------------------------------------------------------

export interface MoveNode {
  id: number;
  san: string | null;         // null for the root (initial position)
  moveNumber: number;         // 0 for root
  color: Color | null;        // null for root
  comment?: string;
  nags?: number[];
  state: BoardState;
  from: number;  // board index of the moving piece's origin (-1 for root/null moves)
  to: number;    // board index of the destination (-1 for root/null moves)
  parent: MoveNode | null;
  next: MoveNode | null;           // continuation within this line
  variationHeads: MoveNode[];      // first node of each variation shown after this move
                                   // (each variation is an alternative to this move,
                                   //  starting from the same parent position)
}
