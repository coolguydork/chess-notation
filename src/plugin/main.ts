import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { load as parseYaml } from "js-yaml";
import { parseFEN } from "../core/fen";
import { parsePGN } from "../core/pgn";
import { renderBoard } from "../render/board";
import { buildSnapshots, renderControls } from "../render/controls";
import { DEFAULT_BOARD_CONFIG, BoardConfig, PieceSource } from "../render/config";
import type { Piece } from "../core/types";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface ChessBlockParams {
  fen?: string;
  pgn?: string;
  orientation?: "white" | "black";
}

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

  if (!params.fen && !params.pgn) {
    throw new Error("Chess block: 'fen' or 'pgn' is required");
  }

  return params;
}

export default class ChessPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerMarkdownCodeBlockProcessor(
      "chess",
      (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
        try {
          const params = parseBlock(source);

          const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
          const getResourcePath = (path: string) =>
            this.app.vault.adapter.getResourcePath(path);

          const pieceSource = DEFAULT_BOARD_CONFIG.pieceSource;
          const config: BoardConfig = {
            ...DEFAULT_BOARD_CONFIG,
            orientation: params.orientation ?? DEFAULT_BOARD_CONFIG.orientation,
            resolvePieceUrl: (piece) =>
              resolvePieceUrl(piece, pieceSource, getResourcePath, pluginDir),
          };

          if (params.fen && !params.pgn) {
            // Phase 1 path: static board from FEN
            const state = parseFEN(params.fen);
            const svg = renderBoard(state, config);
            const wrapper = el.createDiv({ cls: "chess-board" });
            wrapper.innerHTML = svg;
            return;
          }

          // Phase 2 path: PGN with move navigation
          const game = parsePGN(params.pgn!);
          const startFen = params.fen ?? STARTING_FEN;
          const snapshots = buildSnapshots(startFen, game.moves);

          let currentIndex = 0;

          const wrapper = el.createDiv({ cls: "chess-viewer-wrapper" });

          function render(): void {
            wrapper.innerHTML = renderControls(snapshots, currentIndex, config, game.result);
            attachHandlers();
          }

          function attachHandlers(): void {
            wrapper.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
              btn.addEventListener("click", () => {
                const action = btn.dataset.action;
                if (action === "prev" && currentIndex > 0) {
                  currentIndex--;
                  render();
                } else if (action === "next" && currentIndex < snapshots.length - 1) {
                  currentIndex++;
                  render();
                }
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
          el.createEl("pre", {
            text: `Chess error: ${msg}`,
            cls: "chess-error",
          });
        }
      }
    );
  }

  onunload(): void {}
}
