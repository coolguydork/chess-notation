import type { BoardState } from "../core/types";
import type { BoardConfig, EngineArrow } from "../render/config";

// The contract a board implementation exposes to PgnViewer. cm-board.ts is the
// implementation; PgnViewer depends only on this interface so the board backend
// stays swappable.
export interface InteractiveBoardHandle {
  getState: () => BoardState;
  setState: (s: BoardState, lastMove?: { from: number; to: number }) => void;
  setEngineArrows(arrows: EngineArrow[]): void;
  animateTo(s: BoardState, from: number, to: number, config: BoardConfig, cancelPrev: (() => void) | null): () => void;
  /** Animate to a transient hover position without changing committed state. Returns cancel fn. */
  animatedPreview(s: BoardState, from: number, to: number): () => void;
  /** Commit the current preview as the new board state (called on click-while-hovering). */
  commitPreview(): void;
  preview(s: BoardState, lastMove?: { from: number; to: number }): void;
  endPreview(): void;
}
