// Quick smoke-test: run Stockfish against a position and print top moves.
// Usage: node scripts/probe-engine.mjs [fen]

import { spawn } from "child_process";

// Inline the pure helpers (avoids needing to build the TS first)
const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BINARY = "/opt/homebrew/bin/stockfish";
const DEPTH = 18;
const MULTI_PV = 3;

const fen = process.argv[2] ?? STARTING_FEN;

// --- positionToUci ---
function positionToUci(fen, history = []) {
  const base = fen === STARTING_FEN ? "position startpos" : `position fen ${fen}`;
  return history.length > 0 ? `${base} moves ${history.join(" ")}` : base;
}

// --- parseInfoLine ---
function parseInfoLine(line) {
  if (!line.startsWith("info ")) return null;
  const tokens = line.split(" ");
  if (!tokens.includes("pv")) return null;

  const get = (key) => {
    const i = tokens.indexOf(key);
    return i !== -1 && i + 1 < tokens.length ? tokens[i + 1] : null;
  };
  const getArr = (key) => {
    const i = tokens.indexOf(key);
    if (i === -1) return [];
    const stop = new Set(["depth","seldepth","time","nodes","pv","multipv","score","currmove","currmovenumber","hashfull","nps","tbhits","string","refutation"]);
    const out = [];
    for (let j = i + 1; j < tokens.length; j++) { if (stop.has(tokens[j])) break; out.push(tokens[j]); }
    return out;
  };

  const depth = parseInt(get("depth") ?? "0", 10);
  const multipv = parseInt(get("multipv") ?? "1", 10);
  const scoreIdx = tokens.indexOf("score");
  if (scoreIdx === -1) return null;
  const scoreType = tokens[scoreIdx + 1];
  const scoreValue = parseInt(tokens[scoreIdx + 2], 10);
  if (scoreType !== "cp" && scoreType !== "mate") return null;
  const pv = getArr("pv");
  if (!pv.length) return null;
  return { uci: pv[0], score: { type: scoreType, value: scoreValue }, depth, pv, multipv };
}

function scoreToString(score) {
  if (score.type === "mate") return `M${score.value}`;
  const p = score.value / 100;
  return (p > 0 ? "+" : "") + p.toFixed(2);
}

// --- run ---
console.log(`Position : ${fen}`);
console.log(`Binary   : ${BINARY}`);
console.log(`Depth    : ${DEPTH}  MultiPV: ${MULTI_PV}\n`);

const proc = spawn(BINARY, [], { stdio: "pipe" });
const byMultiPV = new Map();
let buffer = "";
let resolved = false;
let readyOkSeen = false;

const send = (cmd) => { proc.stdin.write(cmd + "\n"); };

proc.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (!readyOkSeen && t === "readyok") {
      readyOkSeen = true;
      send(positionToUci(fen));
      send(`go depth ${DEPTH}`);
    }

    const info = parseInfoLine(t);
    if (info) byMultiPV.set(info.multipv, info);

    if (!resolved && t.startsWith("bestmove")) {
      resolved = true;
      const best = t.split(" ")[1];
      proc.kill();

      const moves = [...byMultiPV.entries()].sort(([a],[b]) => a - b).map(([,m]) => m);
      console.log(`bestmove : ${best}\n`);
      for (const m of moves) {
        const score = scoreToString(m.score);
        console.log(`  [${m.multipv}] ${score.padStart(6)}  depth ${m.depth}  pv ${m.pv.slice(0, 5).join(" ")}`);
      }
    }
  }
});

proc.on("error", (e) => { console.error("Engine error:", e.message); process.exit(1); });

send("uci");
send(`setoption name MultiPV value ${MULTI_PV}`);
send("isready");
