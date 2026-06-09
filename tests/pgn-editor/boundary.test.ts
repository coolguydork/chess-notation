import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Enforces the one-way dependency rule: src/pgn-editor/ is self-contained and
// may NOT import from core/ render/ view/ plugin/ Obsidian or the DOM. This is
// what makes the folder liftable into its own package. (A future eslint
// import-boundary rule would subsume this; until then, the test guards it.)
const dir = fileURLToPath(new URL("../../src/pgn-editor/", import.meta.url));

const FORBIDDEN = [
  /from\s+["'].*\/core\//,
  /from\s+["'].*\/render\//,
  /from\s+["'].*\/view\//,
  /from\s+["'].*\/plugin\//,
  /from\s+["']obsidian["']/,
];

describe("pgn-editor layer boundary", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(["it does not"])("%s import from other layers, Obsidian, or up-tree", () => {
    for (const f of files) {
      const src = readFileSync(dir + f, "utf8");
      for (const pat of FORBIDDEN) {
        expect(pat.test(src), `${f} violates the layer boundary (${pat})`).toBe(false);
      }
    }
  });
});
