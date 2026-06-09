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

// TODO(pgn-editor): grow toward a full PGN-CRUD surface — see ./ROADMAP.md.
// Next gap is move-level Update (setComment / setNags / promoteVariation), then
// multi-game parse (parseGames, to retire the @mliebelt GPL dep). Export each
// here as it lands; keep this barrel the single public API contract.
