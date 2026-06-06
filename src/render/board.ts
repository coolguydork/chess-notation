import type { BoardState, Square } from "../core/types";
import type { BoardConfig, EngineArrow } from "./config";

// Maps board index → { col, row } in SVG space (0,0 = top-left).
// When orientation is "white": a8=index 0 → col 0, row 0.
// When orientation is "black": the board is flipped.
function indexToColRow(index: number, orientation: "white" | "black"): { col: number; row: number } {
  const rank = 7 - Math.floor(index / 8); // 0=rank1 … 7=rank8
  const file = index % 8;                  // 0=a … 7=h

  if (orientation === "white") {
    return { col: file, row: 7 - rank };
  } else {
    return { col: 7 - file, row: rank };
  }
}

function isLightSquare(col: number, row: number): boolean {
  return (col + row) % 2 === 0;
}

function renderSquares(config: BoardConfig): string {
  const { squareSize, colors, orientation } = config;
  const parts: string[] = [];

  for (let i = 0; i < 64; i++) {
    const { col, row } = indexToColRow(i, orientation);
    const x = col * squareSize;
    const y = row * squareSize;
    const fill = isLightSquare(col, row) ? colors.light : colors.dark;
    parts.push(`<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" fill="${fill}"/>`);
  }

  return parts.join("\n  ");
}

function renderPieces(board: readonly Square[], config: BoardConfig): string {
  const { squareSize, orientation, resolvePieceUrl } = config;
  const parts: string[] = [];

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece) continue;

    const { col, row } = indexToColRow(i, orientation);
    const x = col * squareSize;
    const y = row * squareSize;
    const url = resolvePieceUrl(piece);

    parts.push(
      `<image href="${url}" x="${x}" y="${y}" width="${squareSize}" height="${squareSize}"/>`
    );
  }

  return parts.join("\n  ");
}

function renderCoordinates(config: BoardConfig): string {
  if (!config.showCoordinates) return "";

  const { squareSize, colors, orientation } = config;
  const parts: string[] = [];
  const fontSize = Math.round(squareSize * 0.2);
  const padding = Math.round(squareSize * 0.05);

  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = ["1", "2", "3", "4", "5", "6", "7", "8"];

  // File labels along the bottom row
  for (let col = 0; col < 8; col++) {
    const fileIndex = orientation === "white" ? col : 7 - col;
    const x = col * squareSize + squareSize - fontSize - padding;
    const y = 8 * squareSize - padding;
    const fill = isLightSquare(col, 7) ? colors.dark : colors.light;
    parts.push(
      `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${fill}" font-family="sans-serif">${files[fileIndex]}</text>`
    );
  }

  // Rank labels along the left column
  for (let row = 0; row < 8; row++) {
    const rankIndex = orientation === "white" ? 7 - row : row;
    const x = padding;
    const y = row * squareSize + fontSize + padding;
    const fill = isLightSquare(0, row) ? colors.dark : colors.light;
    parts.push(
      `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${fill}" font-family="sans-serif">${ranks[rankIndex]}</text>`
    );
  }

  return parts.join("\n  ");
}

function renderHighlights(config: BoardConfig): string {
  const { squareSize, orientation, selectedSquare, legalTargets } = config;
  if (selectedSquare === undefined && !legalTargets?.size) return "";

  const parts: string[] = [];

  if (selectedSquare !== undefined) {
    const { col, row } = indexToColRow(selectedSquare, orientation);
    const x = col * squareSize;
    const y = row * squareSize;
    parts.push(
      `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" fill="rgba(255,255,0,0.45)" data-square="${selectedSquare}"/>`
    );
  }

  if (legalTargets) {
    const dotR = Math.round(squareSize * 0.15);
    for (const idx of legalTargets) {
      const { col, row } = indexToColRow(idx, orientation);
      const cx = col * squareSize + squareSize / 2;
      const cy = row * squareSize + squareSize / 2;
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="rgba(0,0,0,0.25)" data-square="${idx}"/>`
      );
    }
  }

  return parts.join("\n  ");
}

/** Convert a UCI square string ("e2") to a board index (0–63). */
export function uciSquareToIndex(sq: string): number {
  const file = sq.charCodeAt(0) - 97; // 'a'=0
  const rank = parseInt(sq[1], 10) - 1; // '1'=0
  return (7 - rank) * 8 + file;
}

function renderArrows(arrows: EngineArrow[], config: BoardConfig): string {
  if (!arrows.length) return "";
  const { squareSize, orientation } = config;
  const parts: string[] = [];

  // One arrowhead marker def per unique color
  const colors = [...new Set(arrows.map(a => a.color))];
  const defs = colors.map(color => {
    const id = `arrowhead-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
    return `<marker id="${id}" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto">` +
      `<path d="M0,0 L0,4 L4,2 z" fill="${color}"/></marker>`;
  }).join("");
  parts.push(`<defs>${defs}</defs>`);

  for (const arrow of arrows) {
    const from = indexToColRow(arrow.from, orientation);
    const to = indexToColRow(arrow.to, orientation);

    const x1 = from.col * squareSize + squareSize / 2;
    const y1 = from.row * squareSize + squareSize / 2;
    const x2 = to.col * squareSize + squareSize / 2;
    const y2 = to.row * squareSize + squareSize / 2;

    // Shorten the line so the arrowhead lands at the square centre
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const shorten = squareSize * 0.3;
    const ex = x2 - (dx / len) * shorten;
    const ey = y2 - (dy / len) * shorten;

    const colorId = `arrowhead-${arrow.color.replace(/[^a-zA-Z0-9]/g, "")}`;
    const strokeW = Math.round(squareSize * 0.12);
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}"` +
      ` stroke="${arrow.color}" stroke-width="${strokeW}" stroke-linecap="round"` +
      ` marker-end="url(#${colorId})" opacity="0.82"/>`
    );
  }

  return parts.join("\n  ");
}

export function renderBoard(state: BoardState, config: BoardConfig): string {
  const size = config.squareSize * 8;

  const squares = renderSquares(config);
  const coordinates = renderCoordinates(config);
  const pieces = renderPieces(state.board, config);
  const highlights = renderHighlights(config);
  const arrows = renderArrows(config.engineArrows ?? [], config);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="chess-board-svg">`,
    `  <!-- squares -->`,
    `  ${squares}`,
    coordinates ? `  <!-- coordinates -->\n  ${coordinates}` : "",
    highlights ? `  <!-- highlights -->\n  ${highlights}` : "",
    arrows ? `  <!-- engine arrows -->\n  ${arrows}` : "",
    `  <!-- pieces -->`,
    `  ${pieces}`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("\n");
}
