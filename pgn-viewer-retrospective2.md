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
| 1 | **Rules engine** — FEN, move application, legal moves | `core/fen.ts` 143 · `core/moves.ts` 334 · `core/legal.ts` 415 (+ `types.ts`) ≈ **890** | **chessops** (Lichess; TS-native, immutable) or **chess.js** | Strong — most correctness-critical and bug-prone surface |
| 2 | **PGN parse/serialize** | `core/pgn.ts` 349 (+ tree builders `core/tree.ts` 191) | **chessops/pgn** or **@mliebelt/pgn-parser** | Strongest / most actionable — a text format, not chess logic |
| 3 | **Board render + interaction + animation** | `render/board.ts` 274 · `view/interactive-board.ts` 422 · `view/animation.ts` 60 ≈ **756** | **chessground** (Lichess board UI) | Real but highest-effort; architectural mismatch (SVG vs. CSS/DOM) |
| 4 | **UCI protocol glue** — parse `info`/`bestmove`/`option`, build commands, SAN↔UCI | `core/engine.ts` 228 · `plugin/engine-worker.ts` 464 ≈ **690** | (none strong) | **Keep** — see below |
| 5 | Block params parser | `parseBlock()` in `main.ts` | `js-yaml` | **Resolved** — uses `js-yaml` (custom-parser swap reverted) |

### The high-leverage observation: `chessops` covers #1 + #2 together

`chessops` (the library Lichess itself ships) is TypeScript-native and immutable,
which matches our `BoardState` convention better than `chess.js`. One dependency
could:

- replace the **rules engine** (#1) — `chessops/fen`, `chessops/san`,
  `chessops/attacks` cover FEN, SAN, and legal move generation;
- replace the **PGN parser** (#2) — `chessops/pgn` parses *and writes* PGN and
  models a game as a **tree with variations**, mapping almost 1:1 onto our
  `MoveNode` tree;
- shrink the **UCI glue** (#4) — `positionToUci` / `uciPvToSan` in
  `core/engine.ts` exist only because we own the rules engine; chessops does FEN
  and SAN↔UCI natively, so those helpers mostly evaporate.

That retires ~1,200+ LOC of our most dangerous code behind one well-maintained
dependency. `chess.js` is the conservative alternative — even more mileage, but
mutable and weaker on variation trees.

### What to keep (deliberately)

- **#4 UCI glue** — keep. "Library-first" must not push us toward an unmaintained
  UCI library. The engine itself is *already* a dependency (the `stockfish`
  package); the remaining glue is small and specific to Obsidian's browser+WASM
  context, where the Node-oriented UCI libraries don't fit.
- **#3 chessground** — the only swap that fights our SVG architecture. Highest
  effort; do it last, or not at all, unless interaction maintenance (Phase 5
  drag-to-move, premoves) proves too costly.

### Recommended sequence

**#2 PGN → #1 rules (same `chessops` dependency) → reassess #3.** Each step is
independently shippable and verified against the existing test suites.

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

**Library choice.** `@mliebelt/pgn-parser` for a low-risk, PGN-only swap (keeps
the rules engine intact), or `chessops/pgn` if we commit to the chessops path for
#1 in the same pass. Default to the lower-risk option unless #1 is in scope now.

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
   tree to PGN for write-back; it is small and tree-specific. Keep it (adopt
   `chessops/pgn`'s writer later if we go that route) — the parse side is where
   the library wins.
4. Use the existing **`tests/core/pgn.test.ts` (64 cases) as the oracle** — it
   must stay green with **no test edits**. Then add cases from real-world exports
   (Lichess, Chess.com studies, ChessBase) the homemade parser was never tested
   against.

**Done when:** all 64 PGN tests pass against the adapter, no caller changed, and
a multi-game, variation-heavy real-world PGN round-trips (parse → navigate →
write-back) correctly.

**Likeliest gaps:** null moves and `[%clk]` stripping — the library's AST may
expose these differently; cover them explicitly in the adapter.
