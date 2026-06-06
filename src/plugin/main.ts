import { Plugin, PluginSettingTab, App, Setting, MarkdownPostProcessorContext } from "obsidian";
import { load as parseYaml } from "js-yaml";
import { parseFEN } from "../core/fen";
import { parsePGN } from "../core/pgn";
import { renderBoard } from "../render/board";
import { buildSnapshots, renderControls } from "../render/controls";
import { getSquareLegalMoves } from "../core/legal";
import { applyMove } from "../core/moves";
import {
  DEFAULT_BOARD_CONFIG,
  BoardConfig,
  PieceSource,
  getBoardColors,
  themeNames,
} from "../render/config";
import type { Piece, BoardState } from "../core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ---------------------------------------------------------------------------
// Plugin settings
// ---------------------------------------------------------------------------

interface ChessPluginSettings {
  defaultTheme: string;
  squareSize: number;
  showCoordinates: boolean;
  pieceSource: PieceSource;
}

const DEFAULT_SETTINGS: ChessPluginSettings = {
  defaultTheme: "classic",
  squareSize: 60,
  showCoordinates: true,
  pieceSource: { type: "bundled" },
};

// ---------------------------------------------------------------------------
// Block params (YAML)
// ---------------------------------------------------------------------------

interface ChessBlockParams {
  fen?: string;
  pgn?: string;
  orientation?: "white" | "black";
  theme?: string;
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

function mountInteractiveBoard(
  wrapper: HTMLElement,
  initialState: BoardState,
  baseConfig: BoardConfig
): void {
  let state = initialState;
  let selected: number | null = null;
  let legalTargets = new Set<number>();

  function render(): void {
    const config: BoardConfig = {
      ...baseConfig,
      selectedSquare: selected ?? undefined,
      legalTargets: legalTargets.size > 0 ? legalTargets : undefined,
    };
    wrapper.innerHTML = renderBoard(state, config);
  }

  // Use pointer events so the same handler works for mouse and touch
  wrapper.addEventListener("pointerup", (e) => {
    const idx = squareFromEvent(e, baseConfig.squareSize, baseConfig.orientation);
    if (idx === null) return;

    if (selected !== null && legalTargets.has(idx)) {
      const moves = getSquareLegalMoves(state, selected);
      // Prefer queen promotion when multiple promotions share the same destination
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

  render();
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
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class ChessPlugin extends Plugin {
  settings!: ChessPluginSettings;

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
            const wrapper = el.createDiv({ cls: "chess-board" });
            mountInteractiveBoard(wrapper, state, baseConfig);
            return;
          }

          // PGN viewer with move navigation
          const game = parsePGN(params.pgn!);
          const startFen = params.fen ?? STARTING_FEN;
          const snapshots = buildSnapshots(startFen, game.moves);
          let currentIndex = 0;
          const wrapper = el.createDiv({ cls: "chess-viewer-wrapper" });

          function render(): void {
            wrapper.innerHTML = renderControls(snapshots, currentIndex, baseConfig, game.result);
            attachHandlers();
          }

          function attachHandlers(): void {
            wrapper.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
              btn.addEventListener("click", () => {
                const action = btn.dataset.action;
                if (action === "prev" && currentIndex > 0) { currentIndex--; render(); }
                else if (action === "next" && currentIndex < snapshots.length - 1) { currentIndex++; render(); }
              });
            });

            wrapper.querySelectorAll<HTMLElement>("[data-index]").forEach((token) => {
              token.addEventListener("click", () => {
                const idx = parseInt(token.dataset.index ?? "0", 10);
                if (!isNaN(idx) && idx >= 0 && idx < snapshots.length) {
                  currentIndex = idx;
                  render();
                }
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

  onunload(): void {}

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
