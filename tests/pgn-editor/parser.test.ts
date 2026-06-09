import { describe, it, expect } from "vitest";
import { parse } from "../../src/pgn-editor/parser";

describe("pgn-editor parse", () => {
  describe("basic movetext", () => {
    it("parses a short mainline with numbers and colors", () => {
      const g = parse("1. e4 e5 2. Nf3 Nc6 *");
      expect(g.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
      expect(g.moves.map((m) => m.color)).toEqual(["w", "b", "w", "b"]);
      expect(g.moves.map((m) => m.moveNumber)).toEqual([1, 1, 2, 2]);
      expect(g.result).toBe("*");
    });

    it("keeps check/mate suffixes on the SAN but not !/? glyphs", () => {
      const g = parse("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7# 1-0");
      const sans = g.moves.map((m) => m.san);
      expect(sans).toContain("Qxf7#");
      const nf6 = g.moves.find((m) => m.san === "Nf6");
      expect(nf6).toBeDefined();
      expect(nf6!.nags).toEqual([4]); // "??" -> $4, not part of san
    });

    it("handles castling both sides", () => {
      const g = parse("1. e4 e5 2. Nf3 Nc6 3. O-O O-O-O *");
      expect(g.moves.map((m) => m.san)).toContain("O-O");
      expect(g.moves.map((m) => m.san)).toContain("O-O-O");
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
      expect(g.moves.map((m) => m.san)).toEqual(["e4"]);
      expect(g.result).toBe("0-1");
    });
  });

  describe("NAGs", () => {
    it("parses numeric and symbolic NAGs", () => {
      const g = parse("1. e4! e5?! 2. Nf3 $13 *");
      expect(g.moves[0].nags).toEqual([1]); // !
      expect(g.moves[1].nags).toEqual([6]); // ?!
      expect(g.moves[2].nags).toEqual([13]); // $13
    });
  });

  describe("comments — all three positions", () => {
    it("captures commentMove, commentBefore and commentAfter", () => {
      const g = parse("{intro} 1. {pre} e4 {after} e5 *");
      const e4 = g.moves[0];
      expect(e4.commentMove).toBe("intro");
      expect(e4.commentBefore).toBe("pre");
      expect(e4.commentAfter).toBe("after");
    });

    it("parses ;-to-end-of-line comments (gap vs cm-pgn)", () => {
      const g = parse("1. e4 ; a line comment\n e5 *");
      expect(g.moves[0].commentAfter).toBe("a line comment");
      expect(g.moves.map((m) => m.san)).toEqual(["e4", "e5"]);
    });

    it("collapses whitespace/newlines inside brace comments", () => {
      const g = parse("1. e4 { multi\n  line  comment } e5 *");
      expect(g.moves[0].commentAfter).toBe("multi line comment");
    });
  });

  describe("null moves (gap vs cm-pgn)", () => {
    it("parses -- and Z0 null moves", () => {
      const g = parse("1. e4 -- 2. Z0 e5 *");
      const sans = g.moves.map((m) => m.san);
      expect(sans).toContain("--");
      expect(sans).toContain("Z0");
    });
  });

  describe("variations", () => {
    it("attaches a variation as an alternative to the move it follows", () => {
      const g = parse("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *");
      const e5 = g.moves[1];
      expect(e5.variations).toHaveLength(1);
      const sub = e5.variations[0];
      expect(sub.map((m) => m.san)).toEqual(["c5", "Nf3"]);
      expect(sub[0].color).toBe("b"); // c5 is black's alternative to e5
      expect(sub[0].moveNumber).toBe(1);
    });

    it("handles nested variations", () => {
      const g = parse("1. e4 e5 2. Nf3 (2. Nc3 Nf6 (2... d6)) *");
      const nf3 = g.moves[2];
      expect(nf3.variations).toHaveLength(1);
      const nc3line = nf3.variations[0];
      expect(nc3line.map((m) => m.san)).toEqual(["Nc3", "Nf6"]);
      expect(nc3line[1].variations[0].map((m) => m.san)).toEqual(["d6"]);
    });
  });

  describe("strict mode", () => {
    it("throws on an unparseable token when strict (editor read-only fallback)", () => {
      expect(() => parse("1. e4 @@@ e5 *", { strict: true })).toThrow();
    });

    it("skips the stray token in lenient (default) mode", () => {
      expect(parse("1. e4 @@@ e5 *").moves.map((m) => m.san)).toEqual(["e4", "e5"]);
    });
  });

  describe("headers", () => {
    it("parses headers in source order, FEN stays a header (FEN-neutral)", () => {
      const pgn = `[Event "Test"]\n[Result "1-0"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 1-0`;
      const g = parse(pgn);
      expect(Object.keys(g.headers)).toEqual(["Event", "Result", "FEN"]);
      expect(g.headers.FEN).toContain("rnbqkbnr");
      expect(g.moves[0].san).toBe("e4");
    });

    it("unescapes quotes in header values", () => {
      const g = parse(`[White "O'Brien \\"Doc\\""]\n\n*`);
      expect(g.headers.White).toBe('O\'Brien "Doc"');
    });
  });
});
