import { describe, it, expect } from "vitest";
import { parse } from "../../src/pgn-editor/parser";
import { serializeMovetext } from "../../src/pgn-editor/serialize";
import {
  nodeAt,
  adjacentComment,
  setAdjacentComment,
  updateComment,
  setNags,
  removeAt,
  promoteVariation,
} from "../../src/pgn-editor/edit";
import { isMove, isComment, isVariation } from "../../src/pgn-editor/types";
import type { PgnItem, PgnNode, PgnComment, PgnGameAst } from "../../src/pgn-editor/types";

const moves = (items: PgnItem[]): PgnNode[] => items.filter(isMove);
// End-state assertions go through the serializer: it pins structure AND the
// written position of every comment/variation in one string.
const text = (g: PgnGameAst): string => serializeMovetext(g);

describe("pgn-editor edit", () => {
  describe("nodeAt", () => {
    it("resolves a path to its move and rejects the root / non-matches", () => {
      const g = parse("1. e4 e5 2. Nf3 *");
      expect(nodeAt(g.items, ["e4", "e5"])?.san).toBe("e5");
      expect(nodeAt(g.items, [])).toBeNull();
      expect(nodeAt(g.items, ["e4", "Nf6"])).toBeNull();
    });

    it("resolves through comments and variations in the stream", () => {
      const g = parse("1. e4 ( 1. d4 ) { hi } 1... e5 2. Nf3 *", { strict: true });
      expect(nodeAt(g.items, ["e4", "e5", "Nf3"])?.san).toBe("Nf3");
      expect(nodeAt(g.items, ["d4"])?.san).toBe("d4"); // variation head from the root
    });
  });

  describe("adjacentComment / setAdjacentComment", () => {
    it("the same comment item is adjacent to both neighbouring moves", () => {
      // No ownership: "{ hi }" is e4's after-neighbour AND e5's before-neighbour.
      const g = parse("1. e4 { hi } 1... e5 *");
      const after = adjacentComment(g.items, ["e4"], "after");
      const before = adjacentComment(g.items, ["e4", "e5"], "before");
      expect(after?.text).toBe("hi");
      expect(before).toBe(after);
    });

    it("inserts a new comment item after a move", () => {
      const g = parse("1. e4 e5 *");
      expect(setAdjacentComment(g.items, ["e4"], "after", "x")).toBe(true);
      expect(text(g)).toBe("1. e4 { x } 1... e5 *");
    });

    it("inserts before the first move (a leading line comment)", () => {
      const g = parse("1. e4 *");
      setAdjacentComment(g.items, ["e4"], "before", "intro");
      expect(text(g)).toBe("{ intro } 1. e4 *");
    });

    it("updates the adjacent comment in place", () => {
      const g = parse("1. e4 { old } 1... e5 *");
      setAdjacentComment(g.items, ["e4"], "after", "new");
      expect(text(g)).toBe("1. e4 { new } 1... e5 *");
    });

    it("clears the adjacent comment when text is empty", () => {
      const g = parse("1. e4 { old } 1... e5 *");
      setAdjacentComment(g.items, ["e4"], "after", "");
      expect(text(g)).toBe("1. e4 e5 *");
    });

    it("inserts between the move and a following variation", () => {
      // The variation is not a comment, so a new item lands directly after the
      // move — it does not jump over the variation.
      const g = parse("1. e4 ( 1. d4 ) 1... e5 *", { strict: true });
      setAdjacentComment(g.items, ["e4"], "after", "x");
      expect(text(g)).toBe("1. e4 { x } ( 1. d4 ) 1... e5 *");
    });

    it("returns false for a path that doesn't resolve", () => {
      expect(setAdjacentComment(parse("1. e4 *").items, ["Nf6"], "after", "x")).toBe(false);
    });
  });

  describe("updateComment (by item identity)", () => {
    it("edits a comment item nested inside a variation", () => {
      const g = parse("1. e4 ( 1. d4 { deep } ) 1... e5 *", { strict: true });
      const variation = g.items.find(isVariation)!;
      const comment = variation.items.find(isComment)!;
      expect(updateComment(g.items, comment, "deeper")).toBe(true);
      expect(text(g)).toBe("1. e4 ( 1. d4 { deeper } ) 1... e5 *");
    });

    it("removes the item when text is empty", () => {
      const g = parse("1. e4 { hi } 1... e5 *");
      const comment = g.items.find(isComment)!;
      updateComment(g.items, comment, "");
      expect(text(g)).toBe("1. e4 e5 *");
    });

    it("returns false for an item that isn't in the stream", () => {
      const g = parse("1. e4 *");
      const foreign: PgnComment = { kind: "comment", text: "x" };
      expect(updateComment(g.items, foreign, "y")).toBe(false);
    });
  });

  describe("setNags", () => {
    it("replaces and clears the NAG list", () => {
      const g = parse("1. e4 e5 *");
      setNags(g.items, ["e4"], [1]);
      expect(moves(g.items)[0].nags).toEqual([1]);
      setNags(g.items, ["e4"], []);
      expect(moves(g.items)[0].nags).toEqual([]);
    });
  });

  describe("removeAt", () => {
    it("truncates the mainline from the move", () => {
      const g = parse("1. e4 e5 2. Nf3 Nc6 *");
      expect(removeAt(g.items, ["e4", "e5", "Nf3"])).toBe(true);
      expect(text(g)).toBe("1. e4 e5 *");
    });

    it("removes a whole variation by its head, leaving the mainline intact", () => {
      const g = parse("1. e4 e5 ( 1... c5 2. Nf3 ) 2. Nf3 *");
      expect(removeAt(g.items, ["e4", "c5"])).toBe(true);
      expect(text(g)).toBe("1. e4 e5 2. Nf3 *");
    });
  });

  describe("promoteVariation", () => {
    it("promotes a variation to the mainline; old mainline becomes its variation", () => {
      const g = parse("1. e4 e5 ( 1... c5 2. Nf3 ) 2. Nf3 *");
      expect(promoteVariation(g.items, ["e4", "c5"])).toBe(true);
      expect(text(g)).toBe("1. e4 c5 ( 1... e5 2. Nf3 ) 2. Nf3 *");
    });

    it("re-homes ALL siblings onto the new head (3+-way branch edge)", () => {
      const g = parse("1. e4 e5 ( 1... c5 ) ( 1... e6 2. d4 ) ( 1... d5 ) 2. Nf3 *");
      expect(promoteVariation(g.items, ["e4", "e6"])).toBe(true);
      // new head e6 carries the old mainline first, then the other siblings
      expect(text(g)).toBe("1. e4 e6 ( 1... e5 2. Nf3 ) ( 1... c5 ) ( 1... d5 ) 2. d4 *");
    });

    it("works for a variation nested inside another variation", () => {
      const g = parse("1. e4 e5 2. Nf3 ( 2. Nc3 Nf6 ( 2... d6 ) ) *");
      expect(promoteVariation(g.items, ["e4", "e5", "Nc3", "d6"])).toBe(true);
      expect(text(g)).toBe("1. e4 e5 2. Nf3 ( 2. Nc3 d6 ( 2... Nf6 ) ) *");
    });

    it("keeps a comment with the line position it was written in", () => {
      const g = parse("1. e4 e5 { keep } ( 1... c5 ) 2. Nf3 *", { strict: true });
      expect(promoteVariation(g.items, ["e4", "c5"])).toBe(true);
      expect(text(g)).toBe("1. e4 c5 ( 1... e5 { keep } 2. Nf3 ) *");
    });

    it("no-ops on the mainline move or an empty path", () => {
      expect(promoteVariation(parse("1. e4 e5 *").items, ["e4"])).toBe(false);
      expect(promoteVariation(parse("1. e4 *").items, [])).toBe(false);
    });
  });
});
