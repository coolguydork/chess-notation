// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { buildMoveTree, findNodeById, buildMoveListEl, buildHeaderEl } from "../../src/render/controls";
import { parseFEN } from "../../src/core/fen";
import { parse } from "../../src/pgn-editor";
import type { PgnItem } from "../../src/pgn-editor";
import type { BoardConfig } from "../../src/render/config";
import type { MoveNode } from "../../src/core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const testConfig: BoardConfig = {
  orientation: "white",
  colors: { light: "#ffffff", dark: "#000000" },
  squareSize: 50,
  showCoordinates: false,
};

// Trees are built the way the app builds them: PGN text -> item stream -> tree.
const pgnItems = (movetext: string): PgnItem[] => parse(movetext, { strict: true }).items;

// The builders return DOM elements; assertions run over their serialized HTML
// (and "" for null) so positional/containment checks stay one-liners.
const moveListHtml = (...args: Parameters<typeof buildMoveListEl>): string =>
  buildMoveListEl(...args)?.outerHTML ?? "";
const headerHtml = (...args: Parameters<typeof buildHeaderEl>): string =>
  buildHeaderEl(...args)?.outerHTML ?? "";

const italianItems = pgnItems("1. e4 e5 2. Nf3 Nc6 3. Bc4");

// ─── buildMoveTree ────────────────────────────────────────────────────────────

describe("buildMoveTree", () => {
  it("root node has null san and no parent", () => {
    const root = buildMoveTree(STARTING_FEN, italianItems);
    expect(root.san).toBeNull();
    expect(root.parent).toBeNull();
    expect(root.state).toEqual(parseFEN(STARTING_FEN));
  });

  it("root.next is the first main-line move", () => {
    const root = buildMoveTree(STARTING_FEN, italianItems);
    expect(root.next?.san).toBe("e4");
    expect(root.next?.moveNumber).toBe(1);
    expect(root.next?.color).toBe("w");
  });

  it("chains the full main line via .next links", () => {
    const root = buildMoveTree(STARTING_FEN, italianItems);
    const sans: string[] = [];
    let cur = root.next;
    while (cur) { sans.push(cur.san!); cur = cur.next; }
    expect(sans).toEqual(["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  });

  it("each node's parent links back correctly", () => {
    const root = buildMoveTree(STARTING_FEN, italianItems);
    const e4 = root.next!;
    const e5 = e4.next!;
    expect(e4.parent).toBe(root);
    expect(e5.parent).toBe(e4);
  });

  it("each node's state reflects moves applied so far", () => {
    const root = buildMoveTree(STARTING_FEN, italianItems);
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
    const root = buildMoveTree(STARTING_FEN, italianItems);
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
      const root = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 d5 ) 1... e5"));
      const e4Node = root.next!;
      expect(e4Node.variationHeads).toHaveLength(1);
      expect(e4Node.variationHeads[0].san).toBe("d4");
    });

    it("variation nodes have the correct parent (branches from same position as main move)", () => {
      const root = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 ) 1... e5"));
      const d4Node = root.next!.variationHeads[0];
      expect(d4Node.parent).toBe(root);
    });

    it("variation node state is computed from the correct parent position", () => {
      const root = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 ) 1... e5"));
      const d4Node = root.next!.variationHeads[0];
      const idx = (file: number, rank: number) => (7 - rank) * 8 + file;
      expect(d4Node.state.board[idx(3, 3)]).toEqual({ type: "p", color: "w" }); // d4
      expect(d4Node.state.board[idx(3, 1)]).toBeNull();                          // d2 empty
    });

    it("variation line continues via .next links", () => {
      const root = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 d5 2. c4 ) 1... e5"));
      const d4 = root.next!.variationHeads[0];
      expect(d4.san).toBe("d4");
      expect(d4.next?.san).toBe("d5");
      expect(d4.next?.next?.san).toBe("c4");
      expect(d4.next?.next?.next).toBeNull();
    });

    it("handles multiple variations on the same move", () => {
      const root = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 ) ( 1. c4 ) 1... e5"));
      const heads = root.next!.variationHeads;
      expect(heads).toHaveLength(2);
      expect(heads[0].san).toBe("d4");
      expect(heads[1].san).toBe("c4");
    });

    it("handles nested variations (variation inside a variation)", () => {
      const root = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 ( 1. c4 ) 1... d5 ) 1... e5"));
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
    const root = buildMoveTree(STARTING_FEN, italianItems);
    expect(findNodeById(root, root.id)).toBe(root);
  });

  it("finds a main-line node by id", () => {
    const root = buildMoveTree(STARTING_FEN, italianItems);
    const nf3 = root.next!.next!.next!; // e4 → e5 → Nf3
    expect(findNodeById(root, nf3.id)).toBe(nf3);
  });

  it("finds a variation node by id", () => {
    const root = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 ) 1... e5"));
    const d4 = root.next!.variationHeads[0];
    expect(findNodeById(root, d4.id)).toBe(d4);
  });

  it("returns null for an unknown id", () => {
    const root = buildMoveTree(STARTING_FEN, italianItems);
    expect(findNodeById(root, 99999)).toBeNull();
  });
});

