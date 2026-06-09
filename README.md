# Chess for Obsidian

Render interactive chess boards inside your notes using FEN or PGN notation. Navigate games move by move, edit them by playing moves on the board, annotate with comments and glyphs, analyze positions with Stockfish, and choose from six board themes — all without leaving Obsidian.

---

## Features

| Feature | Summary |
|---|---|
| **FEN boards** | Paste any FEN string to render an interactive board. Click a piece to see its legal moves highlighted; click a destination to play the move. |
| **PGN game viewer** | Embed a full game and navigate it move by move with prev/next buttons, **arrow keys**, or by clicking any move token. Variations, comments, NAG glyphs, and header tags are all displayed. |
| **Insert from PGN** | Paste a game from anywhere (Chess.com, Lichess, a database) via the *Insert chess board from PGN* command or ribbon button. Apostrophes, colons, URLs in comments, and line breaks are escaped for you, and the game is validated before it lands in your note. |
| **Edit games in place** | Play a move on the board to extend the line or branch a variation. Right-click any move to add comments, annotation glyphs (`!`, `?`, `!!`…), delete from that point, or promote a variation to the main line. Edits are **written back to the note**. |
| **Click-to-move** | Legal moves are highlighted with dots on destination squares. The board enforces all rules: castling, en passant, promotion (auto-queens). |
| **User-drawn arrows** | Right-click-drag from one square to another to draw an annotation arrow. Optionally attach a text comment to the arrow. Right-drag the same arrow again to remove it. |
| **Engine analysis** | A Stockfish-powered analysis panel (shown by default). Colored arrows show the top moves; a score list shows evaluations and principal variations. Click a suggested move to graft it into the game as a variation. |
| **Six board themes** | `classic`, `blue`, `green`, `dark`, `walnut`, `purple` — set per block or as a plugin default. |
| **Board orientation** | Flip any board to Black's perspective with `orientation: black`, or with the flip (⇆) button. |
| **Mobile & touch** | Pointer events handle mouse and touch uniformly. The board scales to fill narrow viewports. |

