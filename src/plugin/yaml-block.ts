import { dump as dumpYaml } from "js-yaml";

// ---------------------------------------------------------------------------
// Write-back into a `chess` YAML block is line-based: it replaces a single
// `key: value` line. The value (a serialized PGN) can begin with `{` (a
// comment-before-the-move), be a bare `*` (an empty game), or contain `:` / `#`
// — all of which break a bare YAML scalar. Let js-yaml decide the quoting so
// the result is always valid YAML and round-trips through the block's parser.
// ---------------------------------------------------------------------------

// Format a string as a YAML scalar to drop in after `key: `. js-yaml quotes
// only when the content requires it, so plain movetext stays unquoted while
// comment-led / special-char PGN gets single-quoted. A value containing
// newlines (e.g. a pasted PGN with headers) becomes a multi-line block scalar
// (`|-` + indented lines), which is valid YAML and round-trips through the
// block's parser. lineWidth -1 disables folding so single-line values never
// wrap onto a second line.
export function yamlInlineScalar(value: string): string {
  return dumpYaml(value, { lineWidth: -1 }).trimEnd();
}

// Build a complete ` ```chess ` block embedding a raw PGN under `pgn:`. The PGN
// is encoded via yamlInlineScalar, so apostrophes ("white's"), colons (URLs in
// comments), braces, and line breaks are all handled — the caller never has to
// quote or escape anything.
export function buildChessBlock(pgn: string): string {
  return "```chess\npgn: " + yamlInlineScalar(pgn.trim()) + "\n```";
}

const indentOf = (line: string): number => (/^\s*/.exec(line)?.[0].length ?? 0);

// The `pgn:` value may be a multi-line YAML block scalar (`pgn: |` followed by
// indented lines) — that's what a pasted full PGN serializes to. Return the
// index one past the last line belonging to the value, so a rewrite can replace
// the whole region. Replacing only the key line would orphan the indented
// continuation lines and corrupt the block.
function pgnValueEnd(lines: string[], keyLine: number, limit: number): number {
  if (!/:\s*[|>]/.test(lines[keyLine])) return keyLine + 1; // single-line scalar
  const keyIndent = indentOf(lines[keyLine]);
  let end = keyLine + 1;
  while (end < limit && (lines[end].trim() === "" || indentOf(lines[end]) > keyIndent)) {
    end++;
  }
  return end;
}

// Replace the `pgn:` value within a block's body lines in place, collapsing any
// multi-line block scalar down to the freshly-serialized value. `start`/`end`
// bound the body (exclusive of the ``` fences). Returns true if a `pgn:` line
// was found and replaced.
export function replacePgnValue(
  lines: string[],
  start: number,
  end: number,
  newPgn: string,
): boolean {
  for (let i = start; i < end; i++) {
    if (/^\s*pgn\s*:/.test(lines[i])) {
      const valueEnd = pgnValueEnd(lines, i, end);
      lines.splice(i, valueEnd - i, `pgn: ${yamlInlineScalar(newPgn)}`);
      return true;
    }
  }
  return false;
}
