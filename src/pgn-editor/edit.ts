import type { PgnItem, PgnNode, PgnComment, PgnVariation } from "./types";

// ---------------------------------------------------------------------------
// pgn-editor — structural stream navigation and FEN-neutral edits
//
// These operate on a PgnItem[] stream by SAN path and need no rules engine:
// they read/restructure notation only. Engine-aware edits (validating a SAN,
// numbering a new move) live on the consumer side (core/game.ts), which builds
// on the navigation helpers here.
//
// Variations are stream items; a variation is an alternative to the nearest
// preceding move item in its containing line (the spec's "unplay the move
// immediately prior"). Comments are stream items with no owner: navigation
// skips them, and the comment ops below address them by adjacency to a move
// (an authoring convenience) or by item identity — never by an owning slot.
// ---------------------------------------------------------------------------

// Index of the first move item at or after `from`, or -1.
function nextMoveIndex(line: PgnItem[], from: number): number {
  for (let i = from; i < line.length; i++) {
    if (line[i].kind === "move") return i;
  }
  return -1;
}

// Where a move lives in the stream: its node, the items array containing it,
// and that array's index. For a variation head, `varLine`/`varIndex` locate the
// PgnVariation item itself inside its parent line (null/-1 otherwise).
export interface NodeLoc {
  node: PgnNode;
  line: PgnItem[];
  index: number;
  varLine: PgnItem[] | null;
  varIndex: number;
}

// The moves that may follow `parent` (null = the start position): the line's
// next move item plus the head of each variation item that follows that move
// (those variations are its alternatives, played from the same position).
export function childrenOf(items: PgnItem[], parent: NodeLoc | null): NodeLoc[] {
  const line = parent ? parent.line : items;
  const from = parent ? parent.index + 1 : 0;
  const ni = nextMoveIndex(line, from);
  if (ni === -1) return [];

  const next = line[ni] as PgnNode;
  const out: NodeLoc[] = [{ node: next, line, index: ni, varLine: null, varIndex: -1 }];
  for (let j = ni + 1; j < line.length && line[j].kind !== "move"; j++) {
    const it = line[j];
    if (it.kind !== "variation") continue;
    const h = nextMoveIndex(it.items, 0);
    if (h === -1) continue;
    out.push({ node: it.items[h] as PgnNode, line: it.items, index: h, varLine: line, varIndex: j });
  }
  return out;
}

// Resolve a SAN path to the location of the move at its end (null = the root).
export function resolvePath(items: PgnItem[], path: string[]): NodeLoc | null {
  let cur: NodeLoc | null = null;
  for (const san of path) {
    const found: NodeLoc | undefined = childrenOf(items, cur).find((c) => c.node.san === san);
    if (!found) return cur;
    cur = found;
  }
  return cur;
}

// The node at `path`, or null if the path is empty (the root) or doesn't resolve.
export function nodeAt(items: PgnItem[], path: string[]): PgnNode | null {
  if (path.length === 0) return null;
  const loc = resolvePath(items, path);
  return loc && loc.node.san === path[path.length - 1] ? loc.node : null;
}

// ---------------------------------------------------------------------------
// Update / Delete (structural; no rules engine)
// ---------------------------------------------------------------------------

// Set/clear the mid comment (inside the move's number–SAN unit) of the move at
// `path` — the one comment whose syntax binds it to a move. Returns false if
// the path doesn't resolve to a move.
export function setMidComment(items: PgnItem[], path: string[], text: string | null): boolean {
  const node = nodeAt(items, path);
  if (!node) return false;
  const trimmed = text?.trim();
  if (trimmed) node.commentMid = trimmed;
  else delete node.commentMid;
  return true;
}

// The comment item directly adjacent to the move at `path` ("before" = the item
// immediately preceding it in its line, "after" = immediately following), or
// null when the neighbour isn't a comment. Adjacency is positional, not
// ownership: it is simply where a comment about this move reads naturally.
export function adjacentComment(
  items: PgnItem[],
  path: string[],
  side: "before" | "after",
): PgnComment | null {
  const loc = resolvePath(items, path);
  if (!loc || loc.node.san !== path[path.length - 1]) return null;
  const neighbour = loc.line[side === "before" ? loc.index - 1 : loc.index + 1];
  return neighbour && neighbour.kind === "comment" ? neighbour : null;
}

