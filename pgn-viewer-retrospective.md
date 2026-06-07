# PGN Viewer Retrospective & Rewrite Plan

This document is both a post-mortem of the current PGN viewer and a task list for
rewriting it. It is written to be executed by an AI agent. Each `## Task` is
self-contained and can be read and completed in isolation. Read **Task 0** first;
it defines invariants that every other task depends on.

Execute tasks in numeric order. Do not skip a task because it "looks done" — the
acceptance criteria define done.

### What success looks like

The task checklist can all pass while the result still misses the point. These
outcome metrics are the real target — verify them at the end:

- **`src/plugin/main.ts` drops from ~1094 lines to ≈300** — it should contain
  only Obsidian wiring (block processor, settings tab, lifecycle, `writeBackPgn`,
  `viewerPositionCache`). If it is still large, interaction logic did not actually
  move to `view/`.
- **Each shared DOM node has exactly one writer**, and **each piece of state has
  exactly one owner** — these are the two failures this whole rewrite exists to
  fix. If you cannot point to the single owner of `current` or the single writer
  of the board, it is not done.
- **The flicker is gone and no behavior regressed** — the manual smoke checks in
  the Final Verification Gate pass.

Do this on its own branch, not interleaved with feature work — it touches layer
boundaries and is easiest to review as one coherent change.

---

## How to read this document (rules for the executing agent)

**Baseline commit:** `6e6195f`. All file/line references below are valid as of
this commit.

1. **Line numbers drift; symbols do not.** Every reference to existing code cites
   a line number *and* a `locate:` grep command. If the line number no longer
   matches what you see, **use the `locate:` command to find the code. Never
   guess a location and never edit by line number alone.**
2. **Verify mechanically, not by reasoning.** Each invariant and most tasks have
   a runnable check (a `grep`, `npm test`, or a file-mtime observation). Run it.
   A task is done when its check passes, not when it looks right.
3. **Stop and report on conflict.** If an acceptance criterion cannot be met, or
   a `locate:` command returns nothing, or two instructions appear to conflict —
   **stop and report it. Do not work around it, weaken the criterion, or guess.**
4. **Stay in scope.** Only create/modify the files listed in each task's
   **Files** line and the summary table. Do not rename anything in `src/core/`
   or `src/render/`. Do not refactor code a task does not name.
5. **Use the canonical names.** All new identifiers are fixed in the Canonical
   Names table below. Do not invent synonyms — the same name must appear
   identically across every file.

### Progress ledger (update as you go)

Check a box only when that task's acceptance criteria pass. `(→ N)` marks a hard
dependency on an earlier task.

- [x] Task 0 — Invariants (no code; read + keep handy)
- [x] Task A — Establish the `src/view/` layer (do before Task 1)
- [x] Task B — Relocate move-tree builders to `core/tree.ts` (do before Task 1)
- [x] Task 1 — `PgnViewerState` + skeleton (→ A, B)
- [x] Task 2 — Stable DOM + single-writer board
- [x] Task 3 — `render()` (nav + move list only) (→ 2)
- [x] Task 4 — Transition methods (→ 2, 3)
- [x] Task 5 — Event delegation (→ 4)
- [x] Task 6 — Observer hook (→ 4)
- [x] Task 7 — Position cache (re-mount survival) (→ 6)
- [x] Task 8 — Write-back firing rules (→ 6)
- [x] Task 9 — Hover preview / flicker fix (→ 2)
- [x] Task 10 — Extract slide animation (→ 2)
- [x] Task 11 — Game selector / `loadGame` (→ 6)
- [x] Task 12 — Preserve user arrows (→ 2)
- [x] Task 13 — Engine-ready move path (→ 4)
- [x] Task 14 — Obsidian lifecycle + integration (→ 6, 7, 8)
- [x] Task 15 — Tests (→ 4, 6)
- [ ] Final verification gate (manual smoke tests in Obsidian)

### Canonical names (use these exact identifiers)

| Concept | Exact name |
|---|---|
| Viewer class | `PgnViewer` |
| State type | `PgnViewerState` |
| Change event type / reason | `ChangeEvent` / `ChangeReason` |
| Subscribe / emit | `onChange` / `emit` |
| Navigation | `goTo` / `goNext` / `goPrev` |
| Add a move to the tree (human **or** engine) | `commitMove` |
| Promote a variation | `promote` |
| Engine arrows setter | `setEngineArrows` |
| Switch game | `loadGame` |
| Board handle type | `InteractiveBoardHandle` |
| Transient hover display / revert | `preview` / `endPreview` |
| Animated navigation | `animateTo` |
| Stable board node | `boardWrapperEl` |
| Position cache + helpers (existing) | `viewerPositionCache` / `nodeToPath` / `pathToNode` |
| Animation helper (existing) | `animatePieceOverlay` |
| Write-back (existing) | `writeBackPgn` |
| Lifecycle wrapper | `PgnViewerChild` |

### Target layer architecture