// ─── buildMoveListEl ────────────────────────────────────────────────────────

describe("buildMoveListEl", () => {
  const root = buildMoveTree(STARTING_FEN, italianItems);
  const e4 = root.next!;

  it("returns a populated move-list element", () => {
    const list = buildMoveListEl(root, root.id);
    expect(list?.className).toBe("chess-move-list");
    expect(list?.childElementCount ?? 0).toBeGreaterThan(0);
  });

  it("renders all main-line moves in the move list", () => {
    const html = moveListHtml(root, root.id);
    ["e4", "e5", "Nf3", "Nc6", "Bc4"].forEach(san => expect(html).toContain(san));
  });

  it("renders move numbers in the move list", () => {
    const html = moveListHtml(root, root.id);
    expect(html).toContain("1.");
    expect(html).toContain("2.");
    expect(html).toContain("3.");
  });

  it("uses data-node-id for move tokens", () => {
    expect(moveListHtml(root, root.id)).toContain("data-node-id=");
  });

  it("marks the current node with data-active", () => {
    expect(moveListHtml(root, e4.id)).toContain("data-active=\"true\"");
  });

  it("no move is marked active when current is root", () => {
    expect(moveListHtml(root, root.id)).not.toContain("data-active=\"true\"");
  });

  it("renders the result token when provided", () => {
    expect(moveListHtml(root, root.id, "1-0")).toContain("1-0");
  });

  it("omits the result token when not provided", () => {
    expect(moveListHtml(root, root.id)).not.toContain("1-0");
  });

  it("renders no move tokens for FEN-only (no moves)", () => {
    const emptyRoot = buildMoveTree(STARTING_FEN, []);
    expect(moveListHtml(emptyRoot, emptyRoot.id)).not.toContain("data-node-id");
  });

  describe("variation rendering", () => {
    it("renders variation moves in the move list", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 d5 ) 1... e5"));
      const html = moveListHtml(r, r.id);
      expect(html).toContain("d4");
      expect(html).toContain("d5");
      expect(html).toContain("chess-variation");
    });

    it("variation move nodes are navigable via data-node-id", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 ) 1... e5"));
      const d4Node = r.next!.variationHeads[0];
      const html = moveListHtml(r, r.id);
      expect(html).toContain(`data-node-id="${d4Node.id}"`);
    });

    it("marks a variation node active when it is current", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 ) 1... e5"));
      const d4Node = r.next!.variationHeads[0];
      const html = moveListHtml(r, d4Node.id);
      expect(html).toContain("data-active=\"true\"");
    });

    it("renders nested variations recursively", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 ( 1. c4 ) 1... d5 ) 1... e5"));
      const html = moveListHtml(r, r.id);
      expect(html).toContain("d4");
      expect(html).toContain("c4");
      expect(html).toContain("d5");
    });
  });

  describe("NAG rendering", () => {
    it("renders a known NAG as its symbol after the move", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 $1 e5 $2"));
      const html = moveListHtml(r, r.id);
      expect(html).toContain("chess-nags");
      expect(html).toContain("!");
      expect(html).toContain("?");
    });

    it("renders combined glyphs for multi-NAG moves", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 $3 e5 $5"));
      const html = moveListHtml(r, r.id);
      expect(html).toContain("!!");
      expect(html).toContain("!?");
    });

    it("falls back to $N for unknown NAG numbers", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 $99"));
      expect(moveListHtml(r, r.id)).toContain("$99");
    });

    it("renders position-assessment NAGs", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 $16"));
      expect(moveListHtml(r, r.id)).toContain("±");
    });

    it("omits chess-nags span when move has no NAGs", () => {
      const r = buildMoveTree(STARTING_FEN, italianItems);
      expect(moveListHtml(r, r.id)).not.toContain("chess-nags");
    });

    it("renders NAGs inside variations", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 $1 ) 1... e5"));
      const html = moveListHtml(r, r.id);
      expect(html).toContain("chess-nags");
      expect(html).toContain("!");
    });
  });

  describe("comment rendering — positional", () => {
    it("renders a comment after the move it follows", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 e5 { This is a mistake }"));
      const html = moveListHtml(r, r.id);
      expect(html).toContain("chess-comment");
      expect(html).toContain("This is a mistake");
      expect(html.indexOf(">e5<")).toBeLessThan(html.indexOf("This is a mistake"));
    });

    it("renders comment text as inert text (no markup injection)", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 { a<b>&c }"));
      const html = moveListHtml(r, r.id);
      expect(html).toContain("a&lt;b&gt;&amp;c");
      expect(html).not.toContain("a<b>");
    });

    it("omits chess-comment span when there are no comments", () => {
      const r = buildMoveTree(STARTING_FEN, italianItems);
      expect(moveListHtml(r, r.id)).not.toContain("chess-comment");
    });

    it("renders a leading comment before the first move (root tail)", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("{ intro } 1. e4 e5"));
      const html = moveListHtml(r, r.id);
      expect(html.indexOf("intro")).toBeLessThan(html.indexOf(">e4<"));
    });

    it("renders a comment between two moves ahead of the later move", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 { Black replies } 1... e5"));
      const html = moveListHtml(r, r.id);
      const commentPos = html.indexOf("Black replies");
      expect(commentPos).toBeGreaterThan(html.indexOf(">e4<"));
      expect(commentPos).toBeLessThan(html.indexOf(">e5<"));
    });

    it("re-shows the move number after a comment on a black move", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 { hmm } 1... e5"));
      expect(moveListHtml(r, r.id)).toContain("1…"); // black-to-move marker re-shown
    });

    it("renders a comment after a variation in its written position", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 ) { hi } 1... e5"));
      const html = moveListHtml(r, r.id);
      expect(html.indexOf("hi")).toBeGreaterThan(html.indexOf("chess-variation"));
      expect(html.indexOf("hi")).toBeLessThan(html.indexOf(">e5<"));
    });

    it("renders consecutive comments as separate spans", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 { a } { b } e5"));
      const html = moveListHtml(r, r.id);
      expect(html.match(/class="chess-comment"/g)).toHaveLength(2);
    });

    it("renders a variation's leading comment inside the parens before its head", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 e5 ( { gambit try } 1... c5 ) 2. Nf3"));
      const html = moveListHtml(r, r.id);
      const open = html.indexOf("chess-variation-paren");
      expect(html.indexOf("gambit try")).toBeGreaterThan(open);
      expect(html.indexOf("gambit try")).toBeLessThan(html.indexOf(">c5<"));
    });

    it("renders a comment written between the number and the SAN as a before-item", () => {
      // Move numbers are decoration: "1. { sharpest } e4" reads as a comment
      // before e4, so it renders ahead of the move number like any before-item.
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. { sharpest } e4 e5"));
      const html = moveListHtml(r, r.id);
      expect(html.indexOf("sharpest")).toBeLessThan(html.indexOf(">e4<"));
      expect(html).not.toContain("data-comment-slot");
    });

    it("renders comment after NAGs when both are present", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 $1 { Strong move }"));
      const html = moveListHtml(r, r.id);
      const nagsPos = html.indexOf("chess-nags");
      const commentPos = html.indexOf("chess-comment");
      expect(nagsPos).toBeGreaterThan(-1);
      expect(commentPos).toBeGreaterThan(nagsPos);
    });

    it("renders comments inside variations", () => {
      const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 ( 1. d4 { Queens pawn } ) 1... e5"));
      const html = moveListHtml(r, r.id);
      expect(html).toContain("Queens pawn");
      expect(html).toContain("chess-comment");
    });
  });
});

