import { buildMoveListEl, buildHeaderEl } from "../render/controls";
import { findNodeById, findCommentById, nodeToPath, pathToNode } from "../core/tree";
import {
  addMoveAt, removeAt, projectGame, promoteVariation, setNags,
  adjacentComment, setAdjacentComment, updateComment,
} from "../core/game";
import type { GameEditor } from "../core/game";
import { cleanComment } from "../core/pgn";
import { mountCmBoard } from "./cm-board";
import type { InteractiveBoardHandle } from "./board-handle";
import type { MoveNode, BoardState } from "../core/types";
import type { PgnComment } from "../pgn-editor";
import type { BoardConfig, EngineArrow } from "../render/config";
import type { PvMove } from "../core/engine";

export { nodeToPath, pathToNode };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PgnViewerState {
  root: MoveNode;
  current: MoveNode;
  // The selected element when it is a comment rather than `current`. Exactly
  // one element highlights at a time: this comment when set, else the current
  // move. Cleared by every other navigation/edit transition.
  selectedCommentId: number | null;
  result: string;
  headers: Record<string, string>;
  engineArrows: EngineArrow[];
}

export type ChangeReason = "navigate" | "move" | "load-game" | "flip";

// What a comment context-menu action operates on. Comments have no owning
// move: the target is the comment item itself (addressed by identity), with
// `anchor` only naming the board position it sits at and `text` the display
// text for seeding the modal.
export interface CommentTarget {
  comment: PgnComment;
  text: string;
  anchor: MoveNode;
}

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
  // "Collapse/expand all variations" toggle (added by mount). Tests mount a bare
  // skeleton without it, so it is nullable and every use is guarded.
  private navVarsEl: HTMLButtonElement | null = null;
  private moveListEl!: HTMLElement;
  private headersEl!: HTMLElement;
  private turnIndicatorEl!: HTMLElement;
  private board!: InteractiveBoardHandle;
  private hoveredId: number | null = null;
  // Whether every variation card is currently collapsed. Held on the viewer (not
  // the DOM) so the choice survives the full move-list rebuild that each
  // navigation/edit triggers.
  private variationsCollapsed = false;
  // Per-card manual open/close overrides, keyed by the variation head's node id,
  // recording deviations from the global default. This is what lets a card the
  // user opened inside a collapsed view stay open as they click through its
  // moves (each click rebuilds the list). Cleared by collapse/expand-all.
  private variationOverrides = new Map<number, boolean>();
  // The open state we last applied to each card programmatically, so the toggle
  // listener can tell a genuine user click apart from our own re-application.
  private variationApplied = new Map<number, boolean>();
  private cancelAnim: (() => void) | null = null;
  private cancelHoverAnim: (() => void) | null = null;
  // --- Move-list height management (auto-fit short games + drag-to-resize persist) ---
  // All of this is inert until mount() enables it (tests skip mount()), and a no-op
  // where ResizeObserver is unavailable.
  private moveListResizeObserver: ResizeObserver | null = null;
  private heightMgmtEnabled = false;
  private preferredMoveListHeight: number | null = null; // user/persisted cap (px), null = auto
  private defaultMoveListHeight = 0;                       // CSS default height, captured at mount
  private minMoveListHeight = 0;
  private maxMoveListHeight = Number.POSITIVE_INFINITY;
  private lastMoveListHeight: number | null = null;       // height we last applied, to spot user drags
  private onMoveListResizeCb: ((px: number) => void) | null = null;
  private moveListResizeTimer: number | null = null;
  // Plugin-supplied handler that raises the move context menu (Obsidian Menu lives
  // in plugin/; the viewer only detects the trigger and owns the edit ops).
  private moveMenuHandler: ((node: MoveNode, isVariationHead: boolean, evt: MouseEvent) => void) | null = null;
  // Plugin-supplied handler that raises the per-comment context menu (edit / delete).
  private commentMenuHandler: ((target: CommentTarget, evt: MouseEvent) => void) | null = null;

  constructor(
    private host: HTMLElement,
    root: MoveNode,
    private config: BoardConfig,
    current: MoveNode,
    result: string,
    // PGN header tags for the game-info strip ({} for FEN-only blocks).
    headers: Record<string, string> = {},
    // The editable game. When present, board moves and engine grafts are routed
    // through the AST editor; when absent the viewer is read-only (multi-game blocks).
    private editor?: GameEditor,
    private _boardFactory?: (
      wrapper: HTMLElement,
      state: BoardState,
      config: BoardConfig,
      turnEl: HTMLElement | undefined,
      onMove: (san: string, from: number, to: number, newState: BoardState) => void,
    ) => InteractiveBoardHandle,
  ) {
    this.state = { root, current, selectedCommentId: null, result, headers, engineArrows: [] };
  }

  mount(): void {
    // Build stable DOM skeleton
    const viewerDiv = document.createElement("div");
    viewerDiv.className = "chess-viewer";
    // Focusable so ←/→ can step through moves once the board is clicked/tabbed
    // to. Scoping to this element (not document) keeps multiple blocks on a page
    // from all reacting to one keypress.
    viewerDiv.tabIndex = 0;
    this.host.appendChild(viewerDiv);

    // Game-info header strip (above the board; empty when there are no headers).
    this.headersEl = document.createElement("div");
    this.headersEl.className = "chess-headers-container";
    viewerDiv.appendChild(this.headersEl);

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

    // Collapse/expand every variation card at once. Hidden by applyVariationCollapse()
    // whenever the current game has no variations.
    const navVarsEl = document.createElement("button");
    navVarsEl.className = "chess-nav-vars";
    navVarsEl.textContent = "⊟";
    navVarsEl.title = "Collapse all variations";
    navEl.appendChild(navVarsEl);
    navVarsEl.onclick = () => this.toggleAllVariations();
    this.navVarsEl = navVarsEl;

    this.turnIndicatorEl = document.createElement("div");
    this.turnIndicatorEl.className = "chess-turn-indicator";
    viewerDiv.appendChild(this.turnIndicatorEl);

    this.moveListEl = document.createElement("div");
    this.moveListEl.className = "chess-move-list-container";
    viewerDiv.appendChild(this.moveListEl);
    this.setupMoveListHeight();

    // Mount interactive board (read-only when there is no editor)
    this.config.interactive = this.editor !== undefined;
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

    // Keyboard navigation: ←/→ step through the current line. keydown bubbles
    // here from whatever child holds focus (board, move list, a button).
    viewerDiv.addEventListener("keydown", (e) => {
      if (this.handleNavKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // Move list: click delegation
    this.moveListEl.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const deleteId = t.closest<HTMLElement>("[data-delete-id]")?.dataset.deleteId;
      if (deleteId) {
        const n = findNodeById(this.state.root, Number(deleteId));
        if (n) this.deleteMove(n);
        return;
      }
      const commentDel = t.closest<HTMLElement>("[data-comment-delete-id]");
      if (commentDel) {
        const found = findCommentById(this.state.root, Number(commentDel.dataset.commentDeleteId));
        if (found) this.updateCommentOn(found.comment.source, "");
        return;
      }
      // A comment sits at a board position — clicking it navigates there and
      // selects the comment itself, not the move at that position (the × above
      // is handled first, so it still deletes).
      const commentId = t.closest<HTMLElement>("[data-comment-id]")?.dataset.commentId;
      if (commentId) {
        const found = findCommentById(this.state.root, Number(commentId));
        if (found) this.goTo(found.anchor, found.comment.id);
        return;
      }
      const nodeId = t.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (nodeId) {
        const n = findNodeById(this.state.root, Number(nodeId));
        if (n) this.goTo(n);
      }
    });

    // Move list: context menu (right-click / long-press) for editing a move.
    // Delegated on the stable container so it survives move-list re-renders.
    this.moveListEl.addEventListener("contextmenu", (e) => {
      if (!this.editor) return;
      const target = e.target as HTMLElement;

      // Comment menu (edit / delete) takes precedence. Comment spans aren't
      // nested inside move spans, so the two data attributes never collide.
      const commentEl = target.closest<HTMLElement>("[data-comment-id]");
      if (commentEl && this.commentMenuHandler) {
        const found = findCommentById(this.state.root, Number(commentEl.dataset.commentId));
        if (found) {
          e.preventDefault();
          this.commentMenuHandler(
            { comment: found.comment.source, text: found.comment.text, anchor: found.anchor },
            e,
          );
          return;
        }
      }

      if (!this.moveMenuHandler) return;
      const id = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (!id) return;
      const node = findNodeById(this.state.root, Number(id));
      if (!node) return;
      e.preventDefault();
      this.moveMenuHandler(node, this.isVariationHead(node), e);
    });

    // Hover preview — animate the piece to the hovered position. Mouse only:
    // a touch tap fires pointerover immediately before click, so on mobile the
    // preview would animate the move and the click would then play it again —
    // the move renders twice. Touch has no real hover, so skip entirely.
    this.moveListEl.addEventListener("pointerover", (e) => {
      if (e.pointerType !== "mouse") return;
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

    // Variation cards are native <details>. A user clicking a summary toggles
    // one card; record that as an override so the next render keeps it. The
    // toggle event doesn't bubble, so listen in the capture phase. We ignore the
    // toggles our own applyVariationCollapse() causes by comparing against the
    // state we last set.
    this.moveListEl.addEventListener("toggle", (e) => {
      const d = e.target as HTMLElement;
      if (!(d instanceof HTMLDetailsElement) || !d.classList.contains("chess-variation")) return;
      const key = d.dataset.variationHead;
      if (key === undefined) return;
      const id = Number(key);
      // Our own re-application sets `variationApplied` to match — skip those.
      if (this.variationApplied.get(id) === d.open) return;
      const def = !this.variationsCollapsed;
      if (d.open === def) this.variationOverrides.delete(id);
      else this.variationOverrides.set(id, d.open);
      this.variationApplied.set(id, d.open);
    }, true);

    // Initial render
    this.render();
  }

  destroy(): void {
    this.cancelAnim?.();
    this.cancelAnim = null;
    this.cancelHoverAnim?.();
    this.cancelHoverAnim = null;
    this.moveListResizeObserver?.disconnect();
    this.moveListResizeObserver = null;
    if (this.moveListResizeTimer !== null) {
      window.clearTimeout(this.moveListResizeTimer);
      this.moveListResizeTimer = null;
    }
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

  // Register the handler that raises the per-move context menu (plugin-supplied).
  setMoveMenuHandler(fn: (node: MoveNode, isVariationHead: boolean, evt: MouseEvent) => void): void {
    this.moveMenuHandler = fn;
  }

  // Register the handler that raises the per-comment context menu (plugin-supplied).
  setCommentMenuHandler(fn: (target: CommentTarget, evt: MouseEvent) => void): void {
    this.commentMenuHandler = fn;
  }

  // A node is a variation head iff it isn't its parent's mainline continuation.
  private isVariationHead(node: MoveNode): boolean {
    return node.parent !== null && node.parent.next !== node;
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
    const headerEl = buildHeaderEl(this.state.headers);
    this.headersEl.replaceChildren(...(headerEl ? [headerEl] : []));
    const listEl = buildMoveListEl(this.state.root, this.state.current.id, this.state.result, this.editor !== undefined, this.state.selectedCommentId);
    this.moveListEl.replaceChildren(...(listEl ? [listEl] : []));
    // Re-apply the global collapse state to the freshly-built cards before we
    // measure height, so a collapsed view stays collapsed across navigation.
    this.applyVariationCollapse();
    this.fitMoveListHeight();
    this.scrollActiveMoveIntoView();
  }

  private scrollActiveMoveIntoView(): void {
    this.moveListEl.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }

  // ---------------------------------------------------------------------------
  // Variation collapse: one toggle folds/unfolds every variation card. The
  // state lives on the viewer and is re-applied after each render (the move list
  // is rebuilt on every navigation), so the choice persists as you move around.
  // ---------------------------------------------------------------------------

  private toggleAllVariations(): void {
    this.variationsCollapsed = !this.variationsCollapsed;
    // Collapse-all / expand-all is a clean reset: drop any per-card overrides so
    // every card follows the new global default.
    this.variationOverrides.clear();
    this.applyVariationCollapse();
  }

  private applyVariationCollapse(): void {
    const vars = this.moveListEl.querySelectorAll<HTMLDetailsElement>("details.chess-variation");
    const def = !this.variationsCollapsed;
    // Rebuilt DOM: forget last-applied state for cards that no longer exist.
    this.variationApplied.clear();
    for (const v of vars) {
      const key = v.dataset.variationHead;
      const id = key !== undefined ? Number(key) : null;
      const override = id !== null ? this.variationOverrides.get(id) : undefined;
      const open = override !== undefined ? override : def;
      v.open = open;
      if (id !== null) this.variationApplied.set(id, open);
    }
    if (!this.navVarsEl) return; // bare test skeleton has no nav control
    this.navVarsEl.style.display = vars.length === 0 ? "none" : "";
    this.navVarsEl.textContent = this.variationsCollapsed ? "⊞" : "⊟";
    this.navVarsEl.title = this.variationsCollapsed ? "Expand all variations" : "Collapse all variations";
  }

  // ---------------------------------------------------------------------------
  // Move-list height: auto-fit short games, let the user drag to resize, and
  // remember the dragged height (the plugin persists it globally).
  // ---------------------------------------------------------------------------

  // Seed the preferred (persisted) height before mount, or update it later.
  // null restores the auto/default behaviour. Re-fits immediately when mounted.
  setMoveListHeight(px: number | null): void {
    this.preferredMoveListHeight = px;
    if (this.heightMgmtEnabled) this.fitMoveListHeight();
  }

  // Register the callback fired (debounced) when the user drags the resize handle.
  onMoveListResize(fn: (px: number) => void): void {
    this.onMoveListResizeCb = fn;
  }

  private setupMoveListHeight(): void {
    if (typeof ResizeObserver === "undefined") return;
    // Capture the CSS bounds before we ever set an inline height. With the
    // container's zero vertical padding/border, computed height == offsetHeight,
    // so these px values line up with what we later apply and observe.
    const cs = getComputedStyle(this.moveListEl);
    this.defaultMoveListHeight = parseFloat(cs.height) || 320;
    this.minMoveListHeight = parseFloat(cs.minHeight) || 0;
    const maxH = parseFloat(cs.maxHeight);
    this.maxMoveListHeight = maxH > 0 ? maxH : Number.POSITIVE_INFINITY;
    this.heightMgmtEnabled = true;
    this.moveListResizeObserver = new ResizeObserver(() => this.onMoveListResized());
    this.moveListResizeObserver.observe(this.moveListEl);
  }

  // Size the container to min(content, cap): short games hug their moves (no
  // empty box, no scrollbar); long games stop at the cap and scroll internally.
  // cap = the user's preferred/persisted height, else the CSS default.
  private fitMoveListHeight(): void {
    if (!this.heightMgmtEnabled) return;
    const el = this.moveListEl;
    const inner = el.firstElementChild as HTMLElement | null;
    // No moves yet (e.g. a FEN-only position): collapse so there's no empty box.
    if (!inner) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    const content = Math.ceil(inner.getBoundingClientRect().height);
    if (content === 0) return; // not laid out yet
    const cap = this.preferredMoveListHeight ?? this.defaultMoveListHeight;
    const target = Math.max(this.minMoveListHeight, Math.min(this.maxMoveListHeight, content, cap));
    el.style.height = `${target}px`;
    // Remember what actually rendered so the observer can distinguish our own
    // change from a user drag.
    this.lastMoveListHeight = el.offsetHeight;
  }

  private onMoveListResized(): void {
    if (!this.heightMgmtEnabled) return;
    // No height applied yet — this is the initial layout becoming measurable
    // (e.g. the block was rendered detached and just got attached). Fit it rather
    // than mistaking it for a drag.
    if (this.lastMoveListHeight === null) {
      this.fitMoveListHeight();
      return;
    }
    // Ignore the resize fitMoveListHeight() just caused; only a handle drag moves
    // the height away from what we last applied.
    const h = this.moveListEl.offsetHeight;
    if (Math.abs(h - this.lastMoveListHeight) <= 1) return;
    this.lastMoveListHeight = h;
    this.preferredMoveListHeight = h;
    this.persistMoveListHeight(h);
  }

  // Debounce so a drag (many resize events) yields one save, not hundreds.
  private persistMoveListHeight(px: number): void {
    if (this.moveListResizeTimer !== null) window.clearTimeout(this.moveListResizeTimer);
    this.moveListResizeTimer = window.setTimeout(() => {
      this.moveListResizeTimer = null;
      this.onMoveListResizeCb?.(px);
    }, 300);
  }

  // Navigate to `node`. `selectCommentId` carries a comment selection: the
  // board shows `node`'s position but the highlighted element is that comment.
  goTo(node: MoveNode, selectCommentId: number | null = null): void {
    const cur = this.state.current;
    // Clicking the hovered node: commit the preview seamlessly, no re-animation
    if (node.id === this.hoveredId) {
      this.hoveredId = null;
      this.cancelHoverAnim = null; // let in-flight animation finish naturally
      this.board.commitPreview();
      this.state = { ...this.state, current: node, selectedCommentId: selectCommentId, engineArrows: [] };
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
    this.state = { ...this.state, current: node, selectedCommentId: selectCommentId, engineArrows: [] };
    this.render();
    this.emit("navigate");
  }

  // Map a keydown to a navigation action. Returns true if the key was consumed
  // (so the listener can preventDefault). Plain ←/→ only — modifier combos are
  // left for Obsidian/browser shortcuts.
  private handleNavKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    switch (e.key) {
      case "ArrowLeft":
        this.goPrev();
        return true;
      case "ArrowRight":
        this.goNext();
        return true;
      default:
        return false;
    }
  }

  goNext(): void {
    const n = this.state.current.next;
    if (!n) return;
    this.clearHover();
    this.cancelAnim = this.board.animateTo(n.state, n.from, n.to, this.config, this.cancelAnim);
    this.state = { ...this.state, current: n, selectedCommentId: null, engineArrows: [] };
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
    this.state = { ...this.state, current: p, selectedCommentId: null, engineArrows: [] };
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
    if (!this.editor) return; // read-only block
    const path = nodeToPath(this.state.current);
    addMoveAt(this.editor, path, san);
    const root = projectGame(this.editor);
    const current = pathToNode(root, [...path, san]);
    this.board.setState(newState, { from, to });
    this.state = { ...this.state, root, current, selectedCommentId: null, engineArrows: [] };
    this.render();
    this.emit("move");
  }

  // Delete `node` and everything after it in its line (a whole variation if
  // `node` is a variation head). Current relocates to the deepest surviving
  // node on its old path — the deleted move's parent if current was removed.
  deleteMove(node: MoveNode): void {
    if (!this.editor) return;
    if (!this.confirmDelete("Are you sure?")) return;
    removeAt(this.editor, nodeToPath(node));
    this.refreshAfterEdit();
  }

  // Promote the variation whose head is `node` to the mainline at its branch.
  promoteVariationAt(node: MoveNode): void {
    if (!this.editor) return;
    promoteVariation(this.editor, nodeToPath(node));
    this.refreshAfterEdit();
  }

  // Set/replace/clear the comment item directly adjacent to `node` in the
  // stream (empty string clears). This is the authoring path: "write a comment
  // right before/after this move" — position chosen by the user, no ownership.
  setAdjacentCommentOn(node: MoveNode, side: "before" | "after", text: string): void {
    if (!this.editor) return;
    setAdjacentComment(this.editor, nodeToPath(node), side, text);
    this.refreshAfterEdit();
  }

  // Display text of the comment item directly adjacent to `node` ("" if none) —
  // used to seed the comment modal so authoring edits in place.
  adjacentCommentTextOf(node: MoveNode, side: "before" | "after"): string {
    if (!this.editor) return "";
    const item = adjacentComment(this.editor, nodeToPath(node), side);
    return item ? cleanComment(item.text) : "";
  }

  // Replace the text of an existing comment item (addressed by identity);
  // empty string removes it. The removal case is a delete, so it confirms;
  // a genuine text edit does not.
  updateCommentOn(comment: PgnComment, text: string): void {
    if (!this.editor) return;
    if (text === "" && !this.confirmDelete("Are you sure?")) return;
    updateComment(this.editor, comment, text);
    this.refreshAfterEdit();
  }

  // Confirm a destructive action before it runs. Every delete path — the inline
  // × buttons on moves and comments, and the "Delete from here" / "Delete
  // comment" context-menu items (which all route through deleteMove /
  // updateCommentOn) — funnels through here, so the prompt is defined in exactly
  // one place. Guarded for non-browser hosts (unit tests) where window.confirm
  // is absent: there we proceed without prompting.
  private confirmDelete(message: string): boolean {
    if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
    return window.confirm(message);
  }

  // Replace `node`'s NAG list (e.g. [1] for "!", [] to clear).
  setNagOn(node: MoveNode, nags: number[]): void {
    if (!this.editor) return;
    setNags(this.editor, nodeToPath(node), nags);
    this.refreshAfterEdit();
  }

  // Shared tail for every editor mutation: re-project, relocate `current` onto its
  // old SAN path (pathToNode falls back to the deepest surviving node), refresh the
  // board + move list, and fire "move" so the block writes back.
  private refreshAfterEdit(): void {
    if (!this.editor) return;
    const curPath = nodeToPath(this.state.current);
    const root = projectGame(this.editor);
    const current = pathToNode(root, curPath);
    this.clearHover();
    this.cancelAnim?.();
    this.cancelAnim = null;
    const lm = current.from >= 0 ? { from: current.from, to: current.to } : undefined;
    this.board.setState(current.state, lm);
    this.state = { ...this.state, root, current, selectedCommentId: null, engineArrows: [] };
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

  loadGame(root: MoveNode, result: string, headers: Record<string, string> = {}): void {
    this.board.endPreview();
    this.cancelAnim?.();
    this.cancelAnim = null;
    this.state = { root, current: root, selectedCommentId: null, result, headers, engineArrows: [] };
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
    if (!this.editor) return; // read-only block
    let path = nodeToPath(fromNode);
    for (const m of pvMoves) {
      addMoveAt(this.editor, path, m.san);
      path = [...path, m.san];
    }
    const root = projectGame(this.editor);
    const current = pathToNode(root, path);
    this.clearHover();
    this.cancelAnim?.();
    this.cancelAnim = null;
    const lm = current.from >= 0 ? { from: current.from, to: current.to } : undefined;
    this.board.setState(current.state, lm);
    this.state = { ...this.state, root, current, selectedCommentId: null, engineArrows: [] };
    this.render();
    this.emit("move");
  }
}
