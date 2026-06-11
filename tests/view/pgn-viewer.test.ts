import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgnViewer, type ChangeEvent } from "../../src/view/pgn-viewer";
import type { InteractiveBoardHandle } from "../../src/view/board-handle";
import { buildMoveTree } from "../../src/core/tree";
import { gameFromFen, gameFromPgn, projectGame, gameToPgn } from "../../src/core/game";
import type { GameEditor } from "../../src/core/game";
import { parseFEN } from "../../src/core/fen";
import { applyMoveEx } from "../../src/core/moves";
import type { BoardState, MoveNode } from "../../src/core/types";
import { DEFAULT_BOARD_CONFIG } from "../../src/render/config";
import type { BoardConfig, EngineArrow } from "../../src/render/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStubBoard(): InteractiveBoardHandle & { _onMove?: (san: string, from: number, to: number, newState: BoardState) => void } {
  return {
    getState: () => ({} as BoardState),
    setState: vi.fn(),
    setEngineArrows: vi.fn(),
    animateTo: vi.fn(() => () => {}),
    preview: vi.fn(),
    endPreview: vi.fn(),
  };
}

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Display comments following a node, in order.
function tailComments(node: MoveNode): string[] {
  return node.tail
    .filter((t): t is Extract<typeof t, { kind: "comment" }> => t.kind === "comment")
    .map((t) => t.comment.text);
}

function makeConfig(): BoardConfig {
  return {
    ...DEFAULT_BOARD_CONFIG,
  };
}

/**
 * Creates a PgnViewer wired to a stub board, without needing a real DOM.
 * The viewer's mount() builds DOM internally; we provide minimal stubs.
 */
