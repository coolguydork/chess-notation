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

import type { PgnItem, PgnComment } from "../pgn-editor";

// A parsed game as the block processor consumes it: the pgn-editor item stream
// plus headers and result. No intermediate move shape — the stream is the model.
export interface PgnGame {
  headers: Record<string, string>;
  items: PgnItem[];
  result: string; // "1-0" | "0-1" | "1/2-1/2" | "*"
}

// ---------------------------------------------------------------------------
// Move tree (used by render/controls for navigation)
// ---------------------------------------------------------------------------

// A comment in the projected read-model. `text` is display-cleaned ([%clk]/
// [%eval] stripped); `source` points back at the AST item so edits address the
// comment by identity, never by an owning move.
export interface RenderComment {
  id: number;
  text: string;
  source: PgnComment;
}

// One annotation following a move, in the order it was written: a comment item
// or a variation (with any comments that lead the variation's line). The tail
// is positional — it says "this came next in the text", not "this belongs to
// the move".
export type TailItem =
  | { kind: "comment"; comment: RenderComment }
  | { kind: "variation"; head: MoveNode; lead: RenderComment[] };

export interface MoveNode {
  id: number;
  san: string | null;         // null for the root (initial position)
  moveNumber: number;         // 0 for root
  color: Color | null;        // null for root
  nags?: number[];
  state: BoardState;
  from: number;  // board index of the moving piece's origin (-1 for root/null moves)
  to: number;    // board index of the destination (-1 for root/null moves)
  parent: MoveNode | null;
  next: MoveNode | null;           // continuation within this line
  // Items that followed this move in the text, in source order. The root's
  // tail holds anything written before the first move (a game intro comment).
  tail: TailItem[];
  variationHeads: MoveNode[];      // navigation view of the variations in `tail`
                                   // (each is an alternative to this move, starting
                                   //  from the same parent position); kept in sync
                                   //  by buildMoveTree, never mutated elsewhere
}
