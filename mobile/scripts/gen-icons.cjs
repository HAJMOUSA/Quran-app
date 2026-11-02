// Generates the app icon set from inline SVG (emerald + ivory mushaf + gold star).
// Run: node scripts/gen-icons.cjs
const sharp = require("sharp");
const path = require("path");

const A = path.join(__dirname, "..", "assets");

// --- shared motif: open book + 8-point star, centred for the adaptive safe zone ---
// `mono` renders a single flat colour (for the themed/monochrome icon).
function motif({ mono = false } = {}) {
  const page = mono ? "#fff" : "url(#page)";
  const pageEdge = mono ? "#fff" : "#e6d8b6";
  const gold = mono ? "#fff" : "url(#gold)";
  const line = mono ? "#fff" : "#caa64e";
  const gutter = mono ? "#fff" : "#b9922f";
  const textOp = mono ? 0.0 : 0.85;   // hide text lines in the flat silhouette
  return `
  <!-- halo -->
  ${mono ? "" : '<circle cx="512" cy="348" r="210" fill="url(#halo)"/>'}
  <!-- eight-point star (two overlapping squares) -->
  <g transform="translate(512 348)" fill="${gold}">
    <rect x="-96" y="-96" width="192" height="192" rx="26"/>
    <rect x="-96" y="-96" width="192" height="192" rx="26" transform="rotate(45)"/>
  </g>
  <circle cx="512" cy="348" r="40" fill="${mono ? "#fff" : "#12492b"}"/>
  <circle cx="512" cy="348" r="18" fill="${gold}"/>

  <!-- soft shadow under the book -->
  ${mono ? "" : '<ellipse cx="512" cy="712" rx="210" ry="26" fill="#000" opacity="0.18"/>'}

  <!-- open book: two pages meeting at a centre gutter -->
  <g stroke="${pageEdge}" stroke-width="3" stroke-linejoin="round">
    <path d="M512 560 C 430 536 356 540 300 566 L 300 676 C 372 656 452 660 512 684 Z" fill="${page}"/>
    <path d="M512 560 C 594 536 668 540 724 566 L 724 676 C 652 656 572 660 512 684 Z" fill="${page}"/>
  </g>
  <!-- text lines -->
  <g stroke="${line}" stroke-width="9" stroke-linecap="round" opacity="${textOp}">
    <line x1="340" y1="588" x2="470" y2="584"/>
    <line x1="334" y1="616" x2="474" y2="612"/>
    <line x1="336" y1="644" x2="466" y2="640"/>
    <line x1="554" y1="584" x2="684" y2="588"/>
    <line x1="550" y1="612" x2="690" y2="616"/>
    <line x1="558" y1="640" x2="688" y2="644"/>
  </g>
  <!-- centre gutter -->
  <path d="M512 560 L512 684" stroke="${gutter}" stroke-width="7" stroke-linecap="round"/>`;
}

const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#2e9460"/>
      <stop offset="1" stop-color="#103f26"/>
    </linearGradient>
    <linearGradient id="page" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fdf8ec"/>
      <stop offset="1" stop-color="#ecdfc2"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6d87e"/>
      <stop offset="1" stop-color="#c79a33"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffe9a8" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

const svg = (inner, { bg = false } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${DEFS}
   ${bg ? '<rect width="1024" height="1024" fill="url(#bg)"/><g fill="none" stroke="#fff" stroke-opacity="0.045" stroke-width="2"><circle cx="512" cy="430" r="300"/><circle cx="512" cy="430" r="384"/></g>' : ""}
   ${inner}</svg>`;

const BG_ONLY = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${DEFS}
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <g fill="none" stroke="#fff" stroke-opacity="0.045" stroke-width="2"><circle cx="512" cy="430" r="300"/><circle cx="512" cy="430" r="384"/></g></svg>`;

const FULL = svg(motif(), { bg: true });        // green bg + motif
const FG = svg(motif(), { bg: false });         // transparent + motif
const MONO = svg(motif({ mono: true }), { bg: false });

async function png(svgStr, size, out) {
  await sharp(Buffer.from(svgStr)).resize(size, size).png().toFile(path.join(A, out));
}
async function webp(svgStr, size, out) {
  await sharp(Buffer.from(svgStr)).resize(size, size).webp({ quality: 95 }).toFile(out);
}

(async () => {
  // Expo source assets
  await png(FULL, 1024, "icon.png");
  await png(FG, 512, "android-icon-foreground.png");
  await png(BG_ONLY, 512, "android-icon-background.png");
  await png(MONO, 432, "android-icon-monochrome.png");
  await png(FULL, 48, "favicon.png");

  // Native mipmap set (prebuilt android project): [density, legacyPx, adaptivePx]
  const RES = path.join(__dirname, "..", "android", "app", "src", "main", "res");
  const densities = [["mdpi", 48, 108], ["hdpi", 72, 162], ["xhdpi", 96, 216], ["xxhdpi", 144, 324], ["xxxhdpi", 192, 432]];
  for (const [d, legacy, adaptive] of densities) {
    const dir = path.join(RES, "mipmap-" + d);
    await webp(FULL, legacy, path.join(dir, "ic_launcher.webp"));
    await webp(FULL, legacy, path.join(dir, "ic_launcher_round.webp"));
    await webp(FG, adaptive, path.join(dir, "ic_launcher_foreground.webp"));
    await webp(BG_ONLY, adaptive, path.join(dir, "ic_launcher_background.webp"));
    await webp(MONO, adaptive, path.join(dir, "ic_launcher_monochrome.webp"));
  }
  console.log("done: assets + native mipmaps regenerated");
})();
