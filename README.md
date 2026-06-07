# Chess for Obsidian

Render interactive chess boards inside your notes using FEN or PGN notation. Navigate games move by move, click pieces to make moves, analyze positions with Stockfish, and choose from six board themes — all without leaving Obsidian.

---

## Features

| Feature | Summary |
|---|---|
| **FEN boards** | Paste any FEN string to render an interactive board. Click a piece to see its legal moves highlighted; click a destination to play the move. |
| **PGN game viewer** | Embed a full game and navigate it move by move with prev/next buttons or by clicking any move token in the move list. |
| **Click-to-move** | Legal moves are highlighted with dots on destination squares. The board enforces all rules: castling, en passant, promotion (auto-queens). |
| **User-drawn arrows** | Right-click-drag from one square to another to draw an annotation arrow. Optionally attach a text comment to the arrow. Right-drag the same arrow again to remove it. |
| **Engine analysis** | Add `analysis: true` to any FEN block for a Stockfish-powered Analyze button. Colored arrows show the top moves; a score list shows evaluations and principal variations. |
| **Six board themes** | `classic`, `blue`, `green`, `dark`, `walnut`, `purple` — set per block or as a plugin default. |
| **Board orientation** | Flip any board to Black's perspective with `orientation: black`. |
| **Mobile & touch** | Pointer events handle mouse and touch uniformly. The board scales to fill narrow viewports. |

