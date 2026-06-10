import { describe, it, expect, vi } from "vitest";
import ChessPlugin from "../../src/plugin/main";
import { Platform, type App, type PluginManifest } from "obsidian";

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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("ChessPlugin.engineAvailable", () => {
  it("probes once and caches the result", async () => {
    const plugin = makePlugin();
    const probe = vi.fn(async () => true);
    plugin.engineProbe = probe;
    await expect(plugin.engineAvailable()).resolves.toBe(true);
    await expect(plugin.engineAvailable()).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(undefined); // empty path → auto-discovery
  });

  it("re-probes when enginePath changes", async () => {
    const plugin = makePlugin();
    const probe = vi.fn(async () => false);
    plugin.engineProbe = probe;
    await plugin.engineAvailable();
    plugin.settings.enginePath = "/opt/homebrew/bin/lc0";
    await plugin.engineAvailable();
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenLastCalledWith("/opt/homebrew/bin/lc0");
  });
});

describe("ChessPlugin.mountAnalysisWhenAvailable", () => {
  it("mounts immediately for explicit analysis: true, without probing", () => {
    const plugin = makePlugin();
    const probe = vi.fn(async () => false);
    plugin.engineProbe = probe;
    const mount = vi.fn();
    plugin.mountAnalysisWhenAvailable(true, mount);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();
  });

  it("never mounts for explicit analysis: false", async () => {
    const plugin = makePlugin();
    const probe = vi.fn(async () => true);
    plugin.engineProbe = probe;
    const mount = vi.fn();
    plugin.mountAnalysisWhenAvailable(false, mount);
    await tick();
    expect(mount).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it("mounts on auto once the probe finds an engine", async () => {
    const plugin = makePlugin();
    plugin.engineProbe = vi.fn(async () => true);
    const mount = vi.fn();
    plugin.mountAnalysisWhenAvailable(undefined, mount);
    expect(mount).not.toHaveBeenCalled(); // async — board renders first
    await tick();
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("does not mount on auto when no engine is found", async () => {
    const plugin = makePlugin();
    plugin.engineProbe = vi.fn(async () => false);
    const mount = vi.fn();
    plugin.mountAnalysisWhenAvailable(undefined, mount);
    await tick();
    expect(mount).not.toHaveBeenCalled();
  });

  it("never mounts on mobile, even with explicit analysis: true", async () => {
    const plugin = makePlugin();
    const probe = vi.fn(async () => true);
    plugin.engineProbe = probe;
    const mount = vi.fn();
    Platform.isMobile = true;
    try {
      plugin.mountAnalysisWhenAvailable(true, mount);
      plugin.mountAnalysisWhenAvailable(undefined, mount);
      await tick();
    } finally {
      Platform.isMobile = false;
    }
    expect(mount).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });
});
