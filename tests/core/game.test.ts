import { describe, it, expect } from "vitest";
import { gameFromFen, gameFromPgn, projectGame, gameToPgn } from "../../src/core/game";
import { buildMoveTree } from "../../src/core/tree";
import { parseMultiPGN, serializeMoveTree } from "../../src/core/pgn";
import { serializeFEN } from "../../src/core/fen";
import type { MoveNode } from "../../src/core/types";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Compare two MoveNode trees for structural equivalence (ignoring node ids).
function expectTreesEqual(a: MoveNode | null, b: MoveNode | null, path = "root"): void {
  if (a === null || b === null) {
    expect(a, `next mismatch at ${path}`).toBe(b);
    return;
  }
  expect(a.san, `san at ${path}`).toBe(b.san);
  expect(a.moveNumber, `moveNumber at ${path}`).toBe(b.moveNumber);
  expect(a.color, `color at ${path}`).toBe(b.color);
  expect(a.comment ?? undefined, `comment at ${path}`).toBe(b.comment ?? undefined);
  expect(a.nags ?? undefined, `nags at ${path}`).toEqual(b.nags ?? undefined);
  expect(serializeFEN(a.state), `state at ${path}`).toBe(serializeFEN(b.state));
  expect(a.from, `from at ${path}`).toBe(b.from);
  expect(a.to, `to at ${path}`).toBe(b.to);
  expect(a.variationHeads.length, `variation count at ${path} (${a.san})`).toBe(b.variationHeads.length);
  a.variationHeads.forEach((v, i) => expectTreesEqual(v, b.variationHeads[i], `${path}>${a.san}|var${i}`));
  expectTreesEqual(a.next, b.next, `${path}>${a.san}`);
}

// Build the reference tree via the existing (tested) @mliebelt + buildMoveTree path.
function viaLib(movetext: string, startFen = START_FEN): MoveNode {
  return buildMoveTree(startFen, parseMultiPGN(`${movetext} *`)[0].moves);
}

describe("projectGame — parity with buildMoveTree", () => {
  const cases: Record<string, string> = {
    mainline: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6",
    "single variation": "1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6",
    "nested variation": "1. e4 e5 (1... c5 2. Nf3 (2. Nc3) d6) 2. Nf3",
    "comment + NAG": "1. e4 e5 2. Nf3 Nc6 $1 3. Bb5 {Ruy Lopez} a6",
    promotion: "1. e4 d5 2. exd5 Qxd5",
  };

  for (const [name, movetext] of Object.entries(cases)) {
    it(name, () => {
      expectTreesEqual(projectGame(gameFromPgn(movetext)), viaLib(movetext));
    });
  }

  it("custom start FEN", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    expectTreesEqual(projectGame(gameFromPgn("3. Bb5 a6", fen)), viaLib("3. Bb5 a6", fen));
  });
});

describe("gameFromFen", () => {
  it("projects a root-only tree at the given position", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const root = projectGame(gameFromFen(fen));
    expect(root.san).toBeNull();
    expect(root.next).toBeNull();
    expect(serializeFEN(root.state)).toBe(fen);
  });
});

describe("gameToPgn", () => {
  it("round-trips movetext with NAGs and comments", () => {
    const movetext = "1. e4 e5 2. Nf3 Nc6 $1 3. Bb5 {Ruy Lopez} a6";
    expect(gameToPgn(gameFromPgn(movetext), "*")).toBe(
      serializeMoveTree(viaLib(movetext), "*"),
    );
  });

  it("uses correct move numbers from a SetUp FEN (not cm-pgn's buggy render)", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    // cm-pgn's own render() would emit "1. Bb5 ..."; ours respects the FEN.
    expect(gameToPgn(gameFromPgn("3. Bb5 a6", fen), "*")).toBe("3. Bb5 a6 *");
  });
});
