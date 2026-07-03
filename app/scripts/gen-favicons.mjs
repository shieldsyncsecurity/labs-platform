// Throwaway script: rasterize favicon PNGs from the recolored shieldsync-favicon.svg.
// Run once, then delete (or leave — harmless). Mirrors the marketing site's rollout.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharpPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  "sharp"
);
const sharp = require(sharpPath);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(root, "public", "logo", "shieldsync-favicon.svg");
const svg = readFileSync(svgPath);

const sizes = [16, 32, 48, 64, 192, 512];

const run = async () => {
  for (const size of sizes) {
    const out = path.join(root, "public", `favicon-${size}.png`);
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out);
    console.log("wrote", out);
  }

  // apple-touch-icon (public/, for the <link rel="apple-touch-icon"> shortcut) + 180 for app/apple-icon.png
  const appleBuf = await sharp(svg, { density: 384 }).resize(180, 180).png().toBuffer();
  writeFileSync(path.join(root, "public", "apple-touch-icon.png"), appleBuf);
  writeFileSync(path.join(root, "app", "apple-icon.png"), appleBuf);
  console.log("wrote apple-touch-icon.png + app/apple-icon.png (180x180)");
  // NOTE: no favicon.ico — the marketing site references one in metadata but the
  // actual file doesn't exist there either; app/icon.svg + the PNG fallbacks below
  // cover every real icon surface, so skip the fake .ico rather than invent one.
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
