/**
 * Copy the ffmpeg.wasm core (JS + WASM) from node_modules into public/ffmpeg/
 * so the app can transcode audio to real Ogg Vorbis offline.
 *
 * Runs from postinstall — the 32 MB wasm binary stays out of git.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const coreDir = path.join(root, "node_modules", "@ffmpeg", "core", "dist", "esm");
const outDir = path.join(root, "public", "ffmpeg");

const files = ["ffmpeg-core.js", "ffmpeg-core.wasm"];

if (!fs.existsSync(coreDir)) {
  // @ffmpeg/core is optional at runtime (transcode only) — don't fail install.
  console.warn("[ffmpeg-core] @ffmpeg/core not installed — skipping copy.");
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
for (const file of files) {
  const src = path.join(coreDir, file);
  const dst = path.join(outDir, file);
  if (!fs.existsSync(src)) {
    console.warn(`[ffmpeg-core] missing ${file} — skipping.`);
    continue;
  }
  fs.copyFileSync(src, dst);
  console.log(`[ffmpeg-core] ${file} -> public/ffmpeg/${file}`);
}
