import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Retro-1 invariants (pgn-viewer-retrospective.md, "Final verification gate"
// items 4 and 5), codified so they can't silently regress:
// - Write-back is wired in exactly one place. main.ts defines writeBackPgn and
//   passes it by reference exactly once (`writeBack: writeBackPgn`); a second
//   reference would mean a second writer of the note file.
// - The block processor holds no duplicate viewer-position state ("let
//   current"): position is owned by PgnViewer alone.
const mainPath = fileURLToPath(new URL("../../src/plugin/main.ts", import.meta.url));

describe("plugin/main.ts retro invariants", () => {
  const src = readFileSync(mainPath, "utf8");

  it("references writeBackPgn exactly twice: definition + one wiring site", () => {
    const refs = src.match(/\bwriteBackPgn\b/g) ?? [];
    expect(refs, "expected the definition and exactly one use").toHaveLength(2);
    expect(/\bfunction writeBackPgn\b/.test(src), "definition missing").toBe(true);
  });

  it("has no `let current` viewer-position variable", () => {
    expect(/\blet\s+current\b/.test(src)).toBe(false);
  });
});
