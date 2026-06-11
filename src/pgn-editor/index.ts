// ---------------------------------------------------------------------------
// pgn-editor — public barrel
//
// A self-contained, FEN-neutral PGN parsing/serializing core. One-way deps:
// plugin -> pgn-editor, never the reverse. This layer imports nothing from
// core/ render/ view/ plugin/ Obsidian or the DOM (see boundary.test.ts), so it
// can be lifted into its own package later without untangling imports.
// ---------------------------------------------------------------------------

export type { Color, PgnItem, PgnNode, PgnComment, PgnVariation, PgnGameAst } from "./types";
export { isMove, isComment, isVariation } from "./types";
export { parse } from "./parser";
export { parseGames, hasTopLevelResult } from "./parseGames";
export { serialize, serializeMovetext, serializeInline } from "./serialize";

// Structural stream navigation + FEN-neutral edits (move-level Update/Delete).
export type { NodeLoc } from "./edit";
export {
  childrenOf,
  resolvePath,
  nodeAt,
  adjacentComment,
  setAdjacentComment,
  updateComment,
  setNags,
  removeAt,
  promoteVariation,
} from "./edit";

// TODO(pgn-editor): remaining PGN-CRUD surface — see ./ROADMAP.md. Game-collection
// C/U/D (append/remove/reorder a game) and header CRUD are deferred until a
// consumer needs them. Export each here as it lands; keep this barrel the single
// public API contract.
