import type { PgnGame, PgnMove, Color } from "./types";

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

type Token =
  | { type: "header"; key: string; value: string }
  | { type: "moveNumber"; number: number; dots: 1 | 3 }
  | { type: "san"; value: string }
  | { type: "comment"; value: string }
  | { type: "nag"; value: number }
  | { type: "result"; value: string }
  | { type: "lparen" }
  | { type: "rparen" };

// SAN: castling, pawn moves, piece moves — with optional disambiguation,
// capture, promotion, and check/checkmate suffixes.
const SAN_RE =
  /^(?:O-O-O|O-O|[NBRQK][a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?[+#]?|[a-h](?:[1-8]|x[a-h][1-8](?:=[NBRQK])?)(?:=[NBRQK])?[+#]?)[!?]*/;

function tokenise(input: string): Token[] {
  const tokens: Token[] = [];
  // Normalise line endings
  let src = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let i = 0;

  while (i < src.length) {
    // Skip whitespace
    if (/\s/.test(src[i])) { i++; continue; }

    // Header tag
    if (src[i] === "[") {
      const end = src.indexOf("]", i);
      if (end === -1) throw new Error("PGN: unclosed header tag");
      const inner = src.slice(i + 1, end);
      const match = inner.match(/^(\w+)\s+"((?:[^"\\]|\\.)*)"\s*$/);
      if (!match) throw new Error(`PGN: malformed header tag: [${inner}]`);
      tokens.push({ type: "header", key: match[1], value: match[2] });
      i = end + 1;
      continue;
    }

    // Comment
    if (src[i] === "{") {
      const end = src.indexOf("}", i);
      if (end === -1) throw new Error("PGN: unclosed comment");
      const raw = src.slice(i + 1, end);
      // Trim leading/trailing whitespace (but preserve internal newlines, then trim each edge)
      const trimmed = raw.replace(/^[\s\n]+/, "").replace(/[\s\n]+$/, "");
      tokens.push({ type: "comment", value: trimmed });
      i = end + 1;
      continue;
    }

    // Parentheses (variations)
    if (src[i] === "(") { tokens.push({ type: "lparen" }); i++; continue; }
    if (src[i] === ")") { tokens.push({ type: "rparen" }); i++; continue; }

    // Semicolon comment (rest of line)
    if (src[i] === ";") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    // NAG: $N or glyph shorthand (!, ?, !!, ??, !?, ?!)
    if (src[i] === "$") {
      const m = src.slice(i).match(/^\$(\d+)/);
      if (!m) throw new Error("PGN: invalid NAG");
      tokens.push({ type: "nag", value: parseInt(m[1], 10) });
      i += m[0].length;
      continue;
    }

    // Move number: digits followed by one or three dots
    const moveNumMatch = src.slice(i).match(/^(\d+)(\.{1,3})/);
    if (moveNumMatch) {
      tokens.push({
        type: "moveNumber",
        number: parseInt(moveNumMatch[1], 10),
        dots: moveNumMatch[2].length === 3 ? 3 : 1,
      });
      i += moveNumMatch[0].length;
      continue;
    }

    // Result
    const resultMatch = src.slice(i).match(/^(1-0|0-1|1\/2-1\/2|\*)/);
    if (resultMatch) {
      tokens.push({ type: "result", value: resultMatch[1] });
      i += resultMatch[0].length;
      continue;
    }

    // SAN move (including any trailing !? suffix consumed here)
    const sanMatch = src.slice(i).match(SAN_RE);
    if (sanMatch) {
      // Strip trailing glyph shortcuts — they'll be re-emitted as NAG tokens
      // but we need to consume them so the cursor advances.
      // Actually: SAN_RE already includes trailing [!?]* — we keep them in the
      // san token and convert below.  Strip glyph chars from the SAN value and
      // emit separate NAG tokens.
      const full = sanMatch[0];
      const glyphMatch = full.match(/([!?]+)$/);
      const san = glyphMatch ? full.slice(0, full.length - glyphMatch[1].length) : full;
      tokens.push({ type: "san", value: san });
      if (glyphMatch) {
        for (const nag of glyphsToNags(glyphMatch[1])) {
          tokens.push({ type: "nag", value: nag });
        }
      }
      i += full.length;
      continue;
    }

    throw new Error(`PGN: unexpected character '${src[i]}' at position ${i}`);
  }

  return tokens;
}

function glyphsToNags(glyphs: string): number[] {
  switch (glyphs) {
    case "!":  return [1];
    case "?":  return [2];
    case "!!": return [3];
    case "??": return [4];
    case "!?": return [5];
    case "?!": return [6];
    default:   return [];
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParserState {
  tokens: Token[];
  pos: number;
}

function peek(ps: ParserState): Token | undefined {
  return ps.tokens[ps.pos];
}

function consume(ps: ParserState): Token {
  const t = ps.tokens[ps.pos];
  if (!t) throw new Error("PGN: unexpected end of input");
  ps.pos++;
  return t;
}

function parseMoveList(ps: ParserState, startColor: Color, startMoveNumber: number): PgnMove[] {
  const moves: PgnMove[] = [];
  let currentColor: Color = startColor;
  let currentMoveNumber: number = startMoveNumber;

  while (ps.pos < ps.tokens.length) {
    const t = peek(ps);
    if (!t) break;

    if (t.type === "result" || t.type === "rparen") break;

    if (t.type === "moveNumber") {
      consume(ps);
      // Update tracking from the explicit move number token
      currentMoveNumber = t.number;
      currentColor = t.dots === 3 ? "b" : "w";
      continue;
    }

    if (t.type === "san") {
      consume(ps);
      const move: PgnMove = {
        san: t.value,
        moveNumber: currentMoveNumber,
        color: currentColor,
      };

      // Collect NAGs and comment immediately following this SAN
      while (ps.pos < ps.tokens.length) {
        const next = peek(ps);
        if (next?.type === "nag") {
          consume(ps);
          move.nags = move.nags ?? [];
          move.nags.push(next.value);
        } else if (next?.type === "comment") {
          consume(ps);
          move.comment = next.value;
        } else {
          break;
        }
      }

      // Collect variations (one or more) following this move
      while (peek(ps)?.type === "lparen") {
        consume(ps); // consume "("
        // A variation starts from the same move number / color perspective as
        // what the variation "replaces" — but we need to figure that out from
        // the first moveNumber token inside (if present).
        const varMoves = parseMoveList(ps, currentColor, currentMoveNumber);
        const rparen = consume(ps);
        if (rparen.type !== "rparen") throw new Error("PGN: expected ')'");
        move.variations = move.variations ?? [];
        move.variations.push(varMoves);
      }

      moves.push(move);

      // Advance color for next move
      if (currentColor === "w") {
        currentColor = "b";
      } else {
        currentColor = "w";
        currentMoveNumber++;
      }
      continue;
    }

    // Skip stray NAGs or comments not attached to a move (e.g. pre-game comments)
    if (t.type === "nag" || t.type === "comment") {
      consume(ps);
      continue;
    }

    break;
  }

  return moves;
}

export function parsePGN(input: string): PgnGame {
  if (!input.trim()) throw new Error("PGN: input is empty");

  const tokens = tokenise(input);
  const ps: ParserState = { tokens, pos: 0 };

  // Headers
  const headers: Record<string, string> = {};
  while (peek(ps)?.type === "header") {
    const t = consume(ps) as Extract<Token, { type: "header" }>;
    headers[t.key] = t.value;
  }

  // Move list
  const moves = parseMoveList(ps, "w", 1);

  // Result
  const resultToken = peek(ps);
  if (!resultToken || resultToken.type !== "result") {
    throw new Error("PGN: missing result token (expected 1-0, 0-1, 1/2-1/2, or *)");
  }
  consume(ps);

  return { headers, moves, result: resultToken.value };
}
