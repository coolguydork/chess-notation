# chess-notation

An Obsidian plugin that renders interactive chess boards and understands chess
notation inside markdown notes.

---

## Architecture

The codebase is split into three layers. **Dependencies only flow downward.**
Nothing in a lower layer may import from a layer above it.

```
src/
  core/     — pure chess logic, no UI, no Obsidian
  render/   — board rendering (SVG) and controls (HTML), no Obsidian
  plugin/   — Obsidian glue; wires core + render into the plugin lifecycle
tests/
  core/
  render/
  plugin/
```

> **Planned fourth layer — `view/` (DOM-aware, Obsidian-free).** Interaction
> logic (pointer/drag handling, selection, animation, the PGN viewer) is
> DOM-aware but not Obsidian-specific, and currently has no home, so it
> accumulated in `plugin/main.ts`. It is being extracted into a `view/` layer
> that sits between `render/` and `plugin/` (flow: `core → render → view →
> plugin`). **Until that lands, do not add new interaction logic to `plugin/` —
> it belongs in `view/`.** See [`pgn-viewer-retrospective.md`](pgn-viewer-retrospective.md),
> Tasks A–B.

### `core/` — Chess logic
- Board state, move generation, rule enforcement
- FEN parsing and serialization (`fen.ts`)
- PGN parsing — moves, comments, NAGs, variations (`pgn.ts`)
- Move application — SAN to new `BoardState` (`moves.ts`)
- Legal move generation with check/pin filtering, castling safety, en passant (`legal.ts`)
- No DOM, no Obsidian, no side effects
- Every public function must be pure and unit-testable in isolation

### `render/` — Board rendering
- Produces SVG from a board state value object (from `core/`)
- Accepts a config object (colors, piece theme, orientation, highlighted squares)
- `controls.ts` — `buildSnapshots()` + `renderControls()` for PGN viewer HTML
- No Obsidian imports — must be usable in a plain browser or test environment
- Piece assets are referenced by path/URL injected via config, never hardcoded

