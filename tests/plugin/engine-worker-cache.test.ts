import { describe, it, expect } from "vitest";
import ChessPlugin from "../../src/plugin/main";
import type { App, PluginManifest } from "obsidian";

// getEngineWorker caches an EngineWorker and must recreate it whenever any
// setting baked into its config changes — path, user options, depth, multiPV.
// (Constructing an EngineWorker spawns nothing; the binary is only touched on
// probe/analyze, so these tests never start a process.)

function makePlugin(): ChessPlugin {
  const plugin = new ChessPlugin({} as App, {} as PluginManifest);
  plugin.settings = {
    defaultTheme: "classic",
    squareSize: 60,
    showCoordinates: true,
    enginePath: "",
    engineDepth: 18,
    engineMultiPV: 3,
    engineDiscoveredOptions: [],
    engineUserOptions: {},
    moveListHeight: null,
  };
  return plugin;
}

describe("ChessPlugin.getEngineWorker", () => {
  it("reuses the cached worker while settings are unchanged", () => {
    const plugin = makePlugin();
    const first = plugin.getEngineWorker();
    expect(plugin.getEngineWorker()).toBe(first);
  });

  it("recreates the worker when engineDepth changes", () => {
    const plugin = makePlugin();
    const first = plugin.getEngineWorker();
    plugin.settings.engineDepth = 25;
    const second = plugin.getEngineWorker();
    expect(second).not.toBe(first);
    expect(second.depth).toBe(25);
  });

  it("recreates the worker when engineMultiPV changes", () => {
    const plugin = makePlugin();
    const first = plugin.getEngineWorker();
    plugin.settings.engineMultiPV = 5;
    const second = plugin.getEngineWorker();
    expect(second).not.toBe(first);
    expect(second.multiPV).toBe(5);
  });

  it("recreates the worker when enginePath changes", () => {
    const plugin = makePlugin();
    const first = plugin.getEngineWorker();
    plugin.settings.enginePath = "/usr/local/bin/stockfish";
    expect(plugin.getEngineWorker()).not.toBe(first);
  });

  it("recreates the worker when engineUserOptions change", () => {
    const plugin = makePlugin();
    const first = plugin.getEngineWorker();
    plugin.settings.engineUserOptions = { Threads: "2" };
    expect(plugin.getEngineWorker()).not.toBe(first);
  });
});
