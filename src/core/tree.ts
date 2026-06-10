import { parseFEN } from "./fen";
import { applyMoveEx } from "./moves";
import type { PgnMove, MoveNode, Color, BoardState } from "./types";

// ---------------------------------------------------------------------------
// buildMoveTree
// Converts a flat PgnMove[] (with nested .variations) into a linked MoveNode
// tree. Each node stores the board state after its move plus parent/next/
// variationHeads links so the UI can navigate any branch.
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
  comment?: string,
  nags?: number[],
  commentBefore?: string,
  commentMid?: string
): MoveNode {
  return {
    id: _idCounter++,
    san,
    moveNumber,
    color,
    commentBefore,
    commentMid,
    comment,
    nags: nags?.length ? nags : undefined,
    state,
    from,
    to,
    parent,
    next: null,
    variationHeads: [],
  };
}

// Extend a line forward from parentNode by applying each PgnMove in sequence.
function buildLine(parentNode: MoveNode, pgnMoves: PgnMove[]): void {
  let cur = parentNode;
  for (const m of pgnMoves) {
    const result = applyMoveEx(cur.state, m.san);
    const node = makeNode(m.san, m.moveNumber, m.color, result.state, result.from, result.to, cur, m.comment, m.nags, m.commentBefore, m.commentMid);
    cur.next = node;

    // m.variations are alternatives to m — they branch from cur (m's parent).
    // Attach each as a variationHead on node (displayed right after node).
    for (const varLine of (m.variations ?? [])) {
      if (varLine.length > 0) {
        try { attachVariation(cur, varLine, node); } catch { /* skip invalid variation */ }
      }
    }

    cur = node;
  }
}

// Create the first node of a variation line and attach it to precedingNode's
// variationHeads. Recursively handles variations nested inside the first move.
function attachVariation(parentNode: MoveNode, varPgn: PgnMove[], precedingNode: MoveNode): void {
  const first = varPgn[0];
  const firstResult = applyMoveEx(parentNode.state, first.san);
  const firstNode = makeNode(
    first.san, first.moveNumber, first.color,
    firstResult.state, firstResult.from, firstResult.to,
    parentNode, first.comment, first.nags, first.commentBefore, first.commentMid
  );
  precedingNode.variationHeads.push(firstNode);

  // Nested variations on the first variation move (alternatives to it, same parent)
  for (const nested of (first.variations ?? [])) {
    if (nested.length > 0) attachVariation(parentNode, nested, firstNode);
  }

  buildLine(firstNode, varPgn.slice(1));
}

export function buildMoveTree(startFen: string, pgnMoves: PgnMove[]): MoveNode {
  _idCounter = 0;
  const root = makeNode(null, 0, null, parseFEN(startFen), -1, -1, null);
  buildLine(root, pgnMoves);
  return root;
}

// ---------------------------------------------------------------------------
// findNodeById
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
