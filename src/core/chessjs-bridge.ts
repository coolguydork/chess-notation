import { Chess } from "chess.js";
import type { BoardState } from "./types";
import { serializeFEN } from "./fen";

// ---------------------------------------------------------------------------
// Bridge between our BoardState model and the chess.js rules engine.
// chess.js owns rule logic (legal moves, move application, check detection);
// this module converts positions and squares across the boundary. FEN parse/
// serialize stays ours (see fen.ts) — it doubles as the conversion primitive.
// ---------------------------------------------------------------------------

// Build a chess.js position from a BoardState. `skipValidation` lets us load the
// degenerate/constructed positions our callers use — single-king boards, or
// castling rights that don't match rook squares — which chess.js would
// otherwise reject. We only need move generation/application, not validation.
export function toChess(state: BoardState): Chess {
  return new Chess(serializeFEN(state), { skipValidation: true });
}

// Our board index (0 = a8, 63 = h1) ↔ algebraic square ("e4").
export function indexToAlgebraic(index: number): string {
  const file = index % 8;
  const rank = 8 - Math.floor(index / 8); // 1..8
  return String.fromCharCode(97 + file) + rank;
}

export function algebraicToIndex(square: string): number {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10); // 1..8
  return (8 - rank) * 8 + file;
}
