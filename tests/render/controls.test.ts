import { describe, it, expect } from "vitest";
import { buildSnapshots, renderControls } from "../../src/render/controls";
import { parseFEN } from "../../src/core/fen";
import type { BoardConfig } from "../../src/render/config";
import type { PgnGame } from "../../src/core/types";
import type { Piece } from "../../src/core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const testConfig: BoardConfig = {
  orientation: "white",
  colors: { light: "#ffffff", dark: "#000000" },
  squareSize: 50,
  showCoordinates: false,
  pieceSource: { type: "bundled" },
  resolvePieceUrl: (piece: Piece) => `/pieces/${piece.color}${piece.type.toUpperCase()}.svg`,
};

const italianGame: PgnGame = {
  headers: { White: "Alice", Black: "Bob", Result: "1-0" },
  moves: [
    { san: "e4",  moveNumber: 1, color: "w" },
    { san: "e5",  moveNumber: 1, color: "b" },
    { san: "Nf3", moveNumber: 2, color: "w" },
    { san: "Nc6", moveNumber: 2, color: "b" },
    { san: "Bc4", moveNumber: 3, color: "w" },
  ],
  result: "1-0",
};

// ─── buildSnapshots ───────────────────────────────────────────────────────────

describe("buildSnapshots", () => {
  it("starts with the initial position as snapshot 0", () => {
    const snaps = buildSnapshots(STARTING_FEN, italianGame.moves);
    expect(snaps[0].state).toEqual(parseFEN(STARTING_FEN));
    expect(snaps[0].san).toBeNull(); // before any move
  });

  it("produces one snapshot per move plus the start", () => {
    const snaps = buildSnapshots(STARTING_FEN, italianGame.moves);
    expect(snaps).toHaveLength(6); // start + 5 moves
  });

  it("snapshot san matches the move that produced it", () => {
    const snaps = buildSnapshots(STARTING_FEN, italianGame.moves);
    expect(snaps[1].san).toBe("e4");
    expect(snaps[2].san).toBe("e5");
    expect(snaps[3].san).toBe("Nf3");
  });

  it("each snapshot's state reflects the moves applied so far", () => {
    const snaps = buildSnapshots(STARTING_FEN, italianGame.moves);
    // After 1.e4: e4 pawn should be on e4, e2 empty
    const idx = (file: number, rank: number) => (7 - rank) * 8 + file;
    expect(snaps[1].state.board[idx(4, 3)]).toEqual({ type: "p", color: "w" }); // e4
    expect(snaps[1].state.board[idx(4, 1)]).toBeNull(); // e2 empty
  });

  it("works with an empty move list (FEN-only block)", () => {
    const snaps = buildSnapshots(STARTING_FEN, []);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].san).toBeNull();
  });
});

// ─── renderControls ───────────────────────────────────────────────────────────

describe("renderControls", () => {
  const snaps = buildSnapshots(STARTING_FEN, italianGame.moves);

  it("returns a non-empty HTML string", () => {
    const html = renderControls(snaps, 0, testConfig);
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("includes an <svg> board", () => {
    const html = renderControls(snaps, 0, testConfig);
    expect(html).toContain("<svg ");
  });

  it("includes prev and next buttons", () => {
    const html = renderControls(snaps, 0, testConfig);
    expect(html).toContain("data-action=\"prev\"");
    expect(html).toContain("data-action=\"next\"");
  });

  it("marks prev button disabled at snapshot 0", () => {
    const html = renderControls(snaps, 0, testConfig);
    // Extract just the prev button
    const prevMatch = html.match(/data-action="prev"[^>]*>/);
    expect(prevMatch).not.toBeNull();
    expect(prevMatch![0]).toContain("disabled");
  });

  it("marks next button disabled at the last snapshot", () => {
    const html = renderControls(snaps, snaps.length - 1, testConfig);
    const nextMatch = html.match(/data-action="next"[^>]*>/);
    expect(nextMatch).not.toBeNull();
    expect(nextMatch![0]).toContain("disabled");
  });

  it("neither button is disabled at an intermediate snapshot", () => {
    const html = renderControls(snaps, 2, testConfig);
    const prevMatch = html.match(/data-action="prev"[^>]*>/);
    const nextMatch = html.match(/data-action="next"[^>]*>/);
    expect(prevMatch![0]).not.toContain("disabled");
    expect(nextMatch![0]).not.toContain("disabled");
  });

  it("renders move list entries for each move", () => {
    const html = renderControls(snaps, 0, testConfig);
    expect(html).toContain("e4");
    expect(html).toContain("e5");
    expect(html).toContain("Nf3");
    expect(html).toContain("Nc6");
    expect(html).toContain("Bc4");
  });

  it("renders move numbers in the move list", () => {
    const html = renderControls(snaps, 0, testConfig);
    expect(html).toContain("1.");
    expect(html).toContain("2.");
    expect(html).toContain("3.");
  });

  it("marks the active move with data-active", () => {
    const html = renderControls(snaps, 3, testConfig); // after Nf3 (snapshot 3)
    // snapshot 3 corresponds to move index 3 (san="Nf3")
    expect(html).toContain("data-active=\"true\"");
  });

  it("no move is marked active at snapshot 0 (start position)", () => {
    const html = renderControls(snaps, 0, testConfig);
    expect(html).not.toContain("data-active=\"true\"");
  });

  it("each move entry has a data-index attribute for click navigation", () => {
    const html = renderControls(snaps, 0, testConfig);
    expect(html).toContain("data-index=\"1\"");
    expect(html).toContain("data-index=\"2\"");
  });

  it("renders result token at the end of the move list", () => {
    const html = renderControls(snaps, 0, testConfig, "1-0");
    expect(html).toContain("1-0");
  });

  it("omits result token when not provided", () => {
    const html = renderControls(snaps, 0, testConfig);
    expect(html).not.toContain("1-0");
  });

  it("renders correctly with a single-snapshot (FEN-only) list", () => {
    const fenOnlySnaps = buildSnapshots(STARTING_FEN, []);
    const html = renderControls(fenOnlySnaps, 0, testConfig);
    expect(html).toContain("<svg ");
    // No move entries expected
    expect(html).not.toContain("data-index");
  });
});
