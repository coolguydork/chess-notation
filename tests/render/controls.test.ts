import { describe, it, expect } from "vitest";
import { buildMoveTree, findNodeById, buildMoveListHtml } from "../../src/render/controls";
import { parseFEN } from "../../src/core/fen";
import type { BoardConfig } from "../../src/render/config";
import type { PgnMove, MoveNode } from "../../src/core/types";
import type { Piece } from "../../src/core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const testConfig: BoardConfig = {
  orientation: "white",
  colors: { light: "#ffffff", dark: "#000000" },
  squareSize: 50,
  showCoordinates: false,
  pieceSource: { type: "bundled" },
  resolvePieceUrl: (piece: Piece) => `/pieces/${piece.color}${piece.type.toUpperCase()}.svg`,
};

const italianMoves: PgnMove[] = [
  { san: "e4",  moveNumber: 1, color: "w" },
  { san: "e5",  moveNumber: 1, color: "b" },
  { san: "Nf3", moveNumber: 2, color: "w" },
  { san: "Nc6", moveNumber: 2, color: "b" },
  { san: "Bc4", moveNumber: 3, color: "w" },
];

// ─── buildMoveTree ────────────────────────────────────────────────────────────

describe("buildMoveTree", () => {
  it("root node has null san and no parent", () => {
    const root = buildMoveTree(STARTING_FEN, italianMoves);
    expect(root.san).toBeNull();
    expect(root.parent).toBeNull();
    expect(root.state).toEqual(parseFEN(STARTING_FEN));
  });

  it("root.next is the first main-line move", () => {
    const root = buildMoveTree(STARTING_FEN, italianMoves);
    expect(root.next?.san).toBe("e4");
    expect(root.next?.moveNumber).toBe(1);
    expect(root.next?.color).toBe("w");
  });

  it("chains the full main line via .next links", () => {
    const root = buildMoveTree(STARTING_FEN, italianMoves);
    const sans: string[] = [];
    let cur = root.next;
    while (cur) { sans.push(cur.san!); cur = cur.next; }
    expect(sans).toEqual(["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  });

  it("each node's parent links back correctly", () => {
    const root = buildMoveTree(STARTING_FEN, italianMoves);
    const e4 = root.next!;
    const e5 = e4.next!;
    expect(e4.parent).toBe(root);
    expect(e5.parent).toBe(e4);
  });

  it("each node's state reflects moves applied so far", () => {
    const root = buildMoveTree(STARTING_FEN, italianMoves);
    const idx = (file: number, rank: number) => (7 - rank) * 8 + file;
    const afterE4 = root.next!.state;
    expect(afterE4.board[idx(4, 3)]).toEqual({ type: "p", color: "w" }); // pawn on e4
    expect(afterE4.board[idx(4, 1)]).toBeNull();                          // e2 empty
  });

  it("returns a single root with no next for an empty move list", () => {
    const root = buildMoveTree(STARTING_FEN, []);
    expect(root.next).toBeNull();
    expect(root.san).toBeNull();
  });

  it("assigns unique ids to every node", () => {
    const root = buildMoveTree(STARTING_FEN, italianMoves);
    const ids = new Set<number>();
    const visit = (n: MoveNode | null) => {
      if (!n) return;
      ids.add(n.id);
      visit(n.next);
      n.variationHeads.forEach(visit);
    };
    visit(root);
    expect(ids.size).toBe(6); // root + 5 moves
  });

  describe("variations", () => {
    it("attaches a variation as variationHead on the preceding move node", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          { san: "d4", moveNumber: 1, color: "w" },
          { san: "d5", moveNumber: 1, color: "b" },
        ]] },
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const root = buildMoveTree(STARTING_FEN, moves);
      const e4Node = root.next!;
      expect(e4Node.variationHeads).toHaveLength(1);
      expect(e4Node.variationHeads[0].san).toBe("d4");
    });

    it("variation nodes have the correct parent (branches from same position as main move)", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          { san: "d4", moveNumber: 1, color: "w" },
        ]] },
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const root = buildMoveTree(STARTING_FEN, moves);
      const d4Node = root.next!.variationHeads[0];
      expect(d4Node.parent).toBe(root);
    });

    it("variation node state is computed from the correct parent position", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          { san: "d4", moveNumber: 1, color: "w" },
        ]] },
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const root = buildMoveTree(STARTING_FEN, moves);
      const d4Node = root.next!.variationHeads[0];
      const idx = (file: number, rank: number) => (7 - rank) * 8 + file;
      expect(d4Node.state.board[idx(3, 3)]).toEqual({ type: "p", color: "w" }); // d4
      expect(d4Node.state.board[idx(3, 1)]).toBeNull();                          // d2 empty
    });

    it("variation line continues via .next links", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          { san: "d4", moveNumber: 1, color: "w" },
          { san: "d5", moveNumber: 1, color: "b" },
          { san: "c4", moveNumber: 2, color: "w" },
        ]] },
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const root = buildMoveTree(STARTING_FEN, moves);
      const d4 = root.next!.variationHeads[0];
      expect(d4.san).toBe("d4");
      expect(d4.next?.san).toBe("d5");
      expect(d4.next?.next?.san).toBe("c4");
      expect(d4.next?.next?.next).toBeNull();
    });

    it("handles multiple variations on the same move", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [
          [{ san: "d4", moveNumber: 1, color: "w" }],
          [{ san: "c4", moveNumber: 1, color: "w" }],
        ]},
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const root = buildMoveTree(STARTING_FEN, moves);
      const heads = root.next!.variationHeads;
      expect(heads).toHaveLength(2);
      expect(heads[0].san).toBe("d4");
      expect(heads[1].san).toBe("c4");
    });

    it("handles nested variations (variation inside a variation)", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          {
            san: "d4", moveNumber: 1, color: "w",
            variations: [[{ san: "c4", moveNumber: 1, color: "w" }]],
          },
          { san: "d5", moveNumber: 1, color: "b" },
        ]]},
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const root = buildMoveTree(STARTING_FEN, moves);
      const e4Node = root.next!;
      const d4Node = e4Node.variationHeads[0];
      expect(d4Node.san).toBe("d4");
      expect(d4Node.variationHeads).toHaveLength(1);
      expect(d4Node.variationHeads[0].san).toBe("c4");
      expect(d4Node.variationHeads[0].parent).toBe(root);
    });
  });
});

