// Minimal ambient types for cm-chessboard, which ships untyped ESM source.
// Only the surface we use is declared; widen as later sub-steps need more.

declare module "cm-chessboard/src/Chessboard.js" {
  export const COLOR: { readonly white: "w"; readonly black: "b" };
  export const FEN: { readonly empty: string; readonly start: string };
  export const INPUT_EVENT_TYPE: Record<string, string>;

  export interface CmMoveInputEvent {
    type: string;
    squareFrom?: string;
    squareTo?: string;
    [k: string]: unknown;
  }

  export class Chessboard {
    constructor(context: HTMLElement, props?: Record<string, unknown>);
    setPosition(fen: string, animated?: boolean): Promise<void>;
    setOrientation(color: string, animated?: boolean): Promise<void>;
    getOrientation(): string;
    getPosition(): string;
    enableMoveInput(handler: (event: CmMoveInputEvent) => boolean | void, color?: string): void;
    disableMoveInput(): void;
    destroy(): void;
    // Added to the instance by extensions:
    addMarker(type: unknown, square: string): void;
    removeMarkers(type?: unknown, square?: string): void;
    addArrow(type: unknown, from: string, to: string): void;
    removeArrows(type?: unknown, from?: string, to?: string): void;
  }
}

declare module "cm-chessboard/src/extensions/markers/Markers.js" {
  export const MARKER_TYPE: Record<string, { class: string; slice: string }>;
  export class Markers {}
}

declare module "cm-chessboard/src/extensions/arrows/Arrows.js" {
  export const ARROW_TYPE: Record<string, { class: string }>;
  export class Arrows {}
}
