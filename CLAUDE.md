# obsidian-chess-plugin

An Obsidian plugin that renders interactive chess boards and understands chess
notation inside markdown notes.

---

## Architecture

The codebase is split into three layers. **Dependencies only flow downward.**
Nothing in a lower layer may import from a layer above it.

```
src/
  core/     — pure chess logic, no UI, no Obsidian
  render/   — board rendering (SVG), no Obsidian
  plugin/   — Obsidian glue; wires core + render into the plugin lifecycle
tests/
  core/
  render/
  plugin/
```

### `core/` — Chess logic
- Board state, move generation, rule enforcement
- FEN parsing and serialization
- PGN parsing (games, variations, annotations)
- No DOM, no Obsidian, no side effects
- Every public function must be pure and unit-testable in isolation

### `render/` — Board rendering
- Produces SVG from a board state value object (from `core/`)
- Accepts a config object (colors, piece theme, orientation, highlighted squares)
- No Obsidian imports — must be usable in a plain browser or test environment
- Piece assets are referenced by path/URL injected via config, never hardcoded

### `plugin/` — Obsidian integration
- Registers the fenced code block processor (` ```chess `)
- Owns Obsidian settings (persisted via `plugin.loadData()` / `plugin.saveData()`)
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
```
````

The block body is YAML. Supported keys (Phase 1):
- `fen` — FEN string (required if no `pgn`)
- `pgn` — PGN string or PGN game text (required if no `fen`)
- `orientation` — `white` | `black` (default: `white`)

Additional keys will be added in later phases without breaking existing blocks.

---

## Phases

### Phase 1 — Foundation (current)
- Parse `chess` code blocks
- Render a static board from FEN
- Orientation support (flip board)
- Unit tests for FEN parsing and board rendering logic
- Board is **purely decorative** — no click or hover behaviour
- `render/` is a pure "board state → SVG" function with zero event handling

### Phase 2 — PGN & move navigation
- Parse PGN (moves, comments, variations)
- Step through moves with prev/next controls
- Display move list alongside board

### Phase 3 — Interactivity
- Click/drag piece moves (validates against legal moves from `core/`)
- Copy resulting FEN/PGN back to the note (or a new block)

### Phase 4 — Polish
- Piece theme selection (SVG sets)
- Board color themes
- Mobile / touch support

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
| Three-layer architecture | Enforces separation so phases 2-4 don't require refactoring layer boundaries |
| Piece assets default to bundled | Obsidian is local-first; offline must always work without configuration |

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

No local Obsidian vault is configured. Development workflow:

```bash
npm install
npm run build      # esbuild bundle → dist/main.js
npm test           # vitest unit tests
npm run dev        # watch mode
```

To manually test inside Obsidian, copy `dist/main.js` and `manifest.json` into
a vault's `.obsidian/plugins/obsidian-chess-plugin/` folder and enable the
plugin in Obsidian settings.
