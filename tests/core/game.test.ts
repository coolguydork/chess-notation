import { describe, it, expect } from "vitest";
import { gameFromFen, gameFromPgn, projectGame, gameToPgn, addMoveAt, removeAt } from "../../src/core/game";
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

function mainlineSans(root: MoveNode): string[] {
  const sans: string[] = [];
  for (let n = root.next; n; n = n.next) sans.push(n.san!);
  return sans;
}

describe("addMoveAt", () => {
  it("extends the mainline", () => {
    const ed = gameFromPgn("1. e4 e5");
    addMoveAt(ed, ["e4", "e5"], "Nf3");
    expect(mainlineSans(projectGame(ed))).toEqual(["e4", "e5", "Nf3"]);
  });

  it("adds the first move to an empty FEN game", () => {
    const ed = gameFromFen(START_FEN);
    addMoveAt(ed, [], "e4");
    expect(mainlineSans(projectGame(ed))).toEqual(["e4"]);
  });

  it("branches a variation when the position already continues", () => {
    const ed = gameFromPgn("1. e4 e5 2. Nf3");
    addMoveAt(ed, ["e4"], "c5"); // alternative to e5
    const root = projectGame(ed);
    const e5 = root.next!.next!;
    expect(e5.variationHeads.map((v) => v.san)).toEqual(["c5"]);
    expect(mainlineSans(root)).toEqual(["e4", "e5", "Nf3"]);
  });

  it("branches a variation at the root (non-empty mainline)", () => {
    const ed = gameFromPgn("1. e4 e5");
    addMoveAt(ed, [], "d4");
    const root = projectGame(ed);
    expect(root.next!.variationHeads.map((v) => v.san)).toEqual(["d4"]);
    expect(mainlineSans(root)).toEqual(["e4", "e5"]);
  });

  it("de-dupes an existing continuation (no-op)", () => {
    const ed = gameFromPgn("1. e4 e5");
    addMoveAt(ed, ["e4"], "e5");
    const root = projectGame(ed);
    expect(mainlineSans(root)).toEqual(["e4", "e5"]);
    expect(root.next!.variationHeads).toHaveLength(0);
    expect(root.next!.next!.variationHeads).toHaveLength(0);
  });
});

describe("removeAt", () => {
  it("truncates the mainline from the given move", () => {
    const ed = gameFromPgn("1. e4 e5 2. Nf3 Nc6");
    removeAt(ed, ["e4", "e5", "Nf3"]);
    expect(mainlineSans(projectGame(ed))).toEqual(["e4", "e5"]);
  });

  it("removing the first move clears the game", () => {
    const ed = gameFromPgn("1. e4 e5");
    removeAt(ed, ["e4"]);
    expect(mainlineSans(projectGame(ed))).toEqual([]);
    expect(gameToPgn(ed, "*")).toBe("*");
  });

  it("removes a whole variation WITHOUT corrupting the mainline (undo-bug guard)", () => {
    const ed = gameFromPgn("1. e4 e5 (1... c5 2. Nf3) 2. Nf3");
    removeAt(ed, ["e4", "c5"]); // c5 is a variation head
    const root = projectGame(ed);
    expect(mainlineSans(root)).toEqual(["e4", "e5", "Nf3"]); // mainline intact
    expect(root.next!.next!.variationHeads).toHaveLength(0);
  });

  it("truncates inside a variation", () => {
    const ed = gameFromPgn("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3");
    removeAt(ed, ["e4", "c5", "Nf3"]);
    const root = projectGame(ed);
    const c5 = root.next!.next!.variationHeads[0];
    expect(c5.san).toBe("c5");
    expect(c5.next).toBeNull();
    expect(mainlineSans(root)).toEqual(["e4", "e5", "Nf3"]);
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