### `plugin/` — Obsidian integration
- Registers the fenced code block processor (` ```chess `)
- Owns Obsidian settings (persisted via `plugin.loadData()` / `plugin.saveData()`)
- Settings tab: default theme, square size, coordinates toggle
- Passes user settings down to `render/` as a config object
- Handles lifecycle: `onload`, `onunload`
- Must not contain chess logic or rendering logic — only wiring

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

### Phase 1 — Foundation ✅
- Parse `chess` code blocks
- Render a static board from FEN
- Orientation support (flip board)
- Unit tests for FEN parsing and board rendering logic

### Phase 2 — PGN & move navigation ✅
- PGN parser: moves, comments, NAGs, variations
- Move application engine: all piece types, castling, en passant, promotion
- Step through moves with prev/next controls
- Move list alongside board; click a move to jump to it

### Phase 3 — Interactivity ✅
- Click/tap piece moves (validates against legal moves from `core/`)
- Legal move highlighting: selected square tinted, target squares dotted
- Pointer events (works on mouse and touch)

### Phase 4 — Polish ✅
- Six named board color themes; `theme:` key in chess blocks
- Obsidian settings tab: default theme, square size, coordinates toggle
- Responsive board (fills narrow viewports); mobile touch support
- `styles.css` built and shipped alongside `main.js`

### Phase 5 — Engine integration
- Analysis mode: send current position to an engine, display top moves and
  evaluation on the board
- Engine play mode: human vs. engine, move validation via `core/` rules engine
- Engine communication lives in `core/engine.ts` — pure logic, no Obsidian, no
  rendering
- `plugin/` wires up the UI controls; `render/` highlights suggested moves using
  the same highlight API added in Phase 3

**Open decision (resolve in Phase 5):** how Stockfish is delivered:

| Option | Pros | Cons |
|---|---|---|
| WASM (bundled) | Zero user setup, fully offline | ~5MB+ bundle size increase |
| External binary | Small bundle, full engine strength | User must install Stockfish separately |

Do not make architectural decisions that would foreclose either option.

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
- **Default to TDD (test-first) where practical**, but don't be dogmatic — take it
  case by case. Pure functions with clear inputs/outputs (parsers, rule checks)
  are strong TDD candidates. Code whose shape is still being discovered (SVG
  output, plugin lifecycle) may be written first and pinned with tests once the
  design settles. The goal is confidence, not ceremony.
- **No third-party chess libraries** for core logic (we own the rules engine).
  Third-party libs are acceptable in `render/` for SVG utilities if needed.
- Commit messages: imperative mood, short subject line (`Add FEN parser`,
  `Fix castling rights after rook capture`).

---

## Key decisions & rationale

| Decision | Rationale |
|---|---|
| `core/` has zero Obsidian imports | Keeps chess logic testable outside Obsidian and reusable |
| YAML inside the code block | Human-readable, extensible without breaking old blocks |
| SVG rendering (not canvas) | SVG is accessible, scalable, and inspectable in devtools |
| Own rules engine, no chess lib | Avoids opaque dependency; rules engine is small and well-scoped |
| Three-layer architecture | Enforces separation so phases don't require refactoring layer boundaries |
| Piece assets default to bundled | Obsidian is local-first; offline must always work without configuration |
| Pointer events for interaction | Single handler works for both mouse and touch; no separate touch wiring |
| Themes as named presets | Easy to extend; per-block `theme:` key overrides the plugin default |

## Lessons learned (`plugin/` layer discipline)

The three-layer boundary held perfectly across all phases — `core/` and
`render/` stayed clean and barely churned. **Every painful rewrite happened in
`plugin/`, where stateful UI wiring lives.** These principles are the distilled
cost of those rewrites; apply them to any new `plugin/` work, especially the
PGN viewer rewrite tracked in [`pgn-viewer-retrospective.md`](pgn-viewer-retrospective.md).

- **Model for the next phase, not just the current one.** The biggest rewrites
  all came from a data/render shape that fit the current scope but not the known
  future one: `Snapshot[]` → `MoveNode` tree (variations were already planned),
  full re-render → DOM-stable mount (interactivity was already planned). When the
  Phases section names a future requirement, give the *shape* room for it now,
  even if the UI comes later. A linear game is just a tree with no branches.

- **One owner per piece of mutable state.** Duplicating state across closures and
  syncing it by hand is the root smell behind most viewer bugs (e.g. `current`
  living in both the viewer and the block-processor closure). State lives in
  exactly one place; others observe it via an event/hook, never via a callback
  that re-enters and re-sets it.

- **One writer per shared DOM node.** A node mutated by several code paths (the
  board: interactive + hover + engine arrows + animation) races and goes stale.
  Give each shared node a single owner; everything else calls a method on that
  owner instead of writing `innerHTML` directly.

- **Stable skeleton, delegated events, region re-renders.** Build the container
  DOM once; re-render only the inner region that changed; attach listeners to
  stable parents so they survive `innerHTML` swaps. Never rebuild a subtree that
  owns event handlers or transient state.

- **Side effects fire on the transition that warrants them.** Persisting,
  network, or file writes belong on the specific transition that changes the
  underlying data — not on a catch-all navigation handler. (Write-back belongs on
  a move/promote, not on every prev/next.)

- **Keep `plugin/` thin; extract an owning class before a closure grows stateful.**
  When block-processor wiring starts accumulating navigation/animation/lifecycle
  state, that is the signal to extract a small class that owns it — not to add
  another closure variable.

## Piece asset strategy

Pieces are resolved via a `PieceSource` discriminated union injected into the
render config. The renderer never has knowledge of where assets come from.

```ts
type PieceSource =
  | { type: "bundled" }                   // default — SVGs shipped with the plugin
  | { type: "cdn"; baseUrl: string }      // e.g. a Lichess or custom piece set URL
  | { type: "local"; vaultPath: string }  // future: user's own pieces inside their vault
```

**Default:** `{ type: "bundled" }` — works offline, zero configuration required.

**CDN option:** user can supply a `baseUrl` in plugin settings. The renderer
constructs piece URLs as `{baseUrl}/{color}{piece}.svg`
(e.g. `https://example.com/pieces/wK.svg`).

**Local option:** reserved for Phase 4. Allows a vault-relative path to a
folder of SVG files.

The bundled piece set ships in `src/render/pieces/` as plain SVG files and is
included in the esbuild bundle.

---

## Running locally

A test vault lives at `test-vault/`. To use it:

```bash
npm install
npm run build      # esbuild bundle → dist/main.js + dist/styles.css
npm test           # vitest unit tests (289 tests across 9 suites)
npm run dev        # watch mode
```

After building, copy `dist/main.js` and `dist/styles.css` into the vault:

```bash
cp dist/main.js dist/styles.css \
  test-vault/.obsidian/plugins/chess-notation/
```

Then reload the plugin in Obsidian (disable → re-enable in Community Plugins).
`test-vault/test.md` has examples of every block type and all six themes.
