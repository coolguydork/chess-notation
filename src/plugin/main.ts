import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { load as parseYaml } from "js-yaml";
import { parseFEN } from "../core/fen";
import { renderBoard } from "../render/board";
import { DEFAULT_BOARD_CONFIG, BoardConfig, PieceSource } from "../render/config";
import type { Piece } from "../core/types";

interface ChessBlockParams {
  fen?: string;
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

  if ("orientation" in parsed) {
    if (parsed.orientation !== "white" && parsed.orientation !== "black") {
      throw new Error("Chess block: 'orientation' must be 'white' or 'black'");
    }
    params.orientation = parsed.orientation;
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

          if (!params.fen) {
            throw new Error("Chess block: 'fen' is required in Phase 1");
          }

          const state = parseFEN(params.fen);

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

          const svg = renderBoard(state, config);

          const wrapper = el.createDiv({ cls: "chess-board" });
          wrapper.innerHTML = svg;
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

  onunload(): void {
    // Nothing to tear down in Phase 1
  }
}
