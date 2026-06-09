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

// Structural tree navigation + FEN-neutral edits (move-level Update/Delete).
export type { NodeLoc, CommentField } from "./edit";
export {
  childrenOf,
  resolvePath,
  nodeAt,
  setComment,
  setNags,
  removeAt,
  promoteVariation,
} from "./edit";

// TODO(pgn-editor): remaining PGN-CRUD surface — see ./ROADMAP.md. Next is
// multi-game parse (parseGames, to retire the @mliebelt GPL dep), then header
// CRUD if a consumer needs it. Export each here as it lands; keep this barrel
// the single public API contract.
