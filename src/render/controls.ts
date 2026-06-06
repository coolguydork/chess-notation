import { parseFEN } from "../core/fen";
import { applyMove } from "../core/moves";
import { renderBoard } from "./board";
import type { PgnMove, BoardState } from "../core/types";
import type { BoardConfig } from "./config";

// ---------------------------------------------------------------------------
// Snapshot — a board state reached after applying a specific move
// ---------------------------------------------------------------------------

export interface Snapshot {
  san: string | null; // null for the initial position (before any move)
  moveIndex: number;  // 1-based; 0 for the start snapshot
  state: BoardState;
}

// ---------------------------------------------------------------------------
// buildSnapshots
// Replays all main-line moves from the starting FEN and produces one snapshot
// per position (initial + one per move).
// ---------------------------------------------------------------------------

export function buildSnapshots(startFen: string, moves: PgnMove[]): Snapshot[] {
  const snapshots: Snapshot[] = [];
  let state = parseFEN(startFen);
  snapshots.push({ san: null, moveIndex: 0, state });

  for (let i = 0; i < moves.length; i++) {
    state = applyMove(state, moves[i].san);
    snapshots.push({ san: moves[i].san, moveIndex: i + 1, state });
  }

  return snapshots;
}

// ---------------------------------------------------------------------------
// renderControls
// Returns a self-contained HTML string: board SVG + navigation buttons +
// move list. No Obsidian imports. plugin/ wires up click handlers.
//
// data-action="prev" / data-action="next"  — nav buttons
// data-index="N"                            — each move token (1-based)
// data-active="true"                        — the currently displayed move
// ---------------------------------------------------------------------------

export function renderControls(
  snapshots: Snapshot[],
  currentIndex: number,
  config: BoardConfig,
  result?: string
): string {
  const current = snapshots[currentIndex];
  const boardSvg = renderBoard(current.state, config);

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === snapshots.length - 1;

  const prevDisabled = isFirst ? " disabled" : "";
  const nextDisabled = isLast ? " disabled" : "";

  const nav = `<div class="chess-nav">
  <button data-action="prev"${prevDisabled}>&#8592;</button>
  <button data-action="next"${nextDisabled}>&#8594;</button>
</div>`;

  // Build move list — group by move number, two moves per row
  const moveTokens = snapshots.slice(1); // skip start snapshot
  const rows: string[] = [];

  let i = 0;
  while (i < moveTokens.length) {
    const white = moveTokens[i];
    const black = moveTokens[i + 1]; // may be undefined (last move was white's)
    const num = Math.ceil(white.moveIndex / 2);

    const whiteActive = white.moveIndex === currentIndex ? " data-active=\"true\"" : "";
    const blackActive = black && black.moveIndex === currentIndex ? " data-active=\"true\"" : "";

    const whiteToken = `<span class="chess-move" data-index="${white.moveIndex}"${whiteActive}>${white.san}</span>`;
    const blackToken = black
      ? `<span class="chess-move" data-index="${black.moveIndex}"${blackActive}>${black.san}</span>`
      : "";

    rows.push(`<span class="chess-move-number">${num}.</span>${whiteToken}${blackToken}`);
    i += 2;
  }

  const resultToken = result
    ? `<span class="chess-result">${result}</span>`
    : "";

  const moveList = moveTokens.length > 0
    ? `<div class="chess-move-list">${rows.join("")}${resultToken}</div>`
    : "";

  return `<div class="chess-viewer">${boardSvg}${nav}${moveList}</div>`;
}
