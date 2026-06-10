import { describe, it, expect } from "vitest";
import { parse } from "../../src/pgn-editor/parser";
import { serialize, serializeMovetext, serializeInline } from "../../src/pgn-editor/serialize";

// Round-trip: parse -> serialize -> parse must be a fixed point on the AST.
function roundTrips(pgn: string): void {
  const a = parse(pgn);
  const b = parse(serialize(a));
  expect(b).toEqual(a);
}

describe("pgn-editor serialize", () => {
  it("round-trips a plain mainline", () => {
    roundTrips("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0");
  });

  it("round-trips all three comment positions", () => {
    roundTrips("{intro} 1. {pre} e4 {after} e5 *");
  });

  it("round-trips NAGs", () => {
    roundTrips("1. e4 $1 e5 $6 2. Nf3 $13 *");
  });

  it("round-trips nested variations", () => {
    roundTrips("1. e4 e5 2. Nf3 (2. Nc3 Nf6 (2... d6)) Nc6 *");
  });

  it("round-trips null moves", () => {
    roundTrips("1. e4 -- 2. Z0 e5 *");
  });

  it("round-trips a comment that follows a variation (re-anchored before it)", () => {
    // The comment attaches to e4's after-slot; serialization emits it before
    // the variation, which re-parses to the identical AST.
    roundTrips("1. e4 ( 1. d4 ) { hi } ( 1. c4 ) 1... e5 2. Nf3 *");
  });

  it("round-trips headers including FEN", () => {
    roundTrips(`[Event "T"]\n[Result "1-0"]\n[FEN "8/8/8/8/8/8/8/8 w - - 0 1"]\n\n1. e4 1-0`);
  });

  it("emits black move number after a comment break", () => {
    const text = serializeMovetext(parse("1. e4 {x} e5 2. Nf3 *"));
    expect(text).toContain("1... e5");
  });

  it("omits the header block when there are no headers", () => {
    expect(serialize(parse("1. e4 *"))).toBe("1. e4 *");
  });

  it("serializeInline keeps header tags and movetext on one physical line", () => {
    const block = `[White "A"]\n[Black "B"]\n\n1. e4 e5 *`;
    const inline = serializeInline(parse(block));
    expect(inline).toBe(`[White "A"] [Black "B"] 1. e4 e5 *`);
    expect(inline).not.toContain("\n");
    // single-line form re-parses to the same AST as the block form
    expect(parse(inline)).toEqual(parse(block));
  });

  it("serializeInline omits tags when there are no headers", () => {
    expect(serializeInline(parse("1. e4 *"))).toBe("1. e4 *");
  });
});
