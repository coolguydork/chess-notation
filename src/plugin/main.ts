import { Plugin, PluginSettingTab, App, Setting, MarkdownPostProcessorContext, MarkdownRenderChild, TFile, Menu, Modal, MarkdownView, Editor, Notice, Platform } from "obsidian";
import { load as parseYaml } from "js-yaml";
import { parseMultiPGN } from "../core/pgn";
import { uciSquareToIndex } from "../core/fen";
import { buildMoveTree, nodeToPath, pathToNode } from "../core/tree";
import { gameFromFen, gameFromPgn, projectGame, gameToPgn } from "../core/game";
import type { GameEditor } from "../core/game";
import { yamlInlineScalar, buildChessBlock, replacePgnValue } from "./yaml-block";
import { PgnViewer } from "../view/pgn-viewer";
import {
  DEFAULT_BOARD_CONFIG,
  BoardConfig,
  EngineArrow,
  getBoardColors,
  themeNames,
} from "../render/config";
import { scoreToString, uciPvToSan } from "../core/engine";
import type { UciOptionDef, PvMove } from "../core/engine";
import { EngineWorker, probeEngineAvailable } from "./engine-worker";
import type { BoardState, MoveNode, PgnGame } from "../core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ---------------------------------------------------------------------------
// Plugin settings
// ---------------------------------------------------------------------------

interface ChessPluginSettings {
  defaultTheme: string;
  squareSize: number;
  showCoordinates: boolean;
  enginePath: string;                      // explicit binary path; empty = auto-discover
  engineDepth: number;
  engineMultiPV: number;
  engineDiscoveredOptions: UciOptionDef[]; // cached from last successful probe
  engineUserOptions: Record<string, string>; // user-set option values (setoption name X value Y)
  moveListHeight: number | null;           // user's dragged move-list height (px); null = auto-fit
}

const DEFAULT_SETTINGS: ChessPluginSettings = {
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

export function parseBlock(source: string): ChessBlockParams {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    // The body is YAML, but a pasted PGN is full of YAML-hostile characters —
    // apostrophes (white's), colons (URLs in comments), braces — that break a
    // quoted scalar. Point the user at the literal block scalar, which needs no
    // escaping, instead of surfacing the cryptic js-yaml message alone.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      "Chess block: invalid YAML. If your PGN contains apostrophes, colons, or " +
        "spans multiple lines, embed it with a literal block scalar (no quoting " +
        "or escaping needed):\n\npgn: |\n  [Event \"…\"]\n  1. e4 e5 …\n\n" +
        `(${detail})`,
    );
  }
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

  // Tri-state: explicit true/false always wins; an absent key means auto —
  // the panel is mounted only when an engine is detected (mountAnalysisWhenAvailable).
  if ("analysis" in parsed) params.analysis = Boolean(parsed.analysis);

  if (!params.fen && !params.pgn) {
    params.fen = STARTING_FEN;
  }

  return params;
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

// Glyph -> NAG code for the annotation menu items.
const NAG_ITEMS: ReadonlyArray<readonly [string, number]> = [
  ["!", 1], ["?", 2], ["!!", 3], ["??", 4], ["!?", 5], ["?!", 6],
];

// Raise the per-move context menu (Obsidian Menu). All edits go through the
// viewer, which owns the state and re-renders + writes back.
function showMoveMenu(
  app: App,
  viewer: PgnViewer,
  node: MoveNode,
  isVariationHead: boolean,
  evt: MouseEvent,
): void {
  const menu = new Menu();

  if (isVariationHead) {
    menu.addItem((i) =>
      i.setTitle("Promote to mainline").setIcon("arrow-up").onClick(() => viewer.promoteVariationAt(node)));
  }

  menu.addItem((i) =>
    i.setTitle("Comment before move…").setIcon("message-square").onClick(() => {
      new CommentModal(app, "Comment before move", node.commentBefore ?? "",
        (text) => viewer.setCommentOn(node, text, "before")).open();
    }));
  menu.addItem((i) =>
    i.setTitle("Comment after move…").setIcon("message-square").onClick(() => {
      new CommentModal(app, "Comment after move", node.comment ?? "",
        (text) => viewer.setCommentOn(node, text, "after")).open();
    }));

  menu.addSeparator();
  for (const [glyph, code] of NAG_ITEMS) {
    const active = node.nags?.includes(code) ?? false;
    menu.addItem((i) =>
      i.setTitle(`Annotate ${glyph}`).setChecked(active).onClick(() => viewer.setNagOn(node, [code])));
  }
  menu.addItem((i) =>
    i.setTitle("Clear annotation").setDisabled(!node.nags?.length).onClick(() => viewer.setNagOn(node, [])));

  menu.addSeparator();
  menu.addItem((i) =>
    i.setTitle("Delete from here").setIcon("trash").onClick(() => viewer.deleteMove(node)));

  menu.showAtMouseEvent(evt);
}