This rewrite introduces a **fourth layer, `src/view/`**, to fix a structural gap:
interaction logic (pointer/drag handling, selection, animation, the viewer
itself) is DOM-aware but **not** Obsidian-specific, and today it has nowhere to
live except `plugin/main.ts` (which is why that file is 1094 lines). `view/` is
DOM-aware and Obsidian-free, sitting between `render/` and `plugin/`.

Dependencies still flow strictly downward — a layer may import only from layers
below it:

```
core/    — pure logic, no DOM, no Obsidian      (imports: nothing upward)
render/  — pure string → SVG/HTML, no DOM       (imports: core)
view/    — DOM-aware, Obsidian-free             (imports: render, core)   ← NEW
plugin/  — Obsidian wiring only                 (imports: view, render, core)
```

`view/` may touch the DOM and call `renderBoard`/`buildMoveListHtml`, but must
**not** `import` from `obsidian` or from `plugin/`. That keeps it testable in
jsdom without an Obsidian mock.

---

## Background — why the rewrite

The PGN viewer grew across five feature waves, each layered onto the previous
structure rather than anticipated:

1. Linear playback (flat `Snapshot[]`)
2. Variations → forced a rewrite to the `MoveNode` tree
3. Interactive moves → forced the "DOM-stable mount" refactor (commit `0104226`)
4. Write-back to the vault file (commit `07bcadf`), then a position-cache fix
   (commit `ecf12a6`)
5. Engine analysis (arrows, eval panel, Stockfish WASM)

The result: `src/plugin/main.ts` is 1094 lines, touched in 25 of 30 commits, and
`mountPgnViewer` is a ~170-line closure that owns navigation, animation, engine
arrows, write-back, hover, and event wiring. State is duplicated between the
viewer closure and the block-processor closure and kept in sync by hand.

The rewrite extracts the viewer into a `PgnViewer` class with a single owned
state object. The hard part is **not** the class — it is preserving four
behaviors that are easy to silently break (see Task 0).

---

## Task 0 — Invariants (read before any other task)

These rules are non-negotiable. Two of them prevent re-introducing bugs that
were already fixed once. Violating them will pass a casual smoke test and fail
in real use. Each invariant ends with a **Check:** — a command that must hold
after the rewrite is complete.

### Invariant A — The board wrapper is a stable DOM node with exactly one writer

`boardWrapperEl` (`.chess-board-wrapper`) is created **once** at mount and is
**never** removed, replaced, or reassigned. Exactly one piece of code sets its
`innerHTML`: the interactive board's own internal `render()`. Every other part
of the system that wants to change the board calls a **method on the interactive
board handle** — never `boardWrapperEl.innerHTML = ...` directly.

> Why: the current code has **four** uncoordinated writers to
> `boardWrapperEl.innerHTML` — `mountInteractiveBoard.render`, the hover handler
> (`main.ts:648`), the engine-arrow branch (`main.ts:717`), and the animation
> branch (`main.ts:721`). They race; after an Analyze the interactive board's
> internal `state`/`lastMove`/`userArrows` go stale relative to the DOM, and
> user-drawn arrows vanish. Reusing `renderControls` (which emits the board SVG
> inside its output) inside `render()` re-introduces this. **Do not render the
> board through `renderControls`.**
>
> locate: `grep -n "innerHTML = renderBoard" src/plugin/main.ts`
>
> **Check:** `grep -n "innerHTML\|renderBoard\|renderControls" src/view/pgn-viewer.ts`
> returns nothing. (All board writes live in the interactive-board module, not the
> viewer.)

### Invariant B — `render()` re-renders nav + move list ONLY, never the board

`PgnViewer.render()` updates two HTML regions: the nav buttons' disabled state
and the move list. It must not touch `boardWrapperEl`. The board changes only
through the interactive board handle (Invariant A). These are two DOM regions
with two distinct owners.

> **Check:** the body of `render()` in `src/view/pgn-viewer.ts` contains no
> reference to `boardWrapperEl`, `this.board`, `renderBoard`, or `renderControls`.

### Invariant C — Write-back triggers a full re-mount; viewer position must survive it

`writeBackPgn` calls `app.vault.modify`, which makes Obsidian **re-run the entire
block processor**, which constructs a brand-new `PgnViewer`. The user's current
position must be restored after this re-mount, or they snap back to move 1 on
every interactive move.

> Why: this is exactly the bug commit `ecf12a6` fixed. The `viewerPositionCache`
> module-global plus `nodeToPath`/`pathToNode` (`main.ts:451-473`) exist solely
> to survive the re-mount. **Do not delete them.** See Task 7.
>
> locate: `grep -n "viewerPositionCache\|nodeToPath\|pathToNode" src/plugin/main.ts`
>
> **Check:** the three symbols above still exist in `src/plugin/main.ts` after the
> rewrite (grep returns their definitions, not just call sites).

### Invariant D — Write-back fires only on tree-mutating transitions

Write-back runs only when the move tree actually changes: a new interactive move
(`commitMove`) or a variation promotion (`promoteVariation`). It must **not**
fire on plain navigation (`goTo`/`goNext`/`goPrev`).

