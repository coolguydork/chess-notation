import type { BoardState, Board, Square, Piece, Color, PieceType, CastlingRights } from "./types";
import { applyMove } from "./moves";

// ---------------------------------------------------------------------------
// Square helpers (duplicated from moves.ts to keep layers independent)
// ---------------------------------------------------------------------------

function squareIndex(file: number, rank: number): number {
  return (7 - rank) * 8 + file;
}

function squareCoords(idx: number): { file: number; rank: number } {
  return { file: idx % 8, rank: 7 - Math.floor(idx / 8) };
}

function indexToAlgebraic(idx: number): string {
  const { file, rank } = squareCoords(idx);
  return String.fromCharCode(97 + file) + String(rank + 1);
}

// ---------------------------------------------------------------------------
// Attack detection
// ---------------------------------------------------------------------------

function isAttackedBy(board: Board, targetIdx: number, attacker: Color): boolean {
  const { file: tf, rank: tr } = squareCoords(targetIdx);

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece || piece.color !== attacker) continue;

    const { file: f, rank: r } = squareCoords(i);
    const df = tf - f;
    const dr = tr - r;
    const adf = Math.abs(df);
    const adr = Math.abs(dr);

    switch (piece.type) {
      case "p": {
        const dir = attacker === "w" ? 1 : -1;
        if (dr === dir && adf === 1) return true;
        break;
      }
      case "n":
        if ((adf === 2 && adr === 1) || (adf === 1 && adr === 2)) return true;
        break;
      case "b":
        if (adf === adr && adf > 0 && isPathClear(board, i, targetIdx)) return true;
        break;
      case "r":
        if ((df === 0 || dr === 0) && (df !== 0 || dr !== 0) && isPathClear(board, i, targetIdx)) return true;
        break;
      case "q":
        if (
          ((adf === adr && adf > 0) || ((df === 0 || dr === 0) && (df !== 0 || dr !== 0))) &&
          isPathClear(board, i, targetIdx)
        ) return true;
        break;
      case "k":
        if (adf <= 1 && adr <= 1 && adf + adr > 0) return true;
        break;
    }
  }
  return false;
}

function isPathClear(board: Board, from: number, to: number): boolean {
  const { file: f1, rank: r1 } = squareCoords(from);
  const { file: f2, rank: r2 } = squareCoords(to);
  const df = Math.sign(f2 - f1);
  const dr = Math.sign(r2 - r1);
  let f = f1 + df;
  let r = r1 + dr;
  while (f !== f2 || r !== r2) {
    if (board[squareIndex(f, r)] !== null) return false;
    f += df;
    r += dr;
  }
  return true;
}

function findKing(board: Board, color: Color): number {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.type === "k" && p.color === color) return i;
  }
  throw new Error(`No ${color} king found on board`);
}

export function isInCheck(state: BoardState, color: Color): boolean {
  const kingIdx = findKing(state.board, color);
  const enemy: Color = color === "w" ? "b" : "w";
  return isAttackedBy(state.board, kingIdx, enemy);
}

// ---------------------------------------------------------------------------
// SAN generation
// ---------------------------------------------------------------------------

export interface LegalMove {
  from: number;
  to: number;
  san: string;
  promotion?: PieceType;
}

const PIECE_LETTER: Record<PieceType, string> = {
  p: "", n: "N", b: "B", r: "R", q: "Q", k: "K",
};

function buildSan(
  board: Board,
  from: number,
  to: number,
  piece: Piece,
  isCapture: boolean,
  promotion: PieceType | undefined,
  allFromSquares: number[], // other squares with the same piece type that can reach `to`
  afterState: BoardState
): string {
  const toAlg = indexToAlgebraic(to);
  const { file: fromFile, rank: fromRank } = squareCoords(from);

  // Castling
  if (piece.type === "k") {
    const { file: toFile } = squareCoords(to);
    const df = toFile - fromFile;
    if (df === 2) return "O-O";
    if (df === -2) return "O-O-O";
  }

  if (piece.type === "p") {
    const promoSuffix = promotion ? `=${promotion.toUpperCase()}` : "";
    if (isCapture) {
      const fileChar = String.fromCharCode(97 + fromFile);
      return `${fileChar}x${toAlg}${promoSuffix}`;
    }
    return `${toAlg}${promoSuffix}`;
  }

  const letter = PIECE_LETTER[piece.type];
  const capStr = isCapture ? "x" : "";

  // Disambiguation: find other pieces of the same type that can also reach `to`
  const ambiguous = allFromSquares.filter(s => s !== from);
  let dis = "";
  if (ambiguous.length > 0) {
    const sameFile = ambiguous.some(s => squareCoords(s).file === fromFile);
    const sameRank = ambiguous.some(s => squareCoords(s).rank === fromRank);
    if (!sameFile) {
      dis = String.fromCharCode(97 + fromFile);
    } else if (!sameRank) {
      dis = String(fromRank + 1);
    } else {
      dis = String.fromCharCode(97 + fromFile) + String(fromRank + 1);
    }
  }

  // Check / checkmate suffix
  const enemy: Color = piece.color === "w" ? "b" : "w";
  const enemyInCheck = isInCheck(afterState, enemy);
  const suffix = enemyInCheck
    ? getLegalMoves(afterState).length === 0 ? "#" : "+"
    : "";

  return `${letter}${dis}${capStr}${toAlg}${suffix}`;
}

