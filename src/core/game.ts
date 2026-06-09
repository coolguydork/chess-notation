import { parse, serializeMovetext } from "../pgn-editor";
import {
  childrenOf,
  resolvePath,
  removeAt as removeNodeAt,
  setComment as setNodeComment,
  setNags as setNodeNags,
  promoteVariation as promoteNodeVariation,
} from "../pgn-editor";
import type { PgnNode, CommentField } from "../pgn-editor";
import { parseFEN } from "./fen";
import { applyMoveEx } from "./moves";
import { buildMoveTree } from "./tree";
import { astToPgnMoves } from "./pgn";
import type { MoveNode, BoardState } from "./types";

// ---------------------------------------------------------------------------
// GameEditor — our own FEN-neutral PGN tree is the editable game.
//
// The source of truth is the pgn-editor AST (a PgnNode[] move tree, parsed by
// our clean-room parser). chess.js is the sole rules engine: it validates moves
// and computes positions (via applyMoveEx). Per the core/ convention this is a
// plain holder + functions, not a class.
//
// Structural edits (remove / set comment / set NAGs / promote variation) need no
// rules engine and are delegated to pgn-editor; only the engine-aware ops
// (addMoveAt, replaceMove) live here. The rest of the app reads a derived,
// immutable MoveNode tree via projectGame(); serialization (gameToPgn) goes
// straight to the AST via serializeMovetext to keep full comment fidelity.
// ---------------------------------------------------------------------------

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface GameEditor {
  readonly headers: Record<string, string>;
  readonly startFen: string;
  // The editable move tree (pgn-editor AST). A node's `variations` are the
  // alternatives to that node. Mutated in place by the edit functions below.
  readonly moves: PgnNode[];
}

// Build a GameEditor for a position with no moves yet (FEN-only blocks). The FEN
// isn't validated here; projectGame() (via parseFEN) throws on a bad FEN, which
// is where callers fall back to a read-only render.
export function gameFromFen(fen: string): GameEditor {
  return { headers: {}, startFen: fen, moves: [] };
}

// Build a GameEditor from PGN movetext, optionally from a custom start FEN.
// Parses strictly so an unparseable game throws and the caller falls back to
// read-only rather than risk a lossy parse corrupting a later write-back.
export function gameFromPgn(movetext: string, startFen?: string): GameEditor {
  const ast = parse(movetext, { strict: true });
  return { headers: ast.headers, startFen: startFen ?? START_FEN, moves: ast.moves };
}

// Project the AST into our MoveNode read-model via the existing, tested
// buildMoveTree (so states, variation attachment, and node shape match the rest
// of the app exactly).
export function projectGame(editor: GameEditor): MoveNode {
  return buildMoveTree(editor.startFen, astToPgnMoves(editor.moves));
}

// Serialize the AST directly (movetext + result, no headers — write-back
// targets a single YAML `pgn:` line). Going through the AST rather than the
// projected MoveNode tree preserves all three comment positions; the projection
// (astToPgnMoves) keeps only commentAfter.
export function gameToPgn(editor: GameEditor, result: string): string {
  return serializeMovetext({ headers: editor.headers, moves: editor.moves, result });
}

// ---------------------------------------------------------------------------
// Editing — all mutations go through the AST. A position is addressed by its SAN
// path from the start (the same paths the viewer uses via nodeToPath/pathToNode).
// Traversal (childrenOf/resolvePath) lives in pgn-editor; only legality and move
// numbering use the rules engine and stay here.
// ---------------------------------------------------------------------------

// Position reached by replaying `path` from the start (for legality + numbering).
function positionAfter(editor: GameEditor, path: string[]): BoardState {
  let state = parseFEN(editor.startFen);
  for (const san of path) state = applyMoveEx(state, san).state;
  return state;
}

// Add `san` as a continuation of the position at `path`. Extends the line, or
// branches a new variation if that position already continues. De-dupes: an
// existing continuation/variation with the same SAN is a no-op.
export function addMoveAt(editor: GameEditor, path: string[], san: string): void {
  const parent = resolvePath(editor.moves, path);
  if (childrenOf(editor.moves, parent).some((c) => c.node.san === san)) return;

  // Validate against the rules engine before mutating, and number the new node
  // from the position it is played from (side to move + full-move count).
  const before = positionAfter(editor, path);
  applyMoveEx(before, san); // throws on an illegal move; result not needed

  const node: PgnNode = {
    san,
    moveNumber: before.fullmoveNumber,
    color: before.activeColor,
    nags: [],
    variations: [],
  };

  const line = parent ? parent.line : editor.moves;
  const next = line[parent ? parent.index + 1 : 0];
  if (!next) {
    line.push(node); // no continuation here → extend this line
  } else {
    next.variations.push([node]); // position already continues → branch a variation
  }
}

// Remove the move at `path` and everything after it in its line (a whole
// variation if it is a variation head). Removing the root is a no-op.
export function removeAt(editor: GameEditor, path: string[]): void {
  removeNodeAt(editor.moves, path);
}

// Set/clear a comment on the move at `path`. `field` selects the slot
// (commentAfter is the common case). All three slots round-trip through
// gameToPgn now (serializeMovetext walks the AST); only commentAfter is shown
// in the rendered MoveNode tree, since the projection keeps a single slot.
// Returns whether the move was found.
export function setComment(
  editor: GameEditor,
  path: string[],
  field: CommentField,
  text: string | null,
): boolean {
  return setNodeComment(editor.moves, path, field, text);
}

// Replace the NAG list on the move at `path` (empty clears). Returns whether the
// move was found.
export function setNags(editor: GameEditor, path: string[], nags: number[]): boolean {
  return setNodeNags(editor.moves, path, nags);
}

// Promote the variation whose head is the move at `path` to the mainline at its
// branch point. Returns false if `path` isn't a variation head.
export function promoteVariation(editor: GameEditor, path: string[]): boolean {
  return promoteNodeVariation(editor.moves, path);
}

// Replace the move at `path` with a different, legal SAN. The move's own
// variations (alternatives at the same branch) are kept; the continuation after
// it is re-validated against the new position and truncated at the first move
// the change makes illegal. Returns false if `path` is the root or doesn't
// resolve; throws if `san` is illegal at that position.
export function replaceMove(editor: GameEditor, path: string[], san: string): boolean {
  if (path.length === 0) return false;
  const loc = resolvePath(editor.moves, path);
  if (!loc || loc.node.san !== path[path.length - 1]) return false;

  const before = positionAfter(editor, path.slice(0, -1));
  let state = applyMoveEx(before, san).state; // throws if the new move is illegal

  loc.node.san = san;

  // Keep the longest still-legal continuation; drop the rest.
  let j = loc.index + 1;
  while (j < loc.line.length) {
    try {
      state = applyMoveEx(state, loc.line[j].san).state;
    } catch {
      break;
    }
    j++;
  }
  loc.line.length = j;
  return true;
}
