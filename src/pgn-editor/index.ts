// ---------------------------------------------------------------------------
// pgn-editor — public barrel
//
// A self-contained, FEN-neutral PGN parsing/serializing core. One-way deps:
// plugin -> pgn-editor, never the reverse. This layer imports nothing from
// core/ render/ view/ plugin/ Obsidian or the DOM (see boundary.test.ts), so it
// can be lifted into its own package later without untangling imports.
// ---------------------------------------------------------------------------

export type { Color, PgnNode, PgnGameAst } from "./types";
export { parse } from "./parser";
export { serialize, serializeMovetext } from "./serialize";
