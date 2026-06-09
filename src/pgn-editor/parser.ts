import type { Color, PgnNode, PgnGameAst } from "./types";

// ---------------------------------------------------------------------------
// pgn-editor — clean-room PGN parser
//
// Hand-written recursive-descent scanner. PGN's only recursion is the
// parenthesised variation, so the grammar is small. SAN is captured as a single
// opaque token: this layer does NOT resolve which piece moves (no FEN, no
// disambiguation) — the consumer feeds the SAN to its rules engine. That keeps
// the parser tiny and FEN-neutral.
//
// Written from the PGN export/import standard (the move-number / SAN / NAG /
// comment / variation / termination grammar). Fixes the gaps that pushed us off
// the off-the-shelf libraries: null moves ("--" and "Z0"), ";"-line comments,
// all three comment positions, and only the four legal result tokens.
// ---------------------------------------------------------------------------

// Mutable scan position. (Plain holder + functions — no classes in this layer.)
interface Cursor {
  readonly s: string;
  i: number;
}

// Standard NAG glyphs -> numeric code. Longer glyphs must precede their
// prefixes ("!!" before "!"). This is the published NAG table, not authorship.
const NAG_GLYPHS: ReadonlyArray<readonly [string, number]> = [
  ["!!", 3], ["??", 4], ["!?", 5], ["?!", 6], ["!", 1], ["?", 2],
  ["‼", 3], ["⁇", 4], ["⁉", 5], ["⁈", 6],
  ["□", 7], ["=", 10], ["∞", 13], ["⩲", 14], ["⩱", 15],
  ["±", 16], ["∓", 17], ["+−", 18], ["+-", 18], ["−+", 19], ["-+", 19],
];

const RESULTS: readonly string[] = ["1-0", "0-1", "1/2-1/2", "*"];

