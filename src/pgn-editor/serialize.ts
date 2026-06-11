import type { PgnItem, PgnGameAst } from "./types";

// ---------------------------------------------------------------------------
// pgn-editor — serializer (AST -> PGN text)
//
// Round-trips parse(): the item stream is emitted in source order, so comments
// and variations come back exactly where they were written — no re-anchoring,
// no merging. The only normalisation is the move-number indicator: a black ply
// is renumbered ("1... e5") after any comment or variation so the text stays
// unambiguous on re-parse.
// ---------------------------------------------------------------------------

function headerTags(headers: Record<string, string>): string[] {
  return Object.entries(headers).map(([k, v]) => {
    const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `[${k} "${escaped}"]`;
  });
}

// Emit one line (mainline or a variation body). `needsNumber` forces the move
// number on the first ply even when it's black (variations / post-comment).
function serializeLine(items: PgnItem[], out: string[], needsNumber: boolean): void {
  let showNumber = needsNumber;

  for (const it of items) {
    if (it.kind === "comment") {
      out.push(`{ ${it.text} }`);
      showNumber = true; // a comment breaks the run; renumber the next ply
      continue;
    }

    if (it.kind === "variation") {
      const inner: string[] = [];
      serializeLine(it.items, inner, true);
      out.push(`( ${inner.join(" ")} )`);
      showNumber = true; // a variation also breaks the run
      continue;
    }

    if (it.color === "w") {
      out.push(`${it.moveNumber}.`);
      showNumber = false;
    } else if (showNumber) {
      out.push(`${it.moveNumber}...`);
      showNumber = false;
    }

    out.push(it.san);

    for (const n of it.nags) out.push(`$${n}`);
  }
}

// Movetext only (no headers).
export function serializeMovetext(game: PgnGameAst): string {
  const out: string[] = [];
  serializeLine(game.items, out, true);
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
