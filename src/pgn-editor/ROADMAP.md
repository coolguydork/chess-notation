# pgn-editor — roadmap to a full PGN-CRUD library

This library's job is to be a clean-room, MIT, FEN-neutral PGN core: parse, hold,
edit, and serialize a chess game's notation. Below is the intended CRUD surface
and where each piece stands.

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
| **Multi-game**   | `parseGames()` —          | iterate collection —      | add / reorder a game —          | remove a game —            |
| **Headers**      | set key ◐ (raw)           | `headers[k]` ✓            | typed/validated setters —       | delete key ◐ (raw)         |
| **Moves (tree)** | `addMoveAt()` ✓           | `projectGame()` / walk ✓  | comment / NAG / promote / replace ✓ | `removeAt()` ✓          |

✓ done · ◐ works via raw object/ctor but no first-class API · — not built

## Tier 1 — Move-level Update ✅ DONE
Structural ops live in `pgn-editor/edit.ts` (FEN-neutral, with the shared tree
traversal `childrenOf`/`resolvePath`/`nodeAt`); exposed through `core/game.ts`'s
`GameEditor` seam:
- `setComment(path, field, text)` ✓ — set/clear `commentMove` | `commentBefore` |
  `commentAfter`.
- `setNags(path, nags)` ✓ — replace a node's NAG list.
- `promoteVariation(path)` ✓ — promote a variation head to mainline; old mainline +
  all sibling variations re-home onto the new head (handles the 3+-sibling edge).
- `replaceMove(path, san)` ✓ — engine-aware (in `core/game.ts`); validates the new
  SAN, keeps the move's own variations, and truncates the continuation at the first
  move the change makes illegal.

**Known limitation (small follow-up):** only `commentAfter` survives write-back —
`gameToPgn` serializes the projected `MoveNode` (single comment slot), so
`commentMove`/`commentBefore` persist in the AST but aren't re-emitted. Switching
`gameToPgn` to pgn-editor's `serialize()` (full comment fidelity) closes this.

## Tier 2 — Multi-game (removes the last GPL dependency)
Today multi-game blocks fall back to read-only on `@mliebelt/pgn-parser`
(GPL-3.0). Closing this drops that dep entirely:
- `parseGames(text): PgnGameAst[]` — split a multi-game PGN (header-block
  boundaries) and parse each with the existing single-game parser.
- Collection helpers: append / remove / reorder a game; serialize all.
- Then retire `@mliebelt` from `core/pgn.ts` and the `game.test` oracle.

## Tier 3 — Header/field CRUD + validation (only if a consumer needs it)
Pure "spreadsheet" CRUD on tags. Low value for the plugin (its blocks carry
`pgn:`/`fen:` in YAML, not a full Seven Tag Roster), higher value if this becomes
a general-purpose package. Build on demand, not speculatively:
- Typed get/set/delete with Seven-Tag-Roster awareness.
- Validation: `Result` enum, `Date` (`YYYY.MM.DD` / `??`), FEN well-formedness.

## Guardrails (do not regress these)
- **FEN-neutral**: nodes carry SAN/numbers/NAGs/comments/variations only — never
  `BoardState` or board indices. Rules/legality stay in chess.js on the core side.
- **No imports** from `core/`/`render/`/`view/`/`plugin/`/Obsidian/DOM inside this
  folder — enforced by `tests/pgn-editor/boundary.test.ts`. Keeps it liftable into
  its own package.
- **One API contract**: everything public goes through `index.ts`.
- **TDD the tree ops**: variation mutation is where homemade code historically
  came out square (see `pgn-viewer-retrospective2.md`) — test first.
