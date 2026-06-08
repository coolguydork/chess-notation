import type { BoardState } from "./types";
import { parseFEN } from "./fen";
import { toChess, algebraicToIndex } from "./chessjs-bridge";

// ---------------------------------------------------------------------------
// Move application — delegated to chess.js, with null moves handled here
// (chess.js has no concept of a null move). The result is converted back to
// our BoardState via FEN, plus the from/to board indices the viewer needs.
// ---------------------------------------------------------------------------

export interface MoveResult {
  state: BoardState;
  from: number; // board index of the moving piece's origin (-1 for null moves)
  to: number;   // board index of the destination (-1 for null moves)
}

export function applyMoveEx(state: BoardState, san: string): MoveResult {
  // Null move (-- / Z0): pass the turn without moving a piece.
  if (san === "--" || san === "Z0") {
    return {
      state: {
        ...state,
        activeColor: state.activeColor === "w" ? "b" : "w",
        enPassant: null,
        halfmoveClock: state.halfmoveClock + 1,
        fullmoveNumber: state.fullmoveNumber + (state.activeColor === "b" ? 1 : 0),
      },
      from: -1,
      to: -1,
    };
  }

  const chess = toChess(state);
  const move = chess.move(san); // throws on invalid / illegal / ambiguous SAN
  let newState = parseFEN(chess.fen());

  // chess.js omits the en-passant target from the FEN when no capture is
  // possible, but our model records it on every double pawn push. The "b" flag
  // marks a two-square pawn advance; restore the square the pawn skipped over.
  if (move.flags.includes("b")) {
    const file = move.to.charCodeAt(0) - 97;
    const toRank = parseInt(move.to[1], 10); // 4 (white) or 5 (black)
    const epRank = state.activeColor === "w" ? toRank - 1 : toRank + 1; // 1-based
    newState = { ...newState, enPassant: { file, rank: epRank - 1 } };
  }

  return {
    state: newState,
    from: algebraicToIndex(move.from),
    to: algebraicToIndex(move.to),
  };
}

export function applyMove(state: BoardState, san: string): BoardState {
  return applyMoveEx(state, san).state;
}