> Why: the current code fires `writeBackPgn` inside `onNavigate`
> (`main.ts:1058`), which runs on every prev/next/click, rewriting the note file
> on every click through a game. See Task 8.
>
> locate: `grep -n "writeBackPgn(" src/plugin/main.ts`
>
> **Check:** `writeBackPgn` is called from exactly one place — an `onChange`
> listener guarded by `reason === "move" || reason === "promote"`. Manual: note
> mtime is unchanged after pressing prev/next, and changes after an interactive
> move.

---

## Task A — Establish the `src/view/` layer

**Goal:** create the new layer and move the interaction code that is DOM-aware
but Obsidian-free out of `plugin/main.ts`. This is purely a relocation — no
behavior change — so it can be verified by build + tests before the rewrite proper.

**Files:** create `src/view/` and move the functions below into it; update imports
in `src/plugin/main.ts`.

**Steps:**

1. Create these files and move the named functions verbatim (fix imports only):
   - `src/view/interactive-board.ts` ← `mountInteractiveBoard` + `squareFromEvent`
     + the `InteractiveBoardHandle` type.
     locate: `grep -n "function mountInteractiveBoard\|function squareFromEvent" src/plugin/main.ts`
   - `src/view/animation.ts` ← `animatePieceOverlay`.
     locate: `grep -n "function animatePieceOverlay" src/plugin/main.ts`
   - `src/view/pgn-viewer.ts` — created empty here; filled by Tasks 1–14.

2. `view/` may import from `render/` and `core/` only. Add nothing from
   `obsidian` or `plugin/` to any `view/` file. `resolvePieceUrl` stays in
   `plugin/` (it needs the Obsidian resource path) and is passed into `view/`
   via `BoardConfig.resolvePieceUrl`, as it already is.

3. Tests move alongside: create `tests/view/` for any relocated coverage.

**Acceptance criteria:**
- `npm run build && npm test` pass with no behavior change.
- `grep -rn "from \"obsidian\"\|from \"\.\./plugin" src/view/` returns nothing.
- `grep -n "mountInteractiveBoard\|animatePieceOverlay\|squareFromEvent" src/plugin/main.ts`
  shows only imports, not definitions.

**Do not:**
- Do not change any logic during the move — relocation only. Behavioral changes
  to the interactive board happen later (Task 2).

---

## Task B — Relocate the move-tree builders to `core/tree.ts`

**Goal:** the move tree is a state model, not rendering. Move its construction
out of `render/controls.ts` so `render/` only consumes a tree, never builds one.

**Files:** create `src/core/tree.ts`; trim `src/render/controls.ts`; update imports.

**Steps:**

1. Move these from `controls.ts` to `core/tree.ts` verbatim: `buildMoveTree`,
   `buildLine`, `attachVariation`, `makeNode`, `findNodeById`, `attachMove`,
   `promoteVariation` (and the `_idCounter`).
   locate: `grep -n "buildMoveTree\|attachMove\|promoteVariation\|findNodeById" src/render/controls.ts`

2. `controls.ts` keeps only HTML generation: `renderControls`, `buildMoveListHtml`,
   `renderLine`, `nagSymbol`, `escapeHtml`. After the move it should import from
   `../core/tree` and `../core/types` and **no longer** import `parseFEN` or
   `applyMoveEx`.

3. Update every import of the moved symbols to point at `core/tree`: this
   affects Tasks 1, 4, 5, and 11, and the current `main.ts` block processor.

