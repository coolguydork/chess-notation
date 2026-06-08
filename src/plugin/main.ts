import { Plugin, PluginSettingTab, App, Setting, MarkdownPostProcessorContext, MarkdownRenderChild, TFile } from "obsidian";
import { load as parseYaml } from "js-yaml";
import { parseMultiPGN, serializeMoveTree } from "../core/pgn";
import { uciSquareToIndex } from "../core/fen";
import { buildMoveTree, nodeToPath, pathToNode } from "../core/tree";
import { PgnViewer } from "../view/pgn-viewer";
import {
  DEFAULT_BOARD_CONFIG,
  BoardConfig,
  PieceSource,
  EngineArrow,
  getBoardColors,
  themeNames,
} from "../render/config";
import { scoreToString, uciPvToSan } from "../core/engine";
import type { UciOptionDef, PvMove } from "../core/engine";
import { EngineWorker } from "./engine-worker";
import type { Piece, BoardState, MoveNode, PgnGame } from "../core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ---------------------------------------------------------------------------
// Plugin settings
// ---------------------------------------------------------------------------

interface ChessPluginSettings {
  defaultTheme: string;
  squareSize: number;
  showCoordinates: boolean;
  pieceSource: PieceSource;
  engineMode: "auto" | "external" | "wasm";
  enginePath: string;                      // explicit binary path; empty = auto-discover
  engineDepth: number;
  engineMultiPV: number;
  engineDiscoveredOptions: UciOptionDef[]; // cached from last successful probe
  engineUserOptions: Record<string, string>; // user-set option values (setoption name X value Y)
}

const DEFAULT_SETTINGS: ChessPluginSettings = {
  defaultTheme: "classic",
  squareSize: 60,
  showCoordinates: true,
  pieceSource: { type: "bundled" },
  engineMode: "auto",
  enginePath: "",
  engineDepth: 18,
  engineMultiPV: 3,
  engineDiscoveredOptions: [],
  engineUserOptions: {},
};

// ---------------------------------------------------------------------------
// Block params (YAML)
// ---------------------------------------------------------------------------

interface ChessBlockParams {
  fen?: string;
  pgn?: string;
  orientation?: "white" | "black";
  theme?: string;
  analysis?: boolean;
}

function parseBlock(source: string): ChessBlockParams {
  const raw = parseYaml(source);
  if (raw !== null && raw !== undefined && typeof raw !== "object") {
    throw new Error("Chess block: expected a YAML mapping");
  }
  const parsed = (raw ?? {}) as Record<string, unknown>;

  const params: ChessBlockParams = {};

  if ("fen" in parsed) {
    if (typeof parsed.fen !== "string") throw new Error("Chess block: 'fen' must be a string");
    params.fen = parsed.fen;
  }

  if ("pgn" in parsed) {
    if (typeof parsed.pgn !== "string") throw new Error("Chess block: 'pgn' must be a string");
    params.pgn = parsed.pgn;
  }

  if ("orientation" in parsed) {
    if (parsed.orientation !== "white" && parsed.orientation !== "black") {
      throw new Error("Chess block: 'orientation' must be 'white' or 'black'");
    }
    params.orientation = parsed.orientation;
  }

  if ("theme" in parsed) {
    if (typeof parsed.theme !== "string") throw new Error("Chess block: 'theme' must be a string");
    params.theme = parsed.theme;
  }

  params.analysis = "analysis" in parsed ? Boolean(parsed.analysis) : true;

  if (!params.fen && !params.pgn) {
    params.fen = STARTING_FEN;
  }

  return params;
}

// ---------------------------------------------------------------------------
// Piece URL resolution
// ---------------------------------------------------------------------------

function resolvePieceUrl(
  piece: Piece,
  source: PieceSource,
  getResourcePath: (path: string) => string,
  pluginDir: string
): string {
  const name = `${piece.color}${piece.type.toUpperCase()}.svg`;
  switch (source.type) {
    case "bundled":
      return getResourcePath(`${pluginDir}/pieces/${name}`);
    case "cdn":
      return `${source.baseUrl}/${name}`;
    case "local":
      return getResourcePath(`${source.vaultPath}/${name}`);
  }
}

// ---------------------------------------------------------------------------
// Click-to-move board (FEN blocks)
// ---------------------------------------------------------------------------

