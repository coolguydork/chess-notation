import { describe, it, expect } from "vitest";
import { load as parseYaml } from "js-yaml";
import { yamlInlineScalar } from "../../src/plugin/yaml-block";

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
