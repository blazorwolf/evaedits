// Copies the ffmpeg.wasm core builds into public/ so the app serves them
// same-origin (required under COEP, and avoids depending on a CDN).
import { cpSync, mkdirSync } from "node:fs";

for (const [pkg, dir] of [["core", "st"], ["core-mt", "mt"]]) {
  const dest = `public/ffmpeg/${dir}`;
  mkdirSync(dest, { recursive: true });
  cpSync(`node_modules/@ffmpeg/${pkg}/dist/esm`, dest, { recursive: true });
}
// Serve ffmpeg's worker unbundled too. Bundlers rewrite its dynamic
// import() of the core, which breaks loading it.
mkdirSync("public/ffmpeg/worker", { recursive: true });
for (const f of ["worker.js", "const.js", "errors.js"]) {
  cpSync(`node_modules/@ffmpeg/ffmpeg/dist/esm/${f}`, `public/ffmpeg/worker/${f}`);
}
console.log("Copied ffmpeg cores to public/ffmpeg");
