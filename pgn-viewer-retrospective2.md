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

---

## The three homemade components worth reconsidering

### 1. PGN parser — `core/pgn.ts`

**Alternative:** `@mliebelt/pgn-parser`

This is the weakest justification for building from scratch. PGN has a formal
spec and many edge cases (encodings, non-standard tags, deeply nested
variations, NAG combinations, `{` vs. `;` comments). The homemade parser covers
the common cases but has not been tested against the corpus of real-world PGN
files that established parsers have absorbed.

The CLAUDE.md rule ("no third-party chess libraries for core logic") was written
to protect the **rules engine**, not to prohibit a parser. A PGN parser is a
text format parser, not logic. This distinction is worth revisiting.

**Risk of keeping homemade:** silent mis-parses on unusual but valid PGN (e.g.
games exported from Lichess, Chess.com study exports, Chessbase files).

### 2. Rules engine — `core/fen.ts` + `core/legal.ts` + `core/moves.ts`

**Alternative:** `chess.js`

This was a **deliberate architectural decision** documented in CLAUDE.md:
> "Avoids opaque dependency; rules engine is small and well-scoped."

`chess.js` is the most battle-tested open-source JavaScript chess rules engine.
It has years of tournament-level testing covering pins, discovered checks,
castling edge cases, en passant capture rights, and promotion. Our `legal.ts`
handles all of this correctly today, but it is the most complex and bug-prone
surface in the project.

The decision to own the rules engine is defensible. But "small and well-scoped"
should be revisited as Phase 5 (engine integration) expands the surface.

**Risk of keeping homemade:** bugs in legal move generation are hard to find and
embarrassing (illegal moves accepted, legal moves rejected). Any Phase 5 work
that adds human-vs-engine play increases the stakes.

### 3. Board rendering and interaction — `render/board.ts` + `view/`

**Alternative:** `chessground` (Lichess's board component)

Chessground handles SVG/DOM rendering, drag-and-drop, animation, premoves, and
arrow drawing — essentially everything in `render/board.ts`,
`view/interactive-board.ts`, and `view/animation.ts`.

This was also a **deliberate architectural decision**: SVG rendering, chosen
for accessibility and Obsidian's DOM environment. Chessground's architecture
(CSS-based, imperative DOM) is fundamentally different and would require
abandoning the layered SVG approach.

The tradeoff is real: Chessground works. Our board has had multiple animation
and flicker bugs (see Retrospective 1). But adopting Chessground would mean
accepting its CSS/asset pipeline in an Obsidian plugin context, which is
non-trivial.

**Risk of keeping homemade:** continued maintenance burden on animation and
interaction edge cases. Phase 5 (drag-and-drop for engine play, premoves) will
add more.

---

## Summary

| Component | Homemade | Established alternative | Decision |
|---|---|---|---|
| Block params parser | `parseBlock()` in `main.ts` | `js-yaml` (was using) | **Replaced** with custom parser; no library needed |
| PGN parser | `core/pgn.ts` | `@mliebelt/pgn-parser` | **Reconsider** — not a rules engine |
| Rules engine | `core/legal.ts` + `moves.ts` + `fen.ts` | `chess.js` | **Keep** — deliberate, documented decision |
| Board + interaction | `render/board.ts` + `view/` | `chessground` | **Keep** — architectural mismatch; revisit if Phase 5 proves too expensive |

The PGN parser is the most actionable item: it is a text format, not chess
logic, and the existing CLAUDE.md rule does not clearly prohibit replacing it.
