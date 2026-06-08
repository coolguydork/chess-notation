# chess-notation

An Obsidian plugin that renders interactive chess boards and understands chess
notation inside markdown notes.

---

## Architecture

The codebase is split into four layers. **Dependencies only flow downward.**
Nothing in a lower layer may import from a layer above it.

```
src/
  core/     — pure chess logic, no UI, no Obsidian
  render/   — board rendering (SVG) and controls (HTML), no Obsidian
  view/     — DOM-aware interaction logic, no Obsidian
  plugin/   — Obsidian glue; wires core + render + view into the plugin lifecycle
tests/
  core/
  render/
  view/
  plugin/
```

Flow: `core → render → view → plugin`. New interaction logic (pointer/drag handling, selection, animation, the PGN viewer) belongs in `view/`, not `plugin/`.

### `core/` — Chess logic
- Board state, rules, move generation: `fen.ts` (FEN parse/serialize), `pgn.ts` (PGN parse via `@mliebelt/pgn-parser` + `serializeMoveTree`), `moves.ts` / `legal.ts` (move application + legal moves, delegated to `chess.js` via `chessjs-bridge.ts`), `tree.ts` (move-tree builders), `engine.ts` (UCI engine logic).
- `game.ts` — `GameEditor`: cm-chess owns the **editable** game (load, add/remove moves, serialize). All PGN *edits* go through it; it projects to a read-only `MoveNode` tree for rendering. Plain holder + functions, no class (core/ convention).
- No DOM, no Obsidian, no side effects. Functions are pure except `GameEditor`'s edit ops, which mutate their cm-chess instance in place.

### `render/` — Board rendering
- Produces SVG from a `core/` board-state value object + a config (colors, theme, orientation, highlights).
- `controls.ts` — `renderControls()` / `buildMoveListHtml()` (PGN viewer HTML); consumes the `core/tree.ts` move tree, never builds one.
- No Obsidian imports — usable in a plain browser or test environment. Piece assets referenced by injected path/URL, never hardcoded.

