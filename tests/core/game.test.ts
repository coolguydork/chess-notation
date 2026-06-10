import { describe, it, expect } from "vitest";
import {
  gameFromFen,
  gameFromPgn,
  projectGame,
  gameToPgn,
  addMoveAt,
  removeAt,
  setMidComment,
  setAdjacentComment,
  updateComment,
  setNags,
  promoteVariation,
  replaceMove,
} from "../../src/core/game";
import { buildMoveTree } from "../../src/core/tree";
import { parseMultiPGN } from "../../src/core/pgn";
import { serializeFEN } from "../../src/core/fen";
import { isComment } from "../../src/pgn-editor";
import type { MoveNode } from "../../src/core/types";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Display comments following a node, in order.
function tailComments(node: MoveNode): string[] {
  return node.tail
    .filter((t): t is Extract<typeof t, { kind: "comment" }> => t.kind === "comment")
    .map((t) => t.comment.text);
}

// Compare two MoveNode trees for structural equivalence (ignoring node ids).
function expectTreesEqual(a: MoveNode | null, b: MoveNode | null, path = "root"): void {
  if (a === null || b === null) {
    expect(a, `next mismatch at ${path}`).toBe(b);
    return;
  }
  expect(a.san, `san at ${path}`).toBe(b.san);
  expect(a.moveNumber, `moveNumber at ${path}`).toBe(b.moveNumber);
  expect(a.color, `color at ${path}`).toBe(b.color);
  expect(a.commentMid ?? undefined, `commentMid at ${path}`).toBe(b.commentMid ?? undefined);
  expect(tailComments(a), `tail comments at ${path}`).toEqual(tailComments(b));
  expect(a.nags ?? undefined, `nags at ${path}`).toEqual(b.nags ?? undefined);
  expect(serializeFEN(a.state), `state at ${path}`).toBe(serializeFEN(b.state));
  expect(a.from, `from at ${path}`).toBe(b.from);
  expect(a.to, `to at ${path}`).toBe(b.to);
  expect(a.variationHeads.length, `variation count at ${path} (${a.san})`).toBe(b.variationHeads.length);
  a.variationHeads.forEach((v, i) => expectTreesEqual(v, b.variationHeads[i], `${path}>${a.san}|var${i}`));
  expectTreesEqual(a.next, b.next, `${path}>${a.san}`);
}

// Build the same tree via the other entry path (parseMultiPGN -> buildMoveTree),
// a cross-path consistency check that gameFromPgn -> projectGame agrees with it.
function viaLib(movetext: string, startFen = START_FEN): MoveNode {
  return buildMoveTree(startFen, parseMultiPGN(`${movetext} *`)[0].items);
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

  it("branches after the continuation's own comment, not before it", () => {
    const ed = gameFromPgn("1. e4 e5 { solid } 2. Nf3");
    addMoveAt(ed, ["e4"], "c5");
    expect(gameToPgn(ed, "*")).toBe("1. e4 e5 { solid } ( 1... c5 ) 2. Nf3 *");
  });

  it("adds a pawn promotion (restored after dropping cm-chess)", () => {
    const ed = gameFromFen("8/4P3/8/8/8/8/8/4K2k w - - 0 1");
    addMoveAt(ed, [], "e8=Q");
    expect(mainlineSans(projectGame(ed))).toEqual(["e8=Q"]);
    expect(gameToPgn(ed, "*")).toBe("1. e8=Q *");
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
  it("round-trips movetext with NAGs and comments in canonical form", () => {
    const ed = gameFromPgn("1. e4 e5 2. Nf3 Nc6 $1 3. Bb5 {Ruy Lopez} a6");
    expect(gameToPgn(ed, "*")).toBe("1. e4 e5 2. Nf3 Nc6 $1 3. Bb5 { Ruy Lopez } 3... a6 *");
  });

  it("preserves header tags on write-back, on a single line", () => {
    const ed = gameFromPgn(`[White "Carlsen"]\n[Black "Nepo"]\n\n1. e4 e5 *`);
    const out = gameToPgn(ed, "*");
    expect(out).toContain(`[White "Carlsen"]`);
    expect(out).toContain(`[Black "Nepo"]`);
    expect(out).not.toContain("\n"); // must fit the one YAML pgn: scalar
  });

  it("uses correct move numbers from a SetUp FEN", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    expect(gameToPgn(gameFromPgn("3. Bb5 a6", fen), "*")).toBe("3. Bb5 a6 *");
  });

  it("writes back a comment inserted before the first move", () => {
    const ed = gameFromPgn("1. e4 e5");
    setAdjacentComment(ed, ["e4"], "before", "intro");
    expect(gameToPgn(ed, "*")).toBe("{ intro } 1. e4 e5 *");
  });

  it("writes back a between-number-and-SAN comment (commentMid)", () => {
    const ed = gameFromPgn("1. e4 e5");
    setMidComment(ed, ["e4"], "hmm");
    expect(gameToPgn(ed, "*")).toBe("1. { hmm } e4 e5 *");
  });

  it("round-trips every comment position through serialize -> parse", () => {
    const ed = gameFromPgn("{ intro } 1. { hmm } e4 { ok } e5");
    const reparsed = gameFromPgn(gameToPgn(ed, "*")).items;
    expect(reparsed[0]).toMatchObject({ kind: "comment", text: "intro" });
    expect(reparsed[1]).toMatchObject({ kind: "move", san: "e4", commentMid: "hmm" });
    expect(reparsed[2]).toMatchObject({ kind: "comment", text: "ok" });
  });

  it("projects a leading comment into the root's tail", () => {
    const ed = gameFromPgn("{ intro } 1. e4 e5");
    expect(tailComments(projectGame(ed))).toEqual(["intro"]);
  });
});

