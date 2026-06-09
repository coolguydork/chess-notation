export const Platform = {
  isMobile: false,
  isDesktop: true,
  isIosApp: false,
  isAndroidApp: false,
};

// Minimal class stubs so modules that subclass Obsidian types can be imported
// in tests. Methods are only added when a test actually exercises them.
export class App {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
export class MarkdownRenderChild {}
export class MarkdownView {}
export class Menu {}
export class Notice {}
export class TFile {}
export class Editor {}
export type MarkdownPostProcessorContext = unknown;
