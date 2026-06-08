import { Chessboard, COLOR } from "cm-chessboard/src/Chessboard.js";
import { Markers, MARKER_TYPE } from "cm-chessboard/src/extensions/markers/Markers.js";
import { Arrows, ARROW_TYPE } from "cm-chessboard/src/extensions/arrows/Arrows.js";
import { serializeFEN } from "../core/fen";
import type { BoardState } from "../core/types";
import type { BoardConfig, EngineArrow } from "../render/config";
import type { InteractiveBoardHandle } from "./interactive-board";

// ---------------------------------------------------------------------------
// Board rendering + animation backed by cm-chessboard (MIT, SVG). Implements
// the existing InteractiveBoardHandle so PgnViewer is unchanged. This sub-step
// (3b) covers render + navigation; move input / promotion / user arrows land in
// 3c. The handle owns the wrapper as the single writer (Invariant A).
// ---------------------------------------------------------------------------

type LastMove = { from: number; to: number } | undefined;

// Our board index (0 = a8, 63 = h1) → algebraic square ("e4").
function sq(index: number): string {
  return String.fromCharCode(97 + (index % 8)) + (8 - Math.floor(index / 8));
}

// Engine-arrow ranks → cm-chessboard's typed arrow classes (colour by rank).
const ARROW_BY_RANK = [ARROW_TYPE.default, ARROW_TYPE.info, ARROW_TYPE.warning, ARROW_TYPE.secondary];

export function mountCmBoard(
  wrapper: HTMLElement,
  state: BoardState,
  config: BoardConfig,
  _turnEl: HTMLElement | undefined,
  _onMove: (san: string, from: number, to: number, newState: BoardState) => void,
): InteractiveBoardHandle {
  // Theme colours (square fills read these in styles.css) and sizing.
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
    ],
  });

  // committed = the viewer's real position; preview = a transient hover display
  // that endPreview() reverts to the committed one.
  let committed: BoardState = state;
  let committedLm: LastMove = config.lastMove;
  let previewState: BoardState | null = null;
  let previewLm: LastMove = undefined;

  function setMarkers(lm: LastMove): void {
    board.removeMarkers(MARKER_TYPE.frame);
    if (lm) {
      board.addMarker(MARKER_TYPE.frame, sq(lm.from));
      board.addMarker(MARKER_TYPE.frame, sq(lm.to));
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

  setMarkers(committedLm); // initial highlight

  return {
    getState: () => committed,

    setState: (s, lm) => {
      committed = s;
      committedLm = lm;
      previewState = null;
      previewLm = undefined;
      show(s, lm, false);
    },

    animateTo: (s, from, to) => {
      committed = s;
      committedLm = { from, to };
      previewState = null;
      previewLm = undefined;
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
    },

    setEngineArrows: (arrows: EngineArrow[]) => {
      board.removeArrows();
      arrows.forEach((a, i) => {
        board.addArrow(ARROW_BY_RANK[i] ?? ARROW_TYPE.secondary, sq(a.from), sq(a.to));
      });
    },
  };
}