// Build a human-readable label for a game in a multi-game selector.
function gameLabel(game: PgnGame, index: number): string {
  const w = game.headers["White"];
  const b = game.headers["Black"];
  if (w && b) {
    const round = game.headers["Round"];
    const prefix = round && round !== "?" && round !== "-" ? `R${round} · ` : "";
    return `${prefix}${w} – ${b}`;
  }
  return `Game ${index + 1}`;
}

// ---------------------------------------------------------------------------
// Viewer position cache
// When write-back triggers a re-render, the new block processor call restores
// the user's position rather than dropping them back to the root.
// Key: "sourcePath:lineStart"  Value: ordered SANs from root → current node
// ---------------------------------------------------------------------------

const viewerPositionCache = new Map<string, string[]>();

// ---------------------------------------------------------------------------
// PGN write-back
// Serializes the live MoveNode tree and overwrites the pgn: line in the
// source file. Silently no-ops when called outside a file context (e.g.
// hover previews) or when the block has no pgn: key.
// ---------------------------------------------------------------------------

async function writeBackPgn(
  app: App,
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
  newPgn: string,
): Promise<void> {
  const info = ctx.getSectionInfo(el);
  if (!info) return;

  const abstract = app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(abstract instanceof TFile)) return;

  const content = await app.vault.read(abstract);
  const lines = content.split("\n");

  for (let i = info.lineStart + 1; i < info.lineEnd; i++) {
    if (/^\s*pgn\s*:/.test(lines[i])) {
      lines[i] = `pgn: ${newPgn}`;
      await app.vault.modify(abstract, lines.join("\n"));
      return;
    }
  }
}

// Write-back for FEN-only blocks: updates an existing pgn: line or inserts
// one after the fen: line when the user makes their first move.
async function writeBackFenBlock(
  app: App,
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
  newPgn: string,
): Promise<void> {
  const info = ctx.getSectionInfo(el);
  if (!info) return;

  const abstract = app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(abstract instanceof TFile)) return;

  const content = await app.vault.read(abstract);
  const lines = content.split("\n");

  for (let i = info.lineStart + 1; i < info.lineEnd; i++) {
    if (/^\s*pgn\s*:/.test(lines[i])) {
      lines[i] = `pgn: ${newPgn}`;
      await app.vault.modify(abstract, lines.join("\n"));
      return;
    }
  }

  // No pgn: line yet — insert one after the fen: line
  for (let i = info.lineStart + 1; i < info.lineEnd; i++) {
    if (/^\s*fen\s*:/.test(lines[i])) {
      lines.splice(i + 1, 0, `pgn: ${newPgn}`);
      await app.vault.modify(abstract, lines.join("\n"));
      return;
    }
  }

  // No fen: or pgn: line — empty block; insert right after the opening fence
  lines.splice(info.lineStart + 1, 0, `pgn: ${newPgn}`);
  await app.vault.modify(abstract, lines.join("\n"));
}

