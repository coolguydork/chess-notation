import { parse, parseGames, hasTopLevelResult } from "../pgn-editor";
import type { PgnGameAst } from "../pgn-editor";
import type { PgnGame } from "./types";

// ---------------------------------------------------------------------------
// PGN parsing is delegated to our own pgn-editor core (clean-room, MIT). The
// AST item stream IS the model — this module only enforces the single-game
// "result required" contract and exposes the multi-game form. Serialization
// likewise goes straight through pgn-editor (see core/game.ts gameToPgn).
// ---------------------------------------------------------------------------

export function cleanComment(raw: string): string {
  // Strip [%...] annotations (clk/eval/etc.), collapse whitespace, and trim.
  return raw.replace(/\[%[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

function astToPgnGame(ast: PgnGameAst): PgnGame {
  return { headers: ast.headers, items: ast.items, result: ast.result };
}

// Parse a single game. Requires an explicit result token (1-0, 0-1, 1/2-1/2, *).
export function parsePGN(input: string): PgnGame {
  if (!input.trim()) throw new Error("PGN: input is empty");
  if (!hasTopLevelResult(input)) {
    throw new Error("PGN: missing result token (expected 1-0, 0-1, 1/2-1/2, or *)");
  }
  return astToPgnGame(parse(input));
}

// ---------------------------------------------------------------------------
// parseMultiPGN — parse a PGN string that may contain more than one game.
// Returns an array of PgnGame objects (one element for a single-game string).
// ---------------------------------------------------------------------------

export function parseMultiPGN(input: string): PgnGame[] {
  if (!input.trim()) throw new Error("PGN: input is empty");
  const games = parseGames(input);
  if (games.length === 0) throw new Error("PGN: no games found");
  return games.map(astToPgnGame);
}