// ---------------------------------------------------------------------------
// Pseudo-legal move generation
// ---------------------------------------------------------------------------

interface PseudoMove {
  from: number;
  to: number;
  promotion?: PieceType;
}

function pseudoMovesForPiece(
  board: Board,
  fromIdx: number,
  piece: Piece,
  castling: CastlingRights,
  enPassantIdx: number | null
): PseudoMove[] {
  const moves: PseudoMove[] = [];
  const { file: f, rank: r } = squareCoords(fromIdx);
  const color = piece.color;
  const enemy: Color = color === "w" ? "b" : "w";

  const push = (toFile: number, toRank: number, promotion?: PieceType) => {
    if (toFile < 0 || toFile > 7 || toRank < 0 || toRank > 7) return;
    const toIdx = squareIndex(toFile, toRank);
    const target = board[toIdx];
    if (target && target.color === color) return; // can't capture own piece
    moves.push({ from: fromIdx, to: toIdx, promotion });
  };

  const pushSliding = (dFile: number, dRank: number) => {
    let cf = f + dFile;
    let cr = r + dRank;
    while (cf >= 0 && cf <= 7 && cr >= 0 && cr <= 7) {
      const toIdx = squareIndex(cf, cr);
      const target = board[toIdx];
      if (target) {
        if (target.color === enemy) moves.push({ from: fromIdx, to: toIdx });
        break;
      }
      moves.push({ from: fromIdx, to: toIdx });
      cf += dFile;
      cr += dRank;
    }
  };

  switch (piece.type) {
    case "p": {
      const dir = color === "w" ? 1 : -1;
      const startRank = color === "w" ? 1 : 6;
      const promoRank = color === "w" ? 7 : 0;
      const promos: PieceType[] = ["q", "r", "b", "n"];

      // Forward one
      const oneAhead = squareIndex(f, r + dir);
      if (board[oneAhead] === null) {
        if (r + dir === promoRank) {
          for (const p of promos) moves.push({ from: fromIdx, to: oneAhead, promotion: p });
        } else {
          moves.push({ from: fromIdx, to: oneAhead });
          // Forward two from start rank
          if (r === startRank) {
            const twoAhead = squareIndex(f, r + 2 * dir);
            if (board[twoAhead] === null) moves.push({ from: fromIdx, to: twoAhead });
          }
        }
      }

      // Diagonal captures
      for (const df of [-1, 1]) {
        const cf = f + df;
        const cr = r + dir;
        if (cf < 0 || cf > 7 || cr < 0 || cr > 7) continue;
        const toIdx = squareIndex(cf, cr);
        const target = board[toIdx];
        if (target && target.color === enemy) {
          if (cr === promoRank) {
            for (const p of promos) moves.push({ from: fromIdx, to: toIdx, promotion: p });
          } else {
            moves.push({ from: fromIdx, to: toIdx });
          }
        } else if (toIdx === enPassantIdx) {
          moves.push({ from: fromIdx, to: toIdx });
        }
      }
      break;
    }

    case "n":
      for (const [df, dr] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        push(f + df, r + dr);
      }
      break;

    case "b":
      for (const [df, dr] of [[-1,-1],[-1,1],[1,-1],[1,1]]) pushSliding(df, dr);
      break;

    case "r":
      for (const [df, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) pushSliding(df, dr);
      break;

    case "q":
      for (const [df, dr] of [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]) pushSliding(df, dr);
      break;

    case "k": {
      for (const [df, dr] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
        push(f + df, r + dr);
      }
      // Castling
      const backRank = color === "w" ? 0 : 7;
      if (r === backRank && f === 4) {
        const ks = color === "w" ? castling.whiteKingside  : castling.blackKingside;
        const qs = color === "w" ? castling.whiteQueenside : castling.blackQueenside;
        if (ks && board[squareIndex(5, backRank)] === null && board[squareIndex(6, backRank)] === null) {
          moves.push({ from: fromIdx, to: squareIndex(6, backRank) });
        }
        if (qs && board[squareIndex(3, backRank)] === null && board[squareIndex(2, backRank)] === null && board[squareIndex(1, backRank)] === null) {
          moves.push({ from: fromIdx, to: squareIndex(2, backRank) });
        }
      }
      break;
    }
  }

  return moves;
}

// ---------------------------------------------------------------------------
// Legal move generation (filters pseudo-legal for check, castling safety)
// ---------------------------------------------------------------------------

export function getLegalMoves(state: BoardState): LegalMove[] {
  const { board, activeColor, castling, enPassant } = state;
  const epIdx = enPassant ? squareIndex(enPassant.file, enPassant.rank) : null;
  const enemy: Color = activeColor === "w" ? "b" : "w";

  // Collect all pseudo-legal moves
  const pseudoAll: PseudoMove[] = [];
  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece || piece.color !== activeColor) continue;
    pseudoAll.push(...pseudoMovesForPiece(board, i, piece, castling, epIdx));
  }

  // For SAN disambiguation, pre-compute for each destination which from-squares
  // have pseudo-legal moves there (per piece type).
  // We'll compute this per-move during buildSan via the legal set.

  const legal: LegalMove[] = [];

  for (const pm of pseudoAll) {
    const piece = board[pm.from]!;

    // For castling moves: king must not be in check, and must not pass through an attacked square
    if (piece.type === "k") {
      const { file: toFile } = squareCoords(pm.to);
      const { file: kFile, rank: kRank } = squareCoords(pm.from);
      const df = toFile - kFile;
      if (Math.abs(df) === 2) {
        // It's a castling move
        if (isInCheck(state, activeColor)) continue; // can't castle in check
        const step = Math.sign(df);
        const passThroughIdx = squareIndex(kFile + step, kRank);
        if (isAttackedBy(board, passThroughIdx, enemy)) continue; // can't pass through check
        if (isAttackedBy(board, pm.to, enemy)) continue; // can't castle into check
      }
    }

    // Apply move and verify king not in check
    const san = toSanForCheck(pm, board, piece, state, pseudoAll);
    let afterState: BoardState;
    try {
      afterState = applyMove(state, san);
    } catch {
      continue; // move application failed (shouldn't happen for pseudo-legal moves)
    }

    if (isInCheck(afterState, activeColor)) continue; // leaves king in check

    // Build the proper SAN with check/mate suffix now that we know afterState
    const allFromForTo = pseudoAll
      .filter(m => m.to === pm.to && board[m.from]?.type === piece.type && m.from !== pm.from)
      .map(m => m.from)
      .concat([pm.from]);

    const isCapture = board[pm.to] !== null || (piece.type === "p" && pm.to === epIdx);
    const finalSan = buildSan(board, pm.from, pm.to, piece, isCapture, pm.promotion, allFromForTo, afterState);

    legal.push({ from: pm.from, to: pm.to, san: finalSan, promotion: pm.promotion });
  }

  return legal;
}

