// ---------------------------------------------------------------------------
// pgn-editor — FEN-neutral PGN AST
//
// This is the public data shape produced by parse() and consumed by serialize().
// It is deliberately *FEN-neutral*: it describes only what the PGN text says
// (SAN tokens, move numbers, comments, NAGs, variation nesting, headers). It
// carries NO BoardState and NO board indices — those are render concerns that
// live behind the plugin's adapter, never in this layer.
//
// Layer rule: nothing in src/pgn-editor/ may import from core/ render/ view/
// plugin/ Obsidian or the DOM. Dependencies flow one way: plugin -> pgn-editor.
// (Enforced by tests/pgn-editor/boundary.test.ts.)
// ---------------------------------------------------------------------------

export type Color = "w" | "b";

// A single ply. Comments are kept in all three PGN positions for round-trip
// fidelity (the current core serializer only preserves the after-move comment).
export interface PgnNode {
  // SAN exactly as written: "Nf3", "exd5", "O-O-O", "e8=Q+", or a null move
  // ("--" PGN-standard / "Z0" ChessBase). Check/mate suffixes are kept; the
  // "!"/"?" annotation glyphs are NOT part of san (they become nags).
  san: string;

  // Move number shown for this ply (white's full-move number).
  moveNumber: number;
  color: Color;

  // NAGs as integers ($1 -> 1, "!!" -> 3, etc.). Empty when none.
  nags: number[];

  // Comment positions (cm-pgn-compatible naming so the adapter maps cleanly):
  //   commentMove   — before the move number   (intro to the ply / line)
  //   commentBefore — between the number and the SAN
  //   commentAfter  — after the SAN and its NAGs (the common case)
  // Raw text, trimmed; [%clk]/[%eval] annotations are preserved here and only
  // stripped downstream by the consumer if desired.
  commentMove?: string;
  commentBefore?: string;
  commentAfter?: string;

  // Alternative lines branching from the SAME parent position as this ply.
  variations: PgnNode[][];
}

export interface PgnGameAst {
  // Header tags in source order. The starting FEN, if any, lives here as the
  // "FEN" header — it is NOT a property of the tree (FEN-neutral by design).
  headers: Record<string, string>;
  moves: PgnNode[];
  // Game-termination marker: "1-0" | "0-1" | "1/2-1/2" | "*". Defaults to "*"
  // when the movetext carries no explicit result token.
  result: string;
}
