import { describe, it, expect } from "vitest";
import { parse } from "../../src/pgn-editor/parser";
import {
  nodeAt,
  setComment,
  setNags,
  removeAt,
  promoteVariation,
} from "../../src/pgn-editor/edit";

describe("pgn-editor edit", () => {
  describe("nodeAt", () => {
    it("resolves a path to its move and rejects the root / non-matches", () => {
      const g = parse("1. e4 e5 2. Nf3 *");
      expect(nodeAt(g.moves, ["e4", "e5"])?.san).toBe("e5");
      expect(nodeAt(g.moves, [])).toBeNull();
      expect(nodeAt(g.moves, ["e4", "Nf6"])).toBeNull();
    });
  });

  describe("setComment", () => {
    it("sets and clears each comment slot", () => {
      const g = parse("1. e4 e5 *");
      setComment(g.moves, ["e4"], "commentAfter", "best by test");
      expect(g.moves[0].commentAfter).toBe("best by test");
      setComment(g.moves, ["e4"], "commentBefore", "pre");
      expect(g.moves[0].commentBefore).toBe("pre");
      setComment(g.moves, ["e4"], "commentAfter", "");
      expect(g.moves[0].commentAfter).toBeUndefined();
    });

    it("returns false for a path that doesn't resolve", () => {
      const g = parse("1. e4 *");
      expect(setComment(g.moves, ["Nf6"], "commentAfter", "x")).toBe(false);
    });
  });

  describe("setNags", () => {
    it("replaces and clears the NAG list", () => {
      const g = parse("1. e4 e5 *");
      setNags(g.moves, ["e4"], [1]);
      expect(g.moves[0].nags).toEqual([1]);
      setNags(g.moves, ["e4"], []);
      expect(g.moves[0].nags).toEqual([]);
    });
  });

  describe("removeAt", () => {
    it("truncates the mainline from the move", () => {
      const g = parse("1. e4 e5 2. Nf3 Nc6 *");
      expect(removeAt(g.moves, ["e4", "e5", "Nf3"])).toBe(true);
      expect(g.moves.map((m) => m.san)).toEqual(["e4", "e5"]);
    });

    it("removes a whole variation by its head, leaving the mainline intact", () => {
      const g = parse("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *");
      expect(removeAt(g.moves, ["e4", "c5"])).toBe(true);
      expect(g.moves[1].variations).toHaveLength(0);
      expect(g.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3"]);
    });
  });

  describe("promoteVariation", () => {
    it("promotes a variation to the mainline; old mainline becomes its variation", () => {
      const g = parse("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *");
      expect(promoteVariation(g.moves, ["e4", "c5"])).toBe(true);
      expect(g.moves.map((m) => m.san)).toEqual(["e4", "c5", "Nf3"]);
      const c5 = g.moves[1];
      expect(c5.variations.map((v) => v.map((m) => m.san))).toEqual([["e5", "Nf3"]]);
    });

    it("re-homes ALL siblings onto the new head (3+-way branch edge)", () => {
      const g = parse("1. e4 e5 (1... c5) (1... e6 2. d4) (1... d5) 2. Nf3 *");
      expect(promoteVariation(g.moves, ["e4", "e6"])).toBe(true);
      expect(g.moves.map((m) => m.san)).toEqual(["e4", "e6", "d4"]);
      // new head e6 carries the old mainline first, then the other siblings
      expect(g.moves[1].variations.map((v) => v[0].san)).toEqual(["e5", "c5", "d5"]);
    });

    it("works for a variation nested inside another variation", () => {
      const g = parse("1. e4 e5 2. Nf3 (2. Nc3 Nf6 (2... d6)) *");
      expect(promoteVariation(g.moves, ["e4", "e5", "Nc3", "d6"])).toBe(true);
      const nc3line = g.moves[2].variations[0];
      expect(nc3line.map((m) => m.san)).toEqual(["Nc3", "d6"]);
      expect(nc3line[1].variations[0].map((m) => m.san)).toEqual(["Nf6"]);
    });

    it("no-ops on the mainline move or an empty path", () => {
      expect(promoteVariation(parse("1. e4 e5 *").moves, ["e4"])).toBe(false);
      expect(promoteVariation(parse("1. e4 *").moves, [])).toBe(false);
    });
  });
});
