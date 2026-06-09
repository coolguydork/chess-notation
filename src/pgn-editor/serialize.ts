import type { PgnNode, PgnGameAst } from "./types";

// ---------------------------------------------------------------------------
// pgn-editor — serializer (AST -> PGN text)
//
// Round-trips parse(): headers, all three comment positions, NAGs, nested
// variations, and the result token. Unlike the current core serializeMoveTree
// (after-move comments only, no headers) this preserves full comment fidelity.
// ---------------------------------------------------------------------------

function serializeHeaders(headers: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(`[${k} "${escaped}"]`);
  }
  return lines.join("\n");
}

// Emit one line (mainline or a variation body). `needsNumber` forces the move
// number on the first ply even when it's black (variations / post-comment).
function serializeLine(moves: PgnNode[], out: string[], needsNumber: boolean): void {
  let showNumber = needsNumber;

  for (const m of moves) {
    if (m.commentMove) {
      out.push(`{ ${m.commentMove} }`);
      showNumber = true;
    }

    if (m.color === "w") {
      out.push(`${m.moveNumber}.`);
      showNumber = false;
    } else if (showNumber) {
      out.push(`${m.moveNumber}...`);
      showNumber = false;
    }

    if (m.commentBefore) out.push(`{ ${m.commentBefore} }`);

    out.push(m.san);

    for (const n of m.nags) out.push(`$${n}`);

    if (m.commentAfter) {
      out.push(`{ ${m.commentAfter} }`);
      showNumber = true; // a comment breaks the run; renumber the next ply
    }

    for (const variation of m.variations) {
      const inner: string[] = [];
      serializeLine(variation, inner, true);
      out.push(`( ${inner.join(" ")} )`);
      showNumber = true; // a variation also breaks the run
    }
  }
}

// Movetext only (no headers) — the analogue of core's serializeMoveTree.
export function serializeMovetext(game: PgnGameAst): string {
  const out: string[] = [];
  serializeLine(game.moves, out, true);
  out.push(game.result);
  return out.join(" ");
}

// Full PGN: headers (if any) + a blank line + movetext.
export function serialize(game: PgnGameAst): string {
  const movetext = serializeMovetext(game);
  const headerKeys = Object.keys(game.headers);
  if (headerKeys.length === 0) return movetext;
  return `${serializeHeaders(game.headers)}\n\n${movetext}`;
}