// Set/replace/clear the comment item directly adjacent to the move at `path`.
// Updates the neighbour in place when it is already a comment, inserts a new
// item otherwise, and removes the neighbour when `text` is empty. Returns false
// if the path doesn't resolve to a move.
export function setAdjacentComment(
  items: PgnItem[],
  path: string[],
  side: "before" | "after",
  text: string | null,
): boolean {
  const loc = resolvePath(items, path);
  if (!loc || loc.node.san !== path[path.length - 1]) return false;

  const trimmed = text?.trim();
  const at = side === "before" ? loc.index - 1 : loc.index + 1;
  const neighbour = loc.line[at];

  if (neighbour && neighbour.kind === "comment") {
    if (trimmed) neighbour.text = trimmed;
    else loc.line.splice(at, 1);
  } else if (trimmed) {
    loc.line.splice(side === "before" ? loc.index : loc.index + 1, 0, { kind: "comment", text: trimmed });
  }
  return true;
}

// Locate a comment item anywhere in the stream (by identity, recursing into
// variations). Returns its containing line and index, or null.
function findComment(items: PgnItem[], target: PgnComment): { line: PgnItem[]; index: number } | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it === target) return { line: items, index: i };
    if (it.kind === "variation") {
      const found = findComment(it.items, target);
      if (found) return found;
    }
  }
  return null;
}

// Replace the text of an existing comment item (addressed by identity); empty
// text removes the item from its line. Returns false if the item isn't in the
// stream.
export function updateComment(items: PgnItem[], comment: PgnComment, text: string | null): boolean {
  const found = findComment(items, comment);
  if (!found) return false;
  const trimmed = text?.trim();
  if (trimmed) comment.text = trimmed;
  else found.line.splice(found.index, 1);
  return true;
}

// Replace a move's NAG list (e.g. [1] for "!", [16] for "±"). Empty clears them.
export function setNags(items: PgnItem[], path: string[], nags: number[]): boolean {
  const node = nodeAt(items, path);
  if (!node) return false;
  node.nags = [...nags];
  return true;
}

// Remove the move at `path` and everything after it in its line. A variation
// head removes the whole variation item. Removing the root is a no-op. Returns
// whether anything was removed.
export function removeAt(items: PgnItem[], path: string[]): boolean {
  const target = resolvePath(items, path);
  if (!target) return false;

  if (target.varLine && target.varIndex >= 0) {
    target.varLine.splice(target.varIndex, 1);
    return true;
  }
  target.line.length = target.index; // truncate this line from the target on
  return true;
}

// Promote the variation whose head is the move at `path` so it becomes the
// mainline at its branch point; the former mainline (and any sibling variations)
// become variations of the new head. `path` must resolve to a variation head.
// Returns false otherwise (incl. when it is already the mainline move).
export function promoteVariation(items: PgnItem[], path: string[]): boolean {
  if (path.length === 0) return false;
  const loc = resolvePath(items, path);
  if (!loc || loc.node.san !== path[path.length - 1]) return false;
  if (!loc.varLine || loc.varIndex < 0) return false; // already the mainline move

  const branchLine = loc.varLine;
  // The mainline move this variation replaces = nearest preceding move item.
  let nIdx = -1;
  for (let i = loc.varIndex - 1; i >= 0; i--) {
    if (branchLine[i].kind === "move") {
      nIdx = i;
      break;
    }
  }
  if (nIdx === -1) return false; // orphan variation; parser prevents this

  const promoted = (branchLine[loc.varIndex] as PgnVariation).items;

  // Cut the old mainline tail [N ... end] out of the branch line and drop the
  // promoted variation from it.
  const tail = branchLine.splice(nIdx);
  tail.splice(loc.varIndex - nIdx, 1);

  // N's remaining sibling variations (alternatives between N and the next move)
  // re-home onto the new head, mirroring N's demotion. Comments stay with N's
  // line — they keep their written position.
  const siblings: PgnVariation[] = [];
  let k = 1;
  while (k < tail.length && tail[k].kind !== "move") {
    if (tail[k].kind === "variation") siblings.push(tail.splice(k, 1)[0] as PgnVariation);
    else k++;
  }

  // Insert the demoted line and the siblings after the new head's existing
  // trailing items (so they read as alternatives to the head), then splice the
  // promoted line into the parent in place of the old tail.
  const headIdx = nextMoveIndex(promoted, 0);
  let insertAt = headIdx + 1;
  while (insertAt < promoted.length && promoted[insertAt].kind !== "move") insertAt++;
  promoted.splice(insertAt, 0, { kind: "variation", items: tail }, ...siblings);

  branchLine.push(...promoted);
  return true;
}