---

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Block syntax reference](#block-syntax-reference)
  - [FEN blocks](#fen-blocks)
  - [PGN blocks](#pgn-blocks)
  - [Combined FEN + PGN](#combined-fen--pgn)
  - [Analysis blocks](#analysis-blocks)
  - [User-drawn arrows](#user-drawn-arrows)
- [Board themes](#board-themes)
- [Engine analysis](#engine-analysis)
  - [Installing Stockfish](#installing-stockfish)
  - [Plugin settings](#plugin-settings)
  - [Reading the analysis output](#reading-the-analysis-output)
- [Settings reference](#settings-reference)
- [Keyboard and touch](#keyboard-and-touch)
- [Building from source](#building-from-source)
- [Architecture overview](#architecture-overview)

---

## Installation

### From the Obsidian community plugin browser (recommended)

1. Open **Settings → Community plugins → Browse**
2. Search for **Chess**
3. Click **Install**, then **Enable**

### Manual installation

1. Download `main.js` and `styles.css` from the [latest release](../../releases/latest)
2. Create the folder `.obsidian/plugins/chess-notation/` inside your vault
3. Copy both files into that folder
4. In Obsidian: **Settings → Community plugins → Installed plugins** → enable **Chess**

### Building from source

See [Building from source](#building-from-source) below.

---

## Quick start

Create a fenced code block with the language tag `chess`. The block body is YAML.

**Show a position from FEN:**

````markdown
```chess
fen: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
```
````

**Play through a game from PGN:**

````markdown
```chess
pgn: 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 *
```
````

**Analyze a position with Stockfish:**

````markdown
```chess
fen: r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
analysis: true
```
````

That's it. Every block is self-contained and renders independently.

---

## Block syntax reference

All blocks use a `chess` fenced code block. The body is a YAML mapping. Unknown keys are ignored, so future versions can add new options without breaking existing notes.

### FEN blocks

```
fen: <FEN string>
```

Renders an interactive board. You can click any piece of the side to move to see its legal moves highlighted, then click a destination square to make the move. The board tracks the position locally — it does not modify your note.

**Options:**

| Key | Type | Default | Description |
|---|---|---|---|
| `fen` | string | — | FEN string (required if no `pgn`) |
| `orientation` | `white` \| `black` | `white` | Which side faces the bottom of the board |
| `theme` | string | plugin setting | Board color theme name (see [Board themes](#board-themes)) |

**Example — show the Ruy Lopez after 3. Bb5, board flipped to Black's perspective:**

````markdown
```chess
fen: r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3
orientation: black
theme: green
```
````

### PGN blocks

```
pgn: <PGN string>
```

Renders a game viewer with previous/next navigation buttons and a clickable move list. Click any move token to jump directly to that position.

**Options:**

| Key | Type | Default | Description |
|---|---|---|---|
| `pgn` | string | — | PGN string (required if no `fen`) |
| `orientation` | `white` \| `black` | `white` | Board orientation |
| `theme` | string | plugin setting | Board color theme |

The PGN parser handles:
- Standard algebraic notation for all piece moves, captures, castling, en passant, and promotion
- Move comments (`{ comment text }`)
- Numeric annotation glyphs (`$1`, `$2`, …)
- Variations (parsed but not yet displayed in the viewer)
- Standard result tokens: `1-0`, `0-1`, `1/2-1/2`, `*`
- Header tags (`[Event "..."]`, `[White "..."]`, etc.) — parsed but not displayed

**Example — Immortal Game:**

````markdown
```chess
pgn: |
  [Event "Casual game"]
  [White "Adolf Anderssen"]
  [Black "Lionel Kieseritzky"]
  [Result "1-0"]

  1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6
  7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6
  13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6
  Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# 1-0
theme: walnut
```
````

### Combined FEN + PGN

You can provide both `fen` and `pgn`. The FEN sets the starting position; the PGN provides the move list to navigate from there. This is useful for analyzing a game fragment that doesn't begin from the standard starting position.

````markdown
```chess
fen: r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
pgn: 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 *
```
````

### Analysis blocks

Add `analysis: true` to any FEN block to attach an **Analyze** button below the board.

````markdown
```chess
fen: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
analysis: true
```
````

When you click **Analyze**:

1. The plugin spawns Stockfish and sends the position via the UCI protocol
2. The engine searches to the configured depth (default: 18)
3. Results appear as colored arrows on the board and an eval list below it:
   - **Green arrow** — best move (line 1)
   - **Blue arrow** — second-best move (line 2)
   - **Orange arrow** — third-best move (line 3)
4. Each arrow has a score and the first five moves of the principal variation

See [Engine analysis](#engine-analysis) for setup instructions.

### User-drawn arrows

Draw your own annotation arrows directly on any interactive FEN board.

| Gesture | Effect |
|---|---|
| **Right-click drag** from square A to square B | Draws an orange arrow from A → B |
| **Right-click drag** the same arrow again | Removes the arrow |
| **Right-click** on a single square (no drag) | Removes all arrows originating from that square |

After drawing an arrow a small floating input appears — type a comment and press **Enter** to attach it as a label on the arrow, or press **Esc** / click outside to skip.

**Example — annotate a key idea:**

````markdown
```chess
fen: r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
```
````

Open the note, right-click-drag from **f3** to **e5** to draw a "knight attacks" arrow, then type `Knight fork threat` as the comment.

Arrows are in-memory — they reset when the note is closed. Engine analysis arrows and user arrows coexist independently.

---

## Board themes

Six built-in themes. Set `theme:` in any block, or choose a default in plugin settings.

| Name | Description | Light square | Dark square |
|---|---|---|---|
| `classic` | Lichess brown (default) | `#f0d9b5` | `#b58863` |
| `blue` | Lichess blue-gray | `#dee3e6` | `#8ca2ad` |
| `green` | Chess.com green | `#ffffdd` | `#86a666` |
| `dark` | High-contrast dark gray | `#aaaaaa` | `#555555` |
| `walnut` | Warm walnut brown | `#f0c88a` | `#8b5a2b` |
| `purple` | Soft purple | `#e8d5f5` | `#7c4a8c` |

---

## Engine analysis

The plugin communicates with Stockfish over the UCI protocol. Two delivery modes are supported; choose in **Settings → Chess → Engine mode**.

### Installing Stockfish

**macOS (Homebrew):**

```bash
brew install stockfish
```

The plugin auto-discovers Stockfish at `/opt/homebrew/bin/stockfish`, `/usr/local/bin/stockfish`, `/usr/bin/stockfish`, and on the system `PATH`. If Stockfish is somewhere else, set an explicit path in plugin settings.

**Windows:**

1. Download the latest Stockfish release from [stockfishchess.org](https://stockfishchess.org/download/)
2. Unzip and note the path to `stockfish.exe`
3. In plugin settings set **Stockfish binary path** to that path, e.g. `C:\tools\stockfish\stockfish.exe`

**Linux:**

```bash
# Debian/Ubuntu
sudo apt install stockfish

# Arch
sudo pacman -S stockfish
```

**Verify from the terminal:**

```bash
node scripts/probe-engine.mjs
```

You should see output like:

```
Position : rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
Binary   : /opt/homebrew/bin/stockfish
Depth    : 18  MultiPV: 3

bestmove : e2e4

  [1]  +0.46  depth 18  pv e2e4 e7e6 d2d4 d7d5 b1c3
  [2]  +0.33  depth 18  pv g1f3 g8f6 c2c4 c7c5 g2g3
  [3]  +0.31  depth 18  pv d2d4 d7d5 c2c4 e7e6 b1c3
```

You can also pass any FEN as an argument:

```bash
node scripts/probe-engine.mjs "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
```

### Plugin settings

Open **Settings → Chess → Engine** to configure:

| Setting | Default | Description |
|---|---|---|
| Engine mode | `Auto` | `Auto` tries the PATH and common install locations. `External binary` uses the path you specify. `WASM` is reserved for a future bundled build. |
| Stockfish binary path | *(empty)* | Absolute path to the executable. Only used when mode is `External binary`, or as a hint when mode is `Auto`. |
| Analysis depth | `18` | Stockfish search depth. 15–18 is strong and fast; 25+ is very strong but may take several seconds. |
| Lines shown (MultiPV) | `3` | Number of distinct top moves to display. 1 shows only the best move. |

### Reading the analysis output

After clicking **Analyze**, you'll see:

```
+0.46  e2e4 e7e6 d2d4 d7d5 b1c3
+0.33  g1f3 g8f6 c2c4 c7c5 g2g3
+0.31  d2d4 d7d5 c2c4 e7e6 b1c3
```

- **Score** — centipawn evaluation from the perspective of the side to move. `+0.46` means White is 0.46 pawns ahead. `M3` means forced checkmate in 3 moves; `M-2` means the side to move is being mated in 2.
- **PV** — the principal variation: the sequence of best moves for both sides at the current depth, in UCI notation (`e2e4` = pawn from e2 to e4).

Arrow colors on the board correspond to ranks 1, 2, and 3 (green, blue, orange). Click **Re-analyze** at any time to run a fresh search.

---

## Settings reference

All settings are in **Settings → Chess**.

### Board

| Setting | Default | Description |
|---|---|---|
| Default board theme | `classic` | Used when no `theme:` key is present in a chess block |
| Square size (px) | `60` | Width/height of each square. 40–100 px range. |
| Show coordinates | on | Display file (a–h) and rank (1–8) labels on the board edges |

### Engine

See [Plugin settings](#plugin-settings) above.

---

## Keyboard and touch

- **Click or tap** a piece to select it. Legal destination squares appear as dots.
- **Click or tap** a highlighted dot to move the piece there.
- **Click or tap** elsewhere to deselect.
- **Right-click drag** from one square to another to draw an annotation arrow.
- **Right-click drag** the same arrow again to remove it.
- In the PGN viewer, **click any move token** in the move list to jump to that position.
- The prev/next buttons have a minimum tap target of 44 × 36 px for comfortable mobile use.
- The board uses pointer events, so mouse and touch are handled by the same code path with no 300 ms tap delay.
- On narrow screens (< 480 px) the board fills the available width automatically.

---

## Building from source

**Prerequisites:** Node.js 18+, npm.

```bash
git clone <this repo>
cd chess-notation
npm install
```

**Commands:**

| Command | Description |
|---|---|
| `npm run build` | Type-check + production bundle → `dist/main.js` + `dist/styles.css` |
| `npm run dev` | Watch mode (rebuilds on save, skips type-check) |
| `npm test` | Run all 210 tests with Vitest |

**Deploy to the test vault:**

```bash
npm run build
cp dist/main.js dist/styles.css \
  test-vault/.obsidian/plugins/chess-notation/
```

Then in Obsidian: **Settings → Community Plugins** → disable then re-enable **Chess**.

**Smoke-test the engine pipeline without Obsidian:**

```bash
node scripts/probe-engine.mjs
node scripts/probe-engine.mjs "r2q1rk1/ppp2ppp/2n1bn2/2b1p3/3pP3/3P1NP1/PPP1NPBP/R1BQ1RK1 w - - 0 9"
```

---

## Architecture overview

The codebase is split into three layers. **Dependencies only flow downward** — nothing in a lower layer imports from a layer above.

```
src/
  core/     — pure chess logic, zero dependencies (no Obsidian, no DOM)
  render/   — SVG board renderer and PGN viewer controls
  plugin/   — Obsidian glue: lifecycle, settings, block processor, engine worker
```

### `core/`

| File | Responsibility |
|---|---|
| `types.ts` | `BoardState`, `Piece`, `PgnGame`, and related types |
| `fen.ts` | FEN string → `BoardState` (`parseFEN`) and reverse (`serializeFEN`) |
| `pgn.ts` | PGN string → `PgnGame` with moves, comments, NAGs, and result |
| `moves.ts` | Apply a SAN move string to a `BoardState`, returning a new state |
| `legal.ts` | Generate all legal moves for a position, including castling, en passant, and pin/check filtering |
| `engine.ts` | UCI protocol helpers: `positionToUci`, `parseInfoLine`, `parseBestMove`, `scoreToString` |

Every function in `core/` is pure: same inputs always produce the same output, no side effects. All 210 tests run in < 250 ms.

### `render/`

| File | Responsibility |
|---|---|
| `config.ts` | `BoardConfig`, `BoardColors`, theme definitions, `EngineArrow`, `UserArrow` |
| `board.ts` | Render a `BoardState` to an SVG string; overlays for selected square, legal move dots, engine arrows, and user-drawn arrows with optional labels |
| `controls.ts` | Build position snapshots from a PGN move list; render the full PGN viewer HTML |

No Obsidian imports. Can be used in any browser or test environment.

### `plugin/`

| File | Responsibility |
|---|---|
| `main.ts` | Plugin entry point: registers the `chess` code block processor, owns settings and the settings tab, mounts interactive boards and analysis panels |
| `engine-worker.ts` | `EngineWorker` class: spawns Stockfish via `child_process`, manages the UCI handshake, resolves with `AnalysisResult`; pure helpers `buildUciCommands` and `collectAnalysis` are exported for testing |
| `styles.css` | Scoped CSS for boards, PGN viewer, and analysis panel |

### Data flow for a `chess` block

```
Markdown note
  └─ plugin/main.ts (code block processor)
       ├─ js-yaml: parse YAML → block params
       ├─ core/fen.ts: FEN string → BoardState
       ├─ core/pgn.ts: PGN string → PgnGame
       ├─ render/controls.ts: PgnGame → snapshots[]
       ├─ render/board.ts: BoardState + config → SVG string
       ├─ core/legal.ts: BoardState → legal moves (for click-to-move)
       └─ plugin/engine-worker.ts: BoardState → AnalysisResult (on demand)
```

### Piece assets

Pieces are the [cburnett](https://github.com/nicowillis/chess-svg) SVG set, bundled inside the plugin. The renderer receives a `resolvePieceUrl` function injected from `plugin/` — it never constructs asset URLs itself. This indirection supports three piece sources:

| Source | How it works |
|---|---|
| `bundled` (default) | SVGs ship with the plugin; resolved via Obsidian's `getResourcePath` |
| `cdn` | User supplies a base URL; renderer appends `/{color}{piece}.svg` |
| `local` | Vault-relative path to a folder of SVG files |