4. `nodeToPath` / `pathToNode` (currently in `main.ts`) are pure tree-path
   helpers — move them to `core/tree.ts` too. `viewerPositionCache` stays in
   `plugin/` (it is tied to Obsidian's re-render lifecycle — see Invariant C).

**Acceptance criteria:**
- `npm run build && npm test` pass.
- `grep -n "parseFEN\|applyMoveEx" src/render/controls.ts` returns nothing.
- `grep -n "from \"\.\./core/tree\"" src/render/controls.ts` is present.

**Do not:**
- Do not move `renderControls`/`buildMoveListHtml` — they are rendering and stay
  in `render/`.

---

## Task 1 — Define `PgnViewerState` and the `PgnViewer` skeleton

**Goal:** create the file and the state container. No behavior yet.

**Files:** create `src/view/pgn-viewer.ts`.

**Steps:**

1. Define the state interface (plain data, no DOM references):

   ```ts
   interface PgnViewerState {
     root: MoveNode;
     current: MoveNode;
     result: string;
     engineArrows: EngineArrow[];   // [] when none
   }
   ```

   Note: hover state and animation handles are **not** in this object — they are
   transient view concerns owned by the interactive board handle (Task 9), not
   committed viewer state.

2. Define the class skeleton:

   ```ts
   class PgnViewer {
     private state: PgnViewerState;
     private listeners: ((e: ChangeEvent) => void)[] = [];

     // stable DOM nodes, created in mount()
     private boardWrapperEl!: HTMLElement;
     private navPrevEl!: HTMLButtonElement;
     private navNextEl!: HTMLButtonElement;
     private moveListEl!: HTMLElement;
     private turnIndicatorEl!: HTMLElement;
     private board!: InteractiveBoardHandle;

     constructor(
       private host: HTMLElement,
       root: MoveNode,
       private config: BoardConfig,
       current: MoveNode,
       result: string,
     ) {
       this.state = { root, current, result, engineArrows: [] };
     }

     mount(): void { /* Task 2,3,5 */ }
     destroy(): void { /* Task 14 */ }
   }
   ```

3. Define the change-event type (used by Task 6):

   ```ts
   type ChangeReason = "navigate" | "move" | "promote" | "load-game";
   interface ChangeEvent { current: MoveNode; root: MoveNode; reason: ChangeReason; }
   ```

**Acceptance criteria:**
- File compiles under `strict: true`.
- `PgnViewer` has explicit return types on all methods.
- No DOM access in the constructor.

---

## Task 2 — Build the stable DOM skeleton and the single-writer board

**Goal:** `mount()` builds the fixed DOM and the one board writer (Invariant A).

**Files:** `src/view/pgn-viewer.ts`; extend the handle in
`src/view/interactive-board.ts` (moved there in Task A).

**Steps:**

1. In `mount()`, create the stable skeleton **once**:

   ```ts
   const viewer = this.host.createDiv({ cls: "chess-viewer" });
   this.boardWrapperEl   = viewer.createDiv({ cls: "chess-board-wrapper" });
   const nav             = viewer.createDiv({ cls: "chess-nav" });
   this.navPrevEl        = nav.createEl("button", { text: "←" });
   this.navNextEl        = nav.createEl("button", { text: "→" });
   this.turnIndicatorEl  = viewer.createDiv({ cls: "chess-turn-indicator" });
   this.moveListEl       = viewer.createDiv({ cls: "chess-move-list-container" });
   ```

2. Extend `InteractiveBoardHandle` so that **every** board mutation has a method
   — no caller ever writes `boardWrapperEl.innerHTML`:

   ```ts
   interface InteractiveBoardHandle {
     getState(): BoardState;
     setState(s: BoardState, lastMove?: { from: number; to: number }): void;
     setEngineArrows(arrows: EngineArrow[]): void;   // [] clears them
     animateTo(s: BoardState, from: number, to: number): void; // slide then commit
     preview(s: BoardState, lastMove?: { from: number; to: number }): void; // transient
     endPreview(): void;                              // revert to committed state
   }
   ```

3. Move the engine-arrow rendering and the slide animation **inside** the handle
   (they currently live in `update()` at `main.ts:716-732` and write the DOM
   directly). After this task, `setEngineArrows` and `animateTo` are the only
   ways those visuals happen, and they preserve the board's internal
   `state`/`lastMove`/`userArrows`.

4. Mount the board once:

   ```ts
   this.board = mountInteractiveBoard(
     this.boardWrapperEl, this.state.current.state, this.config,
     this.turnIndicatorEl,
     (san, from, to, newState) => this.commitMove(san, from, to, newState),
   );
   ```

   Change `mountInteractiveBoard`'s `onMove` callback to pass
   `(san, from, to, newState)` so the viewer does not recompute the move.

**Acceptance criteria:**
- `grep -n "boardWrapperEl.innerHTML\|\.innerHTML = renderBoard" src/plugin` returns
  results **only** inside `mountInteractiveBoard`'s internal `render`.
- Engine arrows survive having user arrows on the board (draw a right-drag arrow,
  Analyze — both are visible afterward).

**Do not:**
- Do not call `renderBoard` anywhere in `pgn-viewer.ts`.
- Do not have `render()` (Task 3) touch the board.

---

## Task 3 — Implement `render()` (nav + move list only)

**Goal:** one method that refreshes the non-board UI from `this.state`.

**Files:** `src/view/pgn-viewer.ts`.

**Steps:**

1. Implement:

   ```ts
   private render(): void {
     this.navPrevEl.disabled = !this.state.current.parent;
     this.navNextEl.disabled = !this.state.current.next;

     const color = this.state.current.state.activeColor;
     this.turnIndicatorEl.className =
       `chess-turn-indicator chess-turn-indicator--${color}`;
     this.turnIndicatorEl.setText(color === "w" ? "White to move" : "Black to move");

     this.moveListEl.innerHTML =
       buildMoveListHtml(this.state.root, this.state.current.id, this.state.result);

     this.scrollActiveMoveIntoView();
   }
   ```

2. `scrollActiveMoveIntoView()` finds `[data-active="true"]` in `moveListEl` and
   calls `scrollIntoView({ block: "nearest" })`.

**Acceptance criteria:**
- `render()` contains no reference to `boardWrapperEl`, `renderBoard`, `this.board`,
  or `renderControls`.
- Calling `render()` twice in a row produces identical DOM (idempotent).

---

## Task 4 — Implement transition methods

**Goal:** the only ways `this.state` changes. Each updates state, drives the
board via the handle, calls `render()`, and emits a change event (Task 6).

**Files:** `src/view/pgn-viewer.ts`.

**Steps:** implement each method. Keep each ≤ 20 lines.

```ts
goTo(node: MoveNode): void {
  this.board.endPreview();
  this.state = { ...this.state, current: node, engineArrows: [] };
  const lm = node.from >= 0 ? { from: node.from, to: node.to } : undefined;
  this.board.setState(node.state, lm);   // navigation = instant, no animation by default
  this.render();
  this.emit("navigate");
}

goNext(): void {
  const n = this.state.current.next;
  if (!n) return;
  this.board.animateTo(n.state, n.from, n.to);   // slide forward
  this.state = { ...this.state, current: n, engineArrows: [] };
  this.render();
  this.emit("navigate");
}

goPrev(): void {
  const p = this.state.current.parent;
  if (!p) return;
  const c = this.state.current;
  if (c.from >= 0) this.board.animateTo(p.state, c.to, c.from); // slide back
  else this.board.setState(p.state);
  this.state = { ...this.state, current: p, engineArrows: [] };
  this.render();
  this.emit("navigate");
}

commitMove(san: string, from: number, to: number, newState: BoardState): void {
  const node = attachMove(this.state.current, san, newState, from, to);
  this.state = { ...this.state, current: node, engineArrows: [] };
  this.board.setState(node.state, { from, to });
  this.render();
  this.emit("move");   // tree mutated → write-back (Invariant D)
}

promote(varHead: MoveNode): void {
  promoteVariation(varHead);
  this.render();
  this.emit("promote"); // tree mutated → write-back
}

setEngineArrows(arrows: EngineArrow[]): void {
  this.state = { ...this.state, engineArrows: arrows };
  this.board.setEngineArrows(arrows);
  // no emit — arrows are not a tree change and not navigation
}
```

**Acceptance criteria:**
- `goNext`/`goPrev` at the ends of the line are no-ops (early return).
- `commitMove` on a SAN that already exists returns the existing node via
  `attachMove` (no duplicate branch).
- Exactly `commitMove` and `promote` emit a `"move"`/`"promote"` reason; the
  three navigation methods emit `"navigate"`.

**Do not:**
- Do not call `writeBackPgn` from here. Write-back is a listener (Task 8).

---

## Task 5 — Event delegation

**Goal:** one click listener and one hover pair on stable containers; survives
move-list `innerHTML` swaps because the listener is on the parent.

**Files:** `src/view/pgn-viewer.ts`.

**Steps:**

1. Nav buttons: `this.navPrevEl.onclick = () => this.goPrev();` and likewise next.

2. One delegated click on `this.moveListEl`:

   ```ts
   this.moveListEl.addEventListener("click", (e) => {
     const t = e.target as HTMLElement;
     const promoteId = t.closest<HTMLElement>("[data-promote-id]")?.dataset.promoteId;
     if (promoteId) {
       const n = findNodeById(this.state.root, Number(promoteId));
       if (n) this.promote(n);
       return;
     }
     const nodeId = t.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
     if (nodeId) {
       const n = findNodeById(this.state.root, Number(nodeId));
       if (n) this.goTo(n);
     }
   });
   ```

3. Hover is wired in Task 9 (it needs the preview API).

**Acceptance criteria:**
- Listeners are attached in `mount()` exactly once, on `navPrevEl`, `navNextEl`,
  and `moveListEl` — never re-attached after a `render()`.

---

## Task 6 — Observer hook (replace the `onNavigate` callback)

**Goal:** eliminate the duplicated `current` state and the circular
viewer→`onNavigate`→`viewer.update` flow (`main.ts:1053-1062`). External code
observes; it does not drive the viewer.

**Files:** `src/view/pgn-viewer.ts`.

**Steps:**

1. Add subscription + emit:

   ```ts
   onChange(fn: (e: ChangeEvent) => void): void { this.listeners.push(fn); }

   private emit(reason: ChangeReason): void {
     const e = { current: this.state.current, root: this.state.root, reason };
     for (const fn of this.listeners) fn(e);
   }
   ```

2. `PgnViewer` is now the **sole owner** of `current` and `root`. The block
   processor must not keep its own `current` variable; it reads
   `e.current` from the change event.

**Acceptance criteria:**
- After integration (Task 14), `grep -n "let current" src/plugin/main.ts` shows
  no viewer-position variable in the block processor.
- No method on `PgnViewer` calls back into a host-supplied callback that then
  calls a `PgnViewer` method (no re-entrancy).

---

## Task 7 — Preserve the write-back re-mount position cache (Invariant C)

**Goal:** keep the user's position across the block-processor re-run that
write-back causes.

**Files:** `src/plugin/main.ts` (keep the existing helpers), `src/view/pgn-viewer.ts`.

**Steps:**

1. Keep `viewerPositionCache`, `nodeToPath`, `pathToNode` exactly as they are
   (`main.ts:451-473`). Do not move them into the viewer — they must outlive any
   single `PgnViewer` instance, because a new instance is created on re-mount.

2. In the block processor, on mount: compute `viewerKey` from `ctx` +
   `sectionInfo.lineStart`, look up the saved path, resolve it with
   `pathToNode(root, savedPath)`, and pass the resulting node as the `current`
   argument to `new PgnViewer(...)`.

3. Register a listener that saves the path on **every** change:

   ```ts
   viewer.onChange((e) => {
     if (viewerKey) viewerPositionCache.set(viewerKey, nodeToPath(e.current));
   });
   ```

**Acceptance criteria:**
- Make an interactive move at move 10 in a single-game block. After the
  write-back re-render, the board is still at move 10, not the start.

**Do not:**
- Do not store the cache inside `PgnViewer`.
- Do not remove the cache "because the class owns state now" — the class is
  destroyed and recreated on re-mount.

---

## Task 8 — Write-back firing rules and the multi-game decision (Invariant D)

**Goal:** write-back runs only on tree mutations, and the multi-game limitation
is explicit rather than silent.

**Files:** `src/plugin/main.ts`; keep `writeBackPgn` (`main.ts:482-504`) as-is.

**Steps:**

1. Register write-back as a listener gated on reason:

   ```ts
   viewer.onChange((e) => {
     if (e.reason !== "move" && e.reason !== "promote") return; // Invariant D
     if (games.length !== 1) { /* see step 2 */ return; }
     writeBackPgn(app, ctx, el, serializeMoveTree(e.root, games[0].result));
   });
   ```

2. The multi-game gap is currently silent: interactive moves in a multi-game PGN
   are discarded with no feedback. Make the decision explicit. Default decision
   (implement this unless told otherwise): when `games.length > 1`, interactive
   moves are **session-only** — keep them in the tree (so the user can explore)
   but skip write-back, and add a one-time notice in the UI:
   `"Editing is disabled for multi-game PGN files."` Place the notice in the
   `.chess-game-selector` row.

**Acceptance criteria:**
- Clicking prev/next/move-token in a single-game block does **not** modify the
  source file (check file mtime is unchanged after navigation).
- Making an interactive move **does** modify the file.
- A multi-game block shows the "editing disabled" notice and never writes back.

---

## Task 9 — Hover preview without flicker

**Goal:** hovering a move shows its position instantly with no flicker and no
animation churn.

**Files:** `src/view/pgn-viewer.ts`; preview methods on the handle (Task 2).

**Root cause being fixed:** the current handler uses `mouseover` (which bubbles
through a token's child spans), and on each firing it sets
`boardWrapperEl.innerHTML` and starts a fresh `animatePieceOverlay`
(`main.ts:636-658`). Re-entering the same token restarts everything → flicker.
locate: `grep -n "addEventListener(\"mouseover\"" src/plugin/main.ts`

**Steps:**

1. Track the hovered node id and make re-entry a no-op:

   ```ts
   private hoveredId: number | null = null;
   ```

2. Delegate hover on `moveListEl`, but act only when the node actually changes:

   ```ts
   this.moveListEl.addEventListener("pointerover", (e) => {
     const id = (e.target as HTMLElement)
       .closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
     if (!id) return;
     const n = Number(id);
     if (n === this.hoveredId || n === this.state.current.id) return; // idempotent
     this.hoveredId = n;
     const node = findNodeById(this.state.root, n);
     if (node) {
       const lm = node.from >= 0 ? { from: node.from, to: node.to } : undefined;
       this.board.preview(node.state, lm);   // instant snap, no animation
     }
   });

   this.moveListEl.addEventListener("pointerleave", () => {
     if (this.hoveredId === null) return;
     this.hoveredId = null;
     this.board.endPreview();                // revert to committed position, no animation
   });
   ```

3. `preview()`/`endPreview()` live in the handle (Invariant A). `preview` shows a
   transient state without changing the board's committed `state`; `endPreview`
   restores the committed `state`. Neither animates.

**Acceptance criteria:**
- Hovering slowly across a dense move list with NAGs and comments produces **no**
  flicker (the board changes once per distinct move, not per sub-span).
- Moving the pointer off the list restores the current position immediately.
- Committed state is unchanged by hovering (hover then click elsewhere starts
  from the right position).

**Do not:**
- Do not animate on hover or on hover-exit.
- Do not write `boardWrapperEl.innerHTML` from the hover handler.

---

## Task 10 — Extract the slide animation

**Goal:** one pure-ish helper, called only from inside the handle's `animateTo`.

**Files:** create `src/view/animation.ts`; move `animatePieceOverlay`
(`main.ts:510-567`) there unchanged in behavior.
locate: `grep -n "function animatePieceOverlay" src/plugin/main.ts`

**Steps:**

1. Export:

   ```ts
   export function animatePieceOverlay(
     wrapper: HTMLElement,
     move: { from: number; to: number },
     config: BoardConfig,
     pieceUrl: string,
     onDone?: () => void,
   ): () => void; // returns cancel()
   ```

2. The handle's `animateTo(state, from, to)`: render the destination state with
   the dest piece hidden (`animatedMove`), call `animatePieceOverlay`, and on
   completion commit the state so pointer events work again. Store the `cancel`
   handle; cancel it if another navigation arrives before it finishes.

**Acceptance criteria:**
- `animatePieceOverlay` has no reference to `PgnViewer` or module globals.
- Rapidly pressing → cancels the in-flight slide and starts the next without
  leaving orphaned overlay `<img>` nodes in the DOM.

---

## Task 11 — Game selector / `loadGame` transition

**Goal:** the multi-game `<select>` works against the class without external
state juggling (replaces the `reset()` path at `main.ts:738-743, 1037-1043`).
locate: `grep -n "function reset\|chess-game-select" src/plugin/main.ts`

**Files:** `src/view/pgn-viewer.ts`; block processor in `main.ts`.

**Steps:**

1. Add a transition:

   ```ts
   loadGame(root: MoveNode, result: string): void {
     this.board.endPreview();
     this.state = { root, current: root, result, engineArrows: [] };
     this.board.setState(root.state);
     this.render();
     this.emit("load-game");
   }
   ```

2. The `<select>` change handler builds the new tree and calls
   `viewer.loadGame(buildMoveTree(startFen, games[i].moves), games[i].result)`.
   It does not touch any `current`/`root` variable itself.

3. Engine analysis reset on game change: the analysis-panel reset (currently
   `analysisReset?.()` at `main.ts:1041`) becomes a `loadGame` listener:
   `viewer.onChange((e) => { if (e.reason === "load-game") analysisReset?.(); });`

**Acceptance criteria:**
- Switching games resets the move list, board, engine arrows, and analysis panel.
- The position cache key still tracks the new game's position after a switch.

---

## Task 12 — Preserve user-drawn arrows across navigation and analysis

**Goal:** right-drag user arrows (`mountInteractiveBoard`, `main.ts:396-435`)
are not silently wiped by navigation, engine arrows, or animation.
locate: `grep -n "Right-drag arrow drawing\|userArrows" src/plugin/main.ts`

**Files:** `src/view/interactive-board.ts` (or wherever the handle lives).

**Steps:**

1. Decide and document the semantics (default: user arrows are cleared when
   `current` changes via navigation/move, but **not** by `setEngineArrows`,
   `preview`/`endPreview`, or `animateTo` mid-flight). Implement that in the
   handle so all four board mutators agree.

2. Because all board writes now go through the handle (Invariant A), the handle's
   internal `render()` always includes `userArrows` — there is no code path that
   renders the board without them except a deliberate clear.

**Acceptance criteria:**
- Draw a user arrow, press → and ← : the arrow clears on navigation (expected),
  but Analyze on a static position keeps any arrows drawn since the last
  navigation.
- No code path renders the board omitting `userArrows` unintentionally.

---

## Task 13 — Make the move-commit path engine-ready (Phase 5)

**Goal:** human-vs-engine play (CLAUDE.md Phase 5) reuses `commitMove` without a
second code path.

**Files:** `src/view/pgn-viewer.ts`.

**Steps:**

1. Confirm `commitMove(san, from, to, newState)` is source-agnostic — it does not
   assume the move came from a pointer event. An engine move is just
   `viewer.commitMove(...)` computed from the engine's chosen UCI move via
   `applyMoveEx`.

2. Do not special-case engine moves in write-back: an engine move is a tree
   mutation and should follow Invariant D like any other.

**Acceptance criteria:**
- There is exactly one method that grafts a move onto the tree (`commitMove`);
  human and (future) engine moves both call it.

**Do not:**
- Do not build engine play mode now. Only ensure the seam exists so it does not
  require reopening the viewer later.

---

## Task 14 — Obsidian lifecycle and integration

**Goal:** the block processor shrinks to wiring; listeners are cleaned up on
re-render.

**Files:** `src/plugin/main.ts`.

**Steps:**

1. Wrap the viewer in a `MarkdownRenderChild` so Obsidian calls cleanup when the
   block is re-rendered or the note closes:

   ```ts
   class PgnViewerChild extends MarkdownRenderChild {
     constructor(containerEl: HTMLElement, private viewer: PgnViewer) { super(containerEl); }
     onunload(): void { this.viewer.destroy(); }
   }
   // ...
   ctx.addChild(new PgnViewerChild(el, viewer));
   ```

2. `PgnViewer.destroy()` cancels any in-flight animation, calls
   `this.board.endPreview()`, removes any `document`/`body`-level listeners or
   nodes created by the board (drag ghost, arrow-comment overlay), and clears
   `this.listeners`.

3. The PGN branch of the block processor becomes: parse → build tree → restore
   cached position → `new PgnViewer(...)` → `mount()` → register the position-cache
   listener (Task 7), the write-back listener (Task 8), and (if `analysis`) the
   analysis panel + its arrow/reset listeners. Target ≤ 40 lines.

**Acceptance criteria:**
- Editing a note with a chess block repeatedly does not accumulate
  `document`-level listeners or stray overlay nodes (inspect after 5 edits).
- The block processor's PGN branch has no navigation/animation/hover logic.

---

## Task 15 — Tests

**Goal:** lock the transition logic, which is now plain-data and DOM-free.

**Files:** create `tests/view/pgn-viewer.test.ts`.

**Steps:** test the transition methods by constructing a `PgnViewer` with a small
tree and inspecting `state.current`/`state.root`/emitted events. Stub the
interactive board handle with a no-op object so no DOM is needed.

Cases:
- `goNext` advances to `current.next`; no-op at the end of the line.
- `goPrev` retreats to `current.parent`; no-op at the root.
- `goTo` jumps to an arbitrary node.
- `goTo`/`goNext`/`goPrev` clear `engineArrows` and emit reason `"navigate"`.
- `commitMove` on a novel SAN extends the mainline and emits `"move"`.
- `commitMove` on an existing SAN returns the existing node (no duplicate).
- `promote` swaps a variation to the mainline and emits `"promote"`.
- `setEngineArrows` stores arrows and emits **no** event.
- `loadGame` replaces root + current and emits `"load-game"`.
- A registered `onChange` listener receives every event with the correct reason.

**Acceptance criteria:**
- All cases pass under vitest with no DOM/jsdom dependency for the transition
  tests.

---

## Files created or modified (summary)

| File | Change |
|---|---|
| `src/view/pgn-viewer.ts` | **Create** (Task A empty, Tasks 1–14 fill) — `PgnViewer` class, state, transitions, observer |
| `src/view/animation.ts` | **Create** (Task A) — `animatePieceOverlay` moved from `main.ts` |
| `src/view/interactive-board.ts` | **Create** (Task A) — `mountInteractiveBoard` + `squareFromEvent` + extended single-writer handle |
| `src/core/tree.ts` | **Create** (Task B) — move-tree builders + `nodeToPath`/`pathToNode` moved out of `render`/`plugin` |
| `src/render/controls.ts` | **Trim** (Task B) — keep only HTML generation; tree builders move to `core/tree.ts`; never re-render the board via `renderControls` |
| `src/plugin/main.ts` | **Shrink** — PGN branch becomes wiring; keep `viewerPositionCache` + `writeBackPgn`; tree/animation/board code moves to `view/`+`core/` |
| `src/core/types.ts`, `legal.ts`, `moves.ts`, `fen.ts`, `pgn.ts`, `engine.ts` | **No change** |
| `src/plugin/engine-worker.ts` | **No change** |
| `tests/view/pgn-viewer.test.ts` | **Create** |

---

## Global do-not list

- Do not render the board through `renderControls` (re-introduces the multi-writer
  race — Invariant A).
- Do not let `render()` touch the board wrapper (Invariant B).
- Do not delete `viewerPositionCache`; it must stay in `plugin/` (re-introduces
  the `ecf12a6` reset bug — Invariant C). `nodeToPath`/`pathToNode` may move to
  `core/tree.ts` (Task B) but must not be deleted.
- Do not fire write-back on navigation (Invariant D).
- Do not animate on hover or hover-exit.
- Do not duplicate `current`/`root` outside `PgnViewer`.
- Do not introduce a virtual DOM, diffing library, reducer, or observable — a
  plain state object plus named transition methods is sufficient.
- Do not import from `obsidian` or `plugin/` inside any `view/` file.
- Do not change the *logic* of `MoveNode`, `BoardConfig`, or existing `core/`
  files. Adding `core/tree.ts` (Task B) is a relocation, not new logic — it is
  the only permitted `core/` addition.
- Do not build engine play mode now; only keep the `commitMove` seam (Task 13).

---

## Final verification gate

Run all of these after the last task. Every one must pass. If any fails, the
rewrite is not done — fix it or stop and report (do not check the final box).

**1. Build and tests:**

```bash
npm run build && npm test
```

**2. Invariant A — viewer never touches the board directly:**

```bash
grep -n "innerHTML\|renderBoard\|renderControls" src/view/pgn-viewer.ts   # expect: no output
```

**2b. Layer boundaries hold (Tasks A & B):**

```bash
grep -rn "from \"obsidian\"\|from \"\.\./plugin" src/view/    # expect: no output
grep -n "parseFEN\|applyMoveEx" src/render/controls.ts        # expect: no output (tree builders moved)
```

**3. Invariant C — position cache survived the rewrite:**

```bash
grep -n "viewerPositionCache\|function nodeToPath\|function pathToNode" src/plugin/main.ts  # expect: all three
```

**4. Invariant D — write-back has exactly one guarded caller:**

```bash
grep -n "writeBackPgn(" src/plugin/main.ts   # expect: one call, inside an onChange listener
```

**5. State is owned only by `PgnViewer`:**

```bash
grep -n "let current" src/plugin/main.ts     # expect: no viewer-position variable in the block processor
```

**6. Manual smoke (in the test vault):**
- Navigate prev/next through a single-game block → note file mtime unchanged.
- Make an interactive move at move ~10 → file updates *and*, after the
  re-render, the board stays at the move you were on (not move 1).
- Hover slowly across a dense move list → no flicker.
- Draw a user arrow, then Analyze → both the user arrow and engine arrows show.
- Switch games in a multi-game block → board, move list, arrows, and analysis
  panel all reset; the "editing disabled" notice is shown.

When all six pass, check the final box in the progress ledger.
