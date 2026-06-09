import { parse, parseGames, hasTopLevelResult } from "../pgn-editor";
import type { PgnNode } from "../pgn-editor";
import type { PgnGame, PgnMove, MoveNode } from "./types";

// ---------------------------------------------------------------------------
// PGN parsing is delegated to our own pgn-editor core (clean-room, MIT). This
// module is a thin adapter: it maps the FEN-neutral AST to our PgnGame / PgnMove
// types and enforces the single-game "result required" contract. serializeMoveTree
// (further down) is ours and operates on the MoveNode read-model.
// ---------------------------------------------------------------------------

export function cleanComment(raw: string): string {
  // Strip [%...] annotations (clk/eval/etc.), collapse whitespace, and trim.
  return raw.replace(/\[%[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

// AST move nodes -> our PgnMove[]. Comment comes from the after-move slot via
// cleanComment; NAGs and nested variations carry across recursively.
export function astToPgnMoves(nodes: PgnNode[]): PgnMove[] {
  return nodes.map((n) => {
    const move: PgnMove = { san: n.san, moveNumber: n.moveNumber, color: n.color };
    const comment = n.commentAfter ? cleanComment(n.commentAfter) : "";
    if (comment) move.comment = comment;
    if (n.nags.length) move.nags = n.nags;
    if (n.variations.length) move.variations = n.variations.map(astToPgnMoves);
    return move;
  });
}

function astToPgnGame(ast: { headers: Record<string, string>; moves: PgnNode[]; result: string }): PgnGame {
  return { headers: ast.headers, moves: astToPgnMoves(ast.moves), result: ast.result };
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

// ---------------------------------------------------------------------------
// serializeMoveTree
// Walks a MoveNode tree (built by buildMoveTree) and emits a PGN move-text
// string (no headers). Variations are written as standard parenthesised
// branches. Pass the game result as the second arg (defaults to "*").
// ---------------------------------------------------------------------------

export function serializeMoveTree(root: MoveNode, result = "*"): string {
  const parts: string[] = [];
  serializeLine(root.next, parts, true);
  parts.push(result);
  return parts.join(" ");
}

function serializeLine(head: MoveNode | null, out: string[], needsMoveNumber: boolean): void {
  let cur = head;
  let showNumber = needsMoveNumber;

  while (cur) {
    if (cur.color === "w" || showNumber) {
      out.push(cur.color === "w" ? `${cur.moveNumber}.` : `${cur.moveNumber}...`);
      showNumber = false;
    }

    out.push(cur.san!);

    if (cur.nags?.length) {
      for (const n of cur.nags) out.push(`$${n}`);
    }

    if (cur.comment) {
      out.push(`{ ${cur.comment} }`);
      showNumber = true;
    }

    for (const varHead of cur.variationHeads) {
      const varParts: string[] = [];
      serializeLine(varHead, varParts, true);
      out.push(`( ${varParts.join(" ")} )`);
      showNumber = true;
    }

    cur = cur.next;
  }
}
