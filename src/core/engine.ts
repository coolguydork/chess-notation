import type { BoardState } from "./types";
import { serializeFEN } from "./fen";
import { getLegalMoves } from "./legal";
import { applyMoveEx } from "./moves";

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

/** One move in a decoded principal variation — SAN + board context needed to graft into a MoveNode tree. */
export interface PvMove {
  san: string;
  from: number;
  to: number;
  state: BoardState; // board state AFTER this move
}

/**
 * Convert a UCI principal variation (e.g. ["e2e4","e7e5"]) to SAN + state pairs,
 * starting from `startState`. Stops early if any move is illegal.
 */
function uciSquare(sq: string): number {
  const file = sq.charCodeAt(0) - 97; // 'a'=0
  const rank = parseInt(sq[1], 10) - 1; // '1'=0
  return (7 - rank) * 8 + file;
}

export function uciPvToSan(startState: BoardState, uciMoves: string[]): PvMove[] {
  const result: PvMove[] = [];
  let state = startState;
  for (const uci of uciMoves) {
    const fromIdx = uciSquare(uci.slice(0, 2));
    const toIdx   = uciSquare(uci.slice(2, 4));
    const promo   = uci.length > 4 ? uci[4] : undefined;
    const legal   = getLegalMoves(state);
    const match   = legal.find(m => m.from === fromIdx && m.to === toIdx && (promo ? m.promotion === promo : true));
    if (!match) break;
    const mr = applyMoveEx(state, match.san);
    result.push({ san: match.san, from: fromIdx, to: toIdx, state: mr.state });
    state = mr.state;
  }
  return result;
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
// UCI option types
// ---------------------------------------------------------------------------

export interface UciOptionCheck  { name: string; type: "check";  default: boolean }
export interface UciOptionSpin   { name: string; type: "spin";   default: number; min: number; max: number }
export interface UciOptionCombo  { name: string; type: "combo";  default: string; vars: string[] }
export interface UciOptionButton { name: string; type: "button" }
export interface UciOptionString { name: string; type: "string"; default: string }

export type UciOptionDef =
  | UciOptionCheck
  | UciOptionSpin
  | UciOptionCombo
  | UciOptionButton
  | UciOptionString;

/**
 * Parse a UCI `option` line into a typed descriptor.
 * Returns null for unrecognised types or malformed lines.
 */
export function parseOptionLine(line: string): UciOptionDef | null {
  if (!line.startsWith("option name ")) return null;
  const after = line.slice("option name ".length);

  const typeMarker = " type ";
  const typeIdx = after.indexOf(typeMarker);
  if (typeIdx === -1) return null;

  const name = after.slice(0, typeIdx).trim();
  const typeAndRest = after.slice(typeIdx + typeMarker.length);
  const spaceIdx = typeAndRest.indexOf(" ");
  const type = spaceIdx === -1 ? typeAndRest : typeAndRest.slice(0, spaceIdx);
  const attrs = spaceIdx === -1 ? "" : typeAndRest.slice(spaceIdx + 1);

  switch (type) {
    case "check": {
      const m = attrs.match(/\bdefault\s+(\S+)/);
      return { name, type: "check", default: m?.[1] === "true" };
    }
    case "spin": {
      const def = attrs.match(/\bdefault\s+(-?\d+)/);
      const min = attrs.match(/\bmin\s+(-?\d+)/);
      const max = attrs.match(/\bmax\s+(-?\d+)/);
      if (!def || !min || !max) return null;
      return { name, type: "spin",
        default: parseInt(def[1], 10),
        min: parseInt(min[1], 10),
        max: parseInt(max[1], 10) };
    }
    case "combo": {
      const defMatch = attrs.match(/\bdefault\s+(\S+)/);
      const def = defMatch?.[1] ?? "";
      const vars = [...attrs.matchAll(/\bvar\s+(\S+)/g)].map((m) => m[1]);
      return { name, type: "combo", default: def, vars };
    }
    case "button":
      return { name, type: "button" };
    case "string": {
      const m = attrs.match(/\bdefault\s+(.*)/);
      const raw = m ? m[1].trim() : "";
      return { name, type: "string", default: raw === "<empty>" ? "" : raw };
    }
    default:
      return null;
  }
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
