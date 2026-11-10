// Bundles the CLI into dist/sovereign.mjs: one readable file that needs only Node 22 or newer.
import { build } from "esbuild";

await build({
  entryPoints: ["src/entry.ts"],
  outfile: "dist/sovereign.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: false,
  charset: "ascii",
  legalComments: "inline",
  logLevel: "info",
  banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
});
