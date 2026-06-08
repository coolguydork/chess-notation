import { Chessboard, COLOR, INPUT_EVENT_TYPE } from "cm-chessboard/src/Chessboard.js";
import type { CmMoveInputEvent } from "cm-chessboard/src/Chessboard.js";
import { Markers, MARKER_TYPE } from "cm-chessboard/src/extensions/markers/Markers.js";
import { Arrows, ARROW_TYPE } from "cm-chessboard/src/extensions/arrows/Arrows.js";
import { PromotionDialog, PROMOTION_DIALOG_RESULT_TYPE } from "cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js";
import { serializeFEN } from "../core/fen";
import { getSquareLegalMoves } from "../core/legal";
import { applyMoveEx } from "../core/moves";
import type { BoardState } from "../core/types";
import type { LegalMove } from "../core/legal";
import type { BoardConfig, EngineArrow } from "../render/config";
import type { InteractiveBoardHandle } from "./board-handle";

// ---------------------------------------------------------------------------
// Board rendering, animation, and interaction backed by cm-chessboard (MIT,
// SVG). Implements the existing InteractiveBoardHandle so PgnViewer is
// unchanged. The handle owns the wrapper as the single writer (Invariant A).
// ---------------------------------------------------------------------------

type LastMove = { from: number; to: number } | undefined;

// Our board index (0 = a8, 63 = h1) <-> algebraic square ("e4").
function toSquare(index: number): string {
  return String.fromCharCode(97 + (index % 8)) + (8 - Math.floor(index / 8));
}
function toIndex(square: string): number {
  return (8 - parseInt(square[1], 10)) * 8 + (square.charCodeAt(0) - 97);
}

// Engine-arrow ranks -> cm-chessboard's typed arrow classes (colour by rank).
const ENGINE_ARROWS = [ARROW_TYPE.default, ARROW_TYPE.info, ARROW_TYPE.warning, ARROW_TYPE.secondary];
const USER_ARROW = ARROW_TYPE.danger;
// Last move: a full-square tint (colored yellow in cm-theme.css) on from/to,
// matching the old board's highlight rather than cm-chessboard's black frame.
const LAST_MOVE_MARKER = MARKER_TYPE.square;

