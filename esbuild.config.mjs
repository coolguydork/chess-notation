import esbuild from "esbuild";
import { readFileSync, copyFileSync, mkdirSync, writeFileSync } from "fs";

const prod = process.argv[2] === "production";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

mkdirSync("dist", { recursive: true });

// Stockfish engine — separate worker files, not bundled.
copyFileSync("node_modules/stockfish/bin/stockfish-18-lite-single.js", "dist/stockfish-18-lite-single.js");
copyFileSync("node_modules/stockfish/bin/stockfish-18-lite-single.wasm", "dist/stockfish-18-lite-single.wasm");

// cm-chessboard SVG sprites — loaded at runtime via assetsUrl (resolved to an
// Obsidian resource path in plugin/). Copy only the sprites, mirroring the
// package's assets/ layout so the default sprite paths resolve.
const CB = "node_modules/cm-chessboard/assets";
for (const sub of ["pieces", "extensions/markers", "extensions/arrows"]) {
  mkdirSync(`dist/cm-chessboard/${sub}`, { recursive: true });
}
for (const f of ["pieces/standard.svg", "pieces/staunty.svg", "extensions/markers/markers.svg", "extensions/arrows/arrows.svg"]) {
  copyFileSync(`${CB}/${f}`, `dist/cm-chessboard/${f}`);
}

// styles.css = our styles + cm-chessboard CSS + our per-instance theme overrides
// (cm-theme.css, concatenated last so it wins). Square, coordinate, last-move
// and arrow colors are themed per instance via the --cb-light / --cb-dark custom
// properties (set in view/cm-board.ts).
const css = [
  "src/plugin/styles.css",
  "node_modules/cm-chessboard/assets/chessboard.css",
  "node_modules/cm-chessboard/assets/extensions/markers/markers.css",
  "node_modules/cm-chessboard/assets/extensions/arrows/arrows.css",
  "node_modules/cm-chessboard/assets/extensions/promotion-dialog/promotion-dialog.css",
  "src/plugin/cm-theme.css",
].map((f) => readFileSync(f, "utf8"));
writeFileSync("dist/styles.css", css.join("\n"));

const ctx = await esbuild.context({
  entryPoints: ["src/plugin/main.ts"],
  bundle: true,
  external: ["obsidian"],   // Obsidian is provided at runtime; never bundle it
  format: "cjs",
  target: "es2020",   // chess.js uses BigInt literals (Zobrist hashing); es2020+
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  define: {
    PLUGIN_VERSION: JSON.stringify(version),
  },
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
