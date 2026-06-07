import { getSquareLegalMoves } from "../core/legal";
import { applyMove, applyMoveEx } from "../core/moves";
import type { BoardState } from "../core/types";
import { renderBoard } from "../render/board";
import type { BoardConfig, UserArrow, EngineArrow } from "../render/config";
import { animatePieceOverlay } from "./animation";

export const USER_ARROW_COLOR = "rgba(220,80,20,0.82)";

export interface InteractiveBoardHandle {
  getState: () => BoardState;
  setState: (s: BoardState, lastMove?: { from: number; to: number }) => void;
  setEngineArrows(arrows: EngineArrow[]): void;
  animateTo(s: BoardState, from: number, to: number, config: BoardConfig, cancelPrev: (() => void) | null): () => void;
  /** Animate to a transient hover position without changing committed state. Returns cancel fn. */
  animatedPreview(s: BoardState, from: number, to: number): () => void;
  /** Commit the current preview as the new board state (called on click-while-hovering). */
  commitPreview(): void;
  preview(s: BoardState, lastMove?: { from: number; to: number }): void;
  endPreview(): void;
}

export function squareFromEvent(
  e: MouseEvent | PointerEvent,
  squareSize: number,
  orientation: "white" | "black"
): number | null {
  const svg = (e.currentTarget as HTMLElement).querySelector("svg.chess-board-svg");
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const scale = rect.width / (squareSize * 8);
  const col = Math.floor(x / (squareSize * scale));
  const row = Math.floor(y / (squareSize * scale));
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const file = orientation === "white" ? col : 7 - col;
  const rank = orientation === "white" ? 7 - row : row;
  return (7 - rank) * 8 + file;
}

