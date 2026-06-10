// ---------------------------------------------------------------------------
// pgn-editor — FEN-neutral PGN AST
//
// This is the public data shape produced by parse() and consumed by serialize().
// It is deliberately *FEN-neutral*: it describes only what the PGN text says
// (SAN tokens, move numbers, comments, NAGs, variation nesting, headers). It
// carries NO BoardState and NO board indices — those are render concerns that
// live behind the plugin's adapter, never in this layer.
//
// A line of movetext is an *ordered stream of items* — moves, comments, and
// variations in exactly the order the text gives them. The PGN spec assigns
// no ownership to comments (they are standalone tokens in the stream), so the
// AST doesn't either: a comment's position IS its meaning, and serialization
// re-emits it where it was written. Two annotations are move-attached because
// the spec/syntax binds them to a move: NAGs ("applies to the move immediately
// prior") and the rare mid comment sitting inside a move's own number–SAN unit
// ("1. { x } e4"). Variations are stream items too — a RAV "unplays the move
// immediately prior", so its anchor is positional, recovered by the navigation
// helpers in edit.ts.
//
// Layer rule: nothing in src/pgn-editor/ may import from core/ render/ view/
// plugin/ Obsidian or the DOM. Dependencies flow one way: plugin -> pgn-editor.
// (Enforced by tests/pgn-editor/boundary.test.ts.)
// ---------------------------------------------------------------------------

export type Color = "w" | "b";

// One token of a movetext line, in source order.
export type PgnItem = PgnNode | PgnComment | PgnVariation;

// A single ply.
export interface PgnNode {
  kind: "move";

  // SAN exactly as written: "Nf3", "exd5", "O-O-O", "e8=Q+", or a null move
  // ("--" PGN-standard / "Z0" ChessBase). Check/mate suffixes are kept; the
  // "!"/"?" annotation glyphs are NOT part of san (they become nags).
  san: string;

  // Move number shown for this ply (white's full-move number).
  moveNumber: number;
  color: Color;

  // NAGs as integers ($1 -> 1, "!!" -> 3, etc.). Empty when none. NAGs stay on
  // the move because the spec binds them to it, unlike comments.
  nags: number[];

  // Comment between the move number and the SAN ("1. { x } e4") — inside the
  // move's own unit, so its position alone binds it to this move. Raw text,
  // trimmed; [%clk]/[%eval] annotations are preserved here and only stripped
  // downstream by the consumer if desired.
  commentMid?: string;
}

// A standalone comment in the stream. Raw text, trimmed; [%...] annotations
// preserved (consumers strip for display if desired).
export interface PgnComment {
  kind: "comment";
  text: string;
}

// A parenthesised variation: an alternative to the nearest preceding move item
// in the containing line. Its body is itself an item stream.
export interface PgnVariation {
  kind: "variation";
  items: PgnItem[];
}

export interface PgnGameAst {
  // Header tags in source order. The starting FEN, if any, lives here as the
  // "FEN" header — it is NOT a property of the tree (FEN-neutral by design).
  headers: Record<string, string>;
  // The mainline movetext as an ordered item stream.
  items: PgnItem[];
  // Game-termination marker: "1-0" | "0-1" | "1/2-1/2" | "*". Defaults to "*"
  // when the movetext carries no explicit result token.
  result: string;
}

// Type guards (the discriminant is `kind`, these just read better at call sites).
export function isMove(item: PgnItem): item is PgnNode {
  return item.kind === "move";
}
export function isComment(item: PgnItem): item is PgnComment {
  return item.kind === "comment";
}
export function isVariation(item: PgnItem): item is PgnVariation {
  return item.kind === "variation";
}