// SAN: castling, null move, or piece/pawn move (incl. long-algebraic dash form),
// with optional promotion and check/mate suffix. The "!"/"?" annotations are
// deliberately excluded — they are read separately as NAGs.
const SAN_RE =
  /^(?:O-O-O|O-O|0-0-0|0-0|--|Z0|[NBRQK]?[a-h]?[1-8]?[-x]?[a-h][1-8](?:=[NBRQKnbrq])?)[+#]?/;

function eof(c: Cursor): boolean {
  return c.i >= c.s.length;
}

function skipSpace(c: Cursor): void {
  while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++;
}

// Read one comment if the cursor is on one, else null. Handles both "{ ... }"
// (may span newlines) and ";"-to-end-of-line comments.
function readComment(c: Cursor): string | null {
  if (c.s[c.i] === "{") {
    const end = c.s.indexOf("}", c.i + 1);
    const stop = end === -1 ? c.s.length : end;
    const text = c.s.slice(c.i + 1, stop);
    c.i = end === -1 ? c.s.length : end + 1;
    return text.replace(/\s+/g, " ").trim();
  }
  if (c.s[c.i] === ";") {
    let end = c.s.indexOf("\n", c.i + 1);
    if (end === -1) end = c.s.length;
    const text = c.s.slice(c.i + 1, end);
    c.i = end;
    return text.trim();
  }
  return null;
}

// Read zero or more consecutive comments, joined with a space (rare but legal).
function readComments(c: Cursor): string | undefined {
  let acc: string | undefined;
  for (;;) {
    skipSpace(c);
    const cm = readComment(c);
    if (cm === null) break;
    acc = acc ? `${acc} ${cm}` : cm;
  }
  return acc;
}

// Read one NAG ("$7" or a glyph) if present, else null.
function readNag(c: Cursor): number | null {
  if (c.s[c.i] === "$") {
    const m = /^\$(\d+)/.exec(c.s.slice(c.i));
    if (m) {
      c.i += m[0].length;
      return parseInt(m[1], 10);
    }
  }
  for (const [glyph, code] of NAG_GLYPHS) {
    if (c.s.startsWith(glyph, c.i)) {
      c.i += glyph.length;
      return code;
    }
  }
  return null;
}

// Move-number indicator: "12." (white) or "12..." (black to move). Returns the
// number and which side it announces, or null if the cursor isn't on one.
function readMoveNumber(c: Cursor): { num: number; color: Color } | null {
  const m = /^(\d+)\s*(\.+)/.exec(c.s.slice(c.i));
  if (!m) return null;
  c.i += m[0].length;
  // One dot announces white; two or more (the "..." ellipsis) announces black.
  return { num: parseInt(m[1], 10), color: m[2].length >= 2 ? "b" : "w" };
}

function readSan(c: Cursor): string | null {
  const m = SAN_RE.exec(c.s.slice(c.i));
  if (!m) return null;
  c.i += m[0].length;
  return m[0];
}

function readResult(c: Cursor): string | null {
  for (const r of RESULTS) {
    if (c.s.startsWith(r, c.i)) {
      c.i += r.length;
      return r;
    }
  }
  return null;
}

// Running side/number while walking a line; PGN omits the number on most black
// plies, so we carry it and let explicit tokens (and ellipses) correct it.
interface Turn {
  color: Color;
  num: number;
}

function advance(t: Turn): Turn {
  return t.color === "w" ? { color: "b", num: t.num } : { color: "w", num: t.num + 1 };
}

// Parse a movetext line until ")" (variation close), a result token, or EOF.
// `start` seeds the side/number for the first ply (a variation inherits these
// from the move it replaces). The result token, if any, is returned separately.
function parseLine(c: Cursor, start: Turn): { moves: PgnNode[]; result: string | null } {
  const moves: PgnNode[] = [];
  let turn = start;
  let result: string | null = null;

  for (;;) {
    // Comments before the move number become the next ply's commentMove.
    const commentMove = readComments(c);
    skipSpace(c);
    if (eof(c) || c.s[c.i] === ")") break;

    const res = readResult(c);
    if (res !== null) {
      result = res;
      break;
    }

    // Optional move number (corrects running side/number via the ellipsis).
    const mn = readMoveNumber(c);
    if (mn) turn = { color: mn.color, num: mn.num };

    // Comments between the number and the SAN.
    const commentBefore = readComments(c);
    skipSpace(c);

    const san = readSan(c);
    if (san === null) {
      // Unrecognised token — skip it so one stray char can't abort the parse.
      if (!eof(c) && c.s[c.i] !== ")") c.i++;
      continue;
    }

    const node: PgnNode = { san, moveNumber: turn.num, color: turn.color, nags: [], variations: [] };
    if (commentMove) node.commentMove = commentMove;
    if (commentBefore) node.commentBefore = commentBefore;

    // After the SAN: NAGs and the after-comment may interleave.
    let commentAfter: string | undefined;
    for (;;) {
      skipSpace(c);
      const nag = readNag(c);
      if (nag !== null) {
        node.nags.push(nag);
        continue;
      }
      const cm = readComment(c);
      if (cm !== null) {
        commentAfter = commentAfter ? `${commentAfter} ${cm}` : cm;
        continue;
      }
      break;
    }
    if (commentAfter) node.commentAfter = commentAfter;

    // Variations branch from this ply's parent — i.e. they are alternatives to
    // THIS move, so they start at this ply's side/number.
    for (;;) {
      skipSpace(c);
      if (c.s[c.i] !== "(") break;
      c.i++; // consume "("
      const sub = parseLine(c, { color: turn.color, num: turn.num });
      skipSpace(c);
      if (c.s[c.i] === ")") c.i++; // consume ")"
      if (sub.moves.length > 0) node.variations.push(sub.moves);
    }

    moves.push(node);
    turn = advance(turn);
  }

  return { moves, result };
}

// Strip and parse leading [Tag "value"] header lines; returns the headers (in
// source order) and the offset where the movetext begins.
function parseHeaders(s: string): { headers: Record<string, string>; offset: number } {
  const headers: Record<string, string> = {};
  const re = /\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/y;
  let i = 0;
  for (;;) {
    // Advance over whitespace between/around header lines.
    while (i < s.length && /\s/.test(s[i])) i++;
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m || m.index !== i) break;
    headers[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    i = re.lastIndex;
  }
  return { headers, offset: i };
}

// ---------------------------------------------------------------------------
// parse — PGN text -> FEN-neutral AST. Lenient: missing result -> "*",
// unparseable stray tokens are skipped rather than thrown.
// ---------------------------------------------------------------------------
export function parse(input: string): PgnGameAst {
  const { headers, offset } = parseHeaders(input);
  const c: Cursor = { s: input, i: offset };
  // A game with a [FEN] for a black-to-move start still numbers its first ply as
  // white unless the movetext says otherwise; the running side self-corrects on
  // the first explicit number/ellipsis. Top level seeds white / move 1.
  const { moves, result } = parseLine(c, { color: "w", num: 1 });
  return { headers, moves, result: result ?? "*" };
}
