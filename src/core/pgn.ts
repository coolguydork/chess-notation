import { parseGame, parseGames } from "@mliebelt/pgn-parser";
import type { PgnGame, PgnMove, MoveNode } from "./types";

// ---------------------------------------------------------------------------
// PGN parsing is delegated to @mliebelt/pgn-parser. This module is a thin
// adapter: it maps the library's AST to our own PgnGame / PgnMove types and
// re-applies the few behaviours our callers rely on that the library does not
// provide directly (see notes below). serializeMoveTree (further down) is ours.
// ---------------------------------------------------------------------------

// Minimal shape of the @mliebelt AST we consume. Declared locally (and cast to)
// so we don't couple to the library's internal type names.
interface MlMove {
  moveNumber: number | null;
  notation: { notation: string };
  turn: "w" | "b";
  nag: string[] | null;
  commentAfter?: string;
  variations: MlMove[][];
}
interface MlGame {
  tags: Record<string, unknown>;
  moves: MlMove[];
}

// A tag value is usually a string, but structured tags (e.g. Date) come back as
// { value, ... }. Reduce any tag to its string form.
function tagToString(v: unknown): string {
  if (v && typeof v === "object" && "value" in v) return String((v as { value: unknown }).value);
  return String(v);
}

// The library synthesises tags.Result from the trailing game-termination marker
// (e.g. "*") even when no [Result ...] header is present. Our callers expect
// `headers` to reflect only real header tags, so only surface Result when the
// source actually contains a [Result "..."] tag.
function buildHeaders(tags: Record<string, unknown>, source: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const hasResultTag = /\[\s*Result\s+"/.test(source);
  for (const [k, v] of Object.entries(tags)) {
    if (k === "messages") continue; // library bookkeeping, not a header
    if (k === "Result" && !hasResultTag) continue;
    headers[k] = tagToString(v);
  }
  return headers;
}

// The library normalises both "--" (PGN standard) and "Z0" (ChessBase) null
// moves to "Z0", losing the original token. To preserve round-trip fidelity we
// scan the source for null-move literals in order and hand them back as we
// encounter null nodes during conversion (which proceeds in source order).
function collectNullLiterals(source: string): string[] {
  const cleaned = source
    .replace(/\{[^}]*\}/g, " ") // brace comments
    .replace(/;[^\n]*/g, " ")   // line comments
    .replace(/\[[^\]]*\]/g, " "); // header tags / [%...] annotations
  return cleaned.match(/(?<![\w-])(?:--|Z0)(?![\w-])/g) ?? [];
}

interface NullCursor { lits: string[]; i: number; }
function nextNull(c: NullCursor): string {
  return c.i < c.lits.length ? c.lits[c.i++] : "Z0";
}

export function cleanComment(raw: string): string {
  // commentAfter already has [%...] annotations split out by the library; strip
  // any residual ones, collapse whitespace, and trim.
  return raw.replace(/\[%[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

function convertMoves(mlMoves: MlMove[], nulls: NullCursor): PgnMove[] {
  const out: PgnMove[] = [];
  // The library only sets moveNumber on white (and the first) moves; carry it.
  let num = mlMoves.length && mlMoves[0].moveNumber != null ? mlMoves[0].moveNumber : 1;

  for (const m of mlMoves) {
    if (m.moveNumber != null) num = m.moveNumber;

    const isNull = m.notation.notation === "Z0";
    const move: PgnMove = {
      san: isNull ? nextNull(nulls) : m.notation.notation,
      moveNumber: num,
      color: m.turn,
    };

    if (m.nag && m.nag.length) {
      const nags = m.nag
        .map((s) => parseInt(s.replace(/^\$/, ""), 10))
        .filter((n) => !Number.isNaN(n));
      if (nags.length) move.nags = nags;
    }

    if (m.commentAfter) {
      const c = cleanComment(m.commentAfter);
      if (c) move.comment = c;
    }

    if (m.variations && m.variations.length) {
      move.variations = m.variations.map((v) => convertMoves(v, nulls));
    }

    out.push(move);
    if (m.turn === "b") num++;
  }

  return out;
}

export function parsePGN(input: string): PgnGame {
  if (!input.trim()) throw new Error("PGN: input is empty");

  const game = parseGame(input) as unknown as MlGame;

  const result = game.tags.Result;
  if (typeof result !== "string") {
    throw new Error("PGN: missing result token (expected 1-0, 0-1, 1/2-1/2, or *)");
  }

  const nulls: NullCursor = { lits: collectNullLiterals(input), i: 0 };
  return {
    headers: buildHeaders(game.tags, input),
    moves: convertMoves(game.moves, nulls),
    result,
  };
}

// ---------------------------------------------------------------------------
// parseMultiPGN — parse a PGN string that may contain more than one game.
// Returns an array of PgnGame objects (one element for a single-game string).
// ---------------------------------------------------------------------------

export function parseMultiPGN(input: string): PgnGame[] {
  if (!input.trim()) throw new Error("PGN: input is empty");

  const games = parseGames(input) as unknown as MlGame[];
  if (!games || games.length === 0) throw new Error("PGN: no games found");

  // One cursor shared across all games: null-move literals are consumed in
  // overall source order, and games are returned in source order.
  const nulls: NullCursor = { lits: collectNullLiterals(input), i: 0 };

  return games.map((game, idx) => {
    const result = game.tags.Result;
    if (typeof result !== "string") {
      throw new Error(
        `PGN: game ${idx + 1}: missing result token (expected 1-0, 0-1, 1/2-1/2, or *)`
      );
    }
    return {
      headers: buildHeaders(game.tags, input),
      moves: convertMoves(game.moves, nulls),
      result,
    };
  });
}

// ---------------------------------------------------------------------------
// serializeMoveTree
// Walks a MoveNode tree (built by buildMoveTree in render/controls.ts) and
// emits a PGN move-text string (no headers). Variations are written as
// standard parenthesised branches. Pass the game result as the second arg
// (defaults to "*" for an ongoing/unknown game).
// ---------------------------------------------------------------------------

export function serializeMoveTree(root: MoveNode, result = "*"): string {
  const parts: string[] = [];
  serializeLine(root.next, parts, true);
  parts.push(result);
  return parts.join(" ");
}

function serializeLine(head: MoveNode | null, out: string[], needsMoveNumber: boolean): void {
  let cur = head;
  let showNumber = needsMoveNumber;

  while (cur) {
    if (cur.color === "w" || showNumber) {
      out.push(cur.color === "w" ? `${cur.moveNumber}.` : `${cur.moveNumber}...`);
      showNumber = false;
    }

    out.push(cur.san!);

    if (cur.nags?.length) {
      for (const n of cur.nags) out.push(`$${n}`);
    }

    if (cur.comment) {
      out.push(`{ ${cur.comment} }`);
      showNumber = true;
    }

    for (const varHead of cur.variationHeads) {
      const varParts: string[] = [];
      serializeLine(varHead, varParts, true);
      out.push(`( ${varParts.join(" ")} )`);
      showNumber = true;
    }

    cur = cur.next;
  }
}
