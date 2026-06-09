# Retrospective 2 — Homemade Components vs. Established Libraries

## What prompted this

A bug in `test2.md`: pasting a multi-game PGN after `pgn:` triggered a YAML
parse error because `js-yaml` could not handle PGN headers (`[Site "?"]`,
etc.) appearing as bare lines in the block body.

The fix exposed a deeper question: is wrapping PGN in a YAML block the right
design at all? That led to asking which other components were built from scratch
when an established library already solves the problem.

---

## The YAML block parser

**What we built:** `parseBlock()` used `js-yaml` to parse the chess fenced block
body as a YAML mapping. The five keys (`fen`, `pgn`, `orientation`, `theme`,
`analysis`) were extracted from the parsed object.

**What went wrong:** multi-line PGN inside a YAML value requires either a
block literal (`pgn: |` + indented content) or quoting. Neither is natural when
pasting raw PGN from a chess tool. The workaround (`preprocessMultilinePgn`)
was fragile and still broke when users tried to add `|` manually.

**Resolution:** replaced `js-yaml` + the preprocessor with a simple line-by-line
custom parser. For `pgn:`, it collects everything until the next known key or
EOF — no YAML rules apply to the content. The other four keys remain
single-line. The chess block syntax was never actually YAML in practice; it just
looked like it.

**Lesson:** using a general-purpose serialization library for a five-key DSL
means the library's rules leak into the user-facing format. A trivial custom
parser owns the format completely and is easier to extend.

**Update (reversed — library-first):** this swap was undone. Replacing a
battle-tested parser with a hand-rolled one is exactly the wheel-reinvention the
project now avoids; `js-yaml` is kept. The multi-line PGN awkwardness is handled
the library-consistent way — a YAML block scalar (`pgn: |` with indented
content) — and documented in the block syntax, rather than by abandoning the
library. See "Principle adopted" below.

---

## Inventory: hand-rolled vs. established libraries

A full sweep of the source: ~3,000 of ~4,285 LOC is hand-rolled chess logic.
Five components were built from scratch; four have a strong library that could
do the job (one is already resolved).

| # | Component | Hand-rolled (files · LOC) | Library | Case |
|---|---|---|---|---|
| 1 | **Rules engine** — FEN, move application, legal moves | `core/fen.ts` 143 · `core/moves.ts` 334 · `core/legal.ts` 415 (+ `types.ts`) ≈ **890** | **chess.js** (BSD) ✅ chosen | Strong — most correctness-critical and bug-prone surface |
| 2 | **PGN parse/serialize** | `core/pgn.ts` 349 (+ tree builders `core/tree.ts` 191) | **@mliebelt/pgn-parser** (Apache) ✅ chosen | Strongest / most actionable — a text format, not chess logic |
| 3 | **Board render + interaction + animation** | `render/board.ts` 274 · `view/interactive-board.ts` 422 · `view/animation.ts` 60 ≈ **756** | **cm-chessboard** (MIT, SVG) | **Candidate** — MIT + SVG matches our renderer; `chessground` rejected (GPL + CSS/DOM mismatch) |
| 4 | **UCI protocol glue** — parse `info`/`bestmove`/`option`, build commands, SAN↔UCI | `core/engine.ts` 228 · `plugin/engine-worker.ts` 464 ≈ **690** | (none strong) | **Keep** — see below |
| 5 | Block params parser | `parseBlock()` in `main.ts` | `js-yaml` | **Resolved** — uses `js-yaml` (custom-parser swap reverted) |

### Decision: stay MIT — `chess.js` + `@mliebelt/pgn-parser`

The tempting unification was `chessops` (the library Lichess ships) — one
TS-native dependency covering both #1 and #2 and shrinking the UCI glue. It was
briefly chosen, then **rejected on licensing.**

**The licensing constraint.** The plugin is **MIT**, and esbuild *bundles* every
`src/` import into `main.js`. `chessops` and `chessground` are **GPL-3.0**, so
importing (bundling) them would force the entire plugin to GPL — copyleft, and
hard to reverse. (`stockfish` is GPL too but is fine: it ships as a *separate*
worker file, mere aggregation, not bundled.) Keeping the plugin permissive wins.

