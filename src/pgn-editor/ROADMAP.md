# pgn-editor — roadmap to a full PGN-CRUD library

This library's job is to be a clean-room, MIT, FEN-neutral PGN core: parse, hold,
edit, and serialize a chess game's notation. Below is the intended CRUD surface
and where each piece stands.

> **No comment ownership.** The PGN spec treats movetext as a token stream;
> comments are standalone tokens and a RAV "unplays the move immediately prior".
> The AST mirrors that: a line is an ordered `PgnItem[]` of move | comment |
> variation, position is truth, and serialization re-emits items where they were
> written — never re-anchored, never merged. The one spec'd exception stays on
> the move: NAGs ("applies to the move immediately prior"). Move number
> indicators are decoration the export format re-derives, so "1. { x } e4" and
> "{ x } 1. e4" are the same stream — both export as the latter.

> **Rails-style framing, with one caveat.** A game is *not* one flat record — it's
> three layers with different shapes: the **game/collection**, the flat
> **header** record, and the **move tree** (with variations). So this is three
> different CRUDs, not the same one stamped three times. And per the repo's
> library-first rule, we implement a cell **when a consumer needs it**, not just to
> fill the grid. The tiers below are ordered by real demand, not symmetry.

## Status grid

| Layer            | Create                    | Read                      | Update                          | Delete                     |
|------------------|---------------------------|---------------------------|---------------------------------|----------------------------|
| **Game**         | `parse()` ✓ / empty ◐     | AST / `serialize()` ✓     | (container of headers+moves) ✓  | drop the object ✓          |
| **Multi-game**   | `parseGames()` ✓          | iterate collection ✓      | add / reorder a game —          | remove a game —            |
| **Headers**      | set key ◐ (raw)           | `headers[k]` ✓            | typed/validated setters —       | delete key ◐ (raw)         |
| **Moves (stream)** | `addMoveAt()` ✓         | `projectGame()` / walk ✓  | comment / NAG / promote / replace ✓ | `removeAt()` ✓          |

✓ done · ◐ works via raw object/ctor but no first-class API · — not built

## Tier 1 — Move-level Update ✅ DONE
Structural ops live in `pgn-editor/edit.ts` (FEN-neutral, with the shared stream
traversal `childrenOf`/`resolvePath`/`nodeAt` — navigation skips comment items;
variation heads resolve positionally); exposed through `core/game.ts`'s
`GameEditor` seam:
- `adjacentComment(path, side)` / `setAdjacentComment(path, side, text)` ✓ —
  read / insert / update / remove the comment item directly before or after a
  move (positional authoring; the same item is one move's after-neighbour and
  the next move's before-neighbour).
- `updateComment(comment, text)` ✓ — edit or delete an existing comment item by
  identity, wherever it sits in the stream.
- `setNags(path, nags)` ✓ — replace a move's NAG list.
- `promoteVariation(path)` ✓ — promote a variation head to mainline; old mainline +
  all sibling variations re-home onto the new head (handles the 3+-sibling edge);
  comments keep their written line positions.
- `replaceMove(path, san)` ✓ — engine-aware (in `core/game.ts`); validates the new
  SAN, keeps the move's own variations, and truncates the continuation at the first
  move the change makes illegal.

**Comment fidelity ✅** — `gameToPgn` serializes the item stream in source order
via pgn-editor's `serializeMovetext()` (movetext-only; write-back targets a single
YAML `pgn:` line, so no headers): comments come back exactly where they were
written, consecutive comments stay separate, and raw `[%clk]`/`[%eval]` text is
preserved. **Comment rendering ✅** — the projection (`buildMoveTree`) carries
comments positionally on each node's `tail` (display-cleaned, with `source` refs
back to the AST), so the viewer renders and edits them as items, never as slots.

## Tier 2 — Multi-game ✅ DONE (last GPL dependency removed)
- `parseGames(text): PgnGameAst[]` ✓ in `parseGames.ts` — a comment/variation-aware
  top-level scanner splits on result tokens and header-block boundaries (throws when
  a header interrupts un-terminated movetext); each chunk goes through `parse()`.
- `core/pgn.ts` reimplemented over pgn-editor (`parsePGN`/`parseMultiPGN` adapt the
  AST to `PgnGame`); `@mliebelt/pgn-parser` (GPL-3.0) **removed** along with its
  null-literal hack. Single parsing stack now, no GPL dep.
- **Deferred** (no consumer yet): game-collection C/U/D — append/remove/reorder are
  plain array ops on `PgnGameAst[]`; add when something needs them.

## Tier 3 — Header/field CRUD + validation (only if a consumer needs it)
Pure "spreadsheet" CRUD on tags. Low value for the plugin (its blocks carry
`pgn:`/`fen:` in YAML, not a full Seven Tag Roster), higher value if this becomes
a general-purpose package. Build on demand, not speculatively:
- Typed get/set/delete with Seven-Tag-Roster awareness.
- Validation: `Result` enum, `Date` (`YYYY.MM.DD` / `??`), FEN well-formedness.

## Known normalizations & extensions (the complete inventory)

Everything that carries meaning follows the spec with no added interpretation:
comments are positional stream items (§5 places them, assigns no attachment),
NAGs bind to "the move just played" (§10; §8.2.3.8's export example shows the
adjacency), and RAVs anchor by "unplaying the move that appears immediately
prior" (§8.2.5). Beyond that, the writer is deliberately *not* a byte-copier —
these are the only deltas, all lexical or disclosed extensions:

1. **Move numbers are regenerated**, not preserved (§8.2.2: import treats them
   as optional/redundant; export derives them by rule). "1. { x } e4" exports
   as "{ x } 1. e4".
2. **A NAG written after a variation re-emits adjacent to its move** — the one
   token we reposition; follows from §10 but that input placement is unaddressed
   by the spec.
3. **Comment form normalizes, content doesn't**: `;`-comments re-emit as brace
   comments; internal whitespace collapses to single spaces (single-line YAML
   write-back target). Text is never altered, merged, or moved; `[%clk]`/`[%eval]`
   pass through verbatim and are never parsed here (stripping is display-only,
   in core/).
4. **Null moves `--`/`Z0`** are accepted and round-tripped — an extension; the
   spec has no null move.
5. **Output is valid import format, not export-format file discipline**: no
   80-column wrap (§8.2.1), headers in source order rather than Seven-Tag-Roster
   export order. Revisit if this lifts into a standalone package.
6. **Lenient mode drops unparseable tokens** (the spec's import tolerance);
   the editor uses strict mode so write-back never operates on a guessed parse.

## Guardrails (do not regress these)
- **FEN-neutral**: items carry SAN/numbers/NAGs/comments/variations only — never
  `BoardState` or board indices. Rules/legality stay in chess.js on the core side.
- **No comment ownership**: comments are stream items addressed by position or
  identity, never by an owning move's slot. Serialization must never move,
  merge, or re-anchor a comment the user wrote.
- **No imports** from `core/`/`render/`/`view/`/`plugin/`/Obsidian/DOM inside this
  folder — enforced by `tests/pgn-editor/boundary.test.ts`. Keeps it liftable into
  its own package.
- **One API contract**: everything public goes through `index.ts`.
- **TDD the stream ops**: variation mutation is where homemade code historically
  came out square (see `pgn-viewer-retrospective2.md`) — test first.
