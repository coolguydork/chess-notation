import { buildMoveTree, findNodeById } from "../core/tree";
import type { MoveNode } from "../core/types";

export { buildMoveTree, findNodeById };

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
// Header (game info) rendering
// ---------------------------------------------------------------------------

// Render every PGN tag as an aligned key/value grid, in source order. Each tag
// emits two grid cells (key, value) styled by .chess-headers. Tags with an empty
// value are skipped; returns "" when there is nothing to show (FEN-only blocks).
export function buildHeaderHtml(headers: Record<string, string>): string {
  const cells: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (value.trim() === "") continue;
    cells.push(
      `<span class="chess-header-key">${escapeHtml(key)}</span>` +
      `<span class="chess-header-value">${escapeHtml(value)}</span>`,
    );
  }
  if (cells.length === 0) return "";
  return `<div class="chess-headers">${cells.join("")}</div>`;
}

// ---------------------------------------------------------------------------
// Move list rendering
// ---------------------------------------------------------------------------

export function buildMoveListHtml(root: MoveNode, currentId: number, result?: string, editable = false): string {
  if (!root.next && root.tail.length === 0) return "";

  const parts: string[] = [];
  // Comments written before the first move live in the root's tail.
  renderTail(root, currentId, parts, editable);
  if (root.next) renderLine(root.next, currentId, parts, /* firstInLine */ true, editable);
  if (result) parts.push(`<span class="chess-result">${result}</span>`);

  return `<div class="chess-move-list">${parts.join("")}</div>`;
}

// A standalone comment item. Block element, so it drops onto its own line.
// `anchorActive` mirrors the active state of the move whose position the
// comment sits at; the delete control follows the same rule as move deletes.
function commentSpan(c: { id: number; text: string }, anchorActive: boolean, editable: boolean): string {
  const active = anchorActive ? ` data-active="true"` : "";
  const del = editable && anchorActive
    ? `<button class="chess-delete-btn" data-comment-delete-id="${c.id}" title="Delete comment">×</button>`
    : "";
  return `<span class="chess-comment" data-comment-id="${c.id}"${active}>${escapeHtml(c.text)}${del}</span>`;
}

// Emit a node's tail — the comments and variations that followed it in the
// text, in source order. Returns whether anything was emitted (the caller
// re-shows the next move number after a break).
function renderTail(node: MoveNode, currentId: number, out: string[], editable: boolean): boolean {
  for (const entry of node.tail) {
    if (entry.kind === "comment") {
      out.push(commentSpan(entry.comment, node.id === currentId, editable));
    } else {
      out.push(`<span class="chess-variation">`);
      out.push(`<span class="chess-variation-paren">(</span>`);
      for (const leadComment of entry.lead) {
        out.push(commentSpan(leadComment, entry.head.id === currentId, editable));
      }
      renderLine(entry.head, currentId, out, /* firstInLine */ true, editable);
      out.push(`<span class="chess-variation-paren">)</span>`);
      out.push(`</span>`);
    }
  }
  return node.tail.length > 0;
}

// Render a sequence of linked nodes, inserting each node's tail (comments and
// variation sub-trees) inline where the text had them.
// needsMoveNumber: true at the start of any line and after a comment/variation.
// editable: emit a delete control on the active move.
function renderLine(head: MoveNode, currentId: number, out: string[], needsMoveNumber: boolean, editable: boolean): void {
  let cur: MoveNode | null = head;
  let showNumber = needsMoveNumber;

  while (cur) {
    if (cur.color === "w" || showNumber) {
      const dots = cur.color === "w" ? "." : "…"; // "…" for black-to-move marker
      out.push(`<span class="chess-move-number">${cur.moveNumber}${dots}</span>`);
      showNumber = false;
    }

    const active = cur.id === currentId ? ` data-active="true"` : "";

    // Mid comment sits between the number and the move token (the PGN's rare
    // "1. {…} e4" slot); inline, so no move-number re-show needed.
    if (cur.commentMid) {
      const del = editable && cur.id === currentId
        ? `<button class="chess-delete-btn" data-comment-delete-id="${cur.id}" data-comment-delete-slot="mid" title="Delete comment">×</button>`
        : "";
      out.push(`<span class="chess-comment" data-comment-id="${cur.id}" data-comment-slot="mid"${active}>${escapeHtml(cur.commentMid)}${del}</span>`);
    }

    out.push(`<span class="chess-move" data-node-id="${cur.id}"${active}>${cur.san}</span>`);

    // NAG glyphs inline right after the move token (!, ?, !?, etc.)
    if (cur.nags?.length) {
      const glyphs = cur.nags.map(nagSymbol).join("");
      out.push(`<span class="chess-nags">${glyphs}</span>`);
    }

    // Delete control on the active move (editable blocks only)
    if (editable && cur.id === currentId) {
      out.push(`<button class="chess-delete-btn" data-delete-id="${cur.id}" title="Delete from here">×</button>`);
    }

    // Everything that followed this move in the text, in order.
    if (renderTail(cur, currentId, out, editable)) {
      showNumber = true; // a comment or variation breaks the run
    }

    cur = cur.next;
  }
}

