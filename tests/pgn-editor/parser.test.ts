import { describe, it, expect } from "vitest";
import { parse } from "../../src/pgn-editor/parser";
import { isMove, isVariation } from "../../src/pgn-editor/types";
import type { PgnItem, PgnNode, PgnVariation } from "../../src/pgn-editor/types";

// The moves of one line in order, skipping comment/variation items.
const moves = (items: PgnItem[]): PgnNode[] => items.filter(isMove);

// Compact stream shape for position assertions: "e4" | "{text}" | "(...)".
const shape = (items: PgnItem[]): string[] =>
  items.map((it) => (it.kind === "move" ? it.san : it.kind === "comment" ? `{${it.text}}` : "(...)"));

const variations = (items: PgnItem[]): PgnVariation[] => items.filter(isVariation);

describe("pgn-editor parse", () => {
  describe("basic movetext", () => {
    it("parses a short mainline with numbers and colors", () => {
      const g = parse("1. e4 e5 2. Nf3 Nc6 *");
      expect(moves(g.items).map((m) => m.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
      expect(moves(g.items).map((m) => m.color)).toEqual(["w", "b", "w", "b"]);
      expect(moves(g.items).map((m) => m.moveNumber)).toEqual([1, 1, 2, 2]);
      expect(g.result).toBe("*");
    });

    it("keeps check/mate suffixes on the SAN but not !/? glyphs", () => {
      const g = parse("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7# 1-0");
      const sans = moves(g.items).map((m) => m.san);
      expect(sans).toContain("Qxf7#");
      const nf6 = moves(g.items).find((m) => m.san === "Nf6");
      expect(nf6).toBeDefined();
      expect(nf6!.nags).toEqual([4]); // "??" -> $4, not part of san
    });

    it("handles castling both sides", () => {
      const g = parse("1. e4 e5 2. Nf3 Nc6 3. O-O O-O-O *");
      expect(moves(g.items).map((m) => m.san)).toContain("O-O");
      expect(moves(g.items).map((m) => m.san)).toContain("O-O-O");
    });
  });

  describe("results", () => {
    it.each(["1-0", "0-1", "1/2-1/2", "*"])("recognises %s", (r) => {
      expect(parse(`1. e4 ${r}`).result).toBe(r);
    });

    it("defaults to * when the result token is missing", () => {
      expect(parse("1. e4 e5").result).toBe("*");
    });

    it("does not mistake 0-1 for queenside castling", () => {
      const g = parse("1. e4 0-1");
      expect(moves(g.items).map((m) => m.san)).toEqual(["e4"]);
      expect(g.result).toBe("0-1");
    });
  });

  describe("NAGs", () => {
    it("parses numeric and symbolic NAGs", () => {
      const g = parse("1. e4! e5?! 2. Nf3 $13 *");
      expect(moves(g.items)[0].nags).toEqual([1]); // !
      expect(moves(g.items)[1].nags).toEqual([6]); // ?!
      expect(moves(g.items)[2].nags).toEqual([13]); // $13
    });

    it("attaches a NAG after a variation to the move immediately prior", () => {
      // NAGs are the spec'd exception: they bind to the preceding move even
      // across a variation, unlike comments which stay where they are written.
      const g = parse("1. e4 ( 1. d4 ) $1 1... e5 *", { strict: true });
      expect(moves(g.items)[0].nags).toEqual([1]);
      expect(moves(g.items).map((m) => m.san)).toEqual(["e4", "e5"]);
    });
  });

  describe("comments — positional stream items", () => {
    it("keeps comments as items where they were written", () => {
      // Move numbers are decoration, so a comment "between the number and the
      // SAN" is simply a comment before that move: {intro} and {pre} are two
      // consecutive before-items.
      const g = parse("{intro} 1. {pre} e4 {after} e5 *");
      expect(shape(g.items)).toEqual(["{intro}", "{pre}", "e4", "{after}", "e5"]);
    });

    it("parses ;-to-end-of-line comments (gap vs cm-pgn)", () => {
      const g = parse("1. e4 ; a line comment\n e5 *");
      expect(shape(g.items)).toEqual(["e4", "{a line comment}", "e5"]);
    });

    it("collapses whitespace/newlines inside brace comments", () => {
      const g = parse("1. e4 { multi\n  line  comment } e5 *");
      expect(shape(g.items)).toEqual(["e4", "{multi line comment}", "e5"]);
    });

    it("keeps consecutive comments as separate items", () => {
      const g = parse("1. e4 { a } { b } e5 *", { strict: true });
      expect(shape(g.items)).toEqual(["e4", "{a}", "{b}", "e5"]);
    });

    it("keeps a comment after a variation in its written position", () => {
      const g = parse("1. e4 ( 1. d4 ) { hi } 1... e5 2. Nf3 *", { strict: true });
      expect(shape(g.items)).toEqual(["e4", "(...)", "{hi}", "e5", "Nf3"]);
    });

    it("keeps a comment between two variations in place", () => {
      const g = parse("1. e4 ( 1. d4 ) { hi } ( 1. c4 ) 1... e5 *", { strict: true });
      expect(shape(g.items)).toEqual(["e4", "(...)", "{hi}", "(...)", "e5"]);
      expect(variations(g.items).map((v) => moves(v.items)[0].san)).toEqual(["d4", "c4"]);
    });

    it("keeps a comment after a variation at the end of a line", () => {
      const g = parse("1. e4 e5 ( 1... c6 ) { hi } *", { strict: true });
      expect(shape(g.items)).toEqual(["e4", "e5", "(...)", "{hi}"]);
    });

    it("keeps a leading comment inside a variation as its first item", () => {
      const g = parse("1. e4 e5 ( { gambit try } 1... c5 ) 2. Nf3 *", { strict: true });
      const v = variations(g.items)[0];
      expect(shape(v.items)).toEqual(["{gambit try}", "c5"]);
    });

    it("keeps a comment after a dangling number (no move follows) as an item", () => {
      const g = parse("1. e4 e5 ( 2. { cut off } ) *");
      const v = variations(g.items)[0];
      expect(shape(v.items)).toEqual(["{cut off}"]);
    });
  });

  describe("null moves (gap vs cm-pgn)", () => {
    it("parses -- and Z0 null moves", () => {
      const g = parse("1. e4 -- 2. Z0 e5 *");
      const sans = moves(g.items).map((m) => m.san);
      expect(sans).toContain("--");
      expect(sans).toContain("Z0");
    });
  });

  describe("variations", () => {
    it("places a variation directly after the move it is an alternative to", () => {
      const g = parse("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *");
      expect(shape(g.items)).toEqual(["e4", "e5", "(...)", "Nf3"]);
      const sub = variations(g.items)[0];
      expect(moves(sub.items).map((m) => m.san)).toEqual(["c5", "Nf3"]);
      expect(moves(sub.items)[0].color).toBe("b"); // c5 is black's alternative to e5
      expect(moves(sub.items)[0].moveNumber).toBe(1);
    });

    it("handles nested variations", () => {
      const g = parse("1. e4 e5 2. Nf3 (2. Nc3 Nf6 (2... d6)) *");
      expect(shape(g.items)).toEqual(["e4", "e5", "Nf3", "(...)"]);
      const nc3line = variations(g.items)[0];
      expect(shape(nc3line.items)).toEqual(["Nc3", "Nf6", "(...)"]);
      const nested = variations(nc3line.items)[0];
      expect(moves(nested.items).map((m) => m.san)).toEqual(["d6"]);
    });
  });

  describe("strict mode", () => {
    it("throws on an unparseable token when strict (editor read-only fallback)", () => {
      expect(() => parse("1. e4 @@@ e5 *", { strict: true })).toThrow();
    });

    it("skips the stray token in lenient (default) mode", () => {
      expect(moves(parse("1. e4 @@@ e5 *").items).map((m) => m.san)).toEqual(["e4", "e5"]);
    });

    it("throws on a variation with no preceding move when strict", () => {
      expect(() => parse("( 1. e4 ) 1. d4 *", { strict: true })).toThrow();
    });

    it("drops an unanchorable leading variation in lenient mode", () => {
      const g = parse("( 1. e4 ) 1. d4 d5 *");
      expect(shape(g.items)).toEqual(["d4", "d5"]);
    });
  });

  describe("headers", () => {
    it("parses headers in source order, FEN stays a header (FEN-neutral)", () => {
      const pgn = `[Event "Test"]\n[Result "1-0"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 1-0`;
      const g = parse(pgn);
      expect(Object.keys(g.headers)).toEqual(["Event", "Result", "FEN"]);
      expect(g.headers.FEN).toContain("rnbqkbnr");
      expect(moves(g.items)[0].san).toBe("e4");
    });

    it("unescapes quotes in header values", () => {
      const g = parse(`[White "O'Brien \\"Doc\\""]\n\n*`);
      expect(g.headers.White).toBe('O\'Brien "Doc"');
    });
  });
});
