import { Chess } from "cm-chess/src/Chess.js";
import type { CmMove } from "cm-chess/src/Chess.js";
import { buildMoveTree } from "./tree";
import { serializeMoveTree, cleanComment } from "./pgn";
import type { MoveNode, PgnMove } from "./types";

// ---------------------------------------------------------------------------
// GameEditor — cm-chess owns the editable game.
//
// cm-chess (built on chess.mjs, MIT, same author as cm-chessboard) is the source
// of truth and the engine for all PGN edits. Per the core/ convention we expose
// it as a plain holder + functions rather than a class. The wrapped Chess
// instance is mutated in place by the edit functions (addMoveAt / removeAt, see
// below); the rest of the app reads a derived, immutable MoveNode tree via
// projectGame(). Text serialization stays on our serializeMoveTree (cm-pgn's own
// render() mis-emits NAGs and SetUp-FEN move numbers).
// ---------------------------------------------------------------------------

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface GameEditor {
  // cm-chess instance — mutable and library-owned; never mutate it directly,
  // go through the edit functions in this module.
  readonly chess: Chess;
  readonly startFen: string;
}

// Build a GameEditor for a position with no moves yet (FEN-only blocks).
// Throws if cm-chess/chess.mjs rejects the FEN (callers fall back to read-only).
export function gameFromFen(fen: string): GameEditor {
  return { chess: new Chess({ fen }), startFen: fen };
}

// Build a GameEditor from PGN movetext, optionally starting from a custom FEN.
// Throws on unparseable movetext (e.g. null moves) — callers fall back.
export function gameFromPgn(movetext: string, startFen?: string): GameEditor {
  const start = startFen ?? START_FEN;
  const pgn =
    start !== START_FEN
      ? `[SetUp "1"]\n[FEN "${start}"]\n\n${movetext}`
      : movetext;
  return { chess: new Chess({ pgn, sloppy: true }), startFen: start };
}

// Project the cm-chess game into our MoveNode read-model. We convert cm-chess's
// history to PgnMove[] and reuse the existing, tested buildMoveTree so states,
// variation attachment, and node shape match the rest of the app exactly.
export function projectGame(editor: GameEditor): MoveNode {
  return buildMoveTree(editor.startFen, cmHistoryToPgnMoves(editor.chess.history()));
}

// Serialize via our own serializer over the projection (movetext + result).
// cm-pgn's render() is buggy for NAGs and SetUp-FEN move numbers.
export function gameToPgn(editor: GameEditor, result: string): string {
  return serializeMoveTree(projectGame(editor), result);
}

// Convert a cm-chess move list (mainline or variation line) to our PgnMove[].
function cmHistoryToPgnMoves(cmMoves: CmMove[]): PgnMove[] {
  return cmMoves.map((m) => {
    // Displayed move number = fullmove of the position *before* the move. After a
    // white move the fullmove is unchanged; after a black move it has incremented.
    const fullAfter = parseInt(m.fen.split(" ")[5], 10);
    const moveNumber = m.color === "w" ? fullAfter : fullAfter - 1;

    const move: PgnMove = { san: m.san, moveNumber, color: m.color };

    const comment = m.commentAfter ? cleanComment(m.commentAfter) : "";
    if (comment) move.comment = comment;

    if (m.nag) {
      const n = parseInt(m.nag.replace(/^\$/, ""), 10);
      if (!Number.isNaN(n)) move.nags = [n];
    }

    if (m.variations.length > 0) {
      move.variations = m.variations.map((v) => cmHistoryToPgnMoves(v));
    }

    return move;
  });
}
