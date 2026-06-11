import { parse, serializeInline } from "../pgn-editor";
import {
  childrenOf,
  resolvePath,
  removeAt as removeItemAt,
  adjacentComment as itemAdjacentComment,
  setAdjacentComment as setItemAdjacentComment,
  updateComment as updateItemComment,
  setNags as setItemNags,
  promoteVariation as promoteItemVariation,
} from "../pgn-editor";
import type { PgnItem, PgnNode, PgnComment } from "../pgn-editor";
import { parseFEN } from "./fen";
import { applyMoveEx } from "./moves";
import { buildMoveTree } from "./tree";
import type { MoveNode, BoardState } from "./types";

// ---------------------------------------------------------------------------
// GameEditor — our own FEN-neutral PGN stream is the editable game.
//
// The source of truth is the pgn-editor AST (a PgnItem[] stream, parsed by our
// clean-room parser). chess.js is the sole rules engine: it validates moves
// and computes positions (via applyMoveEx). Per the core/ convention this is a
// plain holder + functions, not a class.
//
// Structural edits (remove / comments / NAGs / promote variation) need no
// rules engine and are delegated to pgn-editor; only the engine-aware ops
// (addMoveAt, replaceMove) live here. The rest of the app reads a derived,
// immutable MoveNode tree via projectGame(); serialization (gameToPgn) emits
// the stream in source order, so nothing the user wrote ever moves.
// ---------------------------------------------------------------------------

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface GameEditor {
  readonly headers: Record<string, string>;
  readonly startFen: string;
  // The editable item stream (pgn-editor AST), mutated in place by the edit
  // functions below.
  readonly items: PgnItem[];
}

// Build a GameEditor for a position with no moves yet (FEN-only blocks). The FEN
// isn't validated here; projectGame() (via parseFEN) throws on a bad FEN, which
// is where callers fall back to a read-only render.
export function gameFromFen(fen: string): GameEditor {
  return { headers: {}, startFen: fen, items: [] };
}

// Build a GameEditor from PGN movetext, optionally from a custom start FEN.
// Parses strictly so an unparseable game throws and the caller falls back to
// read-only rather than risk a lossy parse corrupting a later write-back.
export function gameFromPgn(movetext: string, startFen?: string): GameEditor {
  const ast = parse(movetext, { strict: true });
  return { headers: ast.headers, startFen: startFen ?? START_FEN, items: ast.items };
}

// Project the AST into our MoveNode read-model (board states resolved, comment
// text display-cleaned, AST references kept for editing by identity).
export function projectGame(editor: GameEditor): MoveNode {
  return buildMoveTree(editor.startFen, editor.items);
}

// Serialize the AST to a single-line PGN (header tags + movetext + result, no
// blank-line separator) so the whole game fits the one YAML `pgn:` line that
// write-back rewrites. The stream serializes in source order with raw comment
// text ([%clk]/[%eval] intact) — the projection's cleaning is display-only.
export function gameToPgn(editor: GameEditor, result: string): string {
  return serializeInline({ headers: editor.headers, items: editor.items, result });
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

// Index of the first move item at or after `from`, or -1.
function nextMoveIndex(line: PgnItem[], from: number): number {
  for (let i = from; i < line.length; i++) {
    if (line[i].kind === "move") return i;
  }
  return -1;
}

// Add `san` as a continuation of the position at `path`. Extends the line, or
// branches a new variation if that position already continues. De-dupes: an
// existing continuation/variation with the same SAN is a no-op.
export function addMoveAt(editor: GameEditor, path: string[], san: string): void {
  const parent = resolvePath(editor.items, path);
  if (childrenOf(editor.items, parent).some((c) => c.node.san === san)) return;

  // Validate against the rules engine before mutating, and number the new node
  // from the position it is played from (side to move + full-move count).
  const before = positionAfter(editor, path);
  applyMoveEx(before, san); // throws on an illegal move; result not needed

  const node: PgnNode = {
    kind: "move",
    san,
    moveNumber: before.fullmoveNumber,
    color: before.activeColor,
    nags: [],
  };

  const line = parent ? parent.line : editor.items;
  const from = parent ? parent.index + 1 : 0;
  const ni = nextMoveIndex(line, from);
  if (ni === -1) {
    line.push(node); // no continuation here → extend this line
  } else {
    // The position already continues → branch a new variation. It goes after
    // the continuation's existing trailing items, as the last alternative.
    let at = ni + 1;
    while (at < line.length && line[at].kind !== "move") at++;
    line.splice(at, 0, { kind: "variation", items: [node] });
  }
}

// Remove the move at `path` and everything after it in its line (a whole
// variation if it is a variation head). Removing the root is a no-op.
export function removeAt(editor: GameEditor, path: string[]): void {
  removeItemAt(editor.items, path);
}

// The comment item directly adjacent to the move at `path`, or null. Adjacency
// is positional ("the comment right before/after this move in the text") — an
// authoring convenience, not ownership.
export function adjacentComment(
  editor: GameEditor,
  path: string[],
  side: "before" | "after",
): PgnComment | null {
  return itemAdjacentComment(editor.items, path, side);
}

// Set/replace/clear the comment item directly adjacent to the move at `path`.
// Returns whether the move was found.
export function setAdjacentComment(
  editor: GameEditor,
  path: string[],
  side: "before" | "after",
  text: string | null,
): boolean {
  return setItemAdjacentComment(editor.items, path, side, text);
}

// Replace the text of an existing comment item (addressed by identity, as
// projected into RenderComment.source); empty text removes the item.
export function updateComment(editor: GameEditor, comment: PgnComment, text: string | null): boolean {
  return updateItemComment(editor.items, comment, text);
}

// Replace the NAG list on the move at `path` (empty clears). Returns whether the
// move was found.
export function setNags(editor: GameEditor, path: string[], nags: number[]): boolean {
  return setItemNags(editor.items, path, nags);
}

// Promote the variation whose head is the move at `path` to the mainline at its
// branch point. Returns false if `path` isn't a variation head.
export function promoteVariation(editor: GameEditor, path: string[]): boolean {
  return promoteItemVariation(editor.items, path);
}

// Replace the move at `path` with a different, legal SAN. The move's own
// variations (alternatives at the same branch) are kept; the continuation after
// it is re-validated against the new position and truncated at the first move
// the change makes illegal. Returns false if `path` is the root or doesn't
// resolve; throws if `san` is illegal at that position.
export function replaceMove(editor: GameEditor, path: string[], san: string): boolean {
  if (path.length === 0) return false;
  const loc = resolvePath(editor.items, path);
  if (!loc || loc.node.san !== path[path.length - 1]) return false;

  const before = positionAfter(editor, path.slice(0, -1));
  let state = applyMoveEx(before, san).state; // throws if the new move is illegal

  loc.node.san = san;

  // Keep the longest still-legal continuation; drop the rest of the line from
  // the first now-illegal move on (comments/variations between surviving moves
  // stay where they were written; invalid variations are skipped at render).
  let j = loc.index + 1;
  while (j < loc.line.length) {
    const it = loc.line[j];
    if (it.kind === "move") {
      try {
        state = applyMoveEx(state, it.san).state;
      } catch {
        break;
      }
    }
    j++;
  }
  loc.line.length = j;
  return true;
}
