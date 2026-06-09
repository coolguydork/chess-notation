import type { PgnNode } from "./types";

// ---------------------------------------------------------------------------
// pgn-editor — structural tree navigation and FEN-neutral edits
//
// These operate on a PgnNode[] move tree by SAN path and need no rules engine:
// they read/restructure notation only. Engine-aware edits (validating a SAN,
// numbering a new move) live on the consumer side (core/game.ts), which builds
// on the navigation helpers here. A node's `variations` are the alternatives to
// that node, branching from the same parent position.
// ---------------------------------------------------------------------------

// Where a move lives in the tree: its node, the array containing it, that
// array's index, and (for a variation head) the node whose `variations` holds
// the array.
export interface NodeLoc {
  node: PgnNode;
  line: PgnNode[];
  index: number;
  owner: PgnNode | null;
}

// The moves that may follow `parent` (null = the start position): the line's
// continuation plus the head of each variation branching from it.
export function childrenOf(moves: PgnNode[], parent: NodeLoc | null): NodeLoc[] {
  const line = parent ? parent.line : moves;
  const index = parent ? parent.index + 1 : 0;
  const next = line[index];
  if (!next) return [];

  const out: NodeLoc[] = [{ node: next, line, index, owner: null }];
  for (const variation of next.variations) {
    out.push({ node: variation[0], line: variation, index: 0, owner: next });
  }
  return out;
}

// Resolve a SAN path to the location of the move at its end (null = the root).
export function resolvePath(moves: PgnNode[], path: string[]): NodeLoc | null {
  let cur: NodeLoc | null = null;
  for (const san of path) {
    const found: NodeLoc | undefined = childrenOf(moves, cur).find((c) => c.node.san === san);
    if (!found) return cur;
    cur = found;
  }
  return cur;
}

// The node at `path`, or null if the path is empty (the root) or doesn't resolve.
export function nodeAt(moves: PgnNode[], path: string[]): PgnNode | null {
  if (path.length === 0) return null;
  const loc = resolvePath(moves, path);
  return loc && loc.node.san === path[path.length - 1] ? loc.node : null;
}

// ---------------------------------------------------------------------------
// Update / Delete (structural; no rules engine)
// ---------------------------------------------------------------------------

// Which comment slot to set. PGN allows a comment before the move number
// (commentMove), between the number and the SAN (commentBefore), and after the
// move (commentAfter — the common case). Returns false if the path doesn't
// resolve to a move.
export type CommentField = "commentMove" | "commentBefore" | "commentAfter";

export function setComment(
  moves: PgnNode[],
  path: string[],
  field: CommentField,
  text: string | null,
): boolean {
  const node = nodeAt(moves, path);
  if (!node) return false;
  const trimmed = text?.trim();
  if (trimmed) node[field] = trimmed;
  else delete node[field];
  return true;
}

// Replace a move's NAG list (e.g. [1] for "!", [16] for "±"). Empty clears them.
export function setNags(moves: PgnNode[], path: string[], nags: number[]): boolean {
  const node = nodeAt(moves, path);
  if (!node) return false;
  node.nags = [...nags];
  return true;
}

// Remove the move at `path` and everything after it in its line. A variation
// head removes the whole variation. Removing the root is a no-op. Returns
// whether anything was removed.
export function removeAt(moves: PgnNode[], path: string[]): boolean {
  const target = resolvePath(moves, path);
  if (!target) return false;

  if (target.owner && target.index === 0) {
    const idx = target.owner.variations.indexOf(target.line);
    if (idx === -1) return false;
    target.owner.variations.splice(idx, 1);
    return true;
  }
  target.line.length = target.index; // truncate this line from the target on
  return true;
}

// Promote the variation whose head is the move at `path` so it becomes the
// mainline at its branch point; the former mainline (and any sibling variations)
// become variations of the new head. `path` must resolve to a variation head.
// Returns false otherwise (incl. when it is already the mainline move).
export function promoteVariation(moves: PgnNode[], path: string[]): boolean {
  if (path.length === 0) return false;

  // Branch point = the position after the parent path. `branch` is the mainline
  // move there; its `variations` hold the alternatives we may promote.
  const parent = resolvePath(moves, path.slice(0, -1));
  const branchLine = parent ? parent.line : moves;
  const branchIndex = parent ? parent.index + 1 : 0;
  const branch = branchLine[branchIndex];
  if (!branch) return false;

  const head = path[path.length - 1];
  if (branch.san === head) return false; // already the mainline at this branch

  const vIdx = branch.variations.findIndex((v) => v[0].san === head);
  if (vIdx === -1) return false;

  const promoted = branch.variations[vIdx];
  const oldMainTail = branchLine.slice(branchIndex); // [branch, ...rest of the old line]
  const siblings = branch.variations.filter((_, k) => k !== vIdx);
  branch.variations = []; // branch is being demoted; its alternatives move to the new head

  // Splice the promoted line into the mainline in place of the old tail.
  branchLine.length = branchIndex;
  for (const n of promoted) branchLine.push(n);

  // The old mainline and the other siblings become variations of the new head.
  const newHead = promoted[0];
  newHead.variations = [...newHead.variations, oldMainTail, ...siblings];
  return true;
}
