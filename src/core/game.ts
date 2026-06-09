import { parse } from "../pgn-editor";
import type { PgnNode } from "../pgn-editor";
import { parseFEN } from "./fen";
import { applyMoveEx } from "./moves";
import { buildMoveTree } from "./tree";
import { serializeMoveTree, cleanComment } from "./pgn";
import type { MoveNode, PgnMove, BoardState } from "./types";

// ---------------------------------------------------------------------------
// GameEditor — our own FEN-neutral PGN tree is the editable game.
//
// The source of truth is the pgn-editor AST (a PgnNode[] move tree, parsed by
// our clean-room parser). chess.js is the sole rules engine: it validates moves
// and computes positions (via applyMoveEx). Per the core/ convention this is a
// plain holder + functions, not a class.
//
// The AST is mutated in place by the edit functions (addMoveAt / removeAt). The
// rest of the app reads a derived, immutable MoveNode tree via projectGame(),
// and serializes via serializeMoveTree over that projection.
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

// Serialize via our serializer over the projection (movetext + result).
export function gameToPgn(editor: GameEditor, result: string): string {
  return serializeMoveTree(projectGame(editor), result);
}

// Adapter: pgn-editor AST node -> core PgnMove. (core may depend on pgn-editor;
// never the reverse.) Mirrors the @mliebelt path: comment from the after-move
// comment via cleanComment, NAGs, and recursive variations.
function astToPgnMoves(nodes: PgnNode[]): PgnMove[] {
  return nodes.map((n) => {
    const move: PgnMove = { san: n.san, moveNumber: n.moveNumber, color: n.color };
    const comment = n.commentAfter ? cleanComment(n.commentAfter) : "";
    if (comment) move.comment = comment;
    if (n.nags.length) move.nags = n.nags;
    if (n.variations.length) move.variations = n.variations.map(astToPgnMoves);
    return move;
  });
}

// ---------------------------------------------------------------------------
// Editing — all mutations go through the AST. A position is addressed by its SAN
// path from the start (the same paths the viewer uses via nodeToPath/pathToNode).
// ---------------------------------------------------------------------------

// Where a move lives in the AST: its node, the array containing it, that array's
// index, and (for a variation head) the node whose `variations` holds the array.
interface MoveLoc {
  node: PgnNode;
  line: PgnNode[];
  index: number;
  owner: PgnNode | null;
}

// The moves that may follow `parent` (null = the start position): the line's
// continuation plus the head of each variation branching from it.
function childrenOf(editor: GameEditor, parent: MoveLoc | null): MoveLoc[] {
  const line = parent ? parent.line : editor.moves;
  const index = parent ? parent.index + 1 : 0;
  const next = line[index];
  if (!next) return [];

  const out: MoveLoc[] = [{ node: next, line, index, owner: null }];
  for (const variation of next.variations) {
    out.push({ node: variation[0], line: variation, index: 0, owner: next });
  }
  return out;
}

// Resolve a SAN path to the location of the move at its end (null = the root).
// Paths originate from existing projected nodes, so they always resolve.
function resolvePath(editor: GameEditor, path: string[]): MoveLoc | null {
  let cur: MoveLoc | null = null;
  for (const san of path) {
    const found: MoveLoc | undefined = childrenOf(editor, cur).find((c) => c.node.san === san);
    if (!found) return cur;
    cur = found;
  }
  return cur;
}

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
  const parent = resolvePath(editor, path);
  if (childrenOf(editor, parent).some((c) => c.node.san === san)) return;

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

// Remove the move at `path` and everything after it in its line. If the move is
// a variation head, the whole variation is removed. (Removing the root no-ops.)
export function removeAt(editor: GameEditor, path: string[]): void {
  const target = resolvePath(editor, path);
  if (!target) return;

  if (target.owner && target.index === 0) {
    const idx = target.owner.variations.indexOf(target.line);
    if (idx !== -1) target.owner.variations.splice(idx, 1);
  } else {
    target.line.length = target.index; // truncate this line from the target on
  }
}
