import type { Piece } from "../core/types";

// How piece image URLs are resolved — injected into the renderer,
// which never knows or cares where assets actually live.
export type PieceSource =
  | { type: "bundled" }                   // SVGs shipped with the plugin (default)
  | { type: "cdn"; baseUrl: string }      // e.g. https://example.com/pieces
  | { type: "local"; vaultPath: string }; // Phase 4: user's vault folder

export interface BoardColors {
  light: string;   // CSS color string, e.g. "#f0d9b5"
  dark: string;    // CSS color string, e.g. "#b58863"
}

export interface EngineArrow {
  from: number;  // board index (0–63)
  to: number;    // board index (0–63)
  color: string; // CSS color string
}

export interface UserArrow {
  from: number;   // board index (0–63)
  to: number;     // board index (0–63)
  color: string;  // CSS color string
  label?: string; // optional annotation shown near the arrowhead
}

export interface BoardConfig {
  orientation: "white" | "black";
  colors: BoardColors;
  squareSize: number;              // px, applied to both width and height
  showCoordinates: boolean;
  pieceSource: PieceSource;
  // Resolves a piece to a URL or data-URI for use in <image href="...">.
  // Provided by plugin/ based on pieceSource; render/ never constructs URLs.
  resolvePieceUrl: (piece: Piece) => string;
  // Resolves a cm-chessboard asset (e.g. "pieces/standard.svg") to an absolute
  // URL. Provided by plugin/ as an Obsidian resource path; used by view/cm-board.
  resolveAssetUrl?: (relPath: string) => string;
  // Optional square highlights: set of board indices to overlay.
  // selectedSquare — the clicked piece's square (filled tint).
  // legalTargets   — destination squares for the selected piece (dot overlay).
  lastMove?: { from: number; to: number };
  // When set, the piece at `to` is animated sliding from `from` on render.
  animatedMove?: { from: number; to: number };
  selectedSquare?: number;
  legalTargets?: ReadonlySet<number>;
  // Engine move arrows drawn over the board (Phase 5).
  engineArrows?: EngineArrow[];
  // User-drawn arrows with optional text labels.
  userArrows?: UserArrow[];
  // Whether the board accepts move input. False for read-only blocks (multi-game
  // and games the editor can't load); defaults to true.
  interactive?: boolean;
}

// ---------------------------------------------------------------------------
// Board color themes
// ---------------------------------------------------------------------------

export const BOARD_THEMES: Record<string, BoardColors> = {
  classic: { light: "#f0d9b5", dark: "#b58863" }, // Lichess brown
  blue:    { light: "#dee3e6", dark: "#8ca2ad" }, // Lichess blue
  green:   { light: "#ffffdd", dark: "#86a666" }, // Chess.com green
  dark:    { light: "#aaaaaa", dark: "#555555" }, // High-contrast dark
  walnut:  { light: "#f0c88a", dark: "#8b5a2b" }, // Warm walnut
  purple:  { light: "#e8d5f5", dark: "#7c4a8c" }, // Soft purple
};

export type BoardThemeName = keyof typeof BOARD_THEMES;

export const themeNames: string[] = Object.keys(BOARD_THEMES);

export function getBoardColors(theme: string | undefined): BoardColors {
  if (theme && theme in BOARD_THEMES) return BOARD_THEMES[theme];
  return BOARD_THEMES["classic"];
}

export const DEFAULT_COLORS: BoardColors = BOARD_THEMES["classic"];

export const DEFAULT_BOARD_CONFIG: Omit<BoardConfig, "resolvePieceUrl"> = {
  orientation: "white",
  colors: DEFAULT_COLORS,
  squareSize: 60,
  showCoordinates: true,
  pieceSource: { type: "bundled" },
};
