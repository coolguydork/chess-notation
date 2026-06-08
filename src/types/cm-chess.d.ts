// Minimal ambient types for cm-chess, which ships untyped ESM source.
// Only the surface GameEditor (src/core/game.ts) uses is declared.

declare module "cm-chess/src/Chess.js" {
  // A move node in cm-pgn's history tree. Squares are algebraic ("e2"); `fen`
  // is the full FEN after the move; `variations` are alternative lines that
  // branch from this move's predecessor; `nag` is a single "$N" string.
  export interface CmMove {
    san: string;
    ply: number;
    color: "w" | "b";
    from: string;
    to: string;
    promotion?: string;
    fen: string;
    nag?: string;
    commentBefore?: string;
    commentMove?: string;
    commentAfter?: string;
    variation: CmMove[];
    variations: CmMove[][];
    previous: CmMove | null;
    next?: CmMove;
  }

  export class Chess {
    constructor(props?: { fen?: string; pgn?: string; sloppy?: boolean });
    history(): CmMove[];
    lastMove(): CmMove | undefined;
    fen(move?: CmMove): string;
    move(move: string, previousMove?: CmMove, sloppy?: boolean): CmMove | null;
    undo(move?: CmMove): void;
    renderPgn(renderHeader?: boolean, renderComments?: boolean, renderNags?: boolean): string;
    pgn: {
      history: {
        moves: CmMove[];
        render(renderComments?: boolean, renderNags?: boolean): string;
      };
    };
  }
}
