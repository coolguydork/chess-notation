import { parseFEN } from "./fen";
import { applyMoveEx } from "./moves";
import { cleanComment } from "./pgn";
import type { PgnItem, PgnNode, PgnComment } from "../pgn-editor";
import type { MoveNode, RenderComment, Color, BoardState } from "./types";

// ---------------------------------------------------------------------------
// buildMoveTree
// Projects a pgn-editor item stream into a linked MoveNode tree. Each node
// stores the board state after its move plus parent/next/variationHeads links
// so the UI can navigate any branch. Comments are carried positionally: each
// node's `tail` holds the comments and variations that followed it in the
// text, in source order (the root's tail holds anything before the first
// move). Comment text is display-cleaned here; `source` keeps the AST item so
// edits address comments by identity.
// ---------------------------------------------------------------------------

let _idCounter = 0;

function makeNode(
  san: string | null,
  moveNumber: number,
  color: Color | null,
  state: BoardState,
  from: number,
  to: number,
  parent: MoveNode | null,
  nags?: number[]
): MoveNode {
  return {
    id: _idCounter++,
    san,
    moveNumber,
    color,
    nags: nags?.length ? nags : undefined,
    state,
    from,
    to,
    parent,
    next: null,
    tail: [],
    variationHeads: [],
  };
}

function renderComment(item: PgnComment): RenderComment | null {
  const text = cleanComment(item.text);
  if (!text) return null; // e.g. a pure [%eval] annotation — nothing to show
  return { id: _idCounter++, text, source: item };
}

// Extend a line forward from parentNode, attaching comments and variations to
// the tail of the move they follow (or to parentNode's tail before any move).
function buildLine(parentNode: MoveNode, items: PgnItem[]): void {
  let cur = parentNode;
  for (const it of items) {
    if (it.kind === "comment") {
      const c = renderComment(it);
      if (c) cur.tail.push({ kind: "comment", comment: c });
      continue;
    }
    if (it.kind === "variation") {
      // A variation is an alternative to `cur`, replayed from cur's parent
      // position. The parser guarantees a preceding move exists in the line.
      if (cur.parent === null) continue;
      try {
        attachVariation(cur, it.items);
      } catch {
        /* skip a variation whose moves are illegal from this position */
      }
      continue;
    }
    const result = applyMoveEx(cur.state, it.san);
    const node = makeNode(
      it.san, it.moveNumber, it.color, result.state, result.from, result.to,
      cur, it.nags
    );
    cur.next = node;
    cur = node;
  }
}

// Project a variation line and attach its head to precedingNode (the move it
// is an alternative to). Comments leading the variation's line become the tail
// entry's `lead`, so they render inside the parentheses before the head.
function attachVariation(precedingNode: MoveNode, items: PgnItem[]): void {
  const lead: RenderComment[] = [];
  let h = 0;
  for (; h < items.length && items[h].kind !== "move"; h++) {
    const it = items[h];
    if (it.kind === "comment") {
      const c = renderComment(it);
      if (c) lead.push(c);
    }
  }
  const first = items[h] as PgnNode | undefined;
  if (!first) return; // comment-only variation: nothing navigable to attach

  const base = precedingNode.parent!;
  const firstResult = applyMoveEx(base.state, first.san);
  const firstNode = makeNode(
    first.san, first.moveNumber, first.color,
    firstResult.state, firstResult.from, firstResult.to,
    base, first.nags
  );
  precedingNode.tail.push({ kind: "variation", head: firstNode, lead });
  precedingNode.variationHeads.push(firstNode);

  buildLine(firstNode, items.slice(h + 1));
}

export function buildMoveTree(startFen: string, items: PgnItem[]): MoveNode {
  _idCounter = 0;
  const root = makeNode(null, 0, null, parseFEN(startFen), -1, -1, null);
  buildLine(root, items);
  return root;
}

// ---------------------------------------------------------------------------
// findNodeById / findCommentById
// BFS over the full tree (main line + all variation branches).
// ---------------------------------------------------------------------------

export function findNodeById(root: MoveNode, id: number): MoveNode | null {
  const queue: MoveNode[] = [root];
  while (queue.length) {
    const node = queue.shift()!;
    if (node.id === id) return node;
    if (node.next) queue.push(node.next);
    for (const v of node.variationHeads) queue.push(v);
  }
  return null;
}

// Locate a rendered comment by id. `anchor` is the node whose board position
// the comment sits at in the text: the move it follows, or — for a comment
// leading a variation — that variation's head.
export function findCommentById(
  root: MoveNode,
  id: number,
): { comment: RenderComment; anchor: MoveNode } | null {
  const queue: MoveNode[] = [root];
  while (queue.length) {
    const node = queue.shift()!;
    for (const entry of node.tail) {
      if (entry.kind === "comment") {
        if (entry.comment.id === id) return { comment: entry.comment, anchor: node };
      } else {
        for (const c of entry.lead) {
          if (c.id === id) return { comment: c, anchor: entry.head };
        }
      }
    }
    if (node.next) queue.push(node.next);
    for (const v of node.variationHeads) queue.push(v);
  }
  return null;
}

// ---------------------------------------------------------------------------
// nodeToPath / pathToNode
// Serialise/restore the viewer's position as a sequence of SANs from root.
// ---------------------------------------------------------------------------

export function nodeToPath(node: MoveNode): string[] {
  const path: string[] = [];
  let cur: MoveNode | null = node;
  while (cur !== null && cur.san !== null) {
    path.unshift(cur.san);
    cur = cur.parent;
  }
  return path;
}

export function pathToNode(root: MoveNode, path: string[]): MoveNode {
  let cur = root;
  for (const san of path) {
    const next = cur.next?.san === san
      ? cur.next
      : cur.next?.variationHeads.find(v => v.san === san);
    if (!next) break;
    cur = next;
  }
  return cur;
}