// ─── findNodeById ─────────────────────────────────────────────────────────────

describe("findNodeById", () => {
  it("finds the root by id", () => {
    const root = buildMoveTree(STARTING_FEN, italianMoves);
    expect(findNodeById(root, root.id)).toBe(root);
  });

  it("finds a main-line node by id", () => {
    const root = buildMoveTree(STARTING_FEN, italianMoves);
    const nf3 = root.next!.next!.next!; // e4 → e5 → Nf3
    expect(findNodeById(root, nf3.id)).toBe(nf3);
  });

  it("finds a variation node by id", () => {
    const moves: PgnMove[] = [
      { san: "e4", moveNumber: 1, color: "w", variations: [[
        { san: "d4", moveNumber: 1, color: "w" },
      ]]},
      { san: "e5", moveNumber: 1, color: "b" },
    ];
    const root = buildMoveTree(STARTING_FEN, moves);
    const d4 = root.next!.variationHeads[0];
    expect(findNodeById(root, d4.id)).toBe(d4);
  });

  it("returns null for an unknown id", () => {
    const root = buildMoveTree(STARTING_FEN, italianMoves);
    expect(findNodeById(root, 99999)).toBeNull();
  });
});

// ─── buildMoveListHtml ──────────────────────────────────────────────────────

describe("buildMoveListHtml", () => {
  const root = buildMoveTree(STARTING_FEN, italianMoves);
  const e4 = root.next!;

  it("returns a non-empty HTML string", () => {
    expect(typeof buildMoveListHtml(root, root.id)).toBe("string");
    expect(buildMoveListHtml(root, root.id).length).toBeGreaterThan(0);
  });

  it("renders all main-line moves in the move list", () => {
    const html = buildMoveListHtml(root, root.id);
    ["e4", "e5", "Nf3", "Nc6", "Bc4"].forEach(san => expect(html).toContain(san));
  });

  it("renders move numbers in the move list", () => {
    const html = buildMoveListHtml(root, root.id);
    expect(html).toContain("1.");
    expect(html).toContain("2.");
    expect(html).toContain("3.");
  });

  it("uses data-node-id for move tokens", () => {
    expect(buildMoveListHtml(root, root.id)).toContain("data-node-id=");
  });

  it("marks the current node with data-active", () => {
    expect(buildMoveListHtml(root, e4.id)).toContain("data-active=\"true\"");
  });

  it("no move is marked active when current is root", () => {
    expect(buildMoveListHtml(root, root.id)).not.toContain("data-active=\"true\"");
  });

  it("renders the result token when provided", () => {
    expect(buildMoveListHtml(root, root.id, "1-0")).toContain("1-0");
  });

  it("omits the result token when not provided", () => {
    expect(buildMoveListHtml(root, root.id)).not.toContain("1-0");
  });

  it("renders no move tokens for FEN-only (no moves)", () => {
    const emptyRoot = buildMoveTree(STARTING_FEN, []);
    expect(buildMoveListHtml(emptyRoot, emptyRoot.id)).not.toContain("data-node-id");
  });

  describe("variation rendering", () => {
    it("renders variation moves in the move list", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          { san: "d4", moveNumber: 1, color: "w" },
          { san: "d5", moveNumber: 1, color: "b" },
        ]]},
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("d4");
      expect(html).toContain("d5");
      expect(html).toContain("chess-variation");
    });

    it("variation move nodes are navigable via data-node-id", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          { san: "d4", moveNumber: 1, color: "w" },
        ]]},
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const d4Node = r.next!.variationHeads[0];
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain(`data-node-id="${d4Node.id}"`);
    });

    it("marks a variation node active when it is current", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          { san: "d4", moveNumber: 1, color: "w" },
        ]]},
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const d4Node = r.next!.variationHeads[0];
      const html = buildMoveListHtml(r, d4Node.id);
      expect(html).toContain("data-active=\"true\"");
    });

    it("renders nested variations recursively", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          {
            san: "d4", moveNumber: 1, color: "w",
            variations: [[{ san: "c4", moveNumber: 1, color: "w" }]],
          },
          { san: "d5", moveNumber: 1, color: "b" },
        ]]},
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("d4");
      expect(html).toContain("c4");
      expect(html).toContain("d5");
    });
  });

  describe("NAG rendering", () => {
    it("renders a known NAG as its symbol after the move", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", nags: [1] }, // !
        { san: "e5", moveNumber: 1, color: "b", nags: [2] }, // ?
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("chess-nags");
      expect(html).toContain("!");
      expect(html).toContain("?");
    });

    it("renders combined glyphs for multi-NAG moves", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", nags: [3] },  // !!
        { san: "e5", moveNumber: 1, color: "b", nags: [5] },  // !?
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("!!");
      expect(html).toContain("!?");
    });

    it("falls back to $N for unknown NAG numbers", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", nags: [99] },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("$99");
    });

    it("renders position-assessment NAGs", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", nags: [16] }, // ±
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("±");
    });

    it("omits chess-nags span when move has no NAGs", () => {
      const r = buildMoveTree(STARTING_FEN, italianMoves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).not.toContain("chess-nags");
    });

    it("renders NAGs inside variations", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          { san: "d4", moveNumber: 1, color: "w", nags: [1] },
        ]]},
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("chess-nags");
      expect(html).toContain("!");
    });
  });

  describe("comment rendering", () => {
    it("renders a comment after its move", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w" },
        { san: "e5", moveNumber: 1, color: "b", comment: "This is a mistake" },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("chess-comment");
      expect(html).toContain("This is a mistake");
    });

    it("escapes HTML special characters in comments", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", comment: "a<b>&c" },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("a&lt;b&gt;&amp;c");
      expect(html).not.toContain("a<b>");
    });

    it("omits chess-comment span when move has no comment", () => {
      const r = buildMoveTree(STARTING_FEN, italianMoves);
      expect(buildMoveListHtml(r, r.id)).not.toContain("chess-comment");
    });

    it("renders comment after NAGs when both are present", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", nags: [1], comment: "Strong move" },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      const nagsPos = html.indexOf("chess-nags");
      const commentPos = html.indexOf("chess-comment");
      expect(nagsPos).toBeGreaterThan(-1);
      expect(commentPos).toBeGreaterThan(nagsPos);
    });

    it("renders comments inside variations", () => {
      const moves: PgnMove[] = [
        { san: "e4", moveNumber: 1, color: "w", variations: [[
          { san: "d4", moveNumber: 1, color: "w", comment: "Queens pawn" },
        ]]},
        { san: "e5", moveNumber: 1, color: "b" },
      ];
      const r = buildMoveTree(STARTING_FEN, moves);
      const html = buildMoveListHtml(r, r.id);
      expect(html).toContain("Queens pawn");
      expect(html).toContain("chess-comment");
    });
  });
});

// ---------------------------------------------------------------------------
// buildMoveListHtml — delete control (editable blocks)
// ---------------------------------------------------------------------------

describe("buildMoveListHtml delete control", () => {
  const root = buildMoveTree(STARTING_FEN, [
    { san: "e4", moveNumber: 1, color: "w" },
    { san: "e5", moveNumber: 1, color: "b" },
  ]);
  const e4 = root.next!;
  const e5 = e4.next!;

  it("emits a delete button only on the active move when editable", () => {
    const html = buildMoveListHtml(root, e4.id, undefined, true);
    expect(html).toContain(`data-delete-id="${e4.id}"`);
    expect(html).not.toContain(`data-delete-id="${e5.id}"`);
  });

  it("emits no delete buttons when not editable", () => {
    expect(buildMoveListHtml(root, e4.id, undefined, false)).not.toContain("data-delete-id");
    expect(buildMoveListHtml(root, e4.id)).not.toContain("data-delete-id"); // default
  });
});