---

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Block syntax reference](#block-syntax-reference)
  - [FEN blocks](#fen-blocks)
  - [PGN blocks](#pgn-blocks)
  - [Inserting a board from an existing PGN](#inserting-a-board-from-an-existing-pgn)
  - [Combined FEN + PGN](#combined-fen--pgn)
  - [Analysis blocks](#analysis-blocks)
  - [User-drawn arrows](#user-drawn-arrows)
- [Editing & annotating games](#editing--annotating-games)
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

Renders a game viewer with previous/next navigation buttons and a clickable move list. Click any move token to jump directly to that position, use the ← / → arrow keys, or play a move on the board to edit the game (see [Editing & annotating games](#editing--annotating-games)).

**Options:**

| Key | Type | Default | Description |
|---|---|---|---|
| `pgn` | string | — | PGN string (required if no `fen`) |
| `orientation` | `white` \| `black` | `white` | Board orientation |
| `theme` | string | plugin setting | Board color theme |
| `analysis` | boolean | `true` | Show the Stockfish analysis panel (set `false` to hide) |

The PGN parser and viewer handle:
- Standard algebraic notation for all piece moves, captures, castling, en passant, and promotion
- Move comments (`{ comment text }`), shown inline in the move list
- Numeric annotation glyphs (`$1`, `$2`, …), rendered as symbols (`!`, `?`, `!!`, …)
- Variations (`(…)`), displayed as indented branches you can click into
- Standard result tokens: `1-0`, `0-1`, `1/2-1/2`, `*`
- Header tags (`[Event "..."]`, `[White "..."]`, etc.), shown in a strip above the board

A single game is fully editable; a multi-game PGN is shown read-only with a game selector.

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

### Inserting a board from an existing PGN

If you already have a game — copied from Chess.com or Lichess, exported from a database, or saved as a `.pgn` file — you don't have to hand-write the block. PGNs are full of characters that are awkward to put in YAML by hand: apostrophes (`white's`), colons (`plan: develop`, URLs in comments), and braces (`{…}`). Pasted between quotes, a single apostrophe ends the value early and the block fails to parse.

To insert one safely, use either entry point:

- **Ribbon icon** — click the clipboard icon in the left ribbon, or
- **Command palette** — run **Insert chess board from PGN**.

Either opens a dialog. Paste the PGN and click **Insert**: the game is validated, then a ready-to-render `chess` block is dropped at your cursor with the PGN embedded as a literal block scalar (`pgn: |-`) — no quoting or escaping required.

If you'd rather write the block yourself, use the same literal block scalar so you can paste comments verbatim:

````markdown
```chess
pgn: |-
  [Event "Two Knights Defense"]

  1. e4 e5 {Here's the plan: develop. See https://lichess.org/study} 2. Nf3 Nc6 *
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

The Stockfish analysis panel is shown **by default** on every block — there's nothing to add. To hide it, set `analysis: false`.

````markdown
```chess
fen: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
analysis: false
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

In an editable PGN game, clicking a move in a principal variation grafts that line into the game as a variation from the current position.

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

## Editing & annotating games

A single-game PGN block (or a FEN block) is a live editor, not just a viewer. Every change is **written back into the `chess` block in your note**, so your edits persist.

### Playing moves

Play a legal move on the board — drag a piece or click origin then destination. If you're at the end of the line, the move extends it; if a continuation already exists, your move is added as a **variation** (branch) from that position. Illegal moves are rejected.

### Annotating moves

**Right-click any move** in the move list for a context menu:

| Action | Effect |
|---|---|
| **Comment before / after move…** | Open a text box to attach a `{ comment }` before or after the move |
| **Annotate `!` `?` `!!` `??` `!?` `?!`** | Tag the move with a NAG glyph (`$1`–`$6`); shown as the symbol in the move list |
| **Clear annotation** | Remove the move's glyph |
| **Promote to main line** | (On a variation move) make this branch the main line at its branch point |
| **Delete from here** | Remove this move and everything after it in its line |

**Right-click an existing comment** to edit or delete it. Click a comment to jump to its move, the same as clicking the move itself.

### Headers

Header tags (`[White "..."]`, `[Event "..."]`, …) in the PGN are shown in a strip above the board and are preserved when the game is edited and written back.

### What stays read-only

A **multi-game** PGN is displayed read-only with a dropdown to switch games. A single game the parser can't read strictly also falls back to a read-only render rather than risk corrupting it on write-back.

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
- **← / → arrow keys** step backward/forward through the current line once the board has focus (click or tab to it). The keys are scoped to the focused board, so multiple games on one page don't interfere; a focus ring shows which board is active.
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
| `npm test` | Run all 410 tests with Vitest |

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

The codebase is split into four layers plus a self-contained PGN core. **Dependencies only flow downward** — nothing in a lower layer imports from a layer above.

```
src/
  pgn-editor/ — clean-room PGN parse/serialize/edit + FEN-neutral AST; imports nothing else
  core/       — pure chess logic, no UI, no Obsidian (may import pgn-editor)
  render/     — board theming + PGN viewer HTML, no Obsidian, no DOM events
  view/       — DOM-aware interaction (board mount, the PGN viewer/editor)
  plugin/     — Obsidian glue: lifecycle, settings, block processor, engine worker
```

Rules are delegated to [chess.js](https://github.com/jhlywa/chess.js); the board is rendered by [cm-chessboard](https://github.com/shaack/cm-chessboard); the chess-block body is parsed with [js-yaml](https://github.com/nodeca/js-yaml). The library-first rule keeps the homemade surface small — the one deliberate exception is `pgn-editor`, because no suitably-licensed edit-capable PGN library exists.

### `pgn-editor/`

A leaf package (MIT, liftable) that imports nothing from the rest of the app. Clean-room, variation-aware PGN parsing and serializing over a FEN-neutral AST, plus structural edits (set comment / set NAGs / remove / promote variation). `core/game.ts` builds on it.

### `core/`

| File | Responsibility |
|---|---|
| `types.ts` | `BoardState`, `Piece`, `MoveNode`, `PgnGame`, and related types |
| `fen.ts` | FEN string → `BoardState` (`parseFEN`) and reverse (`serializeFEN`) |
| `pgn.ts` | Adapt the `pgn-editor` AST to `PgnGame` (single + multi-game); `serializeMoveTree` |
| `moves.ts` / `legal.ts` | Apply a SAN move / generate legal moves — delegated to chess.js via `chessjs-bridge.ts` |
| `tree.ts` | Build and navigate the read-only `MoveNode` tree the viewer renders |
| `game.ts` | `GameEditor`: owns the editable game as a `pgn-editor` AST; add/remove/edit moves, project to `MoveNode`, serialize back to PGN |
| `engine.ts` | UCI protocol helpers: `positionToUci`, `parseInfoLine`, `parseBestMove`, `scoreToString` |

`core/` has no DOM and no Obsidian imports; functions are pure except `GameEditor`'s edit ops, which mutate the AST in place.

### `render/`

| File | Responsibility |
|---|---|
| `config.ts` | `BoardConfig`, `BoardColors`, the six theme definitions, `EngineArrow`, asset-URL resolution |
| `controls.ts` | Build the PGN viewer / move-list HTML from a `MoveNode` tree |

No Obsidian imports — usable in any browser or test environment.

### `view/`

| File | Responsibility |
|---|---|
| `cm-board.ts` | Mount and drive a cm-chessboard instance (pieces, highlights, arrows, move/animation) |
| `board-handle.ts` | The `InteractiveBoardHandle` interface the viewer talks to (lets tests stub the board) |
| `pgn-viewer.ts` | `PgnViewer`: owns viewer state, navigation, keyboard handling, and routes edits through `GameEditor` |

### `plugin/`

| File | Responsibility |
|---|---|
| `main.ts` | Plugin entry point: registers the `chess` block processor, owns settings + the settings tab, mounts the viewer and analysis panel, raises edit context menus, writes edits back to the note |
| `engine-worker.ts` | `EngineWorker`: spawns Stockfish via `child_process`, manages the UCI handshake, resolves with `AnalysisResult`; pure helpers `buildUciCommands` / `collectAnalysis` are exported for testing |
| `yaml-block.ts` | Parse the chess-block YAML into block params; serialize edits back to a YAML-safe `pgn:` scalar |
| `styles.css` | Scoped CSS for boards, PGN viewer, and analysis panel |

### Data flow for a `chess` block

```
Markdown note
  └─ plugin/main.ts (code block processor)
       ├─ plugin/yaml-block.ts: parse YAML → block params
       ├─ core/game.ts (GameEditor): PGN/FEN → editable AST → MoveNode tree
       ├─ render/controls.ts: MoveNode tree → move-list HTML
       ├─ view/pgn-viewer.ts + view/cm-board.ts: mount the interactive board
       ├─ edits → GameEditor mutate → re-serialize → write back to the note
       └─ plugin/engine-worker.ts: BoardState → AnalysisResult (on demand)
```

### Piece assets

Board pieces are cm-chessboard's **standard** SVG sprite sheet. It's bundled into the plugin's `cm-chessboard/` asset folder at build time (see [`esbuild.config.mjs`](esbuild.config.mjs), which also copies the marker, arrow, and promotion-dialog sprites) and resolved at runtime through a `resolveAssetUrl` function injected from `plugin/` → Obsidian's `getResourcePath`. The board never constructs asset URLs itself. Everything ships with the plugin, so boards render **offline with zero configuration** — no CDN, no network.
