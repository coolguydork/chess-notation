import esbuild from "esbuild";
import { readFileSync, copyFileSync, mkdirSync } from "fs";

const prod = process.argv[2] === "production";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

mkdirSync("dist", { recursive: true });
copyFileSync("src/plugin/styles.css", "dist/styles.css");
copyFileSync("node_modules/stockfish/bin/stockfish-18-lite-single.js", "dist/stockfish-18-lite-single.js");
copyFileSync("node_modules/stockfish/bin/stockfish-18-lite-single.wasm", "dist/stockfish-18-lite-single.wasm");

const ctx = await esbuild.context({
  entryPoints: ["src/plugin/main.ts"],
  bundle: true,
  external: ["obsidian"],   // Obsidian is provided at runtime; never bundle it
  format: "cjs",
  target: "es2018",
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