### `plugin/` — Obsidian integration
- Registers the ` ```chess ` block processor; owns settings (persisted via `loadData()`/`saveData()`), the settings tab (default theme, square size, coordinates toggle), and the `onload`/`onunload` lifecycle.
- Passes user settings down to `render/` as a config object.
- Wiring only — no chess logic, no rendering logic.

---

## Fenced code block syntax

Chess positions and games are embedded in notes using a fenced code block with
the language tag `chess`:

````markdown
```chess
fen: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
orientation: white
theme: classic
```
````

The block body is YAML. Supported keys:
- `fen` — FEN string (required if no `pgn`)
- `pgn` — PGN string (required if no `fen`)
- `orientation` — `white` | `black` (default: `white`)
- `theme` — board color theme name (default: plugin setting); see themes below
- `analysis` — show the engine analysis panel (default: `true`; set to `false` to hide)

`fen` and `pgn` may be combined: `fen` sets the starting position, `pgn`
provides the move list to navigate.

Additional keys will be added in later phases without breaking existing blocks.

---

## Board color themes

| Name | Description |
|---|---|
| `classic` | Lichess brown (default) |
| `blue` | Lichess blue-grey |
| `green` | Chess.com green |
| `dark` | High-contrast dark grey |
| `walnut` | Warm walnut brown |
| `purple` | Soft purple |

Themes are defined in `src/render/config.ts` as `BOARD_THEMES`. Adding a new
theme is a one-line entry in that record.

---

## Phases

### Phases 1–4 ✅
- **1 Foundation:** parse `chess` blocks; static board from FEN; orientation; FEN/render unit tests.
- **2 PGN & navigation:** PGN parser (moves, comments, NAGs, variations); full move engine (castling, en passant, promotion); prev/next + clickable move list.
- **3 Interactivity:** click/tap moves validated against `core/` legal moves; selected/target highlighting; pointer events (mouse + touch).
- **4 Polish:** six themes + `theme:` key; settings tab (theme, square size, coordinates); responsive/mobile board; `styles.css` shipped with `main.js`.

### Phase 5 — Engine integration 🚧
- **Analysis mode ✅** — send the position to Stockfish; show top moves, evaluation, and arrows on the board. Logic in `core/engine.ts` (pure; no Obsidian/rendering); `plugin/` wires the UI; `render/` reuses the Phase 3 highlight API.
- **Engine play mode** (human vs. engine, validated via `core/` rules) — not yet built; reuse `commitMove`.
- **Stockfish delivery — both supported:** WASM (bundled; offline, zero setup; larger bundle) and an external binary (small bundle, full strength, user-installed). The external-binary path is UCI-generic; the WASM path is Stockfish-specific by design.

---

## Coding conventions

- **TypeScript strict mode** (`strict: true` in tsconfig). No `any` unless
  unavoidable and explicitly commented.
- **No classes in `core/`** — prefer plain types + functions. Classes are
  acceptable in `render/` and `plugin/` when they aid encapsulation.
- **Immutable board state** — board positions in `core/` are plain objects;
  mutations return new objects rather than modifying in place.
- **Explicit return types** on all exported functions.
- **Tests live next to their layer** — `tests/core/`, `tests/render/`, etc.
- **Default to TDD where practical, not dogmatically.** Pure functions with clear I/O (parsers, rule checks) are strong test-first candidates; code whose shape is still emerging (SVG output, plugin lifecycle) may be written first and pinned with tests once it settles. Goal: confidence, not ceremony.
- **Use the best, battle-tested open-source library available — don't reinvent the wheel.** In every layer, prefer a well-maintained, widely-adopted library over a homemade one; build new *only* for a real, stated reason. We stick to this as much as possible: reinvented wheels usually come out square, and the ride has been bumpy because of it (see [`pgn-viewer-retrospective2.md`](pgn-viewer-retrospective2.md)).
- Commit messages: imperative mood, short subject line (`Add FEN parser`,
  `Fix castling rights after rook capture`).

---

## Key decisions & rationale

| Decision | Rationale |
|---|---|
| Library-first: use the best battle-tested open-source library; don't reinvent the wheel | Less code to own and debug; inherits years of edge-case coverage. Building our own needs a real, stated reason — reinvented wheels come out square. See [retrospective 2](pgn-viewer-retrospective2.md) |
| `core/` has zero Obsidian imports | Keeps chess logic testable outside Obsidian and reusable |
| `js-yaml` for the chess block body | Human-readable, extensible without breaking old blocks; a battle-tested parser instead of a hand-rolled one (library-first) |
| SVG rendering (not canvas) | SVG is accessible, scalable, and inspectable in devtools |
| Rules engine via `chess.js` (`core/legal.ts`, `moves.ts` delegate through `chessjs-bridge.ts`) | Library-first; `chess.js 1.x` owns legal moves / application / check detection. `fen.ts` stays homemade (it doubles as the BoardState ↔ FEN conversion primitive). |
| PGN **edits** via `cm-chess` (`core/game.ts`) | Editing (add/remove moves, variation branching) rides on a battle-tested library instead of homemade tree mutation. cm-chess owns the editable game; we project to `MoveNode` for rendering and serialize via `serializeMoveTree` (cm-pgn's `render()` mis-emits NAGs / SetUp-FEN numbers). cm-pgn pulls in a second engine (`chess.mjs`); accepted. Multi-game + null-move games stay read-only on the `@mliebelt` path. |
| Four-layer architecture (`core → render → view → plugin`) | Enforces separation so phases don't require refactoring layer boundaries |
| Piece assets default to bundled | Obsidian is local-first; offline must always work without configuration |
| Pointer events for interaction | Single handler works for both mouse and touch; no separate touch wiring |
| Themes as named presets | Easy to extend; per-block `theme:` key overrides the plugin default |

## Lessons learned (`plugin/` layer discipline)

The layer boundary held: `core/` and `render/` barely churned. **Every painful
rewrite happened in `plugin/`, where stateful UI wiring lives.** Apply these to
any new `plugin/` work (full post-mortem in [`pgn-viewer-retrospective.md`](pgn-viewer-retrospective.md)):

- **Model for the next phase, not just the current one.** The big rewrites came from a shape that fit current scope but not the known-future one (`Snapshot[]` → `MoveNode` tree; full re-render → DOM-stable mount). Give the *shape* room for named future requirements now. A linear game is just a tree with no branches.
- **One owner per piece of mutable state.** Duplicating state across closures and hand-syncing it is the root of most viewer bugs (e.g. `current` in both viewer and block processor). State lives in one place; others observe via an event/hook, never a callback that re-enters and re-sets it.
- **One writer per shared DOM node.** A node mutated by several paths (board: interactive + hover + arrows + animation) races and goes stale. One owner per node; everyone else calls a method, never writes `innerHTML` directly.
- **Stable skeleton, delegated events, region re-renders.** Build the container once; re-render only the changed region; attach listeners to stable parents so they survive `innerHTML` swaps.
- **Side effects fire on the transition that warrants them.** Persist/network/file writes belong on the transition that changes the data, not a catch-all nav handler (write-back on move/promote, not every prev/next).
- **Keep `plugin/` thin; extract an owning class before a closure grows stateful.** When wiring accumulates navigation/animation/lifecycle state, extract a small class that owns it rather than adding another closure variable.

## Piece asset strategy

Pieces resolve via a `PieceSource` discriminated union injected into the render
config — the renderer never knows where assets come from:

```ts
type PieceSource =
  | { type: "bundled" }                   // default — SVGs shipped with the plugin
  | { type: "cdn"; baseUrl: string }      // a Lichess or custom piece-set URL
  | { type: "local"; vaultPath: string }  // future: user's own pieces in their vault
```

- **`bundled` (default)** — works offline, zero config. Ships in `src/render/pieces/`, included in the esbuild bundle.
- **`cdn`** — user supplies `baseUrl` in settings; URLs built as `{baseUrl}/{color}{piece}.svg` (e.g. `…/wK.svg`).
- **`local`** — future: a vault-relative folder of SVGs.

---

## Running locally

A test vault lives at `test-vault/`. To use it:

```bash
npm install
npm run build      # esbuild bundle → dist/main.js + dist/styles.css
npm test           # vitest unit tests (314 tests across 10 suites)
npm run dev        # watch mode
```

After building, copy `dist/main.js` and `dist/styles.css` into the vault:

```bash
cp dist/main.js dist/styles.css \
  test-vault/.obsidian/plugins/chess-notation/
```

Then reload the plugin in Obsidian (disable → re-enable in Community Plugins).
`test-vault/test.md` has examples of every block type and all six themes.