function makeViewer(
  root: MoveNode,
  current: MoveNode,
  editor?: GameEditor,
  headers: Record<string, string> = {},
): {
  viewer: PgnViewer;
  stub: InteractiveBoardHandle & { _onMove?: (san: string, from: number, to: number, newState: BoardState) => void };
} {
  const stub = makeStubBoard();

  const factory = (
    _wrapper: HTMLElement,
    _state: BoardState,
    _config: BoardConfig,
    _turnEl: HTMLElement | undefined,
    onMove: (san: string, from: number, to: number, newState: BoardState) => void,
  ): InteractiveBoardHandle => {
    stub._onMove = onMove;
    return stub;
  };

  // Minimal host that satisfies the DOM API calls in mount()
  // (querySelector for scrollIntoView, innerHTML assignment)
  const host = {
    appendChild: vi.fn(),
  } as unknown as HTMLElement;

  // We patch document.createElement to return minimal objects for mount()
  const origCreate = typeof globalThis.document !== "undefined" ? globalThis.document.createElement.bind(globalThis.document) : null;

  // Instead of a real DOM, test the state-machine methods directly by calling
  // commitMove / goNext etc., which don't touch DOM (except render() which we stub).
  // We need to call mount() but render() will fail without DOM — so we override
  // render by injecting dummy elements via _boardFactory.

  // Simplest approach: construct then directly call the methods under test
  // which only touch this.state and call board methods.

  // We bypass mount() by directly setting private fields via a subclass trick.
  class TestableViewer extends PgnViewer {
    constructor() {
      super(host, root, makeConfig(), current, "*", headers, editor, factory);
    }
    // Expose mount logic without DOM — skip mount(), use internal boot instead
    boot(): void {
      // Directly set the DOM-dependent fields to stubs
      (this as any).navPrevEl = { disabled: false, onclick: null };
      (this as any).navNextEl = { disabled: false, onclick: null };
      (this as any).turnIndicatorEl = { className: "", textContent: "" };
      (this as any).moveListEl = {
        innerHTML: "",
        addEventListener: vi.fn(),
        querySelector: () => null,
      };
      (this as any).headersEl = { innerHTML: "" };
      (this as any).boardWrapperEl = {};
      // Call board factory
      const b = factory({} as HTMLElement, current.state, makeConfig(), undefined, (san, from, to, ns) => {
        this.commitMove(san, from, to, ns);
      });
      (this as any).board = b;
    }
  }

  const viewer = new TestableViewer();
  (viewer as any).boot();
  return { viewer, stub };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PgnViewer (state-machine)", () => {
  const startState = parseFEN(STARTING_FEN);

  describe("goNext / goPrev", () => {
    it("does nothing at root when no next", () => {
      const root = buildMoveTree(STARTING_FEN, []);
      const { viewer } = makeViewer(root, root);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.goNext();
      expect(events).toHaveLength(0);
    });

    it("does nothing when goPrev at root", () => {
      const root = buildMoveTree(STARTING_FEN, []);
      const { viewer } = makeViewer(root, root);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.goPrev();
      expect(events).toHaveLength(0);
    });

    it("navigates forward and emits navigate", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.goNext();
      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe("navigate");
      expect(events[0].current.san).toBe("e4");
    });

    it("navigates backward and emits navigate", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);
      viewer.goNext();
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.goPrev();
      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe("navigate");
      expect(events[0].current.san).toBeNull(); // root
    });

    it("round-trips: goNext then goPrev returns to root", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);
      viewer.goNext();
      viewer.goPrev();
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.goNext();
      expect(events[0].current.san).toBe("e4");
    });
  });

  describe("keyboard navigation (handleNavKey)", () => {
    const key = (
      k: string,
      mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
    ) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

    it("ArrowRight steps forward and reports consumed", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      const consumed = (viewer as any).handleNavKey(key("ArrowRight"));
      expect(consumed).toBe(true);
      expect(events).toHaveLength(1);
      expect(events[0].current.san).toBe("e4");
    });

    it("ArrowLeft steps backward", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);
      viewer.goNext();
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      expect((viewer as any).handleNavKey(key("ArrowLeft"))).toBe(true);
      expect(events[0].current.san).toBeNull(); // back at root
    });

    it("ignores other keys and modifier combos", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      expect((viewer as any).handleNavKey(key("ArrowUp"))).toBe(false);
      expect((viewer as any).handleNavKey(key("ArrowRight", { metaKey: true }))).toBe(false);
      expect(events).toHaveLength(0);
    });
  });

  describe("goTo", () => {
    it("navigates to a specific node and emits navigate", () => {
      const root = buildMoveTree(STARTING_FEN, [
        { san: "e4", moveNumber: 1, color: "w" },
        { san: "e5", moveNumber: 1, color: "b" },
      ]);
      const { viewer } = makeViewer(root, root);
      const e5Node = root.next!.next!;
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.goTo(e5Node);
      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe("navigate");
      expect(events[0].current.san).toBe("e5");
    });
  });

  describe("comment selection", () => {
    // The comment item in a node's tail (clicking a comment routes here as
    // goTo(anchor, commentId)).
    function firstTailComment(node: MoveNode): { id: number } {
      const entry = node.tail[0];
      if (entry?.kind !== "comment") throw new Error("expected a comment entry");
      return entry.comment;
    }

    it("goTo with a comment id highlights only the comment, not the move at its position", () => {
      const editor = gameFromPgn("{ a } 1. e4 { b } 1... e5 *");
      const root = projectGame(editor);
      const e4 = root.next!;
      const b = firstTailComment(e4);
      const { viewer } = makeViewer(root, root, editor);
      viewer.goTo(e4, b.id);
      const html = (viewer as any).moveListEl.innerHTML as string;
      expect(html).toContain(`data-comment-id="${b.id}" data-active="true"`);
      expect(html).not.toContain(`data-node-id="${e4.id}" data-active="true"`);
    });

    it("subsequent navigation clears the comment selection", () => {
      const editor = gameFromPgn("1. e4 { b } 1... e5 *");
      const root = projectGame(editor);
      const e4 = root.next!;
      const b = firstTailComment(e4);
      const { viewer } = makeViewer(root, root, editor);
      viewer.goTo(e4, b.id);
      viewer.goNext(); // to e5 — the move highlight returns
      const html = (viewer as any).moveListEl.innerHTML as string;
      expect(html).not.toContain(`data-comment-id="${b.id}" data-active="true"`);
      expect(html).toContain(`data-node-id="${e4.next!.id}" data-active="true"`);
    });
  });

  describe("commitMove", () => {
    it("extends the tree (via the editor) and emits move", () => {
      const editor = gameFromFen(STARTING_FEN);
      const root = projectGame(editor);
      const { viewer } = makeViewer(root, root, editor);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      const result = applyMoveEx(startState, "e4");
      viewer.commitMove("e4", result.from, result.to, result.state);

      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe("move");
      expect(events[0].current.san).toBe("e4");
    });

    it("does not create a duplicate node when the same SAN is played twice", () => {
      const editor = gameFromFen(STARTING_FEN);
      const root = projectGame(editor);
      const { viewer } = makeViewer(root, root, editor);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      const result = applyMoveEx(startState, "e4");
      viewer.commitMove("e4", result.from, result.to, result.state);
      viewer.goPrev(); // back to root
      viewer.commitMove("e4", result.from, result.to, result.state);

      const lastRoot = events[events.length - 1].root;
      expect(lastRoot.next?.san).toBe("e4");
      expect(lastRoot.next?.variationHeads).toHaveLength(0);
    });

    it("is read-only (no-op) when there is no editor", () => {
      const root = buildMoveTree(STARTING_FEN, []);
      const { viewer } = makeViewer(root, root); // no editor
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      const result = applyMoveEx(startState, "e4");
      viewer.commitMove("e4", result.from, result.to, result.state);

      expect(events).toHaveLength(0);
    });
  });

  describe("deleteMove", () => {
    it("truncates from a move and relocates current to the deleted move's parent", () => {
      const editor = gameFromPgn("1. e4 e5 2. Nf3");
      const root = projectGame(editor);
      const e5 = root.next!.next!;
      const nf3 = e5.next!;
      const { viewer } = makeViewer(root, nf3, editor); // current at Nf3
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      viewer.deleteMove(e5); // delete e5 and everything after it

      const last = events[events.length - 1];
      expect(last.reason).toBe("move");
      expect(last.root.next!.san).toBe("e4");
      expect(last.root.next!.next).toBeNull();
      expect(last.current.san).toBe("e4"); // relocated to e5's parent
    });

    it("is read-only (no-op) when there is no editor", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root.next!); // no editor
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.deleteMove(root.next!);
      expect(events).toHaveLength(0);
    });
  });

  describe("move-level edit ops (context-menu seam)", () => {
    it("promoteVariationAt makes the variation the mainline and emits move", () => {
      const editor = gameFromPgn("1. e4 e5 (1... c5 2. Nf3) 2. Nf3");
      const root = projectGame(editor);
      const c5 = root.next!.next!.variationHeads[0]; // e5's variation head
      const { viewer } = makeViewer(root, root.next!, editor); // current at e4
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      viewer.promoteVariationAt(c5);

      const last = events[events.length - 1];
      expect(last.reason).toBe("move");
      expect(last.root.next!.next!.san).toBe("c5"); // c5 promoted to mainline
      expect(last.root.next!.next!.variationHeads.map((v) => v.san)).toContain("e5");
    });

    it("setAdjacentCommentOn(after) inserts a comment item after the move and emits move", () => {
      const editor = gameFromPgn("1. e4 e5");
      const root = projectGame(editor);
      const { viewer } = makeViewer(root, root, editor);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      viewer.setAdjacentCommentOn(root.next!, "after", "best by test");

      const last = events[events.length - 1];
      expect(last.reason).toBe("move");
      expect(tailComments(last.root.next!)).toEqual(["best by test"]);
      expect(gameToPgn(editor, "*")).toBe("1. e4 { best by test } 1... e5 *");
    });

    it("setAdjacentCommentOn(before) inserts a leading comment item and emits move", () => {
      const editor = gameFromPgn("1. e4 e5");
      const root = projectGame(editor);
      const { viewer } = makeViewer(root, root, editor);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      viewer.setAdjacentCommentOn(root.next!, "before", "before e4");

      const last = events[events.length - 1];
      expect(last.reason).toBe("move");
      expect(tailComments(last.root)).toEqual(["before e4"]); // sits in the root's tail
      expect(tailComments(last.root.next!)).toEqual([]);      // not after e4
    });

    it("adjacentCommentTextOf reads the neighbouring item for modal seeding", () => {
      const editor = gameFromPgn("1. e4 { hi } 1... e5");
      const root = projectGame(editor);
      const { viewer } = makeViewer(root, root, editor);

      // The same item is e4's after-neighbour and e5's before-neighbour.
      expect(viewer.adjacentCommentTextOf(root.next!, "after")).toBe("hi");
      expect(viewer.adjacentCommentTextOf(root.next!.next!, "before")).toBe("hi");
      expect(viewer.adjacentCommentTextOf(root.next!, "before")).toBe("");
    });

    it("updateCommentOn edits an existing comment item by identity and emits move", () => {
      const editor = gameFromPgn("1. e4 { old } 1... e5");
      const root = projectGame(editor);
      const { viewer } = makeViewer(root, root, editor);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      const entry = root.next!.tail[0];
      if (entry.kind !== "comment") throw new Error("expected a comment entry");
      viewer.updateCommentOn(entry.comment.source, "new");

      const last = events[events.length - 1];
      expect(last.reason).toBe("move");
      expect(tailComments(last.root.next!)).toEqual(["new"]);
    });

    it("setNagOn annotates a move and emits move", () => {
      const editor = gameFromPgn("1. e4 e5");
      const root = projectGame(editor);
      const { viewer } = makeViewer(root, root, editor);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      viewer.setNagOn(root.next!, [1]);

      const last = events[events.length - 1];
      expect(last.reason).toBe("move");
      expect(last.root.next!.nags).toEqual([1]);
    });

    it("edit ops are no-ops without an editor", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root.next!); // no editor
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.setNagOn(root.next!, [1]);
      viewer.setAdjacentCommentOn(root.next!, "after", "x");
      viewer.promoteVariationAt(root.next!);
      expect(events).toHaveLength(0);
    });
  });

  describe("setEngineArrows", () => {
    it("calls board.setEngineArrows and does NOT emit a change event", () => {
      const root = buildMoveTree(STARTING_FEN, []);
      const { viewer, stub } = makeViewer(root, root);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      const arrows: EngineArrow[] = [{ from: 12, to: 28, color: "green" }];
      viewer.setEngineArrows(arrows);

      expect(stub.setEngineArrows).toHaveBeenCalledWith(arrows);
      expect(events).toHaveLength(0);
    });
  });

  describe("loadGame", () => {
    it("replaces root and current, emits load-game", () => {
      const root = buildMoveTree(STARTING_FEN, []);
      const { viewer } = makeViewer(root, root);
      const newRoot = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);

      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.loadGame(newRoot, "1-0");

      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe("load-game");
      expect(events[0].current).toBe(newRoot);
      expect(events[0].root).toBe(newRoot);
    });

    it("resets current to root on loadGame", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);
      viewer.goNext();

      const newRoot = buildMoveTree(STARTING_FEN, []);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.loadGame(newRoot, "*");

      expect(events[0].current).toBe(newRoot);
    });

    it("repaints the header strip with the new game's headers", () => {
      const root = buildMoveTree(STARTING_FEN, []);
      const { viewer } = makeViewer(root, root, undefined, { White: "Kasparov", Black: "Karpov" });
      const newRoot = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);

      viewer.loadGame(newRoot, "1-0", { White: "Fischer", Black: "Spassky" });

      const html = (viewer as unknown as { headersEl: { innerHTML: string } }).headersEl.innerHTML;
      expect(html).toContain("Fischer");
      expect(html).toContain("Spassky");
      expect(html).not.toContain("Kasparov"); // old headers replaced
    });
  });

  describe("onChange listener", () => {
    it("receives events from multiple navigation methods", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);
      const newRoot = buildMoveTree(STARTING_FEN, []);

      const reasons: string[] = [];
      viewer.onChange((e) => reasons.push(e.reason));

      viewer.goNext();
      viewer.goPrev();
      viewer.loadGame(newRoot, "*");

      expect(reasons).toEqual(["navigate", "navigate", "load-game"]);
    });

    it("multiple listeners all receive events", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);

      const a: string[] = [];
      const b: string[] = [];
      viewer.onChange((e) => a.push(e.reason));
      viewer.onChange((e) => b.push(e.reason));

      viewer.goNext();
      expect(a).toEqual(["navigate"]);
      expect(b).toEqual(["navigate"]);
    });
  });
});
