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

// Move-quality NAGs (1–6) carry a colour category so the badge can signal how
// good/bad the move was at a glance. Everything else (positional assessments,
// "with idea", etc.) stays neutral and inherits the accent colour.
const NAG_CATEGORY: Record<number, string> = {
  1: "good", 2: "mistake", 3: "brilliant", 4: "blunder", 5: "interesting", 6: "dubious",
};

function nagCategory(n: number): string | null {
  return NAG_CATEGORY[n] ?? null;
}

// All output is built with the DOM API and textContent — never HTML strings —
// so PGN-sourced text (SAN, comments, headers) needs no escaping and can't
// inject markup. `document` comes from the host environment (Obsidian, a
// browser, or happy-dom in tests); render/ still imports nothing.
function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Human-readable address of a move ("3. Bc4" / "3… Nf6"), used to title the
// variation card it heads ("alternative to 3. Bc4").
function moveLabel(node: MoveNode): string {
  const dots = node.color === "w" ? "." : "\u2026";
  return `${node.moveNumber}${dots} ${node.san ?? ""}`.trim();
}

// ---------------------------------------------------------------------------
// Header (game info) rendering
// ---------------------------------------------------------------------------

// Render every PGN tag as an aligned key/value grid, in source order. Each tag
// emits two grid cells (key, value) styled by .chess-headers. Tags with an empty
// value are skipped; returns null when there is nothing to show (FEN-only blocks).
export function buildHeaderEl(headers: Record<string, string>): HTMLElement | null {
  const entries = Object.entries(headers).filter(([, value]) => value.trim() !== "");
  if (entries.length === 0) return null;
  const grid = el("div", "chess-headers");
  for (const [key, value] of entries) {
    grid.appendChild(el("span", "chess-header-key", key));
    grid.appendChild(el("span", "chess-header-value", value));
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Move list rendering
// ---------------------------------------------------------------------------

// The selected element is exactly one item: the current move, or — when
// `activeCommentId` is set — that comment alone. A comment never inherits
// active state from the move whose position it sits at (no ownership).
export function buildMoveListEl(root: MoveNode, currentId: number, result?: string, editable = false, activeCommentId: number | null = null): HTMLElement | null {
  if (!root.next && root.tail.length === 0) return null;

  // When a comment is selected, no move is. Ids are non-negative, so -1
  // matches nothing.
  const moveId = activeCommentId === null ? currentId : -1;
  const list = el("div", "chess-move-list");
  // Comments written before the first move live in the root's tail.
  renderTail(root, moveId, activeCommentId, list, editable);
  if (root.next) renderLine(root.next, moveId, activeCommentId, list, /* firstInLine */ true, editable);
  if (result) list.appendChild(el("span", "chess-result", result));

  return list;
}

// A standalone comment item. Block element, so it drops onto its own line.
// `active` marks the comment itself as the selected element; the delete
// control follows the same rule as move deletes.
function commentEl(c: { id: number; text: string }, active: boolean, editable: boolean): HTMLElement {
  const span = el("span", "chess-comment", c.text);
  span.dataset.commentId = String(c.id);
  if (active) span.dataset.active = "true";
  if (editable && active) {
    const del = el("button", "chess-delete-btn", "×");
    del.dataset.commentDeleteId = String(c.id);
    del.title = "Delete comment";
    span.appendChild(del);
  }
  return span;
}

// Emit a node's tail — the comments and variations that followed it in the
// text, in source order. Returns whether anything was emitted (the caller
// re-shows the next move number after a break).
//
// Variations render as a collapsible <details> card titled by the move they
// branch from. The literal "(" / ")" parens are still emitted (hidden in CSS)
// so the serialized structure — and its tests — stay stable, and so the model
// round-trips unchanged.
function renderTail(node: MoveNode, currentId: number, activeCommentId: number | null, out: HTMLElement, editable: boolean): boolean {
  for (const entry of node.tail) {
    if (entry.kind === "comment") {
      out.appendChild(commentEl(entry.comment, entry.comment.id === activeCommentId, editable));
    } else {
      const variation = document.createElement("details");
      variation.className = "chess-variation";
      variation.open = true;

      const summary = document.createElement("summary");
      summary.className = "chess-variation-summary";
      summary.appendChild(el("span", "chess-variation-caret"));
      summary.appendChild(el(
        "span",
        "chess-variation-label",
        node.san ? `Variation · alternative to ${moveLabel(node)}` : "Variation",
      ));
      summary.appendChild(el("span", "chess-variation-paren", "("));
      variation.appendChild(summary);

      const body = el("span", "chess-variation-body");
      for (const leadComment of entry.lead) {
        body.appendChild(commentEl(leadComment, leadComment.id === activeCommentId, editable));
      }
      renderLine(entry.head, currentId, activeCommentId, body, /* firstInLine */ true, editable);
      body.appendChild(el("span", "chess-variation-paren", ")"));
      variation.appendChild(body);

      out.appendChild(variation);
    }
  }
  return node.tail.length > 0;
}

// Render a sequence of linked nodes, inserting each node's tail (comments and
// variation sub-trees) inline where the text had them.
// needsMoveNumber: true at the start of any line and after a comment/variation.
// editable: emit a delete control on the active move.
function renderLine(head: MoveNode, currentId: number, activeCommentId: number | null, out: HTMLElement, needsMoveNumber: boolean, editable: boolean): void {
  let cur: MoveNode | null = head;
  let showNumber = needsMoveNumber;

  while (cur) {
    if (cur.color === "w" || showNumber) {
      const dots = cur.color === "w" ? "." : "…"; // "…" for black-to-move marker
      out.appendChild(el("span", "chess-move-number", `${cur.moveNumber}${dots}`));
      showNumber = false;
    }

    const move = el("span", "chess-move", cur.san ?? "");
    move.dataset.nodeId = String(cur.id);
    if (cur.id === currentId) move.dataset.active = "true";
    out.appendChild(move);

    // NAG glyphs right after the move token. Each glyph is its own badge so a
    // move-quality NAG (!, ?, !?, …) can be colour-coded by category; the
    // outer .chess-nags wrapper is retained as the stable hook.
    if (cur.nags?.length) {
      const nags = el("span", "chess-nags");
      for (const n of cur.nags) {
        const cat = nagCategory(n);
        nags.appendChild(el("span", cat ? `chess-nag chess-nag--${cat}` : "chess-nag", nagSymbol(n)));
      }
      out.appendChild(nags);
    }

    // Delete control on the active move (editable blocks only)
    if (editable && cur.id === currentId) {
      const del = el("button", "chess-delete-btn", "×");
      del.dataset.deleteId = String(cur.id);
      del.title = "Delete from here";
      out.appendChild(del);
    }

    // Everything that followed this move in the text, in order.
    if (renderTail(cur, currentId, activeCommentId, out, editable)) {
      showNumber = true; // a comment or variation breaks the run
    }

    cur = cur.next;
  }
}
