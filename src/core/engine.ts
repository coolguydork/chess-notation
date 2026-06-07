import type { BoardState } from "./types";
import { serializeFEN } from "./fen";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EngineMode = "auto" | "external" | "wasm";

export interface CpScore {
  type: "cp";
  value: number; // centipawns, positive = side to move is better
}

export interface MateScore {
  type: "mate";
  value: number; // moves to mate; negative = mated
}

export type EngineScore = CpScore | MateScore;

export interface EngineMove {
  uci: string;   // e.g. "e2e4", "e7e8q"
  score: EngineScore;
  depth: number;
  pv: string[];  // full principal variation in UCI notation
  multipv: number;
}

export interface AnalysisResult {
  moves: EngineMove[]; // one per multipv line, sorted by multipv index
  bestMove: string | null;
}

// ---------------------------------------------------------------------------
// UCI serialization
// ---------------------------------------------------------------------------

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function positionToUci(state: BoardState, history: string[]): string {
  const fen = serializeFEN(state);
  const base = fen === STARTING_FEN ? "position startpos" : `position fen ${fen}`;
  return history.length > 0 ? `${base} moves ${history.join(" ")}` : base;
}

// ---------------------------------------------------------------------------
// UCI response parsing
// ---------------------------------------------------------------------------

function extractToken(tokens: string[], key: string): string | null {
  const idx = tokens.indexOf(key);
  return idx !== -1 && idx + 1 < tokens.length ? tokens[idx + 1] : null;
}

function extractTokens(tokens: string[], key: string): string[] {
  const idx = tokens.indexOf(key);
  if (idx === -1) return [];
  // collect until next known UCI keyword
  const uciKeywords = new Set([
    "depth", "seldepth", "time", "nodes", "pv", "multipv",
    "score", "currmove", "currmovenumber", "hashfull", "nps",
    "tbhits", "sbhits", "cpuload", "string", "refutation", "currline",
  ]);
  const result: string[] = [];
  for (let i = idx + 1; i < tokens.length; i++) {
    if (uciKeywords.has(tokens[i])) break;
    result.push(tokens[i]);
  }
  return result;
}

/** Parse a UCI `info` line. Returns null if it's not a pv-bearing info line. */
export function parseInfoLine(line: string): EngineMove | null {
  if (!line.startsWith("info ")) return null;

  const tokens = line.split(" ");

  // Must have a pv to be useful
  const pvIdx = tokens.indexOf("pv");
  if (pvIdx === -1) return null;

  const depthStr = extractToken(tokens, "depth");
  const depth = depthStr ? parseInt(depthStr, 10) : 0;

  const multipvStr = extractToken(tokens, "multipv");
  const multipv = multipvStr ? parseInt(multipvStr, 10) : 1;

  // score: "score cp 30" or "score mate 3"
  const scoreIdx = tokens.indexOf("score");
  if (scoreIdx === -1) return null;
  const scoreType = tokens[scoreIdx + 1];
  const scoreValue = parseInt(tokens[scoreIdx + 2], 10);
  if (scoreType !== "cp" && scoreType !== "mate") return null;
  const score: EngineScore = { type: scoreType as "cp" | "mate", value: scoreValue };

  const pv = extractTokens(tokens, "pv");
  if (pv.length === 0) return null;

  return { uci: pv[0], score, depth, pv, multipv };
}

/** Parse a `bestmove` line. Returns the UCI move string or null. */
export function parseBestMove(line: string): string | null {
  if (!line.startsWith("bestmove ")) return null;
  const move = line.split(" ")[1];
  if (!move || move === "(none)") return null;
  return move;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Format a score for display (e.g. "+1.50", "M3", "M-2"). */
export function scoreToString(score: EngineScore): string {
  if (score.type === "mate") {
    return `M${score.value}`;
  }
  const pawns = score.value / 100;
  const sign = pawns > 0 ? "+" : pawns < 0 ? "" : "";
  return `${sign}${pawns.toFixed(2)}`;
}
