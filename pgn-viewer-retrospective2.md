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

## First migration (sketch): PGN parser → library

The smallest, highest-value first step. Goal: replace the *parse* path in
`core/pgn.ts` with a battle-tested library while keeping the rest of the system
unchanged.

**Library:** `@mliebelt/pgn-parser` (Apache-2.0). PGN-only, low-risk — keeps the
homemade rules engine in place to replay moves into positions, so this step
changes only the text-parse path. (The rules engine is swapped to `chess.js`
later, as a separate step.)

**Keep the public API stable.** `parsePGN`, `parseMultiPGN`, and
`serializeMoveTree` keep their current signatures and return our existing
`PgnGame` / `PgnMove` / `MoveNode` types. The library lives *behind* an adapter,
so `core/tree.ts`, `render/`, `view/`, and `plugin/` never change.

**Steps:**

1. Add the dependency; rewrite `core/pgn.ts` as a thin adapter: library AST →
   our `PgnMove[]` (moves, comments, NAGs, variations).
2. Re-map the edge cases the homemade parser handles today: `[%clk/eval/emt]`
   annotation stripping, `--`/`Z0` null moves, multi-game splitting
   (`parseMultiPGN`), and result tokens.
3. **Serialization stays ours for now.** `serializeMoveTree` walks our `MoveNode`
   tree to PGN for write-back; it is small and tree-specific. Keep it — the
   parse side is where the library wins.
4. Use the existing **`tests/core/pgn.test.ts` (64 cases) as the oracle** — it
   must stay green with **no test edits**. Then add cases from real-world exports
   (Lichess, Chess.com studies, ChessBase) the homemade parser was never tested
   against.

**Done when:** all 64 PGN tests pass against the adapter, no caller changed, and
a multi-game, variation-heavy real-world PGN round-trips (parse → navigate →
write-back) correctly.

**Likeliest gaps:** null moves and `[%clk]` stripping — the library's AST may
expose these differently; cover them explicitly in the adapter.

---

## Later migration (sketch): board → `cm-chessboard` (#3)

After #1 (`chess.js`) and #2 (`@mliebelt/pgn-parser`) land. Replaces our hand-rolled
board UI — `render/board.ts`, `view/interactive-board.ts`, `view/animation.ts`
(~756 LOC) — with `cm-chessboard` (MIT, SVG, zero deps).

**Why it's now viable:** it's SVG (no architectural about-face like chessground's
CSS/DOM) and MIT (no relicense). The earlier "keep homemade" call assumed the only
option was GPL chessground; cm-chessboard removes both objections.

**Scope / shape:**

1. `view/` reorganizes around cm-chessboard's API: its move-input handler drives
   move attempts; we answer with legal targets from `chess.js` (#1) and apply the
   result. The `PgnViewer` single-owner/`onChange` model stays — cm-chessboard
   becomes the board's single writer (Invariant A still holds).
2. Pull in its extensions as needed: **Markers** (selection/last-move/legal-move
   dots), **Arrows** (engine + user arrows), **PromotionDialog**, **Accessibility**.
   These replace our hand-rolled highlight/arrow/animation code.
3. Bundle its SVG piece sets (replaces `src/render/pieces/`); keep `PieceSource`
   config pointing at the bundled set so offline still works.
4. Animation comes from cm-chessboard, so `view/animation.ts` is retired.

**Watch out for:** Obsidian DOM/Electron compatibility (vanilla ES module SVG —
expected fine); theming parity with our six `BOARD_THEMES`; and preserving the
flicker-free hover-preview and last-move highlighting behaviors from Retrospective 1.

**Done when:** the board renders/animates via cm-chessboard, interactive moves +
write-back work, engine + user arrows show, all six themes render, and the
view-layer tests pass. Highest effort of the three; ship #1/#2 first.