export function mountCmBoard(
  wrapper: HTMLElement,
  state: BoardState,
  config: BoardConfig,
  _turnEl: HTMLElement | undefined,
  onMove: (san: string, from: number, to: number, newState: BoardState) => void,
): InteractiveBoardHandle {
  wrapper.style.setProperty("--cb-light", config.colors.light);
  wrapper.style.setProperty("--cb-dark", config.colors.dark);
  wrapper.style.width = `${config.squareSize * 8}px`;
  wrapper.style.maxWidth = "100%";

  const asset = (rel: string): string =>
    config.resolveAssetUrl ? config.resolveAssetUrl(rel) : `./assets/${rel}`;

  const board = new Chessboard(wrapper, {
    position: serializeFEN(state),
    orientation: config.orientation === "white" ? COLOR.white : COLOR.black,
    assetsCache: true,
    style: {
      cssClass: "chess-notation",
      showCoordinates: config.showCoordinates,
      borderType: "none",
      pieces: { file: asset("pieces/standard.svg"), tileSize: 40 },
      animationDuration: 250,
    },
    extensions: [
      { class: Markers, props: { autoMarkers: null, sprite: asset("extensions/markers/markers.svg") } },
      { class: Arrows, props: { sprite: asset("extensions/arrows/arrows.svg") } },
      { class: PromotionDialog },
    ],
  });

  // committed = the viewer's real position; preview = a transient hover display.
  let committed: BoardState = state;
  let committedLm: LastMove = config.lastMove;
  let previewState: BoardState | null = null;
  let previewLm: LastMove = undefined;

  function setMarkers(lm: LastMove): void {
    board.removeMarkers(LAST_MOVE_MARKER);
    if (lm) {
      board.addMarker(LAST_MOVE_MARKER, toSquare(lm.from));
      board.addMarker(LAST_MOVE_MARKER, toSquare(lm.to));
    }
  }

  function syncOrientation(): void {
    const want = config.orientation === "white" ? COLOR.white : COLOR.black;
    if (board.getOrientation() !== want) board.setOrientation(want, false);
  }

  function show(s: BoardState, lm: LastMove, animated: boolean): void {
    syncOrientation();
    board.setPosition(serializeFEN(s), animated);
    setMarkers(lm);
  }

  // ----- interaction: click / drag to move (validated via chess.js) ---------

  function commit(m: LegalMove): void {
    const mr = applyMoveEx(committed, m.san);
    onMove(m.san, mr.from, mr.to, mr.state);
  }

  function inputHandler(event: CmMoveInputEvent): boolean {
    if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
      // Only allow picking up a piece that has a legal move (this also blocks
      // the side not to move, since it has none).
      return !!event.square && getSquareLegalMoves(committed, toIndex(event.square)).length > 0;
    }
    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      if (!event.squareFrom || !event.squareTo) return false;
      const from = toIndex(event.squareFrom);
      const to = toIndex(event.squareTo);
      const candidates = getSquareLegalMoves(committed, from).filter((m) => m.to === to);
      if (candidates.length === 0) return false;

      const promotions = candidates.filter((m) => m.promotion);
      if (promotions.length > 0) {
        const color = committed.activeColor === "w" ? COLOR.white : COLOR.black;
        board.showPromotionDialog(event.squareTo, color, (res) => {
          if (res.type === PROMOTION_DIALOG_RESULT_TYPE.pieceSelected && res.piece) {
            const type = res.piece.charAt(1); // "wq" -> "q"
            commit(promotions.find((m) => m.promotion === type) ?? promotions[0]);
          } else {
            board.setPosition(serializeFEN(committed), false); // canceled — revert
          }
        });
        return true; // let the pawn advance while the dialog is shown
      }

      // Defer the commit so cm-chessboard finishes its own visual move first;
      // commitMove -> setState then re-syncs to the same position (a no-op).
      const move = candidates[0];
      queueMicrotask(() => commit(move));
      return true;
    }
    return true;
  }

  // Enabled for both colours; validation restricts to the side to move.
  board.enableMoveInput(inputHandler);

  // ----- user-drawn arrows (right-drag); left-click clears them -------------

  const squareAt = (e: PointerEvent): string | null =>
    (e.target as HTMLElement | null)?.closest?.("[data-square]")?.getAttribute("data-square") ?? null;
  let arrowFrom: string | null = null;
  wrapper.addEventListener("contextmenu", (e) => e.preventDefault());
  wrapper.addEventListener("pointerdown", (e) => {
    if (e.button === 2) arrowFrom = squareAt(e);
    else if (e.button === 0) board.removeArrows(USER_ARROW);
  });
  wrapper.addEventListener("pointerup", (e) => {
    if (e.button === 2 && arrowFrom) {
      const to = squareAt(e);
      if (to && to !== arrowFrom) board.addArrow(USER_ARROW, arrowFrom, to);
      arrowFrom = null;
    }
  });

  setMarkers(committedLm); // initial highlight

  return {
    getState: () => committed,

    setState: (s, lm) => {
      committed = s;
      committedLm = lm;
      previewState = null;
      previewLm = undefined;
      board.removeArrows(); // navigation/move clears engine + user arrows
      show(s, lm, false);
    },

    animateTo: (s, from, to) => {
      committed = s;
      committedLm = { from, to };
      previewState = null;
      previewLm = undefined;
      board.removeArrows();
      show(s, { from, to }, true);
      return () => {};
    },

    animatedPreview: (s, from, to) => {
      previewState = s;
      previewLm = { from, to };
      show(s, { from, to }, true);
      return () => {};
    },

    preview: (s, lm) => {
      previewState = s;
      previewLm = lm;
      show(s, lm, false);
    },

    endPreview: () => {
      if (previewState === null) return;
      previewState = null;
      previewLm = undefined;
      show(committed, committedLm, false);
    },

    commitPreview: () => {
      if (previewState !== null) {
        committed = previewState;
        committedLm = previewLm;
      }
      previewState = null;
      previewLm = undefined;
      board.removeArrows();
    },

    setEngineArrows: (arrows: EngineArrow[]) => {
      // Replace engine arrows only; leave user-drawn arrows in place.
      for (const t of ENGINE_ARROWS) board.removeArrows(t);
      arrows.forEach((a, i) => board.addArrow(ENGINE_ARROWS[i] ?? ARROW_TYPE.secondary, toSquare(a.from), toSquare(a.to)));
    },
  };
}
