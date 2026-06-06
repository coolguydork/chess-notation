import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    alias: {
      // obsidian is provided at runtime by Obsidian; stub it for tests
      obsidian: new URL("./tests/__mocks__/obsidian.ts", import.meta.url).pathname,
    },
  },
});