// ---------------------------------------------------------------------------
// buildMoveListEl — selection (exactly one element highlights)
// ---------------------------------------------------------------------------

describe("buildMoveListEl selection", () => {
  // Comments at every position: before the game, after a move, leading a
  // variation, and inside a variation line.
  const items = pgnItems("{ a } 1. e4 { b } 1... e5 2. Nf3 Nc6 3. Bc4 $1 ( { c } 3. Bb5 $1 { d } 3... a6 ) 3... Nf6");

  // The comment items in a node's tail, in order.
  const tailComments = (node: MoveNode) =>
    node.tail.filter((t): t is Extract<typeof t, { kind: "comment" }> => t.kind === "comment");

  it("a current move does not activate its adjacent comments", () => {
    const r = buildMoveTree(STARTING_FEN, items);
    const e4 = r.next!;
    const html = moveListHtml(r, e4.id);
    expect(html.match(/data-active="true"/g)).toHaveLength(1);
    expect(html).toContain(`data-node-id="${e4.id}" data-active="true"`);
  });

  it("a current variation head does not activate its lead or trailing comments", () => {
    const r = buildMoveTree(STARTING_FEN, items);
    const bc4 = r.next!.next!.next!.next!.next!; // 3. Bc4
    const bb5 = bc4.variationHeads[0];           // 3. Bb5
    const html = moveListHtml(r, bb5.id);
    expect(html.match(/data-active="true"/g)).toHaveLength(1);
    expect(html).toContain(`data-node-id="${bb5.id}" data-active="true"`);
  });

  it("a selected comment is the only active element — the current move is not", () => {
    const r = buildMoveTree(STARTING_FEN, items);
    const e4 = r.next!;
    const b = tailComments(e4)[0].comment; // { b }
    const html = moveListHtml(r, e4.id, undefined, false, b.id);
    expect(html.match(/data-active="true"/g)).toHaveLength(1);
    expect(html).toContain(`data-comment-id="${b.id}" data-active="true"`);
  });

  it("a variation lead comment is selectable on its own", () => {
    const r = buildMoveTree(STARTING_FEN, items);
    const bc4 = r.next!.next!.next!.next!.next!;
    const entry = bc4.tail.find((t) => t.kind === "variation");
    if (entry?.kind !== "variation") throw new Error("expected a variation entry");
    const c = entry.lead[0]; // { c }
    const html = moveListHtml(r, bc4.id, undefined, false, c.id);
    expect(html.match(/data-active="true"/g)).toHaveLength(1);
    expect(html).toContain(`data-comment-id="${c.id}" data-active="true"`);
  });
});

