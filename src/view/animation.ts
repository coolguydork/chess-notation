import type { BoardConfig } from "../render/config";

export function animatePieceOverlay(
  wrapper: HTMLElement,
  move: { from: number; to: number },
  config: BoardConfig,
  pieceUrl: string,
  onDone?: () => void,
): () => void {
  const { squareSize, orientation } = config;
  const boardSize = squareSize * 8;

  function toPercent(idx: number): { left: string; top: string } {
    const rank = 7 - Math.floor(idx / 8);
    const file = idx % 8;
    const col = orientation === "white" ? file : 7 - file;
    const row = orientation === "white" ? 7 - rank : rank;
    return {
      left: `${(col / 8) * 100}%`,
      top:  `${(row / 8) * 100}%`,
    };
  }

  const size = `${(squareSize / boardSize) * 100}%`;
  const from = toPercent(move.from);
  const to   = toPercent(move.to);

  const img = document.createElement("img");
  img.src = pieceUrl;
  img.className = "chess-piece-anim";
  img.style.width  = size;
  img.style.height = size;
  img.style.left   = from.left;
  img.style.top    = from.top;

  wrapper.appendChild(img);

  // Force layout so the starting position is painted before we apply the transition target.
  img.getBoundingClientRect();

  img.style.left = to.left;
  img.style.top  = to.top;

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    img.remove();
    onDone?.();
  }

  img.addEventListener("transitionend", finish, { once: true });
  const timer = setTimeout(finish, 400);

  return function cancel() {
    clearTimeout(timer);
    finished = true;
    img.remove();
  };
}
