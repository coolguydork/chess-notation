import type {
  BoardState,
  Board,
  Square,
  Color,
  PieceType,
  CastlingRights,
  EnPassantSquare,
} from "./types";

const PIECE_CHARS = new Set(["p", "n", "b", "r", "q", "k"]);

function parsePiecePlacement(placement: string): Board {
  const ranks = placement.split("/");
  if (ranks.length !== 8) {
    throw new Error(`FEN: expected 8 ranks, got ${ranks.length}`);
  }

  const squares: Square[] = [];

  for (const rank of ranks) {
    let fileCount = 0;
    for (const ch of rank) {
      const empty = parseInt(ch, 10);
      if (!isNaN(empty)) {
        for (let i = 0; i < empty; i++) {
          squares.push(null);
          fileCount++;
        }
      } else {
        const lower = ch.toLowerCase() as PieceType;
        if (!PIECE_CHARS.has(lower)) {
          throw new Error(`FEN: invalid piece character '${ch}'`);
        }
        squares.push({ type: lower, color: ch === ch.toUpperCase() ? "w" : "b" });
        fileCount++;
      }
    }
    if (fileCount !== 8) {
      throw new Error(`FEN: rank '${rank}' has ${fileCount} files, expected 8`);
    }
  }

  return squares;
}

function parseActiveColor(field: string): Color {
  if (field === "w" || field === "b") return field;
  throw new Error(`FEN: invalid active color '${field}'`);
}

function parseCastling(field: string): CastlingRights {
  if (field !== "-" && !/^[KQkq]+$/.test(field)) {
    throw new Error(`FEN: invalid castling field '${field}'`);
  }
  return {
    whiteKingside: field.includes("K"),
    whiteQueenside: field.includes("Q"),
    blackKingside: field.includes("k"),
    blackQueenside: field.includes("q"),
  };
}

function parseEnPassant(field: string): EnPassantSquare | null {
  if (field === "-") return null;
  if (!/^[a-h][36]$/.test(field)) {
    throw new Error(`FEN: invalid en passant square '${field}'`);
  }
  return {
    file: field.charCodeAt(0) - "a".charCodeAt(0),
    rank: parseInt(field[1], 10) - 1,
  };
}

export function parseFEN(fen: string): BoardState {
  if (!fen) throw new Error("FEN: string is empty");

  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) {
    throw new Error(`FEN: expected 6 fields, got ${fields.length}`);
  }

  const [placement, activeColor, castling, enPassant, halfmove, fullmove] = fields;

  const halfmoveClock = parseInt(halfmove, 10);
  const fullmoveNumber = parseInt(fullmove, 10);

  if (isNaN(halfmoveClock)) throw new Error(`FEN: invalid halfmove clock '${halfmove}'`);
  if (isNaN(fullmoveNumber)) throw new Error(`FEN: invalid fullmove number '${fullmove}'`);

  return {
    board: parsePiecePlacement(placement),
    activeColor: parseActiveColor(activeColor),
    castling: parseCastling(castling),
    enPassant: parseEnPassant(enPassant),
    halfmoveClock,
    fullmoveNumber,
  };
}

export function serializeFEN(state: BoardState): string {
  // Piece placement
  const ranks: string[] = [];
  for (let rankRow = 0; rankRow < 8; rankRow++) {
    let rank = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = state.board[rankRow * 8 + file];
      if (!piece) {
        empty++;
      } else {
        if (empty > 0) { rank += empty; empty = 0; }
        const ch = piece.type === "k" || piece.type === "q" || piece.type === "r" ||
                   piece.type === "b" || piece.type === "n" || piece.type === "p"
          ? piece.type
          : piece.type;
        rank += piece.color === "w" ? ch.toUpperCase() : ch;
      }
    }
    if (empty > 0) rank += empty;
    ranks.push(rank);
  }

  const castling = [
    state.castling.whiteKingside  ? "K" : "",
    state.castling.whiteQueenside ? "Q" : "",
    state.castling.blackKingside  ? "k" : "",
    state.castling.blackQueenside ? "q" : "",
  ].join("") || "-";

  const ep = state.enPassant
    ? String.fromCharCode(97 + state.enPassant.file) + String(state.enPassant.rank + 1)
    : "-";

  return [
    ranks.join("/"),
    state.activeColor,
    castling,
    ep,
    state.halfmoveClock,
    state.fullmoveNumber,
  ].join(" ");
}

/** Convert an algebraic square string ("e2") to a board index (0–63, a8=0). */
export function uciSquareToIndex(sq: string): number {
  const file = sq.charCodeAt(0) - 97; // 'a'=0
  const rank = parseInt(sq[1], 10) - 1; // '1'=0
  return (7 - rank) * 8 + file;
}
