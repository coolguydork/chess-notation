import { describe, it, expect } from "vitest";
import { load as parseYaml } from "js-yaml";
import { yamlInlineScalar, buildChessBlock, replacePgnValue } from "../../src/plugin/yaml-block";
import { parseBlock } from "../../src/plugin/main";

// Round-trip invariant: whatever yamlInlineScalar produces, parsing
// `pgn: <scalar>` back as YAML must yield the original string. This is the
// contract the line-based write-back relies on.
function roundTrip(pgn: string): unknown {
  const line = `pgn: ${yamlInlineScalar(pgn)}`;
  return (parseYaml(line) as { pgn: unknown }).pgn;
}

describe("yamlInlineScalar", () => {
  const cases: Record<string, string> = {
    "plain movetext": "1. e4 e5 2. Nf3 Nc6 *",
    "comment-led PGN (leading brace)": "{ Game intro } 1. e4 e5 *",
    "empty game (bare asterisk)": "*",
    "comment with a colon": "1. e4 { plan: develop } e5 *",
    "comment with a hash": "1. e4 { #1 in the book } e5 *",
    "all three comment slots": "{ intro } 1. { hmm } e4 { ok } 1... e5 *",
  };

  for (const [name, pgn] of Object.entries(cases)) {
    it(`round-trips ${name}`, () => {
      expect(roundTrip(pgn)).toBe(pgn);
    });
  }

  it("leaves plain movetext unquoted", () => {
    expect(yamlInlineScalar("1. e4 e5 *")).toBe("1. e4 e5 *");
  });

  it("quotes a value that would otherwise be invalid YAML", () => {
    // A leading `{` is a flow-mapping indicator; must be quoted.
    expect(yamlInlineScalar("{ x } 1. e4 *")).toBe("'{ x } 1. e4 *'");
  });

  it("stays on a single line", () => {
    expect(yamlInlineScalar("{ a } 1. e4 { b } e5 *")).not.toContain("\n");
  });
});

// A pasted, multi-line PGN with comments contains apostrophes ("white's"),
// colons (URLs), and braces — all YAML-hostile. The documented way to embed it
// in a `chess` block is a literal block scalar (`pgn: |`), which needs no
// escaping. This pins that contract; the failure it guards against is the
// tempting-but-broken single-quoted form, where a bare apostrophe closes the
// scalar early. (See the test3.md regression.)
describe("literal block scalar embeds a real PGN", () => {
  const pgn =
    '[Event "Two Knights"]\n\n' +
    "1.e4 e5 {Here's the plan: develop. See https://x.test/g.}\n" +
    "2.Nf3 Nc6 {attack white's bishop} *";

  it("round-trips apostrophes, colons, and braces unescaped", () => {
    const block = "pgn: |\n" + pgn.split("\n").map((l) => (l ? "  " + l : "")).join("\n");
    const parsed = parseYaml(block) as { pgn: string };
    expect(parsed.pgn.trimEnd()).toBe(pgn);
  });

  it("the single-quoted form with bare apostrophes is invalid YAML", () => {
    // Demonstrates the failure mode test3.md hit: `'` ends the scalar early.
    expect(() => parseYaml(`pgn: '${pgn}'`)).toThrow();
  });
});

// buildChessBlock backs the "Insert chess board from PGN" command/ribbon: a raw
// PGN in, a ready-to-paste block out. Whatever it emits must parse back to the
// original PGN — that's the contract the block processor relies on.
describe("buildChessBlock", () => {
  function parsePgnFromBlock(block: string): string {
    const body = block.replace(/^```chess\n/, "").replace(/\n```$/, "");
    return (parseYaml(body) as { pgn: string }).pgn.trimEnd();
  }

  const cases: Record<string, string> = {
    "plain movetext": "1. e4 e5 2. Nf3 Nc6 *",
    "comment with apostrophe + colon + URL":
      "1. e4 {white's plan: see https://x.test/g} e5 *",
    "multi-line PGN with headers":
      '[Event "X"]\n[Site "?"]\n\n1.e4 e5 {Here\'s a note} *',
  };

  for (const [name, pgn] of Object.entries(cases)) {
    it(`round-trips ${name}`, () => {
      expect(parsePgnFromBlock(buildChessBlock(pgn))).toBe(pgn);
    });
  }

  it("wraps the PGN in a fenced chess block", () => {
    const block = buildChessBlock("1. e4 *");
    expect(block.startsWith("```chess\n")).toBe(true);
    expect(block.endsWith("\n```")).toBe(true);
  });
});

// replacePgnValue powers write-back. It must overwrite the whole pgn: value,
// including the indented continuation lines of a multi-line block scalar —
// replacing only the key line would orphan them and corrupt the block.
describe("replacePgnValue", () => {
  // Helper: run the replacement over a block's body and return the new lines.
  function rewrite(blockLines: string[], newPgn: string): { found: boolean; lines: string[] } {
    const lines = [...blockLines];
    const found = replacePgnValue(lines, 1, lines.length - 1, newPgn);
    return { found, lines };
  }

  it("replaces a single-line pgn value", () => {
    const { found, lines } = rewrite(["```chess", "pgn: 1. e4 *", "```"], "1. e4 e5 *");
    expect(found).toBe(true);
    expect(lines).toEqual(["```chess", "pgn: 1. e4 e5 *", "```"]);
  });

  it("collapses a multi-line block scalar, removing orphan continuation lines", () => {
    const before = [
      "```chess",
      "pgn: |-",
      '  [Event "X"]',
      "",
      "  1.e4 e5 *",
      "```",
    ];
    const { found, lines } = rewrite(before, "1. e4 e5 2. Nf3 *");
    expect(found).toBe(true);
    expect(lines).toEqual(["```chess", "pgn: 1. e4 e5 2. Nf3 *", "```"]);
    // The result must still parse, with no leftover indented lines.
    expect((parseYaml(lines.slice(1, -1).join("\n")) as { pgn: string }).pgn)
      .toBe("1. e4 e5 2. Nf3 *");
  });

  it("leaves a sibling key after the block scalar intact", () => {
    const before = [
      "```chess",
      "pgn: |-",
      "  1.e4 e5 *",
      "orientation: black",
      "```",
    ];
    const { lines } = rewrite(before, "1. e4 *");
    expect(lines).toEqual(["```chess", "pgn: 1. e4 *", "orientation: black", "```"]);
  });

  it("returns false when there is no pgn line", () => {
    const { found, lines } = rewrite(["```chess", "fen: abc", "```"], "1. e4 *");
    expect(found).toBe(false);
    expect(lines).toEqual(["```chess", "fen: abc", "```"]);
  });
});

// ---------------------------------------------------------------------------
// parseBlock `analysis` key (tri-state: true / false / absent = auto)
// ---------------------------------------------------------------------------

describe("parseBlock analysis key", () => {
  it("leaves analysis undefined when the key is absent (auto)", () => {
    const params = parseBlock("fen: 8/8/8/8/8/8/8/8 w - - 0 1");
    expect(params.analysis).toBeUndefined();
  });

  it("parses explicit analysis: true", () => {
    const params = parseBlock("fen: 8/8/8/8/8/8/8/8 w - - 0 1\nanalysis: true");
    expect(params.analysis).toBe(true);
  });

  it("parses explicit analysis: false", () => {
    const params = parseBlock("fen: 8/8/8/8/8/8/8/8 w - - 0 1\nanalysis: false");
    expect(params.analysis).toBe(false);
  });
});