// Build a temporary SAN without check suffix (used only to call applyMove for legality testing)
function toSanForCheck(pm: PseudoMove, board: Board, piece: Piece, state: BoardState, pseudoAll: PseudoMove[]): string {
  const { file: toFile, rank: toRank } = squareCoords(pm.to);
  const toAlg = indexToAlgebraic(pm.to);
  const { file: fromFile, rank: fromRank } = squareCoords(pm.from);
  const epIdx = state.enPassant ? squareIndex(state.enPassant.file, state.enPassant.rank) : null;
  const isCapture = board[pm.to] !== null || (piece.type === "p" && pm.to === epIdx);

  if (piece.type === "k") {
    const df = toFile - fromFile;
    if (df === 2) return "O-O";
    if (df === -2) return "O-O-O";
  }

  if (piece.type === "p") {
    const promoSuffix = pm.promotion ? `=${pm.promotion.toUpperCase()}` : "";
    if (isCapture) return `${String.fromCharCode(97 + fromFile)}x${toAlg}${promoSuffix}`;
    return `${toAlg}${promoSuffix}`;
  }

  const letter = PIECE_LETTER[piece.type];
  const capStr = isCapture ? "x" : "";

  // Minimal disambiguation for applyMove
  const sameTypeCanReach = pseudoAll.filter(m =>
    m.from !== pm.from &&
    m.to === pm.to &&
    board[m.from]?.type === piece.type &&
    board[m.from]?.color === piece.color
  );

  let dis = "";
  if (sameTypeCanReach.length > 0) {
    const sameFile = sameTypeCanReach.some(m => squareCoords(m.from).file === fromFile);
    const sameRank = sameTypeCanReach.some(m => squareCoords(m.from).rank === fromRank);
    if (!sameFile) {
      dis = String.fromCharCode(97 + fromFile);
    } else if (!sameRank) {
      dis = String(fromRank + 1);
    } else {
      dis = String.fromCharCode(97 + fromFile) + String(fromRank + 1);
    }
  }

  return `${letter}${dis}${capStr}${toAlg}`;
}

export function getSquareLegalMoves(state: BoardState, squareIdx: number): LegalMove[] {
  const piece = state.board[squareIdx];
  if (!piece || piece.color !== state.activeColor) return [];
  return getLegalMoves(state).filter(m => m.from === squareIdx);
}
