import { describe, it, expect } from "vitest";
import { renderBoard } from "../../src/render/board";
import { parseFEN } from "../../src/core/fen";
import type { BoardConfig } from "../../src/render/config";
import type { Piece } from "../../src/core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Minimal config for tests — piece URLs are predictable stubs
const testConfig: BoardConfig = {
  orientation: "white",
  colors: { light: "#ffffff", dark: "#000000" },
  squareSize: 50,
  showCoordinates: false,
  pieceSource: { type: "bundled" },
  resolvePieceUrl: (piece: Piece) => `/pieces/${piece.color}${piece.type.toUpperCase()}.svg`,
};

describe("renderBoard", () => {
  it("returns a string starting with <svg", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    expect(svg.trimStart()).toMatch(/^<svg /);
  });

  it("includes correct width and height based on squareSize", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    expect(svg).toContain('width="400"');
    expect(svg).toContain('height="400"');
  });

  it("renders 64 squares", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    const rectMatches = svg.match(/<rect /g);
    expect(rectMatches).toHaveLength(64);
  });

  it("renders 32 pieces for the starting position", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    const imageMatches = svg.match(/<image /g);
    expect(imageMatches).toHaveLength(32);
  });

  it("places a1 rook at bottom-left when orientation is white", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    // a1 = index 56, white orientation → col 0, row 7 → x=0, y=350
    expect(svg).toContain(`href="/pieces/wR.svg" x="0" y="350"`);
  });

  it("places a8 rook at top-left when orientation is white", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    // a8 = index 0, white orientation → col 0, row 0 → x=0, y=0
    expect(svg).toContain(`href="/pieces/bR.svg" x="0" y="0"`);
  });

  it("flips the board when orientation is black", () => {
    const config: BoardConfig = { ...testConfig, orientation: "black" };
    const svg = renderBoard(parseFEN(STARTING_FEN), config);
    // a1 = index 56, black orientation → col 7, row 0 → x=350, y=0
    expect(svg).toContain(`href="/pieces/wR.svg" x="350" y="0"`);
  });

  it("uses light color for a1 (light square)", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    // a1 = col 0, row 7 → (0+7)%2 = 1 → dark. Wait: a1 is a light square in chess.
    // In our scheme: isLightSquare(col=0, row=7) = (0+7)%2 = 1 → false → dark fill="#000000"
    // But a1 IS a light square in chess... let's verify the color scheme is consistent.
    // The visual correctness depends on the color assignment. We test for consistency:
    // a1 (col=0,row=7): (0+7)%2=1 → dark color
    // h1 (col=7,row=7): (7+7)%2=0 → light color
    // In standard chess a1=dark, h1=light — this matches.
    expect(svg).toContain(`x="0" y="350" width="50" height="50" fill="#000000"`); // a1 = dark
    expect(svg).toContain(`x="350" y="350" width="50" height="50" fill="#ffffff"`); // h1 = light
  });

  it("renders no pieces on an empty board", () => {
    const emptyFEN = "8/8/8/8/8/8/8/8 w - - 0 1";
    const svg = renderBoard(parseFEN(emptyFEN), testConfig);
    expect(svg).not.toContain("<image");
  });

  it("includes coordinate labels when showCoordinates is true", () => {
    const config: BoardConfig = { ...testConfig, showCoordinates: true };
    const svg = renderBoard(parseFEN(STARTING_FEN), config);
    expect(svg).toContain("<text");
    expect(svg).toContain(">a<");
    expect(svg).toContain(">1<");
  });

  it("omits coordinate labels when showCoordinates is false", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    expect(svg).not.toContain("<text");
  });
});
