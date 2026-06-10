import { uciSquareToIndex } from "../core/fen";
import { scoreToString, uciPvToSan } from "../core/engine";
import type { AnalysisResult, PvMove } from "../core/engine";
import type { BoardState } from "../core/types";
import type { EngineArrow } from "../render/config";

// ---------------------------------------------------------------------------
// Analysis panel
// ---------------------------------------------------------------------------

/**
 * The slice of the engine worker the panel needs. Structural so view/ never
 * imports from plugin/ (where EngineWorker lives).
 */
export interface AnalysisEngine {
  analyze(state: BoardState, history: string[]): Promise<AnalysisResult>;
  stopSearch(): void;
}

const ARROW_COLORS = ["rgba(0,180,0,0.82)", "rgba(0,120,210,0.75)", "rgba(210,120,0,0.70)"];

function uciToArrow(uciMove: string, color: string): EngineArrow {
  const from = uciSquareToIndex(uciMove.slice(0, 2));
  const to   = uciSquareToIndex(uciMove.slice(2, 4));
  return { from, to, color };
}

export function mountAnalysisPanel(
  container: HTMLElement,
  getState: () => BoardState,
  getWorker: () => AnalysisEngine,
  onArrows?: (arrows: EngineArrow[]) => void,
  onGraftLine?: (pvMoves: PvMove[], upToIndex: number) => void,
  onPreview?: (state: BoardState, from: number, to: number) => void,
  onEndPreview?: () => void,
): { reset: () => void; destroy: () => void } {
  const panel = container.createDiv({ cls: "chess-analysis-panel" });
  const btn   = panel.createEl("button", { text: "Analyze", cls: "chess-analyze-btn" });
  const output = panel.createDiv({ cls: "chess-analysis-output" });

  // The worker whose analyze() this panel is currently awaiting, if any.
  let activeWorker: AnalysisEngine | null = null;

  function reset(): void {
    btn.disabled = false;
    btn.textContent = "Analyze";
    output.empty();
  }

  function destroy(): void {
    // Panel torn down mid-analysis (block re-render on write-back, note
    // closed): stop the orphaned search instead of letting it run to
    // completion for nobody.
    activeWorker?.stopSearch();
    activeWorker = null;
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Analyzing…";
    output.empty();

    try {
      const worker = getWorker();
      activeWorker = worker;
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
      activeWorker = null;
      btn.disabled = false;
    }
  });

  return { reset, destroy };
}
