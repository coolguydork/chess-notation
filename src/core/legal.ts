import type { BoardState, Color, PieceType } from "./types";
import { toChess, algebraicToIndex } from "./chessjs-bridge";

// ---------------------------------------------------------------------------
// Legal move generation and check detection — delegated to chess.js.
// Results are mapped back to our board-index model.
// ---------------------------------------------------------------------------

export interface LegalMove {
  from: number;
  to: number;
  san: string;
  promotion?: PieceType;
}

export function isInCheck(state: BoardState, color: Color): boolean {
  const chess = toChess(state);
  const enemy: Color = color === "w" ? "b" : "w";
  // Find the king of `color`; report whether the enemy attacks its square.
  // Works for either side regardless of whose turn it is.
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === "k" && cell.color === color) {
        return chess.isAttacked(cell.square, enemy);
      }
    }
  }
  return false; // no king of that color (degenerate position)
}

export function getLegalMoves(state: BoardState): LegalMove[] {
  const chess = toChess(state);
  return chess.moves({ verbose: true }).map((m) => {
    const move: LegalMove = {
      from: algebraicToIndex(m.from),
      to: algebraicToIndex(m.to),
      san: m.san,
    };
    if (m.promotion) move.promotion = m.promotion as PieceType;
    return move;
  });
}

export function getSquareLegalMoves(state: BoardState, squareIdx: number): LegalMove[] {
  return getLegalMoves(state).filter((m) => m.from === squareIdx);
}