export function mountInteractiveBoard(
  wrapper: HTMLElement,
  initialState: BoardState,
  baseConfig: BoardConfig,
  turnIndicator?: HTMLElement,
  onMove?: (san: string, from: number, to: number, newState: BoardState) => void,
): InteractiveBoardHandle {
  let state = initialState;
  let lastMove: { from: number; to: number } | undefined;
  let selected: number | null = null;
  let legalTargets = new Set<number>();
  let userArrows: UserArrow[] = [];
  let engineArrows: EngineArrow[] = [];
  let rightDragStart: number | null = null;
  // Tracks preview (hover) mode. committed = what to restore on endPreview;
  // preview = what the board is currently showing transiently.
  let previewState: {
    committed: { state: BoardState; lastMove?: { from: number; to: number } };
    preview:   { state: BoardState; lastMove?: { from: number; to: number } };
  } | null = null;

  // Drag state
  let dragSource: number | null = null;
  let dragGhost: HTMLImageElement | null = null;
  let dragMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;

  function updateTurnIndicator(): void {
    if (!turnIndicator) return;
    const color = state.activeColor;
    turnIndicator.className = `chess-turn-indicator chess-turn-indicator--${color}`;
    turnIndicator.setText(color === "w" ? "White to move" : "Black to move");
  }

  function render(): void {
    const config: BoardConfig = {
      ...baseConfig,
      lastMove,
      selectedSquare: selected ?? undefined,
      legalTargets: legalTargets.size > 0 ? legalTargets : undefined,
      userArrows: userArrows.length > 0 ? userArrows : undefined,
      engineArrows: engineArrows.length > 0 ? engineArrows : undefined,
    };
    wrapper.innerHTML = renderBoard(state, config);
    updateTurnIndicator();
  }

  function removeGhost(): void {
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }
  }

  // Show a floating comment input near the midpoint of the most-recently drawn arrow.
  // Resolves with the entered label (empty string = no label) or null if cancelled.
  function promptArrowLabel(fromIdx: number, toIdx: number): Promise<string | null> {
    return new Promise((resolve) => {
      const svg = wrapper.querySelector("svg.chess-board-svg");
      if (!svg) { resolve(null); return; }
      const rect = svg.getBoundingClientRect();
      const sq = baseConfig.squareSize;
      const scale = rect.width / (sq * 8);

      function idxToXY(idx: number): { x: number; y: number } {
        const rank = 7 - Math.floor(idx / 8);
        const file = idx % 8;
        const col = baseConfig.orientation === "white" ? file : 7 - file;
        const row = baseConfig.orientation === "white" ? 7 - rank : rank;
        return {
          x: rect.left + (col * sq + sq / 2) * scale,
          y: rect.top  + (row * sq + sq / 2) * scale,
        };
      }

      const p1 = idxToXY(fromIdx);
      const p2 = idxToXY(toIdx);
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;

      const overlay = document.createElement("div");
      overlay.className = "chess-arrow-comment-overlay";
      overlay.style.cssText = `position:fixed;left:${mx}px;top:${my}px;transform:translate(-50%,-50%);
        background:#1e1e2e;border:1px solid rgba(220,80,20,0.7);border-radius:6px;
        padding:6px 8px;display:flex;gap:6px;align-items:center;z-index:9999;box-shadow:0 2px 12px rgba(0,0,0,0.5);`;

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Add comment… (Enter to save, Esc to skip)";
      input.style.cssText = `background:transparent;border:none;outline:none;color:#cdd6f4;
        font-size:13px;width:240px;`;

      const save = document.createElement("button");
      save.textContent = "✓";
      save.style.cssText = `background:rgba(220,80,20,0.8);border:none;border-radius:4px;
        color:#fff;padding:2px 7px;cursor:pointer;font-size:13px;`;

      overlay.appendChild(input);
      overlay.appendChild(save);
      document.body.appendChild(overlay);
      input.focus();

      function done(label: string | null) {
        overlay.remove();
        resolve(label);
      }

      input.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); done(input.value.trim() || null); }
        if (e.key === "Escape") { e.preventDefault(); done(null); }
      });
      save.addEventListener("click", () => done(input.value.trim() || null));

      // Click outside to dismiss without a label
      setTimeout(() => {
        function outside(e: MouseEvent) {
          if (!overlay.contains(e.target as Node)) {
            document.removeEventListener("mousedown", outside);
            done(null);
          }
        }
        document.addEventListener("mousedown", outside);
      }, 0);
    });
  }

  // Left pointer down — begin drag if clicking a friendly piece
  wrapper.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    const idx = squareFromEvent(e, baseConfig.squareSize, baseConfig.orientation);
    if (idx === null) return;
    const piece = state.board[idx];
    if (!piece || piece.color !== state.activeColor) return;

    dragSource = idx;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    // Show legal move dots immediately
    selected = idx;
    legalTargets = new Set(getSquareLegalMoves(state, idx).map(m => m.to));
    render();

    // Create ghost image
    const svg = wrapper.querySelector("svg.chess-board-svg");
    const rect = svg ? svg.getBoundingClientRect() : wrapper.getBoundingClientRect();
    const scale = rect.width / (baseConfig.squareSize * 8);
    const ghostSize = Math.round(baseConfig.squareSize * scale);

    const ghost = document.createElement("img");
    ghost.src = baseConfig.resolvePieceUrl(piece);
    ghost.style.cssText = `position:fixed;width:${ghostSize}px;height:${ghostSize}px;` +
      `pointer-events:none;z-index:10000;opacity:0.85;` +
      `left:${e.clientX - ghostSize / 2}px;top:${e.clientY - ghostSize / 2}px;`;
    document.body.appendChild(ghost);
    dragGhost = ghost;

    wrapper.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  // Pointer move — update ghost position
  wrapper.addEventListener("pointermove", (e: PointerEvent) => {
    if (dragSource === null || !dragGhost) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (!dragMoved && Math.sqrt(dx * dx + dy * dy) > 4) dragMoved = true;
    const ghostSize = parseInt(dragGhost.style.width, 10);
    dragGhost.style.left = `${e.clientX - ghostSize / 2}px`;
    dragGhost.style.top  = `${e.clientY - ghostSize / 2}px`;
  });

  // Left-click / drag-drop move handling
  wrapper.addEventListener("pointerup", (e: PointerEvent) => {
    if (e.button !== 0) return;
    const idx = squareFromEvent(e, baseConfig.squareSize, baseConfig.orientation);

    if (dragSource !== null) {
      removeGhost();
      const src = dragSource;
      dragSource = null;

      if (dragMoved) {
        // Drag release — attempt move to destination
        if (idx !== null && legalTargets.has(idx)) {
          const moves = getSquareLegalMoves(state, src);
          const move =
            moves.find(m => m.to === idx && m.promotion !== "n" && m.promotion !== "b" && m.promotion !== "r") ??
            moves.find(m => m.to === idx);
          if (move) {
            selected = null;
            legalTargets = new Set();
            if (onMove) {
              const result = applyMoveEx(state, move.san);
              onMove(move.san, move.from, move.to, result.state);
              return;
            }
            state = applyMove(state, move.san);
          }
        }
        selected = null;
        legalTargets = new Set();
        render();
        return;
      }

      // Tiny movement — treat as a click; legal dots already showing, wait for next click
      // (fall through: state already rendered with selection on pointerdown)
      return;
    }

    // No drag in progress — handle second click of click-to-move
    if (idx === null) return;
    if (selected !== null && legalTargets.has(idx)) {
      const moves = getSquareLegalMoves(state, selected);
      const move =
        moves.find(m => m.to === idx && m.promotion !== "n" && m.promotion !== "b" && m.promotion !== "r") ??
        moves.find(m => m.to === idx);
      if (move) {
        selected = null;
        legalTargets = new Set();
        if (onMove) {
          const result = applyMoveEx(state, move.san);
          onMove(move.san, move.from, move.to, result.state);
          return;
        }
        state = applyMove(state, move.san);
      } else {
        selected = null;
        legalTargets = new Set();
      }
    } else {
      const piece = state.board[idx];
      if (piece && piece.color === state.activeColor) {
        selected = idx;
        legalTargets = new Set(getSquareLegalMoves(state, idx).map(m => m.to));
      } else {
        selected = null;
        legalTargets = new Set();
      }
    }
    render();
  });

  // Right-drag arrow drawing
  wrapper.addEventListener("pointerdown", (e) => {
    if (e.button !== 2) return;
    rightDragStart = squareFromEvent(e, baseConfig.squareSize, baseConfig.orientation);
  });

  wrapper.addEventListener("pointerup", async (e) => {
    if (e.button !== 2) return;
    const end = squareFromEvent(e, baseConfig.squareSize, baseConfig.orientation);
    const start = rightDragStart;
    rightDragStart = null;
    if (start === null || end === null) return;

    if (start === end) {
      // Same square: remove any arrows originating from this square
      userArrows = userArrows.filter(a => a.from !== start);
      render();
      return;
    }

    // Toggle: if this exact arrow already exists, remove it; otherwise add it
    const existing = userArrows.findIndex(a => a.from === start && a.to === end);
    if (existing !== -1) {
      userArrows.splice(existing, 1);
      render();
      return;
    }

    // Draw the arrow first, then ask for an optional comment
    userArrows.push({ from: start, to: end, color: USER_ARROW_COLOR });
    render();

    const label = await promptArrowLabel(start, end);
    if (label) {
      userArrows[userArrows.length - 1].label = label;
      render();
    }
  });

  wrapper.addEventListener("contextmenu", (e) => e.preventDefault());

  render();
  return {
    getState: () => state,
    setState: (s: BoardState, lm?: { from: number; to: number }) => {
      state = s;
      lastMove = lm;
      selected = null;
      legalTargets = new Set();
      engineArrows = [];
      previewState = null;
      render();
    },
    setEngineArrows(arrows: EngineArrow[]): void {
      engineArrows = arrows;
      render();
    },
    animateTo(s: BoardState, from: number, to: number, config: BoardConfig, cancelPrev: (() => void) | null): () => void {
      cancelPrev?.();
      // Render destination state with animated move hidden
      const lm = { from, to };
      const renderConfig: BoardConfig = { ...config, lastMove: lm, animatedMove: lm, engineArrows: engineArrows.length > 0 ? engineArrows : undefined };
      wrapper.innerHTML = renderBoard(s, renderConfig);
      // Find the piece that moved
      const piece = s.board[to];
      let cancel: () => void = () => {};
      if (piece) {
        cancel = animatePieceOverlay(wrapper, { from, to }, config, config.resolvePieceUrl(piece), () => {
          state = s;
          lastMove = lm;
          selected = null;
          legalTargets = new Set();
          render();
        });
      } else {
        state = s;
        lastMove = lm;
        selected = null;
        legalTargets = new Set();
        render();
      }
      return cancel;
    },
    animatedPreview(s: BoardState, from: number, to: number): () => void {
      const lm = { from, to };
      // Save committed state the first time we enter preview mode
      if (!previewState) {
        previewState = { committed: { state, lastMove }, preview: { state: s, lastMove: lm } };
      } else {
        previewState.preview = { state: s, lastMove: lm };
      }
      // Render destination with the animated piece hidden, then slide it in
      const renderConfig: BoardConfig = { ...baseConfig, lastMove: lm, animatedMove: lm };
      wrapper.innerHTML = renderBoard(s, renderConfig);
      const piece = s.board[to];
      if (!piece) {
        wrapper.innerHTML = renderBoard(s, { ...baseConfig, lastMove: lm });
        return () => {};
      }
      return animatePieceOverlay(wrapper, { from, to }, baseConfig, baseConfig.resolvePieceUrl(piece), () => {
        // Animation done — show the position fully (still in preview mode)
        wrapper.innerHTML = renderBoard(s, { ...baseConfig, lastMove: lm });
      });
    },
    commitPreview(): void {
      // Accept the preview as the new committed state without re-rendering
      if (!previewState) return;
      const prev = previewState.preview;
      previewState = null;
      state = prev.state;
      lastMove = prev.lastMove;
      selected = null;
      legalTargets = new Set();
      // Board already shows the preview state visually — no render() needed
    },
    preview(s: BoardState, lm?: { from: number; to: number }): void {
      if (!previewState) {
        previewState = { committed: { state, lastMove }, preview: { state: s, lastMove: lm } };
      } else {
        previewState.preview = { state: s, lastMove: lm };
      }
      wrapper.innerHTML = renderBoard(s, { ...baseConfig, lastMove: lm });
    },
    endPreview(): void {
      if (!previewState) return;
      const saved = previewState.committed;
      previewState = null;
      state = saved.state;
      lastMove = saved.lastMove;
      selected = null;
      legalTargets = new Set();
      render();
    },
  };
}
