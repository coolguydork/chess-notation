import { buildMoveTree, findNodeById, attachMove } from "../core/tree";
import type { MoveNode } from "../core/types";

export { buildMoveTree, findNodeById, attachMove };

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

