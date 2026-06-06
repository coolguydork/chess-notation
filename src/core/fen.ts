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
