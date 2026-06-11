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

  it("round-trips a comment that follows a variation, in place", () => {
    roundTrips("1. e4 ( 1. d4 ) { hi } ( 1. c4 ) 1... e5 2. Nf3 *");
  });

  // Position is truth: for text already in canonical spacing, serialization
  // reproduces it exactly — comments are never re-anchored, merged, or moved.
  it.each([
    "1. e4 ( 1. d4 ) { hi } 1... e5 2. Nf3 *",
    "1. e4 { a } { b } 1... e5 *",
    "{ intro } { pre } 1. e4 { after } 1... e5 *",
    "1. e4 e5 ( 1... c6 ) { hi } *",
  ])("emits the written text unchanged: %s", (pgn) => {
    expect(serializeMovetext(parse(pgn))).toBe(pgn);
  });

  it("normalises a comment written between the number and the SAN to before the number", () => {
    // Move number indicators are decoration (the spec re-derives them), so
    // "1. { pre } e4" and "{ pre } 1. e4" are the same stream; export emits
    // the comment before the number. The comment never moves relative to moves.
    expect(serializeMovetext(parse("1. { pre } e4 e5 *"))).toBe("{ pre } 1. e4 e5 *");
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
