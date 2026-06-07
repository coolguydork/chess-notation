import type {
  BoardState,
  Board,
  Square,
  Piece,
  PieceType,
  CastlingRights,
  EnPassantSquare,
} from "./types";

// ---------------------------------------------------------------------------
// Square index helpers
// index 0 = a8, index 63 = h1 (matches FEN rank order)
// file: 0–7 (a–h), rank: 0–7 (rank1–rank8)
// ---------------------------------------------------------------------------

function squareIndex(file: number, rank: number): number {
  return (7 - rank) * 8 + file;
}

function squareCoords(idx: number): { file: number; rank: number } {
  return { file: idx % 8, rank: 7 - Math.floor(idx / 8) };
}

// ---------------------------------------------------------------------------
// SAN parser
// ---------------------------------------------------------------------------

interface ParsedSan {
  pieceType: PieceType;
  toFile: number;
  toRank: number;
  fromFile?: number;
  fromRank?: number;
  capture: boolean;
  promotion?: PieceType;
  castling?: "kingside" | "queenside";
}

function parseSan(san: string): ParsedSan {
  // Strip check / checkmate / annotation suffixes
  let s = san.replace(/[+#!?]+$/, "");

  if (s === "O-O-O") {
    return { pieceType: "k", toFile: 0, toRank: 0, capture: false, castling: "queenside" };
  }
  if (s === "O-O") {
    return { pieceType: "k", toFile: 0, toRank: 0, capture: false, castling: "kingside" };
  }

  // Promotion suffix (=Q / =N / =R / =B)
  let promotion: PieceType | undefined;
  const promoMatch = s.match(/=([NBRQ])$/);
  if (promoMatch) {
    promotion = promoMatch[1].toLowerCase() as PieceType;
    s = s.slice(0, -2);
  }

  // Last two characters are the destination square
  const toFile = s.charCodeAt(s.length - 2) - 97;
  const toRank = parseInt(s[s.length - 1], 10) - 1;
  s = s.slice(0, -2);

  // Strip capture marker
  let capture = false;
  if (s.endsWith("x")) {
    capture = true;
    s = s.slice(0, -1);
  }

  // What remains: optional piece letter + optional disambiguation
  let pieceType: PieceType = "p";
  let fromFile: number | undefined;
  let fromRank: number | undefined;

  if (s.length === 0) {
    // Pawn, no disambiguation
  } else if (/^[NBRQK]/.test(s)) {
    pieceType = s[0].toLowerCase() as PieceType;
    const dis = s.slice(1);
    if (dis.length === 2) {
      fromFile = dis.charCodeAt(0) - 97;
      fromRank = parseInt(dis[1], 10) - 1;
    } else if (dis.length === 1) {
      if (/[a-h]/.test(dis)) {
        fromFile = dis.charCodeAt(0) - 97;
      } else {
        fromRank = parseInt(dis, 10) - 1;
      }
    }
  } else {
    // Pawn with file prefix (capture like exd5)
    fromFile = s.charCodeAt(0) - 97;
  }

  return { pieceType, toFile, toRank, fromFile, fromRank, capture, promotion };
}

// ---------------------------------------------------------------------------
// Movement rules (pseudo-legal — does not check for leaving king in check)
// ---------------------------------------------------------------------------

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

function canPieceReach(
  board: Board,
  from: number,
  to: number,
  piece: Piece,
  isCapture: boolean,
  epSquare: EnPassantSquare | null
): boolean {
  const { file: f1, rank: r1 } = squareCoords(from);
  const { file: f2, rank: r2 } = squareCoords(to);
  const df = f2 - f1;
  const dr = r2 - r1;
  const adf = Math.abs(df);
  const adr = Math.abs(dr);

  switch (piece.type) {
    case "p": {
      const dir = piece.color === "w" ? 1 : -1;
      const startRank = piece.color === "w" ? 1 : 6;
      const isEp = epSquare !== null && squareIndex(epSquare.file, epSquare.rank) === to;
      if (isCapture || isEp) {
        return dr === dir && adf === 1;
      }
      if (df !== 0) return false;
      if (dr === dir && board[to] === null) return true;
      if (
        dr === 2 * dir &&
        r1 === startRank &&
        board[to] === null &&
        board[squareIndex(f1, r1 + dir)] === null
      ) return true;
      return false;
    }
    case "n":
      return (adf === 2 && adr === 1) || (adf === 1 && adr === 2);
    case "b":
      return adf === adr && adf > 0 && isPathClear(board, from, to);
    case "r":
      return (df === 0 || dr === 0) && (df !== 0 || dr !== 0) && isPathClear(board, from, to);
    case "q":
      return (
        ((adf === adr && adf > 0) || ((df === 0 || dr === 0) && (df !== 0 || dr !== 0))) &&
        isPathClear(board, from, to)
      );
    case "k":
      return adf <= 1 && adr <= 1 && adf + adr > 0;
  }
}

function findSource(state: BoardState, parsed: ParsedSan): number {
  const { board, activeColor, enPassant } = state;
  const to = squareIndex(parsed.toFile, parsed.toRank);
  const candidates: number[] = [];

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece || piece.color !== activeColor || piece.type !== parsed.pieceType) continue;
    const { file, rank } = squareCoords(i);
    if (parsed.fromFile !== undefined && file !== parsed.fromFile) continue;
    if (parsed.fromRank !== undefined && rank !== parsed.fromRank) continue;
    if (canPieceReach(board, i, to, piece, parsed.capture, enPassant)) {
      candidates.push(i);
    }
  }

  if (candidates.length === 0) {
    throw new Error(`applyMove: no ${activeColor} ${parsed.pieceType} can reach the target square`);
  }
  if (candidates.length > 1) {
    throw new Error(`applyMove: ambiguous move — ${candidates.length} candidates found`);
  }
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Castling rights table: corner square index → rights key
// ---------------------------------------------------------------------------

const CASTLING_SQUARE_RIGHTS: Record<number, keyof CastlingRights> = {
  [squareIndex(7, 0)]: "whiteKingside",
  [squareIndex(0, 0)]: "whiteQueenside",
  [squareIndex(7, 7)]: "blackKingside",
  [squareIndex(0, 7)]: "blackQueenside",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function applyMove(state: BoardState, san: string): BoardState {
  // Null move (-- or Z0): pass the turn without moving a piece.
  if (san === "--" || san === "Z0") {
    return {
      ...state,
      activeColor: state.activeColor === "w" ? "b" : "w",
      enPassant: null,
      halfmoveClock: state.halfmoveClock + 1,
      fullmoveNumber: state.fullmoveNumber + (state.activeColor === "b" ? 1 : 0),
    };
  }

  const parsed = parseSan(san);
  const { board, activeColor } = state;

  const newBoard = [...board] as Square[];
  let newCastling: CastlingRights = { ...state.castling };
  let newEnPassant: EnPassantSquare | null = null;
  let newHalfmoveClock = state.halfmoveClock + 1;
  let newFullmoveNumber = state.fullmoveNumber + (activeColor === "b" ? 1 : 0);

  if (parsed.castling) {
    const rank = activeColor === "w" ? 0 : 7;
    const kingFrom = squareIndex(4, rank);
    const [kingToFile, rookFromFile, rookToFile] =
      parsed.castling === "kingside" ? [6, 7, 5] : [2, 0, 3];
    const rookFrom = squareIndex(rookFromFile, rank);
    const kingTo = squareIndex(kingToFile, rank);
    const rookTo = squareIndex(rookToFile, rank);

    newBoard[kingTo] = newBoard[kingFrom];
    newBoard[rookTo] = newBoard[rookFrom];
    newBoard[kingFrom] = null;
    newBoard[rookFrom] = null;

    if (activeColor === "w") {
      newCastling = { ...newCastling, whiteKingside: false, whiteQueenside: false };
    } else {
      newCastling = { ...newCastling, blackKingside: false, blackQueenside: false };
    }
  } else {
    const to = squareIndex(parsed.toFile, parsed.toRank);
    const from = findSource(state, parsed);
    const piece = board[from]!;

    // Halfmove clock resets on pawn move or capture
    if (piece.type === "p" || board[to] !== null) {
      newHalfmoveClock = 0;
    }

    // En passant capture: remove the captured pawn from its actual square
    if (piece.type === "p" && state.enPassant !== null) {
      const epIdx = squareIndex(state.enPassant.file, state.enPassant.rank);
      if (to === epIdx) {
        const capturedRank = activeColor === "w" ? state.enPassant.rank - 1 : state.enPassant.rank + 1;
        newBoard[squareIndex(state.enPassant.file, capturedRank)] = null;
        newHalfmoveClock = 0;
      }
    }

    // Double pawn push: set en passant target square
    if (piece.type === "p") {
      const { rank: fromRank } = squareCoords(from);
      if (Math.abs(parsed.toRank - fromRank) === 2) {
        newEnPassant = {
          file: parsed.toFile,
          rank: (fromRank + parsed.toRank) / 2,
        };
      }
    }

    // Place piece (with promotion if applicable)
    newBoard[from] = null;
    newBoard[to] = parsed.promotion
      ? { type: parsed.promotion, color: activeColor }
      : piece;

    // Update castling rights for king moves
    if (piece.type === "k") {
      if (activeColor === "w") {
        newCastling = { ...newCastling, whiteKingside: false, whiteQueenside: false };
      } else {
        newCastling = { ...newCastling, blackKingside: false, blackQueenside: false };
      }
    }

    // Update castling rights when a rook leaves or is captured on its corner square
    const rightFrom = CASTLING_SQUARE_RIGHTS[from];
    const rightTo = CASTLING_SQUARE_RIGHTS[to];
    if (rightFrom) newCastling = { ...newCastling, [rightFrom]: false };
    if (rightTo) newCastling = { ...newCastling, [rightTo]: false };
  }

  return {
    board: newBoard,
    activeColor: activeColor === "w" ? "b" : "w",
    castling: newCastling,
    enPassant: newEnPassant,
    halfmoveClock: newHalfmoveClock,
    fullmoveNumber: newFullmoveNumber,
  };
}