// Write-back for orientation changes: updates the `orientation:` line in the
// block if it exists, otherwise inserts it right after the opening fence.
async function writeBackOrientation(
  app: App,
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
  orientation: "white" | "black",
): Promise<void> {
  const info = ctx.getSectionInfo(el);
  if (!info) return;

  const abstract = app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(abstract instanceof TFile)) return;

  const content = await app.vault.read(abstract);
  const lines = content.split("\n");

  for (let i = info.lineStart + 1; i < info.lineEnd; i++) {
    if (/^\s*orientation\s*:/.test(lines[i])) {
      lines[i] = `orientation: ${orientation}`;
      await app.vault.modify(abstract, lines.join("\n"));
      return;
    }
  }

  // No orientation: line yet — insert right after the opening fence
  lines.splice(info.lineStart + 1, 0, `orientation: ${orientation}`);
  await app.vault.modify(abstract, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// PgnViewerChild — Obsidian lifecycle wrapper
// ---------------------------------------------------------------------------

class PgnViewerChild extends MarkdownRenderChild {
  constructor(containerEl: HTMLElement, private viewer: PgnViewer) {
    super(containerEl);
  }
  onunload(): void {
    this.viewer.destroy();
  }
}

// ---------------------------------------------------------------------------
// Analysis panel
// ---------------------------------------------------------------------------

const ARROW_COLORS = ["rgba(0,180,0,0.82)", "rgba(0,120,210,0.75)", "rgba(210,120,0,0.70)"];

function uciToArrow(uciMove: string, color: string): EngineArrow {
  const from = uciSquareToIndex(uciMove.slice(0, 2));
  const to   = uciSquareToIndex(uciMove.slice(2, 4));
  return { from, to, color };
}

function mountAnalysisPanel(
  container: HTMLElement,
  getState: () => BoardState,
  getWorker: () => EngineWorker,
  onArrows?: (arrows: EngineArrow[]) => void,
  onGraftLine?: (pvMoves: PvMove[], upToIndex: number) => void,
  onPreview?: (state: BoardState, from: number, to: number) => void,
  onEndPreview?: () => void,
): { reset: () => void } {
  const panel = container.createDiv({ cls: "chess-analysis-panel" });
  const btn   = panel.createEl("button", { text: "Analyze", cls: "chess-analyze-btn" });
  const output = panel.createDiv({ cls: "chess-analysis-output" });

  function reset(): void {
    btn.disabled = false;
    btn.textContent = "Analyze";
    output.empty();
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Analyzing…";
    output.empty();

    try {
      const worker = getWorker();
      const state = getState();
      const result = await worker.analyze(state, []);

      const arrows: EngineArrow[] = result.moves.map((m, i) =>
        uciToArrow(m.uci, ARROW_COLORS[i] ?? ARROW_COLORS[ARROW_COLORS.length - 1])
      );

      onArrows?.(arrows);

      // Eval bar
      const bestScore = result.moves[0]?.score;
      if (bestScore) {
        const bar = output.createDiv({ cls: "chess-eval-bar" });
        const isMate = bestScore.type === "mate";
        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        const whitePct = isMate
          ? (bestScore.value > 0 ? 100 : 0)
          : clamp(50 + (bestScore.value / 10), 5, 95);
        const fill = bar.createDiv({ cls: "chess-eval-bar-fill" });
        fill.style.width = `${whitePct}%`;
        bar.createSpan({ text: scoreToString(bestScore), cls: "chess-eval-bar-label" });
      }

      // Show eval list
      for (const [i, move] of result.moves.entries()) {
        const pvMoves = uciPvToSan(state, move.pv.slice(0, 5));
        const row = output.createDiv({ cls: "chess-analysis-row" });
        row.createSpan({ text: `${i + 1}.`, cls: "chess-analysis-rank" });
        const scoreClass = move.score.type === "mate"
          ? "chess-analysis-score chess-analysis-score--mate"
          : "chess-analysis-score";
        row.createSpan({ text: scoreToString(move.score), cls: scoreClass });
        const pvEl = row.createSpan({ cls: "chess-analysis-pv" });
        if (onEndPreview) pvEl.addEventListener("pointerleave", () => onEndPreview());
        for (const [j, pvMove] of pvMoves.entries()) {
          const btn = pvEl.createEl("button", {
            text: pvMove.san,
            cls: j === 0 ? "chess-pv-move chess-pv-move--best" : "chess-pv-move",
          });
          if (onPreview) btn.addEventListener("pointerenter", () => onPreview(pvMove.state, pvMove.from, pvMove.to));
          if (onGraftLine) {
            btn.addEventListener("click", () => onGraftLine(pvMoves, j));
          } else {
            btn.disabled = true;
          }
        }
        row.createSpan({ text: `d${move.depth}`, cls: "chess-analysis-depth" });
      }

      btn.textContent = "Re-analyze";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.createEl("p", { text: `Engine error: ${msg}`, cls: "chess-engine-error" });
      btn.textContent = "Analyze";
    } finally {
      btn.disabled = false;
    }
  });

  return { reset };
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

class ChessSettingTab extends PluginSettingTab {
  plugin: ChessPlugin;

  constructor(app: App, plugin: ChessPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Default board theme")
      .setDesc("Color scheme used when no 'theme:' is set in a chess block.")
      .addDropdown((drop) => {
        for (const name of themeNames) {
          drop.addOption(name, name.charAt(0).toUpperCase() + name.slice(1));
        }
        drop.setValue(this.plugin.settings.defaultTheme);
        drop.onChange(async (value) => {
          this.plugin.settings.defaultTheme = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Square size (px)")
      .setDesc("Width and height of each board square in pixels.")
      .addSlider((slider) => {
        slider
          .setLimits(40, 100, 5)
          .setValue(this.plugin.settings.squareSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.squareSize = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Show coordinates")
      .setDesc("Display file and rank labels on the board.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showCoordinates)
          .onChange(async (value) => {
            this.plugin.settings.showCoordinates = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("h3", { text: "Engine" });

    new Setting(containerEl)
      .setName("Engine mode")
      .setDesc("Auto uses the external binary on desktop (strongest) and the built-in WASM engine on mobile. " +
               "WASM runs on all devices but is weaker and slower than a native Stockfish install. " +
               "External binary is desktop-only (install via Homebrew, apt, etc.).")
      .addDropdown((drop) => {
        drop.addOption("auto", "Auto (recommended)");
        drop.addOption("external", "External binary (desktop only)");
        drop.addOption("wasm", "WASM — built-in, weaker");
        drop.setValue(this.plugin.settings.engineMode);
        drop.onChange(async (value) => {
          this.plugin.settings.engineMode = value as "auto" | "external" | "wasm";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Engine binary path")
      .setDesc("Absolute path to a UCI-compatible engine executable. Leave blank to auto-discover.")
      .addText((text) => {
        text
          .setPlaceholder("/opt/homebrew/bin/stockfish")
          .setValue(this.plugin.settings.enginePath)
          .onChange(async (value) => {
            this.plugin.settings.enginePath = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Analysis depth")
      .setDesc("Search depth (higher = stronger but slower).")
      .addSlider((slider) => {
        slider
          .setLimits(8, 30, 1)
          .setValue(this.plugin.settings.engineDepth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.engineDepth = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Lines shown (MultiPV)")
      .setDesc("Number of top moves to display when analyzing a position.")
      .addSlider((slider) => {
        slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.engineMultiPV)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.engineMultiPV = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("h4", { text: "Engine options" });

    // Options the plugin manages through its own dedicated settings.
    const PLUGIN_MANAGED = new Set(["MultiPV"]);

    const probeRow = new Setting(containerEl)
      .setName("Discover options")
      .setDesc("Probe the configured engine to load its available settings.");
    probeRow.addButton((btn) => {
      btn.setButtonText("Probe engine").onClick(async () => {
        btn.setDisabled(true);
        btn.setButtonText("Probing…");
        try {
          const opts = await this.plugin.getEngineWorker().discoverOptions();
          this.plugin.settings.engineDiscoveredOptions = opts;
          await this.plugin.saveSettings();
        } catch { /* ignore — engine not available */ }
        this.display();
      });
    });

    const discoverable = this.plugin.settings.engineDiscoveredOptions
      .filter((o) => !PLUGIN_MANAGED.has(o.name) && o.type !== "button");

    if (discoverable.length === 0) {
      containerEl.createEl("p", {
        text: this.plugin.settings.engineDiscoveredOptions.length === 0
          ? "Click 'Probe engine' to load available options."
          : "No user-configurable options reported by this engine.",
        cls: "chess-settings-note",
      });
    }

    for (const opt of discoverable) {
      const saved = this.plugin.settings.engineUserOptions[opt.name];
      const row = new Setting(containerEl).setName(opt.name);

      if (opt.type === "check") {
        const cur = saved !== undefined ? saved === "true" : opt.default;
        row.addToggle((t) =>
          t.setValue(cur).onChange(async (v) => {
            this.plugin.settings.engineUserOptions[opt.name] = v ? "true" : "false";
            await this.plugin.saveSettings();
          })
        );
      } else if (opt.type === "spin") {
        const cur = saved !== undefined ? parseInt(saved, 10) : opt.default;
        if (opt.max - opt.min <= 1000) {
          row.addSlider((sl) =>
            sl.setLimits(opt.min, opt.max, 1)
              .setValue(cur)
              .setDynamicTooltip()
              .onChange(async (v) => {
                this.plugin.settings.engineUserOptions[opt.name] = String(v);
                await this.plugin.saveSettings();
              })
          );
        } else {
          row.setDesc(`${opt.min} – ${opt.max}`).addText((t) =>
            t.setValue(String(cur)).onChange(async (v) => {
              const n = parseInt(v, 10);
              if (!isNaN(n) && n >= opt.min && n <= opt.max) {
                this.plugin.settings.engineUserOptions[opt.name] = String(n);
                await this.plugin.saveSettings();
              }
            })
          );
        }
      } else if (opt.type === "combo") {
        const cur = saved ?? opt.default;
        row.addDropdown((d) => {
          for (const v of opt.vars) d.addOption(v, v);
          d.setValue(cur).onChange(async (v) => {
            this.plugin.settings.engineUserOptions[opt.name] = v;
            await this.plugin.saveSettings();
          });
        });
      } else if (opt.type === "string") {
        const cur = saved ?? opt.default;
        row.addText((t) =>
          t.setValue(cur).onChange(async (v) => {
            this.plugin.settings.engineUserOptions[opt.name] = v;
            await this.plugin.saveSettings();
          })
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class ChessPlugin extends Plugin {
  settings!: ChessPluginSettings;
  private engineWorker: EngineWorker | null = null;

  getEngineWorker(): EngineWorker {
    const optionsKey = JSON.stringify(this.settings.engineUserOptions);
    if (
      !this.engineWorker ||
      this.engineWorker.mode !== this.settings.engineMode ||
      this.engineWorker.path !== this.settings.enginePath ||
      this.engineWorker.userOptionsKey !== optionsKey
    ) {
      this.engineWorker?.dispose();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = (this.app.vault.adapter as any);
      const pluginDir = adapter.getBasePath
        ? `${adapter.getBasePath()}/.obsidian/plugins/${this.manifest.id}`
        : "";
      this.engineWorker = new EngineWorker({
        mode: this.settings.engineMode,
        externalPath: this.settings.enginePath || undefined,
        wasmDir: pluginDir,
        depth: this.settings.engineDepth,
        multiPV: this.settings.engineMultiPV,
        userOptions: this.settings.engineUserOptions,
      });
    }
    return this.engineWorker;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ChessSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor(
      "chess",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        try {
          const params = parseBlock(source);

          const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
          const getResourcePath = (path: string) =>
            this.app.vault.adapter.getResourcePath(path);

          const pieceSource = this.settings.pieceSource;
          const theme = params.theme ?? this.settings.defaultTheme;

          const baseConfig: BoardConfig = {
            ...DEFAULT_BOARD_CONFIG,
            colors: getBoardColors(theme),
            squareSize: this.settings.squareSize,
            showCoordinates: this.settings.showCoordinates,
            orientation: params.orientation ?? DEFAULT_BOARD_CONFIG.orientation,
            resolvePieceUrl: (piece) =>
              resolvePieceUrl(piece, pieceSource, getResourcePath, pluginDir),
            resolveAssetUrl: (rel) => getResourcePath(`${pluginDir}/cm-chessboard/${rel}`),
          };

          if (params.fen && !params.pgn) {
            const root: MoveNode = buildMoveTree(params.fen, []);

            const sectionInfo = ctx.getSectionInfo(el);
            const viewerKey = sectionInfo ? `${ctx.sourcePath}:${sectionInfo.lineStart}` : null;
            const savedPath = viewerKey ? viewerPositionCache.get(viewerKey) : undefined;
            const initialCurrent: MoveNode = savedPath ? pathToNode(root, savedPath) : root;

            const outerContainer = el.createDiv({ cls: "chess-analysis-container" });
            const wrapper = outerContainer.createDiv({ cls: "chess-viewer-wrapper" });

            const appRef = this.app;
            const viewer = new PgnViewer(wrapper, root, baseConfig, initialCurrent, "*");
            viewer.mount();

            viewer.onChange((e) => {
              if (viewerKey) viewerPositionCache.set(viewerKey, nodeToPath(e.current));
            });

            viewer.onChange((e) => {
              if (e.reason !== "move" && e.reason !== "promote") return;
              writeBackFenBlock(appRef, ctx, el, serializeMoveTree(e.root, "*"));
            });

            viewer.onChange((e) => {
              if (e.reason !== "flip") return;
              writeBackOrientation(appRef, ctx, el, viewer.getOrientation());
            });

            let analysisFenReset: (() => void) | null = null;

            viewer.onChange((e) => {
              if (e.reason === "load-game") analysisFenReset?.();
            });

            if (params.analysis) {
              const { reset } = mountAnalysisPanel(
                outerContainer,
                () => viewer.getCurrentState(),
                this.getEngineWorker.bind(this),
                (arrows) => { viewer.setEngineArrows(arrows); },
                (pvMoves, upToIndex) => {
                  viewer.graftLine(viewer.getCurrentNode(), pvMoves.slice(0, upToIndex + 1));
                },
                (s, from, to) => viewer.previewEngineMove(s, from, to),
                () => viewer.endEnginePreview(),
              );
              analysisFenReset = reset;
            }

            ctx.addChild(new PgnViewerChild(el, viewer));
            return;
          }

          // PGN viewer — supports single and multi-game PGN, variation branches,
          // NAG symbols, and inline annotations.
          const games = parseMultiPGN(params.pgn!);
          const startFen = params.fen ?? STARTING_FEN;
          let gameIndex = 0;
          const root: MoveNode = buildMoveTree(startFen, games[0].moves);

          // Restore position saved before a write-back re-render
          const sectionInfo = ctx.getSectionInfo(el);
          const viewerKey = sectionInfo ? `${ctx.sourcePath}:${sectionInfo.lineStart}` : null;
          const savedPath = viewerKey ? viewerPositionCache.get(viewerKey) : undefined;
          const initialCurrent: MoveNode = savedPath ? pathToNode(root, savedPath) : root;

          const outerContainer = el.createDiv({ cls: "chess-analysis-container" });
          const wrapper = outerContainer.createDiv({ cls: "chess-viewer-wrapper" });

          // Game selector — only shown when the PGN contains more than one game
          if (games.length > 1) {
            const selectorDiv = wrapper.createDiv({ cls: "chess-game-selector" });
            if (games.length > 1) {
              selectorDiv.createEl("p", {
                text: "Editing is disabled for multi-game PGN files.",
                cls: "chess-multigame-notice",
              });
            }
            const select = selectorDiv.createEl("select", { cls: "chess-game-select" });
            games.forEach((g: PgnGame, i: number) => {
              const opt = select.createEl("option", { value: String(i), text: gameLabel(g, i) });
              if (i === gameIndex) opt.selected = true;
            });
            select.addEventListener("change", () => {
              gameIndex = parseInt(select.value, 10);
              const newRoot = buildMoveTree(startFen, games[gameIndex].moves);
              viewer.loadGame(newRoot, games[gameIndex].result);
            });
          }

          const app = this.app;
          const viewer = new PgnViewer(wrapper, root, baseConfig, initialCurrent, games[0].result);
          viewer.mount();

          // Position cache listener
          viewer.onChange((e) => {
            if (viewerKey) viewerPositionCache.set(viewerKey, nodeToPath(e.current));
          });

          // Write-back listener (single game only, tree mutations only)
          viewer.onChange((e) => {
            if (e.reason !== "move" && e.reason !== "promote") return;
            if (games.length !== 1) return;
            writeBackPgn(app, ctx, el, serializeMoveTree(e.root, games[0].result));
          });

          viewer.onChange((e) => {
            if (e.reason !== "flip") return;
            writeBackOrientation(app, ctx, el, viewer.getOrientation());
          });

          let analysisReset: (() => void) | null = null;

          // Analysis reset on game change
          viewer.onChange((e) => {
            if (e.reason === "load-game") analysisReset?.();
          });

          if (params.analysis) {
            const { reset } = mountAnalysisPanel(
              outerContainer,
              () => viewer.getCurrentState(),
              this.getEngineWorker.bind(this),
              (arrows) => { viewer.setEngineArrows(arrows); },
              (pvMoves, upToIndex) => {
                viewer.graftLine(viewer.getCurrentNode(), pvMoves.slice(0, upToIndex + 1));
              },
              (s, from, to) => viewer.previewEngineMove(s, from, to),
              () => viewer.endEnginePreview(),
            );
            analysisReset = reset;
          }

          ctx.addChild(new PgnViewerChild(el, viewer));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          el.createEl("pre", { text: `Chess error: ${msg}`, cls: "chess-error" });
        }
      }
    );
  }

  onunload(): void {
    this.engineWorker?.dispose();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
