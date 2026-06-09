import { describe, it, expect } from "vitest";
import { parse } from "../../src/pgn-editor/parser";
import type { PgnNode } from "../../src/pgn-editor/types";
import { buildMoveTree, nodeToPath, pathToNode } from "../../src/core/tree";
import type { PgnMove } from "../../src/core/types";

// The seam: a thin adapter from the FEN-neutral AST to core's PgnMove[]. In the
// real migration this lives on the plugin/core side (the one place allowed to
// know both shapes); here it proves the AST feeds the existing render chain.
function astToPgnMoves(nodes: PgnNode[]): PgnMove[] {
  return nodes.map((n) => {
    const m: PgnMove = { san: n.san, moveNumber: n.moveNumber, color: n.color };
    if (n.commentAfter) m.comment = n.commentAfter;
    if (n.nags.length) m.nags = n.nags;
    if (n.variations.length) m.variations = n.variations.map(astToPgnMoves);
    return m;
  });
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("pgn-editor -> core/tree integration", () => {
  it("builds a playable MoveNode tree from the clean-room AST", () => {
    const ast = parse("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0");
    const root = buildMoveTree(START, astToPgnMoves(ast.moves));

    const mainline: string[] = [];
    for (let n = root.next; n; n = n.next) mainline.push(n.san!);
    expect(mainline).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);

    // The board state actually advanced (FEN resolution happened in the adapter
    // chain, not in the parser — confirming FEN-neutrality of the AST).
    const last = pathToNode(root, mainline);
    expect(last.state.activeColor).toBe("w");
  });

  it("carries variations through to variationHeads", () => {
    const ast = parse("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *");
    const root = buildMoveTree(START, astToPgnMoves(ast.moves));

    const e5 = root.next!.next!; // root -> e4 -> e5
    expect(e5.san).toBe("e5");
    expect(e5.variationHeads.map((v) => v.san)).toEqual(["c5"]);
  });

  it("round-trips a path: nodeToPath(pathToNode) is stable", () => {
    const ast = parse("1. d4 Nf6 2. c4 e6 *");
    const root = buildMoveTree(START, astToPgnMoves(ast.moves));
    const path = ["d4", "Nf6", "c4", "e6"];
    expect(nodeToPath(pathToNode(root, path))).toEqual(path);
  });
});
