import { dump as dumpYaml } from "js-yaml";

// ---------------------------------------------------------------------------
// Write-back into a `chess` YAML block is line-based: it replaces a single
// `key: value` line. The value (a serialized PGN) can begin with `{` (a
// comment-before-the-move), be a bare `*` (an empty game), or contain `:` / `#`
// — all of which break a bare YAML scalar. Let js-yaml decide the quoting so
// the result is always valid YAML and round-trips through the block's parser.
// ---------------------------------------------------------------------------

// Format a string as a single-line YAML scalar to drop in after `key: `.
// js-yaml quotes only when the content requires it, so plain movetext stays
// unquoted while comment-led / special-char PGN gets single-quoted. lineWidth -1
// disables folding so the value never wraps onto a second line.
export function yamlInlineScalar(value: string): string {
  return dumpYaml(value, { lineWidth: -1 }).trimEnd();
}
