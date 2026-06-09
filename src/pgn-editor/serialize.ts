import type { PgnNode, PgnGameAst } from "./types";

// ---------------------------------------------------------------------------
// pgn-editor — serializer (AST -> PGN text)
//
// Round-trips parse(): headers, all three comment positions, NAGs, nested
// variations, and the result token. Unlike the current core serializeMoveTree
// (after-move comments only, no headers) this preserves full comment fidelity.
// ---------------------------------------------------------------------------

function headerTags(headers: Record<string, string>): string[] {
  return Object.entries(headers).map(([k, v]) => {
    const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `[${k} "${escaped}"]`;
  });
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
  const tags = headerTags(game.headers);
  if (tags.length === 0) return movetext;
  return `${tags.join("\n")}\n\n${movetext}`;
}

// Full PGN on a single physical line: header tags space-joined, then movetext.
// Still valid, re-parseable PGN (each game's result token precedes the next tag
// pair) but free of the blank-line separator, so it fits contexts that must
// stay on one line — e.g. a YAML `pgn:` scalar rewritten line-by-line on edit.
export function serializeInline(game: PgnGameAst): string {
  const movetext = serializeMovetext(game);
  const tags = headerTags(game.headers);
  return tags.length ? `${tags.join(" ")} ${movetext}` : movetext;
}