// Raise the per-comment context menu (right-click an existing comment): edit it
// in the modal, or delete it. Both route through the viewer, which re-renders
// and writes back.
function showCommentMenu(
  app: App,
  viewer: PgnViewer,
  node: MoveNode,
  slot: "before" | "after",
  evt: MouseEvent,
): void {
  const current = slot === "before" ? node.commentBefore ?? "" : node.comment ?? "";
  const title = slot === "before" ? "Comment before move" : "Comment after move";

  const menu = new Menu();
  menu.addItem((i) =>
    i.setTitle("Edit comment…").setIcon("pencil").onClick(() => {
      new CommentModal(app, title, current,
        (text) => viewer.setCommentOn(node, text, slot)).open();
    }));
  menu.addItem((i) =>
    i.setTitle("Delete comment").setIcon("trash").onClick(() => viewer.setCommentOn(node, "", slot)));

  menu.showAtMouseEvent(evt);
}

// Small text-input modal for editing a move's comment.
class CommentModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly initial: string,
    private readonly onSubmit: (text: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    const input = contentEl.createEl("textarea", { cls: "chess-comment-input" });
    input.value = this.initial;
    input.rows = 3;
    input.focus();

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const save = buttons.createEl("button", { text: "Save", cls: "mod-cta" });
    save.onclick = () => {
      this.onSubmit(input.value.trim());
      this.close();
    };
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();

    // Enter saves (Shift+Enter inserts a newline).
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        save.click();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// Paste a raw PGN; on submit, validate it with the same parser the block uses
// and hand back a ready-to-insert ` ```chess ` block with the PGN safely
// embedded (no manual quoting/escaping — see buildChessBlock).
class ImportPgnModal extends Modal {
  constructor(app: App, private readonly onSubmit: (block: string) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Insert chess board from PGN" });
    contentEl.createEl("p", {
      text: "Paste a PGN below. Apostrophes, colons, and line breaks are handled for you.",
      cls: "chess-import-hint",
    });

    const input = contentEl.createEl("textarea", { cls: "chess-import-input" });
    input.rows = 14;
    input.placeholder = '[Event "..."]\n\n1. e4 e5 2. Nf3 Nc6 ... *';
    input.focus();

    const error = contentEl.createEl("p", { cls: "chess-import-error" });
    error.hide();

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const insert = buttons.createEl("button", { text: "Insert", cls: "mod-cta" });
    insert.onclick = () => {
      const raw = input.value.replace(/\r\n?/g, "\n").trim();
      if (!raw) {
        error.setText("Paste a PGN first.");
        error.show();
        return;
      }
      try {
        parseMultiPGN(raw); // same validation the block processor runs
      } catch (e) {
        error.setText(`Couldn't parse that PGN: ${e instanceof Error ? e.message : String(e)}`);
        error.show();
        return;
      }
      this.onSubmit(buildChessBlock(raw));
      this.close();
    };
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
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

  if (replacePgnValue(lines, info.lineStart + 1, info.lineEnd, newPgn)) {
    await app.vault.modify(abstract, lines.join("\n"));
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

  if (replacePgnValue(lines, info.lineStart + 1, info.lineEnd, newPgn)) {
    await app.vault.modify(abstract, lines.join("\n"));
    return;
  }

  // No pgn: line yet — insert one after the fen: line
  for (let i = info.lineStart + 1; i < info.lineEnd; i++) {
    if (/^\s*fen\s*:/.test(lines[i])) {
      lines.splice(i + 1, 0, `pgn: ${yamlInlineScalar(newPgn)}`);
      await app.vault.modify(abstract, lines.join("\n"));
      return;
    }
  }

  // No fen: or pgn: line — empty block; insert right after the opening fence
  lines.splice(info.lineStart + 1, 0, `pgn: ${yamlInlineScalar(newPgn)}`);
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
      .setName("Engine binary path")
      .setDesc("Absolute path to any UCI engine executable — Stockfish, Lc0, etc. (desktop only). " +
               "Leave blank to auto-discover Stockfish from common install locations.")
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

  // Probes spawn real engine processes; injectable so tests stay hermetic.
  engineProbe: (path?: string) => Promise<boolean> = probeEngineAvailable;
  private engineAvailability: { key: string; result: Promise<boolean> } | null = null;

  /** Whether a UCI engine is reachable. Probed once per enginePath value. */
  engineAvailable(): Promise<boolean> {
    const key = this.settings.enginePath;
    if (!this.engineAvailability || this.engineAvailability.key !== key) {
      this.engineAvailability = { key, result: this.engineProbe(key || undefined) };
    }
    return this.engineAvailability.result;
  }

  /**
   * Gate an analysis-panel mount on the block's `analysis` key: explicit
   * true/false always wins; an absent key means auto — mount only once a UCI
   * engine is known to be reachable. Mobile never mounts (no child_process),
   * so the same note renders a clean board on the phone.
   */
  mountAnalysisWhenAvailable(analysis: boolean | undefined, mount: () => void): void {
    if (Platform.isMobile || analysis === false) return;
    if (analysis === true) {
      mount();
      return;
    }
    void this.engineAvailable().then((ok) => {
      if (ok) mount();
    });
  }

  getEngineWorker(): EngineWorker {
    const optionsKey = JSON.stringify(this.settings.engineUserOptions);
    if (
      !this.engineWorker ||
      this.engineWorker.path !== this.settings.enginePath ||
      this.engineWorker.userOptionsKey !== optionsKey ||
      this.engineWorker.depth !== this.settings.engineDepth ||
      this.engineWorker.multiPV !== this.settings.engineMultiPV
    ) {
      this.engineWorker?.dispose();
      this.engineWorker = new EngineWorker({
        externalPath: this.settings.enginePath || undefined,
        depth: this.settings.engineDepth,
        multiPV: this.settings.engineMultiPV,
        userOptions: this.settings.engineUserOptions,
      });
    }
    return this.engineWorker;
  }

  // Open the paste-a-PGN modal and insert the resulting block at the cursor.
  // Inserts on its own line(s) so the fenced block is never glued mid-paragraph.
  private importPgn(editor: Editor): void {
    new ImportPgnModal(this.app, (block) => {
      const cursor = editor.getCursor();
      const before = editor.getLine(cursor.line).slice(0, cursor.ch);
      const lead = before.trim() === "" ? "" : "\n";
      editor.replaceSelection(`${lead}${block}\n`);
    }).open();
  }

  // Seed a viewer with the persisted move-list height and save it back whenever
  // the user drags the resize handle (the viewer debounces the callback).
  private wireMoveListHeight(viewer: PgnViewer): void {
    viewer.setMoveListHeight(this.settings.moveListHeight);
    viewer.onMoveListResize((px) => {
      this.settings.moveListHeight = px;
      void this.saveSettings();
    });
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ChessSettingTab(this.app, this));

    this.addCommand({
      id: "insert-chess-from-pgn",
      name: "Insert chess board from PGN",
      editorCallback: (editor) => this.importPgn(editor),
    });

    this.addRibbonIcon("clipboard-paste", "Insert chess board from PGN", () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        new Notice("Open a note in editing mode first.");
        return;
      }
      this.importPgn(view.editor);
    });

    this.registerMarkdownCodeBlockProcessor(
      "chess",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        try {
          const params = parseBlock(source);

          const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
          const getResourcePath = (path: string) =>
            this.app.vault.adapter.getResourcePath(path);

          const theme = params.theme ?? this.settings.defaultTheme;

          const baseConfig: BoardConfig = {
            ...DEFAULT_BOARD_CONFIG,
            colors: getBoardColors(theme),
            squareSize: this.settings.squareSize,
            showCoordinates: this.settings.showCoordinates,
            orientation: params.orientation ?? DEFAULT_BOARD_CONFIG.orientation,
            resolveAssetUrl: (rel) => getResourcePath(`${pluginDir}/cm-chessboard/${rel}`),
          };

          if (params.fen && !params.pgn) {
            // The AST editor owns the editable game; fall back to a read-only render
            // if it can't load the position.
            let editor: GameEditor | undefined;
            let root: MoveNode;
            try {
              editor = gameFromFen(params.fen);
              root = projectGame(editor);
            } catch {
              editor = undefined;
              root = buildMoveTree(params.fen, []);
            }

            const sectionInfo = ctx.getSectionInfo(el);
            const viewerKey = sectionInfo ? `${ctx.sourcePath}:${sectionInfo.lineStart}` : null;
            const savedPath = viewerKey ? viewerPositionCache.get(viewerKey) : undefined;
            const initialCurrent: MoveNode = savedPath ? pathToNode(root, savedPath) : root;

            const outerContainer = el.createDiv({ cls: "chess-analysis-container" });
            const wrapper = outerContainer.createDiv({ cls: "chess-viewer-wrapper" });

            const appRef = this.app;
            const viewer = new PgnViewer(wrapper, root, baseConfig, initialCurrent, "*", {}, editor);
            this.wireMoveListHeight(viewer);
            viewer.mount();

            if (editor) {
              viewer.setMoveMenuHandler((node, isVarHead, evt) =>
                showMoveMenu(appRef, viewer, node, isVarHead, evt));
              viewer.setCommentMenuHandler((node, slot, evt) =>
                showCommentMenu(appRef, viewer, node, slot, evt));
            }

            viewer.onChange((e) => {
              if (viewerKey) viewerPositionCache.set(viewerKey, nodeToPath(e.current));
            });

            viewer.onChange((e) => {
              if (e.reason !== "move" || !editor) return;
              writeBackFenBlock(appRef, ctx, el, gameToPgn(editor, "*"));
            });

            viewer.onChange((e) => {
              if (e.reason !== "flip") return;
              writeBackOrientation(appRef, ctx, el, viewer.getOrientation());
            });

            let analysisFenReset: (() => void) | null = null;

            viewer.onChange((e) => {
              if (e.reason === "load-game") analysisFenReset?.();
            });

            this.mountAnalysisWhenAvailable(params.analysis, () => {
              const { reset } = mountAnalysisPanel(
                outerContainer,
                () => viewer.getCurrentState(),
                this.getEngineWorker.bind(this),
                (arrows) => { viewer.setEngineArrows(arrows); },
                editor
                  ? (pvMoves, upToIndex) => {
                      viewer.graftLine(viewer.getCurrentNode(), pvMoves.slice(0, upToIndex + 1));
                    }
                  : undefined,
                (s, from, to) => viewer.previewEngineMove(s, from, to),
                () => viewer.endEnginePreview(),
              );
              analysisFenReset = reset;
            });

            ctx.addChild(new PgnViewerChild(el, viewer));
            return;
          }

          // PGN viewer — supports single and multi-game PGN, variation branches,
          // NAG symbols, and inline annotations.
          const games = parseMultiPGN(params.pgn!);
          const startFen = params.fen ?? STARTING_FEN;
          let gameIndex = 0;

          // Single game → the AST editor owns it (editable). Multi-game stays
          // read-only. A single game we can't parse (malformed movetext) also
          // falls back to read-only.
          let editor: GameEditor | undefined;
          let root: MoveNode;
          if (games.length === 1) {
            try {
              editor = gameFromPgn(params.pgn!, params.fen);
              root = projectGame(editor);
            } catch {
              editor = undefined;
              root = buildMoveTree(startFen, games[0].moves);
            }
          } else {
            root = buildMoveTree(startFen, games[0].moves);
          }

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
              viewer.loadGame(newRoot, games[gameIndex].result, games[gameIndex].headers);
            });
          }

          const app = this.app;
          const viewer = new PgnViewer(wrapper, root, baseConfig, initialCurrent, games[0].result, games[gameIndex].headers, editor);
          this.wireMoveListHeight(viewer);
          viewer.mount();

          if (editor) {
            viewer.setMoveMenuHandler((node, isVarHead, evt) =>
              showMoveMenu(app, viewer, node, isVarHead, evt));
            viewer.setCommentMenuHandler((node, slot, evt) =>
              showCommentMenu(app, viewer, node, slot, evt));
          }

          // Position cache listener
          viewer.onChange((e) => {
            if (viewerKey) viewerPositionCache.set(viewerKey, nodeToPath(e.current));
          });

          // Write-back listener (only when the editor owns the game, i.e. single game)
          viewer.onChange((e) => {
            if (e.reason !== "move" || !editor) return;
            writeBackPgn(app, ctx, el, gameToPgn(editor, games[0].result));
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

          this.mountAnalysisWhenAvailable(params.analysis, () => {
            const { reset } = mountAnalysisPanel(
              outerContainer,
              () => viewer.getCurrentState(),
              this.getEngineWorker.bind(this),
              (arrows) => { viewer.setEngineArrows(arrows); },
              editor
                ? (pvMoves, upToIndex) => {
                    viewer.graftLine(viewer.getCurrentNode(), pvMoves.slice(0, upToIndex + 1));
                  }
                : undefined,
              (s, from, to) => viewer.previewEngineMove(s, from, to),
              () => viewer.endEnginePreview(),
            );
            analysisReset = reset;
          });

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
