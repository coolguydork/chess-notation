import { Plugin, PluginSettingTab, App, Setting, MarkdownPostProcessorContext } from "obsidian";
import { load as parseYaml } from "js-yaml";
import { parseFEN } from "../core/fen";
import { parseMultiPGN } from "../core/pgn";
import { renderBoard, uciSquareToIndex } from "../render/board";
import { buildMoveTree, findNodeById, renderControls } from "../render/controls";
import { getSquareLegalMoves } from "../core/legal";
import { applyMove } from "../core/moves";
import {
  DEFAULT_BOARD_CONFIG,
  BoardConfig,
  PieceSource,
  EngineArrow,
  UserArrow,
  getBoardColors,
  themeNames,
} from "../render/config";
import { scoreToString } from "../core/engine";
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
  enginePath: string;   // explicit binary path; empty = auto-discover
  engineDepth: number;
  engineMultiPV: number;
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
  const parsed = parseYaml(source) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Chess block: expected a YAML mapping");
  }

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

  if ("analysis" in parsed) {
    params.analysis = Boolean(parsed.analysis);
  }

  if (!params.fen && !params.pgn) {
    throw new Error("Chess block: 'fen' or 'pgn' is required");
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

function squareFromEvent(
  e: MouseEvent | PointerEvent,
  squareSize: number,
  orientation: "white" | "black"
): number | null {
  const svg = (e.currentTarget as HTMLElement).querySelector("svg.chess-board-svg");
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const scale = rect.width / (squareSize * 8);
  const col = Math.floor(x / (squareSize * scale));
  const row = Math.floor(y / (squareSize * scale));
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const file = orientation === "white" ? col : 7 - col;
  const rank = orientation === "white" ? 7 - row : row;
  return (7 - rank) * 8 + file;
}

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

const USER_ARROW_COLOR = "rgba(220,80,20,0.82)";

function mountInteractiveBoard(
  wrapper: HTMLElement,
  initialState: BoardState,
  baseConfig: BoardConfig
): () => BoardState {
  let state = initialState;
  let selected: number | null = null;
  let legalTargets = new Set<number>();
  let userArrows: UserArrow[] = [];
  let rightDragStart: number | null = null;

  function render(): void {
    const config: BoardConfig = {
      ...baseConfig,
      selectedSquare: selected ?? undefined,
      legalTargets: legalTargets.size > 0 ? legalTargets : undefined,
      userArrows: userArrows.length > 0 ? userArrows : undefined,
    };
    wrapper.innerHTML = renderBoard(state, config);
  }

  // Show a floating comment input near the midpoint of the most-recently drawn arrow.
  // Resolves with the entered label (empty string = no label) or null if cancelled.
  function promptArrowLabel(fromIdx: number, toIdx: number): Promise<string | null> {
    return new Promise((resolve) => {
      const svg = wrapper.querySelector("svg.chess-board-svg");
      if (!svg) { resolve(null); return; }
      const rect = svg.getBoundingClientRect();
      const sq = baseConfig.squareSize;
      const scale = rect.width / (sq * 8);

      function idxToXY(idx: number): { x: number; y: number } {
        const rank = 7 - Math.floor(idx / 8);
        const file = idx % 8;
        const col = baseConfig.orientation === "white" ? file : 7 - file;
        const row = baseConfig.orientation === "white" ? 7 - rank : rank;
        return {
          x: rect.left + (col * sq + sq / 2) * scale,
          y: rect.top  + (row * sq + sq / 2) * scale,
        };
      }

      const p1 = idxToXY(fromIdx);
      const p2 = idxToXY(toIdx);
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;

      const overlay = document.createElement("div");
      overlay.className = "chess-arrow-comment-overlay";
      overlay.style.cssText = `position:fixed;left:${mx}px;top:${my}px;transform:translate(-50%,-50%);
        background:#1e1e2e;border:1px solid rgba(220,80,20,0.7);border-radius:6px;
        padding:6px 8px;display:flex;gap:6px;align-items:center;z-index:9999;box-shadow:0 2px 12px rgba(0,0,0,0.5);`;

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Add comment… (Enter to save, Esc to skip)";
      input.style.cssText = `background:transparent;border:none;outline:none;color:#cdd6f4;
        font-size:13px;width:240px;`;

      const save = document.createElement("button");
      save.textContent = "✓";
      save.style.cssText = `background:rgba(220,80,20,0.8);border:none;border-radius:4px;
        color:#fff;padding:2px 7px;cursor:pointer;font-size:13px;`;

      overlay.appendChild(input);
      overlay.appendChild(save);
      document.body.appendChild(overlay);
      input.focus();

      function done(label: string | null) {
        overlay.remove();
        resolve(label);
      }

      input.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); done(input.value.trim() || null); }
        if (e.key === "Escape") { e.preventDefault(); done(null); }
      });
      save.addEventListener("click", () => done(input.value.trim() || null));

      // Click outside to dismiss without a label
      setTimeout(() => {
        function outside(e: MouseEvent) {
          if (!overlay.contains(e.target as Node)) {
            document.removeEventListener("mousedown", outside);
            done(null);
          }
        }
        document.addEventListener("mousedown", outside);
      }, 0);
    });
  }

  // Left-click move handling
  wrapper.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
    const idx = squareFromEvent(e, baseConfig.squareSize, baseConfig.orientation);
    if (idx === null) return;

    if (selected !== null && legalTargets.has(idx)) {
      const moves = getSquareLegalMoves(state, selected);
      const move =
        moves.find(m => m.to === idx && m.promotion !== "n" && m.promotion !== "b" && m.promotion !== "r") ??
        moves.find(m => m.to === idx);
      if (move) state = applyMove(state, move.san);
      selected = null;
      legalTargets = new Set();
    } else {
      const piece = state.board[idx];
      if (piece && piece.color === state.activeColor) {
        selected = idx;
        legalTargets = new Set(getSquareLegalMoves(state, idx).map(m => m.to));
      } else {
        selected = null;
        legalTargets = new Set();
      }
    }
    render();
  });

  // Right-drag arrow drawing
  wrapper.addEventListener("pointerdown", (e) => {
    if (e.button !== 2) return;
    rightDragStart = squareFromEvent(e, baseConfig.squareSize, baseConfig.orientation);
  });

  wrapper.addEventListener("pointerup", async (e) => {
    if (e.button !== 2) return;
    const end = squareFromEvent(e, baseConfig.squareSize, baseConfig.orientation);
    const start = rightDragStart;
    rightDragStart = null;
    if (start === null || end === null) return;

    if (start === end) {
      // Same square: remove any arrows originating from this square
      userArrows = userArrows.filter(a => a.from !== start);
      render();
      return;
    }

    // Toggle: if this exact arrow already exists, remove it; otherwise add it
    const existing = userArrows.findIndex(a => a.from === start && a.to === end);
    if (existing !== -1) {
      userArrows.splice(existing, 1);
      render();
      return;
    }

    // Draw the arrow first, then ask for an optional comment
    userArrows.push({ from: start, to: end, color: USER_ARROW_COLOR });
    render();

    const label = await promptArrowLabel(start, end);
    if (label) {
      userArrows[userArrows.length - 1].label = label;
      render();
    }
  });

  wrapper.addEventListener("contextmenu", (e) => e.preventDefault());

  render();
  return () => state;
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
  boardWrapper: HTMLElement,
  getState: () => BoardState,
  baseConfig: BoardConfig,
  getWorker: () => EngineWorker
): void {
  const panel = container.createDiv({ cls: "chess-analysis-panel" });
  const btn   = panel.createEl("button", { text: "Analyze", cls: "chess-analyse-btn" });
  const output = panel.createDiv({ cls: "chess-analysis-output" });

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Analysing…";
    output.empty();

    try {
      const worker = getWorker();
      const state = getState();
      const result = await worker.analyse(state, []);

      // Draw arrows for each top move
      const arrows: EngineArrow[] = result.moves.map((m, i) =>
        uciToArrow(m.uci, ARROW_COLORS[i] ?? ARROW_COLORS[ARROW_COLORS.length - 1])
      );
      boardWrapper.innerHTML = renderBoard(state, { ...baseConfig, engineArrows: arrows });

      // Show eval list
      for (const move of result.moves) {
        const row = output.createDiv({ cls: "chess-analysis-row" });
        row.createSpan({ text: scoreToString(move.score), cls: "chess-analysis-score" });
        row.createSpan({ text: move.pv.slice(0, 5).join(" "), cls: "chess-analysis-pv" });
      }

      btn.textContent = "Re-analyse";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.createEl("p", { text: `Engine error: ${msg}`, cls: "chess-engine-error" });
      btn.textContent = "Analyze";
    } finally {
      btn.disabled = false;
    }
  });
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
      .setName("Stockfish binary path")
      .setDesc("Absolute path to the Stockfish executable. Leave blank to auto-discover.")
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
      .setDesc("How deeply Stockfish searches (higher = stronger but slower).")
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
      .setDesc("Number of top moves to display when analysing a position.")
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
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class ChessPlugin extends Plugin {
  settings!: ChessPluginSettings;
  private engineWorker: EngineWorker | null = null;

  getEngineWorker(): EngineWorker {
    if (
      !this.engineWorker ||
      this.engineWorker.mode !== this.settings.engineMode ||
      this.engineWorker.path !== this.settings.enginePath
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
      });
    }
    return this.engineWorker;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ChessSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor(
      "chess",
      (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
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
          };

          if (params.fen && !params.pgn) {
            const state = parseFEN(params.fen);
            const container = el.createDiv({ cls: "chess-analysis-container" });
            const boardWrapper = container.createDiv({ cls: "chess-board" });
            const getState = mountInteractiveBoard(boardWrapper, state, baseConfig);

            if (params.analysis) {
              mountAnalysisPanel(container, boardWrapper, getState, baseConfig, this.getEngineWorker.bind(this));
            }
            return;
          }

          // PGN viewer — supports single and multi-game PGN, variation branches,
          // NAG symbols, and inline annotations.
          const games = parseMultiPGN(params.pgn!);
          const startFen = params.fen ?? STARTING_FEN;
          let gameIndex = 0;
          let root = buildMoveTree(startFen, games[0].moves);
          let current: MoveNode = root;
          const wrapper = el.createDiv({ cls: "chess-viewer-wrapper" });

          function render(): void {
            wrapper.innerHTML = "";

            // Game selector — only shown when the PGN contains more than one game
            if (games.length > 1) {
              const selectorDiv = wrapper.createDiv({ cls: "chess-game-selector" });
              const select = selectorDiv.createEl("select", { cls: "chess-game-select" });
              games.forEach((g: PgnGame, i: number) => {
                const opt = select.createEl("option", {
                  value: String(i),
                  text: gameLabel(g, i),
                });
                if (i === gameIndex) opt.selected = true;
              });
              select.addEventListener("change", () => {
                gameIndex = parseInt(select.value, 10);
                root = buildMoveTree(startFen, games[gameIndex].moves);
                current = root;
                render();
              });
            }

            const viewerDiv = wrapper.createDiv();
            viewerDiv.innerHTML = renderControls(root, current, baseConfig, games[gameIndex].result);
            attachHandlers(viewerDiv);
          }

          function attachHandlers(viewerDiv: HTMLElement): void {
            viewerDiv.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
              btn.addEventListener("click", () => {
                const action = btn.dataset.action;
                if (action === "prev" && current.parent) { current = current.parent; render(); }
                else if (action === "next" && current.next) { current = current.next; render(); }
              });
            });

            viewerDiv.querySelectorAll<HTMLElement>("[data-node-id]").forEach((token) => {
              token.addEventListener("click", () => {
                const id = parseInt(token.dataset.nodeId ?? "-1", 10);
                const found = findNodeById(root, id);
                if (found) { current = found; render(); }
              });
            });
          }

          render();
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
