import type { PgnGameAst } from "./types";
import { parse } from "./parser";

// ---------------------------------------------------------------------------
// pgn-editor — multi-game splitting
//
// A PGN database is a sequence of games. parseGames() splits the text into
// per-game chunks and parses each with the single-game parser. The split must
// honour the standard's delimiters: a game ends at its top-level result token
// (1-0 / 0-1 / 1/2-1/2 / *), and a header block can only begin a new game — a
// header appearing in the middle of un-terminated movetext means the previous
// game is missing its result (an error). Result tokens inside comments ({...},
// ; to EOL) or variations ((...)) must not split, so the scanner tracks that
// state and only acts at depth 0.
// ---------------------------------------------------------------------------

const RESULTS = ["1/2-1/2", "1-0", "0-1", "*"] as const; // longest first

function resultAt(text: string, i: number): string | null {
  for (const r of RESULTS) if (text.startsWith(r, i)) return r;
  return null;
}

// Skip a header tag starting at `text[i] === '['`, returning the index just past
// its closing ']'. Quote-aware so a ']' inside a tag value doesn't end it early.
function skipHeader(text: string, i: number): number {
  let j = i + 1;
  let inQuote = false;
  while (j < text.length) {
    const c = text[j];
    if (inQuote) {
      if (c === "\\") j += 2;
      else { if (c === '"') inQuote = false; j++; }
      continue;
    }
    if (c === '"') { inQuote = true; j++; continue; }
    if (c === "]") return j + 1;
    j++;
  }
  return text.length;
}

// Split into per-game chunk strings (each = headers + movetext + result).
function splitGames(text: string): string[] {
  const chunks: string[] = [];
  let chunkStart = 0;
  let sawMoves = false; // movetext seen in the current chunk since chunkStart
  let brace = false;
  let lineComment = false;
  let paren = 0;
  let i = 0;

  const closeChunk = (end: number): void => {
    const chunk = text.slice(chunkStart, end);
    if (chunk.trim()) chunks.push(chunk);
    chunkStart = end;
    sawMoves = false;
  };

  while (i < text.length) {
    const c = text[i];

    if (lineComment) { if (c === "\n") lineComment = false; i++; continue; }
    if (brace) { if (c === "}") brace = false; i++; continue; }
    if (c === "{") { brace = true; sawMoves = true; i++; continue; }
    if (c === ";") { lineComment = true; sawMoves = true; i++; continue; }
    if (c === "(") { paren++; sawMoves = true; i++; continue; }
    if (c === ")") { if (paren > 0) paren--; i++; continue; }
    if (paren > 0) { i++; continue; }

    if (/\s/.test(c)) { i++; continue; }

    if (c === "[") {
      if (sawMoves) {
        throw new Error("PGN: a game is missing its result token before the next game");
      }
      i = skipHeader(text, i); // headers belong to the (upcoming) game
      continue;
    }

    const res = resultAt(text, i);
    if (res) {
      i += res.length;
      closeChunk(i); // the result terminates this game
      continue;
    }

    sawMoves = true; // ordinary movetext
    i++;
  }

  closeChunk(text.length); // trailing movetext without a result (lenient)
  return chunks;
}

// Parse a multi-game PGN string into one AST per game (in source order).
// Empty/whitespace input yields []. Throws if a header block interrupts
// un-terminated movetext. Lenient otherwise (see parse()).
export function parseGames(text: string, opts?: { strict?: boolean }): PgnGameAst[] {
  if (!text.trim()) return [];
  return splitGames(text).map((chunk) => parse(chunk, opts));
}

// Whether `text` contains a result token at the top level (outside comments and
// variations). Lets the single-game core API require an explicit termination.
export function hasTopLevelResult(text: string): boolean {
  let brace = false;
  let lineComment = false;
  let paren = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (lineComment) { if (c === "\n") lineComment = false; i++; continue; }
    if (brace) { if (c === "}") brace = false; i++; continue; }
    if (c === "{") { brace = true; i++; continue; }
    if (c === ";") { lineComment = true; i++; continue; }
    if (c === "(") { paren++; i++; continue; }
    if (c === ")") { if (paren > 0) paren--; i++; continue; }
    if (paren > 0) { i++; continue; }
    if (c === "[") { i = skipHeader(text, i); continue; }
    if (resultAt(text, i)) return true;
    i++;
  }
  return false;
}
