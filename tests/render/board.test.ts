import { describe, it, expect } from "vitest";
import { renderBoard, uciSquareToIndex } from "../../src/render/board";
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

  it("renders no arrows when engineArrows is absent", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    expect(svg).not.toContain("<line ");
    expect(svg).not.toContain("<marker ");
  });

  it("renders a <line> element for each engine arrow", () => {
    const config: BoardConfig = {
      ...testConfig,
      engineArrows: [
        { from: uciSquareToIndex("e2"), to: uciSquareToIndex("e4"), color: "green" },
        { from: uciSquareToIndex("d2"), to: uciSquareToIndex("d4"), color: "blue" },
      ],
    };
    const svg = renderBoard(parseFEN(STARTING_FEN), config);
    expect((svg.match(/<line /g) ?? []).length).toBe(2);
  });

  it("includes an arrowhead marker definition for each unique arrow color", () => {
    const config: BoardConfig = {
      ...testConfig,
      engineArrows: [
        { from: uciSquareToIndex("e2"), to: uciSquareToIndex("e4"), color: "green" },
        { from: uciSquareToIndex("d2"), to: uciSquareToIndex("d4"), color: "green" },
        { from: uciSquareToIndex("c2"), to: uciSquareToIndex("c4"), color: "blue" },
      ],
    };
    const svg = renderBoard(parseFEN(STARTING_FEN), config);
    expect((svg.match(/<marker /g) ?? []).length).toBe(2); // two unique colors
  });
});

describe("user arrows", () => {
  it("renders no user arrows when userArrows is absent", () => {
    const svg = renderBoard(parseFEN(STARTING_FEN), testConfig);
    // No extra lines beyond potential engine arrows (which are also absent here)
    expect(svg).not.toContain("data-user-arrow");
  });

  it("renders a <line> for each user arrow", () => {
    const config: BoardConfig = {
      ...testConfig,
      userArrows: [
        { from: uciSquareToIndex("e2"), to: uciSquareToIndex("e4"), color: "rgba(255,100,0,0.8)" },
        { from: uciSquareToIndex("d1"), to: uciSquareToIndex("h5"), color: "rgba(255,100,0,0.8)" },
      ],
    };
    const svg = renderBoard(parseFEN(STARTING_FEN), config);
    expect((svg.match(/data-user-arrow/g) ?? []).length).toBe(2);
  });

  it("renders no <text> label for an unlabeled user arrow", () => {
    const config: BoardConfig = {
      ...testConfig,
      userArrows: [
        { from: uciSquareToIndex("e2"), to: uciSquareToIndex("e4"), color: "orange" },
      ],
    };
    const svg = renderBoard(parseFEN(STARTING_FEN), config);
    expect(svg).not.toContain("chess-arrow-label");
  });

  it("renders a <text> with the label for a labeled user arrow", () => {
    const config: BoardConfig = {
      ...testConfig,
      userArrows: [
        { from: uciSquareToIndex("e2"), to: uciSquareToIndex("e4"), color: "orange", label: "Key idea!" },
      ],
    };
    const svg = renderBoard(parseFEN(STARTING_FEN), config);
    expect(svg).toContain("chess-arrow-label");
    expect(svg).toContain("Key idea!");
  });

  it("renders labels for only the arrows that have them", () => {
    const config: BoardConfig = {
      ...testConfig,
      userArrows: [
        { from: uciSquareToIndex("e2"), to: uciSquareToIndex("e4"), color: "orange", label: "Push!" },
        { from: uciSquareToIndex("d2"), to: uciSquareToIndex("d4"), color: "orange" },
      ],
    };
    const svg = renderBoard(parseFEN(STARTING_FEN), config);
    expect((svg.match(/chess-arrow-label/g) ?? []).length).toBe(1);
    expect(svg).toContain("Push!");
  });

  it("user arrows and engine arrows can coexist", () => {
    const config: BoardConfig = {
      ...testConfig,
      engineArrows: [{ from: uciSquareToIndex("e2"), to: uciSquareToIndex("e4"), color: "green" }],
      userArrows:   [{ from: uciSquareToIndex("d2"), to: uciSquareToIndex("d4"), color: "orange" }],
    };
    const svg = renderBoard(parseFEN(STARTING_FEN), config);
    expect((svg.match(/<line /g) ?? []).length).toBe(2);
  });
});

describe("uciSquareToIndex", () => {
  it("converts a1 to index 56", () => expect(uciSquareToIndex("a1")).toBe(56));
  it("converts h1 to index 63", () => expect(uciSquareToIndex("h1")).toBe(63));
  it("converts a8 to index 0",  () => expect(uciSquareToIndex("a8")).toBe(0));
  it("converts h8 to index 7",  () => expect(uciSquareToIndex("h8")).toBe(7));
  it("converts e2 to index 52", () => expect(uciSquareToIndex("e2")).toBe(52));
  it("converts e4 to index 36", () => expect(uciSquareToIndex("e4")).toBe(36));
});
