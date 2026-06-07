import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgnViewer, type ChangeEvent } from "../../src/view/pgn-viewer";
import type { InteractiveBoardHandle } from "../../src/view/interactive-board";
import { buildMoveTree, attachMove } from "../../src/core/tree";
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

function makeConfig(): BoardConfig {
  return {
    ...DEFAULT_BOARD_CONFIG,
    resolvePieceUrl: () => "",
  };
}

/**
 * Creates a PgnViewer wired to a stub board, without needing a real DOM.
 * The viewer's mount() builds DOM internally; we provide minimal stubs.
 */
function makeViewer(
  root: MoveNode,
  current: MoveNode,
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
      super(host, root, makeConfig(), current, "*", factory);
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

  describe("commitMove", () => {
    it("extends the tree and emits move", () => {
      const root = buildMoveTree(STARTING_FEN, []);
      const { viewer } = makeViewer(root, root);
      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));

      const result = applyMoveEx(startState, "e4");
      viewer.commitMove("e4", result.from, result.to, result.state);

      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe("move");
      expect(events[0].current.san).toBe("e4");
    });

    it("does not create a duplicate node when the same SAN is played twice", () => {
      const root = buildMoveTree(STARTING_FEN, []);
      const { viewer } = makeViewer(root, root);

      const result = applyMoveEx(startState, "e4");
      viewer.commitMove("e4", result.from, result.to, result.state);
      viewer.goPrev(); // back to root
      viewer.commitMove("e4", result.from, result.to, result.state);

      expect(root.next?.san).toBe("e4");
      expect(root.next?.variationHeads).toHaveLength(0);
    });
  });

  describe("promote", () => {
    it("emits promote", () => {
      const root = buildMoveTree(STARTING_FEN, [{ san: "e4", moveNumber: 1, color: "w" }]);
      const { viewer } = makeViewer(root, root);

      // Add a variation node manually
      const d4Result = applyMoveEx(startState, "d4");
      const e4Node = root.next!;
      const d4Node: MoveNode = {
        id: 9999,
        san: "d4",
        moveNumber: 1,
        color: "w",
        state: d4Result.state,
        from: d4Result.from,
        to: d4Result.to,
        parent: root,
        next: null,
        variationHeads: [],
      };
      e4Node.variationHeads.push(d4Node);

      const events: ChangeEvent[] = [];
      viewer.onChange((e) => events.push(e));
      viewer.promote(d4Node);

      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe("promote");
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
