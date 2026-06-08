import { buildMoveListHtml } from "../render/controls";
import { findNodeById, attachMove, nodeToPath, pathToNode } from "../core/tree";
import { mountCmBoard } from "./cm-board";
import type { InteractiveBoardHandle } from "./board-handle";
import type { MoveNode, BoardState } from "../core/types";
import type { BoardConfig, EngineArrow } from "../render/config";
import type { PvMove } from "../core/engine";

export { nodeToPath, pathToNode };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PgnViewerState {
  root: MoveNode;
  current: MoveNode;
  result: string;
  engineArrows: EngineArrow[];
}

export type ChangeReason = "navigate" | "move" | "load-game" | "flip";

export interface ChangeEvent {
  current: MoveNode;
  root: MoveNode;
  reason: ChangeReason;
}

// ---------------------------------------------------------------------------
// PgnViewer class
// ---------------------------------------------------------------------------

export class PgnViewer {
  private state: PgnViewerState;
  private listeners: ((e: ChangeEvent) => void)[] = [];
  private boardWrapperEl!: HTMLElement;
  private navPrevEl!: HTMLButtonElement;
  private navNextEl!: HTMLButtonElement;
  private moveListEl!: HTMLElement;
  private turnIndicatorEl!: HTMLElement;
  private board!: InteractiveBoardHandle;
  private hoveredId: number | null = null;
  private cancelAnim: (() => void) | null = null;
  private cancelHoverAnim: (() => void) | null = null;

  constructor(
    private host: HTMLElement,
    root: MoveNode,
    private config: BoardConfig,
    current: MoveNode,
    result: string,
    private _boardFactory?: (
      wrapper: HTMLElement,
      state: BoardState,
      config: BoardConfig,
      turnEl: HTMLElement | undefined,
      onMove: (san: string, from: number, to: number, newState: BoardState) => void,
    ) => InteractiveBoardHandle,
  ) {
    this.state = { root, current, result, engineArrows: [] };
  }

