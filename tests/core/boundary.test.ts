import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Enforces the one-way dependency rule (core → render → view → plugin):
// src/core/ is the bottom chess-logic layer and may NOT import from render/
// view/ plugin/ or Obsidian. pgn-editor (a leaf below core) and chess.js (the
// rules engine) are allowed. Companion to tests/pgn-editor/boundary.test.ts.
const dir = fileURLToPath(new URL("../../src/core/", import.meta.url));

const FORBIDDEN = [
  /from\s+["'].*\/render(\/|["'])/,
  /from\s+["'].*\/view(\/|["'])/,
  /from\s+["'].*\/plugin(\/|["'])/,
  /from\s+["']obsidian["']/,
];

describe("core layer boundary", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("does not import from render/, view/, plugin/, or Obsidian", () => {
    for (const f of files) {
      const src = readFileSync(dir + f, "utf8");
      for (const pat of FORBIDDEN) {
        expect(pat.test(src), `core/${f} violates the layer boundary (${pat})`).toBe(false);
      }
    }
  });
});
