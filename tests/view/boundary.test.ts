import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Enforces the one-way dependency rule (core → render → view → plugin):
// src/view/ is DOM-aware but Obsidian-free, and may import ONLY core/,
// render/, pgn-editor/, and cm-chessboard (plus its own files) — never
// Obsidian or plugin/. Allow-list on purpose: a new dependency must be added
// here deliberately. Companion to tests/pgn-editor/boundary.test.ts.
const dir = fileURLToPath(new URL("../../src/view/", import.meta.url));

const ALLOWED = [
  /^\.\//,                      // within view/
  /^\.\.\/core(\/|$)/,
  /^\.\.\/render(\/|$)/,
  /^\.\.\/pgn-editor(\/|$)/,
  /^cm-chessboard(\/|$)/,
];

function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  // `import ... from "x"` / `export ... from "x"`, then bare `import "x"`.
  for (const pat of [/from\s+["']([^"']+)["']/g, /import\s+["']([^"']+)["']/g]) {
    for (const m of src.matchAll(pat)) specs.push(m[1]);
  }
  return specs;
}

describe("view layer boundary", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports only from core/, render/, pgn-editor/, and cm-chessboard", () => {
    for (const f of files) {
      const src = readFileSync(dir + f, "utf8");
      for (const spec of importSpecifiers(src)) {
        const allowed = ALLOWED.some((pat) => pat.test(spec));
        expect(allowed, `view/${f} imports "${spec}" — view/ may only import core/, render/, pgn-editor/, cm-chessboard`).toBe(true);
      }
    }
  });
});