  mount(): void {
    // Build stable DOM skeleton
    const viewerDiv = document.createElement("div");
    viewerDiv.className = "chess-viewer";
    this.host.appendChild(viewerDiv);

    this.boardWrapperEl = document.createElement("div");
    this.boardWrapperEl.className = "chess-board-wrapper";
    viewerDiv.appendChild(this.boardWrapperEl);

    const navEl = document.createElement("div");
    navEl.className = "chess-nav";
    viewerDiv.appendChild(navEl);

    this.navPrevEl = document.createElement("button");
    this.navPrevEl.textContent = "←";
    navEl.appendChild(this.navPrevEl);

    this.navNextEl = document.createElement("button");
    this.navNextEl.textContent = "→";
    navEl.appendChild(this.navNextEl);

    const navFlipEl = document.createElement("button");
    navFlipEl.textContent = "⇆";
    navFlipEl.title = "Flip board";
    navEl.appendChild(navFlipEl);
    navFlipEl.onclick = () => this.flipOrientation();

    this.turnIndicatorEl = document.createElement("div");
    this.turnIndicatorEl.className = "chess-turn-indicator";
    viewerDiv.appendChild(this.turnIndicatorEl);

    this.moveListEl = document.createElement("div");
    this.moveListEl.className = "chess-move-list-container";
    viewerDiv.appendChild(this.moveListEl);

    // Mount interactive board
    const factory = this._boardFactory ?? mountCmBoard;
    this.board = factory(
      this.boardWrapperEl,
      this.state.current.state,
      this.config,
      undefined,
      (san, from, to, newState) => this.commitMove(san, from, to, newState),
    );

    // Nav button listeners
    this.navPrevEl.onclick = () => this.goPrev();
    this.navNextEl.onclick = () => this.goNext();

    // Move list: click delegation
    this.moveListEl.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const nodeId = t.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (nodeId) {
        const n = findNodeById(this.state.root, Number(nodeId));
        if (n) this.goTo(n);
      }
    });

    // Hover preview — animate the piece to the hovered position
    this.moveListEl.addEventListener("pointerover", (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (!id) return;
      const n = Number(id);
      if (n === this.hoveredId) return;
      // Hovering back over the committed node — revert
      if (n === this.state.current.id) {
        this.clearHover();
        return;
      }
      this.hoveredId = n;
      this.cancelHoverAnim?.();
      this.cancelHoverAnim = null;
      const node = findNodeById(this.state.root, n);
      if (!node) return;
      if (node.from >= 0) {
        this.cancelHoverAnim = this.board.animatedPreview(node.state, node.from, node.to);
      } else {
        this.board.preview(node.state);
      }
    });

    this.moveListEl.addEventListener("pointerleave", () => {
      this.clearHover();
    });

    // Initial render
    this.render();
  }

  destroy(): void {
    this.cancelAnim?.();
    this.cancelAnim = null;
    this.cancelHoverAnim?.();
    this.cancelHoverAnim = null;
    this.listeners = [];
  }

  private clearHover(): void {
    if (this.hoveredId === null) return;
    this.hoveredId = null;
    this.cancelHoverAnim?.();
    this.cancelHoverAnim = null;
    this.board.endPreview();
  }

  onChange(fn: (e: ChangeEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(reason: ChangeReason): void {
    const e: ChangeEvent = { current: this.state.current, root: this.state.root, reason };
    for (const fn of this.listeners) fn(e);
  }

  private render(): void {
    this.navPrevEl.disabled = !this.state.current.parent;
    this.navNextEl.disabled = !this.state.current.next;
    const color = this.state.current.state.activeColor;
    this.turnIndicatorEl.className = `chess-turn-indicator chess-turn-indicator--${color}`;
    this.turnIndicatorEl.textContent = color === "w" ? "White to move" : "Black to move";
    this.moveListEl.innerHTML = buildMoveListHtml(this.state.root, this.state.current.id, this.state.result);
    this.scrollActiveMoveIntoView();
  }

  private scrollActiveMoveIntoView(): void {
    this.moveListEl.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }

  goTo(node: MoveNode): void {
    const cur = this.state.current;
    // Clicking the hovered node: commit the preview seamlessly, no re-animation
    if (node.id === this.hoveredId) {
      this.hoveredId = null;
      this.cancelHoverAnim = null; // let in-flight animation finish naturally
      this.board.commitPreview();
      this.state = { ...this.state, current: node, engineArrows: [] };
      this.render();
      this.emit("navigate");
      return;
    }
    // Clear any hover state before navigating
    this.clearHover();
    // Animate adjacent; instant for long jumps
    if (node === cur.next && node.from >= 0) {
      this.cancelAnim = this.board.animateTo(node.state, node.from, node.to, this.config, this.cancelAnim);
    } else if (node === cur.parent && cur.from >= 0) {
      this.cancelAnim = this.board.animateTo(node.state, cur.to, cur.from, this.config, this.cancelAnim);
    } else {
      this.cancelAnim?.();
      this.cancelAnim = null;
      const lm = node.from >= 0 ? { from: node.from, to: node.to } : undefined;
      this.board.setState(node.state, lm);
    }
    this.state = { ...this.state, current: node, engineArrows: [] };
    this.render();
    this.emit("navigate");
  }

  goNext(): void {
    const n = this.state.current.next;
    if (!n) return;
    this.clearHover();
    this.cancelAnim = this.board.animateTo(n.state, n.from, n.to, this.config, this.cancelAnim);
    this.state = { ...this.state, current: n, engineArrows: [] };
    this.render();
    this.emit("navigate");
  }

  goPrev(): void {
    const p = this.state.current.parent;
    if (!p) return;
    const c = this.state.current;
    this.clearHover();
    if (c.from >= 0) {
      this.cancelAnim = this.board.animateTo(p.state, c.to, c.from, this.config, this.cancelAnim);
    } else {
      this.board.setState(p.state);
    }
    this.state = { ...this.state, current: p, engineArrows: [] };
    this.render();
    this.emit("navigate");
  }

  flipOrientation(): void {
    this.config.orientation = this.config.orientation === "white" ? "black" : "white";
    this.clearHover();
    const cur = this.state.current;
    const lm = cur.from >= 0 ? { from: cur.from, to: cur.to } : undefined;
    this.board.setState(cur.state, lm);
    this.emit("flip");
  }

  getOrientation(): "white" | "black" {
    return this.config.orientation;
  }

  commitMove(san: string, from: number, to: number, newState: BoardState): void {
    const newNode = attachMove(this.state.current, san, newState, from, to);
    const lm = { from, to };
    this.board.setState(newState, lm);
    this.state = { ...this.state, current: newNode, engineArrows: [] };
    this.render();
    this.emit("move");
  }

  setEngineArrows(arrows: EngineArrow[]): void {
    this.state = { ...this.state, engineArrows: arrows };
    this.board.setEngineArrows(arrows);
  }

  previewEngineMove(state: BoardState, from: number, to: number): void {
    this.cancelHoverAnim?.();
    this.cancelHoverAnim = this.board.animatedPreview(state, from, to);
  }

  endEnginePreview(): void {
    this.cancelHoverAnim?.();
    this.cancelHoverAnim = null;
    this.board.endPreview();
  }

  loadGame(root: MoveNode, result: string): void {
    this.board.endPreview();
    this.cancelAnim?.();
    this.cancelAnim = null;
    this.state = { root, current: root, result, engineArrows: [] };
    this.board.setState(root.state);
    this.render();
    this.emit("load-game");
  }

  getCurrentState(): BoardState {
    return this.state.current.state;
  }

  getCurrentNode(): MoveNode {
    return this.state.current;
  }

  /** Graft a decoded engine PV line as variations starting from `fromNode`, navigate to the last grafted node. */
  graftLine(fromNode: MoveNode, pvMoves: PvMove[]): void {
    let node = fromNode;
    for (const m of pvMoves) {
      node = attachMove(node, m.san, m.state, m.from, m.to);
    }
    this.goTo(node);
    this.emit("move");
  }
}
