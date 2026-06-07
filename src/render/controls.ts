import { parseFEN } from "../core/fen";
import { applyMove } from "../core/moves";
import { renderBoard } from "./board";
import type { PgnMove, MoveNode, Color, BoardState } from "../core/types";
import type { BoardConfig } from "./config";

// ---------------------------------------------------------------------------
// NAG symbols
// Covers the glyphs commonly emitted by chess software.
// Unknown NAGs fall back to the numeric form ($N).
// ---------------------------------------------------------------------------

const NAG_SYMBOLS: Record<number, string> = {
  1:  "!",   2:  "?",   3:  "!!",  4:  "??",  5:  "!?",  6:  "?!",
  7:  "□",                          // only move
  10: "=",                          // equal
  11: "∞",   13: "∞",               // unclear
  14: "⩲",   15: "⩱",               // slight edge
  16: "±",   17: "∓",               // clear edge
  18: "+−",  19: "−+",              // decisive
  22: "⊙",                          // zugzwang
  32: "⟳",                          // development
  36: "→",                          // initiative
  40: "↑",                          // attack
  132: "⇆",                         // counterplay
  138: "⊕",                         // time pressure
  140: "△",                          // with idea
  146: "N",                          // novelty
};

function nagSymbol(n: number): string {
  return NAG_SYMBOLS[n] ?? `$${n}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
  parent: MoveNode | null,
  comment?: string,
  nags?: number[]
): MoveNode {
  return {
    id: _idCounter++,
    san,
    moveNumber,
    color,
    comment,
    nags: nags?.length ? nags : undefined,
    state,
    parent,
    next: null,
    variationHeads: [],
  };
}

// Extend a line forward from parentNode by applying each PgnMove in sequence.
function buildLine(parentNode: MoveNode, pgnMoves: PgnMove[]): void {
  let cur = parentNode;
  for (const m of pgnMoves) {
    const node = makeNode(m.san, m.moveNumber, m.color, applyMove(cur.state, m.san), cur, m.comment, m.nags);
    cur.next = node;

    // m.variations are alternatives to m — they branch from cur (m's parent).
    // Attach each as a variationHead on node (displayed right after node).
    for (const varLine of (m.variations ?? [])) {
      if (varLine.length > 0) attachVariation(cur, varLine, node);
    }

    cur = node;
  }
}

// Create the first node of a variation line and attach it to precedingNode's
// variationHeads. Recursively handles variations nested inside the first move.
function attachVariation(parentNode: MoveNode, varPgn: PgnMove[], precedingNode: MoveNode): void {
  const first = varPgn[0];
  const firstNode = makeNode(
    first.san, first.moveNumber, first.color,
    applyMove(parentNode.state, first.san),
    parentNode, first.comment, first.nags
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
  const root = makeNode(null, 0, null, parseFEN(startFen), null);
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
// renderControls
// Returns a self-contained HTML string: board SVG + navigation buttons +
// move list (main line + all variation branches).
//
// data-action="prev" / data-action="next"  — nav buttons
// data-node-id="N"                         — each move token
// data-active="true"                       — the currently displayed move
// ---------------------------------------------------------------------------

export function renderControls(
  root: MoveNode,
  current: MoveNode,
  config: BoardConfig,
  result?: string,
  engineArrows?: import("./config").EngineArrow[]
): string {
  const boardSvg = renderBoard(current.state, engineArrows ? { ...config, engineArrows } : config);

  const prevDisabled = !current.parent ? " disabled" : "";
  const nextDisabled = !current.next   ? " disabled" : "";

  const nav = `<div class="chess-nav">
  <button data-action="prev"${prevDisabled}>&#8592;</button>
  <button data-action="next"${nextDisabled}>&#8594;</button>
</div>`;

  const moveList = buildMoveListHtml(root, current.id, result);

  return `<div class="chess-viewer">${boardSvg}${nav}${moveList}</div>`;
}

// ---------------------------------------------------------------------------
// Move list rendering
// ---------------------------------------------------------------------------

export function buildMoveListHtml(root: MoveNode, currentId: number, result?: string): string {
  if (!root.next) return "";

  const parts: string[] = [];
  renderLine(root.next, currentId, parts, /* firstInLine */ true);
  if (result) parts.push(`<span class="chess-result">${result}</span>`);

  return `<div class="chess-move-list">${parts.join("")}</div>`;
}

// Render a sequence of linked nodes, inserting variation sub-trees inline.
// needsMoveNumber: true at the start of any line and after a variation closes.
function renderLine(head: MoveNode, currentId: number, out: string[], needsMoveNumber: boolean): void {
  let cur: MoveNode | null = head;
  let showNumber = needsMoveNumber;

  while (cur) {
    if (cur.color === "w" || showNumber) {
      const dots = cur.color === "w" ? "." : "…"; // "…" for black-to-move marker
      out.push(`<span class="chess-move-number">${cur.moveNumber}${dots}</span>`);
      showNumber = false;
    }

    const active = cur.id === currentId ? ` data-active="true"` : "";
    out.push(`<span class="chess-move" data-node-id="${cur.id}"${active}>${cur.san}</span>`);

    // NAG glyphs inline right after the move token (!, ?, !?, etc.)
    if (cur.nags?.length) {
      const glyphs = cur.nags.map(nagSymbol).join("");
      out.push(`<span class="chess-nags">${glyphs}</span>`);
    }

    // Annotation comment — block element so it drops below the move line
    if (cur.comment) {
      out.push(`<span class="chess-comment">${escapeHtml(cur.comment)}</span>`);
      showNumber = true; // re-show move number after a block comment
    }

    // Variation lines shown after this move (each branches from cur.parent)
    for (const varHead of cur.variationHeads) {
      out.push(`<span class="chess-variation">`);
      out.push(`<span class="chess-variation-paren">(</span>`);
      renderLine(varHead, currentId, out, /* firstInLine */ true);
      out.push(`<span class="chess-variation-paren">)</span>`);
      out.push(`</span>`);
      showNumber = true; // re-show move number after a variation closes
    }

    cur = cur.next;
  }
}
