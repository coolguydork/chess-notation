import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Enforces the one-way dependency rule (core → render → view → plugin):
// src/render/ sits above core/ and may import ONLY core/ and pgn-editor/
// (plus its own files) — never Obsidian, view/, plugin/, or external packages.
// Allow-list on purpose: a new dependency must be added here deliberately.
// Companion to tests/pgn-editor/boundary.test.ts.
const dir = fileURLToPath(new URL("../../src/render/", import.meta.url));

const ALLOWED = [
  /^\.\//,                      // within render/
  /^\.\.\/core(\/|$)/,
  /^\.\.\/pgn-editor(\/|$)/,
];

function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  // `import ... from "x"` / `export ... from "x"`, then bare `import "x"`.
  for (const pat of [/from\s+["']([^"']+)["']/g, /import\s+["']([^"']+)["']/g]) {
    for (const m of src.matchAll(pat)) specs.push(m[1]);
  }
  return specs;
}

describe("render layer boundary", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports only from core/ and pgn-editor/", () => {
    for (const f of files) {
      const src = readFileSync(dir + f, "utf8");
      for (const spec of importSpecifiers(src)) {
        const allowed = ALLOWED.some((pat) => pat.test(spec));
        expect(allowed, `render/${f} imports "${spec}" — render/ may only import core/ and pgn-editor/`).toBe(true);
      }
    }
  });
});