// ---------------------------------------------------------------------------
// buildMoveListEl — delete control (editable blocks)
// ---------------------------------------------------------------------------

describe("buildMoveListEl delete control", () => {
  const root = buildMoveTree(STARTING_FEN, pgnItems("1. e4 e5"));
  const e4 = root.next!;
  const e5 = e4.next!;

  it("emits a delete button only on the active move when editable", () => {
    const html = moveListHtml(root, e4.id, undefined, true);
    expect(html).toContain(`data-delete-id="${e4.id}"`);
    expect(html).not.toContain(`data-delete-id="${e5.id}"`);
  });

  it("emits no delete buttons when not editable", () => {
    expect(moveListHtml(root, e4.id, undefined, false)).not.toContain("data-delete-id");
    expect(moveListHtml(root, e4.id)).not.toContain("data-delete-id"); // default
  });

  it("emits a comment delete button only when the comment itself is selected", () => {
    const r = buildMoveTree(STARTING_FEN, pgnItems("1. e4 { hi } 1... e5"));
    const e4Node = r.next!;
    const entry = e4Node.tail[0];
    if (entry.kind !== "comment") throw new Error("expected a comment entry");
    // the anchor move being active no longer reveals the comment's delete button
    expect(moveListHtml(r, e4Node.id, undefined, true)).not.toContain("data-comment-delete-id");
    // selecting the comment shows its delete button and suppresses the move's
    const html = moveListHtml(r, e4Node.id, undefined, true, entry.comment.id);
    expect(html).toContain(`data-comment-delete-id="${entry.comment.id}"`);
    expect(html).not.toContain(`data-delete-id="${e4Node.id}"`);
  });
});

// ---------------------------------------------------------------------------
// buildHeaderEl — PGN game-info strip
// ---------------------------------------------------------------------------

describe("buildHeaderEl", () => {
  it("returns null when there are no headers", () => {
    expect(buildHeaderEl({})).toBeNull();
  });

  it("renders every tag as a key/value pair", () => {
    const html = headerHtml({ White: "Kasparov", Black: "Karpov" });
    expect(html).toContain("chess-headers");
    expect(html).toContain(`<span class="chess-header-key">White</span>`);
    expect(html).toContain(`<span class="chess-header-value">Kasparov</span>`);
    expect(html).toContain(`<span class="chess-header-key">Black</span>`);
    expect(html).toContain(`<span class="chess-header-value">Karpov</span>`);
  });

  it("shows ALL tags, including Result, FEN, and SetUp", () => {
    const html = headerHtml({ Result: "1-0", FEN: "8/8/8/8/8/8/8/8 w - - 0 1", SetUp: "1" });
    expect(html).toContain("Result");
    expect(html).toContain("1-0");
    expect(html).toContain("FEN");
    expect(html).toContain("SetUp");
  });

  it("preserves source order", () => {
    const html = headerHtml({ Event: "World Cup", Site: "Baku", Round: "3" });
    expect(html.indexOf("World Cup")).toBeLessThan(html.indexOf("Baku"));
    expect(html.indexOf("Baku")).toBeLessThan(html.indexOf("3"));
  });

  it("skips tags whose value is empty", () => {
    const html = headerHtml({ Event: "Match", Annotator: "  " });
    expect(html).toContain("Event");
    expect(html).not.toContain("Annotator");
  });

  it("renders keys and values as inert text (no markup injection)", () => {
    const html = headerHtml({ White: "<b>x</b>", Event: "a & b" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("a &amp; b");
    expect(html).not.toContain("<b>x</b>");
  });
});