So the permissive picks:

- **#1 rules engine → `chess.js`** (BSD-2). The de-facto standard, most
  battle-tested. Mutable, but wrapped behind our immutable `BoardState` adapter.
- **#2 PGN → `@mliebelt/pgn-parser`** (Apache-2.0). A dedicated PGN text parser
  with full variation/NAG/comment support — the gap chess.js's mainline-only PGN
  loader can't fill. Map its AST to our `MoveNode` tree; replay through chess.js
  for positions.
- **#3 board (later) → `cm-chessboard`** (MIT, SVG). The permissive, SVG-native
  analogue to chessground — keeps our SVG approach instead of chessground's
  CSS/DOM rewrite, and stays MIT. Display + interaction only; legality comes from
  chess.js. **A candidate now, not a forced keep** (GPL `chessground` rejected).

All permissive, so the plugin stays MIT.

### What to keep (deliberately)

- **#4 UCI glue** — keep. "Library-first" must not push us toward an unmaintained
  UCI library. The engine itself is *already* a dependency (the `stockfish`
  package); the remaining glue is small and specific to Obsidian's browser+WASM
  context, where the Node-oriented UCI libraries don't fit.

### Recommended sequence

**#2 PGN (`@mliebelt/pgn-parser`) → #1 rules (`chess.js`) → #3 board
(`cm-chessboard`).** Each step is independently shippable and verified against the
existing test suites. #4 (UCI glue) stays homemade throughout.

---

## Principle adopted: library-first

Now a standing project philosophy, recorded in `CLAUDE.md` ("Coding conventions"
and "Key decisions"):

> **Use the best, most reliable, battle-tested open-source library available —
> don't reinvent the wheel.** Build something new only when there is a real,
> specific reason. Reinvented wheels usually come out square, and the ride has
> been bumpy because of it.

The old blanket rule ("no third-party chess libraries") was **removed** — not
narrowed. Library-first applies everywhere, as much as possible. Per-component
status and the migration sequence are in the Inventory above; the block-params
parser is already resolved (`js-yaml`).

---

## Migration plan

The executable plan to replace the hand-rolled components with the chosen
libraries and delete the old code. Each phase is independently shippable and ends
green; do them in order.

**Order — `#2 PGN → #1 rules → #3 board`, then cleanup. #4 (UCI glue) is kept.**