describe("move-level Update (Tier 1 seam)", () => {
  it("setAdjacentComment (after) reaches the projected tree and the PGN", () => {
    const ed = gameFromPgn("1. e4 e5 2. Nf3");
    expect(setAdjacentComment(ed, ["e4"], "after", "best by test")).toBe(true);
    expect(tailComments(projectGame(ed).next!)).toEqual(["best by test"]);
    expect(gameToPgn(ed, "*")).toContain("{ best by test }");
  });

  it("updateComment edits an existing comment item by identity", () => {
    const ed = gameFromPgn("1. e4 { old } e5");
    const item = ed.items.find(isComment)!;
    expect(updateComment(ed, item, "new")).toBe(true);
    expect(gameToPgn(ed, "*")).toBe("1. e4 { new } 1... e5 *");
    expect(updateComment(ed, item, "")).toBe(true);
    expect(gameToPgn(ed, "*")).toBe("1. e4 e5 *");
  });

  it("setNags annotates a move", () => {
    const ed = gameFromPgn("1. e4 e5");
    setNags(ed, ["e4"], [1]);
    expect(projectGame(ed).next!.nags).toEqual([1]);
    expect(gameToPgn(ed, "*")).toContain("e4 $1");
  });

  it("promoteVariation makes a variation the mainline", () => {
    const ed = gameFromPgn("1. e4 e5 (1... c5 2. Nf3) 2. Nf3");
    expect(promoteVariation(ed, ["e4", "c5"])).toBe(true);
    expect(mainlineSans(projectGame(ed))).toEqual(["e4", "c5", "Nf3"]);
  });

  it("replaceMove swaps a move and keeps a still-legal continuation", () => {
    const ed = gameFromPgn("1. e4 e5 2. Nf3");
    expect(replaceMove(ed, ["e4", "e5", "Nf3"], "Nc3")).toBe(true);
    expect(mainlineSans(projectGame(ed))).toEqual(["e4", "e5", "Nc3"]);
  });

  it("replaceMove truncates a continuation the change makes illegal", () => {
    const ed = gameFromPgn("1. e4 d5 2. exd5");
    expect(replaceMove(ed, ["e4", "d5"], "d6")).toBe(true);
    expect(mainlineSans(projectGame(ed))).toEqual(["e4", "d6"]); // exd5 no longer legal
  });

  it("replaceMove keeps the move's own variations", () => {
    const ed = gameFromPgn("1. e4 e5 (1... c5) 2. Nf3");
    expect(replaceMove(ed, ["e4", "e5"], "e6")).toBe(true);
    const root = projectGame(ed);
    expect(mainlineSans(root)).toEqual(["e4", "e6", "Nf3"]);
    expect(root.next!.next!.variationHeads.map((v) => v.san)).toEqual(["c5"]);
  });
});
