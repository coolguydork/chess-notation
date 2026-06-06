import { describe, it, expect } from "vitest";
import { BOARD_THEMES, getBoardColors, themeNames } from "../../src/render/config";

describe("BOARD_THEMES", () => {
  it("has at least four named themes", () => {
    expect(themeNames.length).toBeGreaterThanOrEqual(4);
  });

  it("includes 'classic' theme", () => {
    expect(themeNames).toContain("classic");
  });

  it("includes 'blue' theme", () => {
    expect(themeNames).toContain("blue");
  });

  it("includes 'green' theme", () => {
    expect(themeNames).toContain("green");
  });

  it("includes 'dark' theme", () => {
    expect(themeNames).toContain("dark");
  });

  it("each theme has light and dark color strings", () => {
    for (const name of themeNames) {
      const theme = BOARD_THEMES[name];
      expect(typeof theme.light).toBe("string");
      expect(typeof theme.dark).toBe("string");
      expect(theme.light.length).toBeGreaterThan(0);
      expect(theme.dark.length).toBeGreaterThan(0);
    }
  });

  it("light and dark colors are different within each theme", () => {
    for (const name of themeNames) {
      const theme = BOARD_THEMES[name];
      expect(theme.light).not.toBe(theme.dark);
    }
  });
});

describe("getBoardColors", () => {
  it("returns theme colors for a known theme name", () => {
    const colors = getBoardColors("classic");
    expect(colors).toEqual(BOARD_THEMES["classic"]);
  });

  it("returns classic colors for an unknown theme name", () => {
    const colors = getBoardColors("nonexistent");
    expect(colors).toEqual(BOARD_THEMES["classic"]);
  });

  it("returns classic colors when called with undefined", () => {
    const colors = getBoardColors(undefined);
    expect(colors).toEqual(BOARD_THEMES["classic"]);
  });

  it("blue theme has blue-ish dark squares", () => {
    const colors = getBoardColors("blue");
    expect(colors.dark.toLowerCase()).toMatch(/#[0-9a-f]{6}/);
  });
});