**Why this order:** PGN (#2) is the most *isolated* change — pure text parsing
that doesn't touch the rules backend — so it's the safe first win. Rules (#1) is
the riskiest core swap; do it with the test harness already warmed up. Board (#3)
is the largest UI change; do it last. PGN replays moves through whatever rules
engine is current, so #2 keeps working after #1 with no rewrite.

**Global rules (every phase):**

- **Keep public signatures + our types stable.** Each replaced module keeps its
  exported signatures and returns our own types (`BoardState`, `PgnMove`,
  `PgnGame`, `MoveNode`, `LegalMove`). The library sits *behind* an adapter inside
  the module; callers in `render/`/`view/`/`plugin/` don't change.
- **Existing tests are the oracle.** The relevant suite stays green with **no test
  edits** — the one exception is Phase 3, which replaces the SVG renderer itself.
  A phase is done only when its suite passes *and* the dead code is deleted.
- **Library imports respect the layers.** chess.js + @mliebelt live in `core/`;
  cm-chessboard in `render/`+`view/`. No new library import in `plugin/`.
- **One commit per phase**, on the `library-first` branch. Run the full suite
  before starting each phase (baseline green).

---

### Phase 1 — PGN parser (#2) → `@mliebelt/pgn-parser`

**Goal:** replace the PGN *text* parser; keep tree-building and serialization ours.
**Library:** `@mliebelt/pgn-parser` (Apache-2.0).
**Files:** `core/pgn.ts` (parse path only). No change to `core/tree.ts`, `render/`,
`view/`, `plugin/`.

**Steps:**

1. `npm install @mliebelt/pgn-parser`.
2. Rewrite `parsePGN` / `parseMultiPGN` to call the library and map its AST → our
   `PgnMove[]` / `PgnGame` (same signatures, same return types).
3. Re-map every edge case the homemade parser handled: `[%clk/eval/emt]`
   comment-annotation stripping, `--` / `Z0` null moves, multi-game splitting,
   NAGs, `{ }` and `;` comments, nested variations, result tokens.
4. Leave `serializeMoveTree` (our `MoveNode` → PGN) untouched — parse side only.
5. Delete the hand-rolled tokenizer / parse internals from `core/pgn.ts`.

**Acceptance:** `tests/core/pgn.test.ts` (64) green, no edits; add real-world
exports (Lichess / Chess.com studies / ChessBase) and they pass; `npm run build`
green.
**Removes:** the hand-rolled PGN parser (parse half of `core/pgn.ts`).

---

### Phase 2 — Rules engine (#1) → `chess.js`

**Goal:** replace FEN, legal-move generation, and move application with chess.js,
behind our signatures and immutable `BoardState`.
**Library:** `chess.js` (BSD-2).
**Files:** `core/fen.ts`, `core/legal.ts`, `core/moves.ts`; new
`core/chessjs-bridge.ts`; opportunistic simplification of `core/engine.ts`.

**Steps:**

1. `npm install chess.js`.
2. `chessjs-bridge.ts`: convert our `BoardState` ↔ chess.js (`Chess` / FEN), and
   our numeric square index `(7-rank)*8+file` ↔ chess.js algebraic `'e4'` — the
   board-index mapping is the integration crux.
3. `parseFEN` / `serializeFEN` → delegate to chess.js + bridge to `BoardState`.
4. `getLegalMoves` / `getSquareLegalMoves` / `isInCheck` → chess.js
   `moves({ verbose })` / `isCheck()`, mapped to our `LegalMove` + indices.
5. `applyMoveEx` / `applyMove` → chess.js `.move(san)`, returning our `BoardState`
   + `{ from, to }`.
6. Simplify `engine.ts` `positionToUci` / `uciPvToSan` using chess.js SAN↔UCI + FEN.
7. Delete the hand-rolled `fen` / `legal` / `moves` internals.

**Acceptance:** `tests/core/fen|legal|moves|engine.test.ts` **and** `pgn.test.ts`
(PGN now replays through chess.js) all green, no edits; full suite + build green;
vault smoke (navigate, interactive move + write-back).
**Removes:** ~890 LOC of hand-rolled rules logic.

---

### Phase 3 — Board (#3) → `cm-chessboard`

**Goal:** replace the SVG board, interaction, and animation with cm-chessboard.
**Library:** `cm-chessboard` (MIT, SVG).
**Files:** retire `render/board.ts`, `view/interactive-board.ts`,
`view/animation.ts`; rework `view/pgn-viewer.ts`; update `esbuild.config.mjs`
(bundle assets).
**Tests:** the one phase that *replaces* tests — `tests/render/board.test.ts` (and
parts of `config.test.ts`) assert our SVG output, which is going away; replace them
with cm-chessboard integration checks. `tests/view/pgn-viewer.test.ts` (transition
logic, board stubbed) stays green.

**Steps:**

1. `npm install cm-chessboard`; bundle its SVG piece sprites into `dist/`
   (replaces `src/render/pieces/`); keep a bundled default so offline still works.
2. Mount cm-chessboard inside `PgnViewer` as the board's **single writer**
   (Invariant A preserved). Its move-input handler → validate via chess.js legal
   dests (#1) → `commitMove`.
3. Add extensions: **Markers** (selection / last-move / legal dots), **Arrows**
   (engine + user arrows), **PromotionDialog**, **Accessibility** — replacing the
   hand-rolled highlight / arrow / promotion / animation code.
4. Map our six `BOARD_THEMES` to cm-chessboard's CSS variables for parity.
5. Delete `render/board.ts`, `view/interactive-board.ts`, `view/animation.ts`,
   and dead config.

**Acceptance:** `tests/view/pgn-viewer.test.ts` green; new board tests pass;
manual smoke — render, interactive move + write-back, flicker-free hover preview,
last-move highlight, engine + user arrows, all six themes, flip board; build green.
**Removes:** ~756 LOC of hand-rolled board / interaction / animation.

---

### Phase 4 — Cleanup & docs

1. Remove orphan exports / dead types; `npm run build && npm test` green.
2. Update `CLAUDE.md` — note which `core/` modules are now thin adapters, and the
   piece-asset source if pieces now ship with cm-chessboard. Mark this plan done.
3. Build + deploy to the test vault; final smoke.

**End state:** `core/` is thin adapters over `chess.js` (#1) + `@mliebelt/pgn-parser`
(#2); the board is `cm-chessboard` (#3); only the UCI glue (#4) and
`serializeMoveTree` remain hand-rolled by design — replacing ~1,900 LOC of
hand-rolled chess/board code with library-backed adapters.

---

## Outcome — what actually shipped ✅

The migration is **complete and merged to `main`.** All four phases landed; the
suite is green at **410 tests across 18 suites**. The end state matches the plan
on three of the four components — with one deliberate divergence on #2.

| # | Component | Planned target | Shipped | Notes |
|---|---|---|---|---|
| 1 | Rules engine | `chess.js` | **`chess.js`** ✅ | `core/chessjs-bridge.ts`; `legal.ts` 415→46, `moves.ts` 334→56. `fen.ts` kept (BoardState↔FEN primitive). |
| 2 | PGN parse/serialize | `@mliebelt/pgn-parser` | **clean-room `pgn-editor/`** ⚠️ | Diverged — see below. `core/pgn.ts` 349→105, delegates to it. |
| 3 | Board / interaction / animation | `cm-chessboard` | **`cm-chessboard`** ✅ | `board.ts` + `interactive-board.ts` + `animation.ts` deleted; now `view/cm-board.ts` + `board-handle.ts` + `cm-theme.css`. |
| 4 | UCI glue | keep homemade | **kept homemade** ✅ | `core/engine.ts` + `plugin/engine-worker.ts`, by design. |
| 5 | Block params | `js-yaml` | **`js-yaml`** ✅ | `plugin/yaml-block.ts`. |

### Why #2 diverged from this plan

This document recommended `@mliebelt/pgn-parser` as **Apache-2.0**. That was
wrong twice over:

1. **License.** `@mliebelt/pgn-parser` is **GPL-3.0**, not Apache. esbuild bundles
   every `src/` import into `main.js`, so importing it would have forced the whole
   plugin to GPL — the exact copyleft trap that disqualified `chessops` and
   `chessground` here. A parse-only library that pins the plugin to GPL is a
   non-starter.
2. **Capability.** The plugin grew an *editing* surface (comments, NAGs, promote
   variation, delete, replace-move). A parser only **reads** PGN. No MIT,
   edit-capable PGN library exists (kokopu=LGPL; chessops & @mliebelt=GPL;
   cm-chess/cm-pgn=MIT but buggy `undo`, no promote). That gap is the **real,
   stated reason** the library-first rule allows building in-house.

So #2 resolved to a clean-room, MIT, FEN-neutral `pgn-editor/` core (parser +
serializer + variation-aware AST + `GameEditor` edit ops), kept liftable into its
own package and boundary-tested. Rules/legality still come from `chess.js`; the
editor is text/AST only. See [`src/pgn-editor/ROADMAP.md`](src/pgn-editor/ROADMAP.md).

This is consistent with, not a violation of, library-first: we used the best
library wherever one fit (#1, #3, #5), kept the small specific glue (#4), and
built only the one component where every candidate library was either
license-incompatible or incapable of the editing the plugin needed.

### Beyond the migration

The editable AST that #2 produced unlocked feature work built on top of it: move
context menu, comment/NAG editing, promote-variation, PGN-header display,
keyboard navigation, "Insert board from PGN", and a resizable/scrollable move
list. None of these would have been reachable with a parse-only PGN library.
