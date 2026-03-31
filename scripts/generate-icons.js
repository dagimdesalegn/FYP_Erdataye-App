/**
 * Generate professional Erdataye app icons.
 *
 * Design: Red gradient circle with white ambulance cross + siren pulse rings
 * Amharic: እርዳታዬ (correct spelling)
 *
 * Run: node scripts/generate-icons.js
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const OUT = path.join(__dirname, "..", "assets", "images");

// ── SVG Templates ────────────────────────────────────────────────────────────

/** Main icon (1024×1024) — red gradient background, white ambulance cross, siren lights */
const mainIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#FF3B30"/>
      <stop offset="100%" stop-color="#B91C1C"/>
    </radialGradient>
    <linearGradient id="cross" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F0F0F0"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="6" stdDeviation="18" flood-color="#000" flood-opacity="0.35"/>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Background circle -->
  <circle cx="512" cy="512" r="460" fill="url(#bg)" filter="url(#shadow)"/>

  <!-- Outer pulse ring -->
  <circle cx="512" cy="512" r="420" fill="none" stroke="#FFFFFF" stroke-width="3" opacity="0.15"/>
  <circle cx="512" cy="512" r="380" fill="none" stroke="#FFFFFF" stroke-width="2" opacity="0.10"/>

  <!-- Siren light top -->
  <ellipse cx="512" cy="248" rx="60" ry="24" fill="#FFD700" opacity="0.9" filter="url(#glow)"/>
  <ellipse cx="512" cy="248" rx="36" ry="14" fill="#FFF8DC" opacity="0.95"/>

  <!-- Ambulance body (rounded rectangle) -->
  <rect x="300" y="340" width="424" height="280" rx="40" ry="40" fill="white" opacity="0.15"/>

  <!-- Medical cross — bold, centered -->
  <rect x="462" y="320" width="100" height="300" rx="16" fill="url(#cross)" filter="url(#shadow)"/>
  <rect x="362" y="420" width="300" height="100" rx="16" fill="url(#cross)" filter="url(#shadow)"/>

  <!-- Small red cross center accent -->
  <rect x="492" y="450" width="40" height="40" rx="6" fill="#FF3B30" opacity="0.6"/>

  <!-- Ambulance wheels -->
  <circle cx="380" cy="660" r="40" fill="#FFFFFF" opacity="0.2"/>
  <circle cx="380" cy="660" r="26" fill="#FFFFFF" opacity="0.35"/>
  <circle cx="644" cy="660" r="40" fill="#FFFFFF" opacity="0.2"/>
  <circle cx="644" cy="660" r="26" fill="#FFFFFF" opacity="0.35"/>

  <!-- Bottom line (road hint) -->
  <rect x="280" y="710" width="464" height="6" rx="3" fill="#FFFFFF" opacity="0.2"/>

  <!-- Amharic text "እርዳታዬ" -->
  <text x="512" y="810" text-anchor="middle" font-family="sans-serif" font-weight="bold"
        font-size="72" fill="#FFFFFF" opacity="0.95" letter-spacing="4">እርዳታዬ</text>

  <!-- English subtitle -->
  <text x="512" y="860" text-anchor="middle" font-family="sans-serif" font-weight="600"
        font-size="32" fill="#FFFFFF" opacity="0.6" letter-spacing="6">ERDATAYE</text>
</svg>`;

/** Android adaptive icon foreground (1024×1024, content in safe zone ~66%) */
const foregroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="cross" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F0F0F0"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="#000" flood-opacity="0.3"/>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Siren light -->
  <ellipse cx="512" cy="290" rx="50" ry="20" fill="#FFD700" opacity="0.9" filter="url(#glow)"/>
  <ellipse cx="512" cy="290" rx="30" ry="12" fill="#FFF8DC"/>

  <!-- Medical cross — big and bold -->
  <rect x="467" y="330" width="90" height="270" rx="14" fill="url(#cross)" filter="url(#shadow)"/>
  <rect x="377" y="420" width="270" height="90" rx="14" fill="url(#cross)" filter="url(#shadow)"/>

  <!-- Center accent -->
  <rect x="497" y="450" width="30" height="30" rx="5" fill="#DC2626" opacity="0.55"/>

  <!-- Wheels -->
  <circle cx="400" cy="640" r="30" fill="#FFFFFF" opacity="0.3"/>
  <circle cx="400" cy="640" r="18" fill="#FFFFFF" opacity="0.5"/>
  <circle cx="624" cy="640" r="30" fill="#FFFFFF" opacity="0.3"/>
  <circle cx="624" cy="640" r="18" fill="#FFFFFF" opacity="0.5"/>

  <!-- Road line -->
  <rect x="320" y="685" width="384" height="5" rx="2.5" fill="#FFFFFF" opacity="0.3"/>

  <!-- Amharic text -->
  <text x="512" y="770" text-anchor="middle" font-family="sans-serif" font-weight="bold"
        font-size="60" fill="#FFFFFF" opacity="0.95" letter-spacing="3">እርዳታዬ</text>
</svg>`;

/** Android adaptive icon background (1024×1024) — red gradient */
const backgroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#EF4444"/>
      <stop offset="100%" stop-color="#991B1B"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <!-- Subtle pattern rings -->
  <circle cx="512" cy="512" r="400" fill="none" stroke="#FFFFFF" stroke-width="2" opacity="0.06"/>
  <circle cx="512" cy="512" r="320" fill="none" stroke="#FFFFFF" stroke-width="2" opacity="0.04"/>
  <circle cx="512" cy="512" r="240" fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.03"/>
</svg>`;

/** Monochrome adaptive icon (white silhouette on transparent) */
const monochromeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <!-- Siren -->
  <ellipse cx="512" cy="310" rx="40" ry="16" fill="white"/>
  <!-- Cross vertical -->
  <rect x="467" y="350" width="90" height="250" rx="14" fill="white"/>
  <!-- Cross horizontal -->
  <rect x="377" y="430" width="270" height="90" rx="14" fill="white"/>
  <!-- Wheels -->
  <circle cx="400" cy="640" r="22" fill="white"/>
  <circle cx="624" cy="640" r="22" fill="white"/>
  <!-- Road -->
  <rect x="340" y="675" width="344" height="5" rx="2.5" fill="white"/>
</svg>`;

/** Splash screen icon (1024×1024) — just the cross + siren, no background circle -->  */
const splashSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#EF4444"/>
      <stop offset="100%" stop-color="#DC2626"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.2"/>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Siren -->
  <ellipse cx="512" cy="260" rx="56" ry="22" fill="#FFD700" filter="url(#glow)"/>
  <ellipse cx="512" cy="260" rx="34" ry="13" fill="#FFFACD"/>

  <!-- Cross -->
  <rect x="462" y="300" width="100" height="310" rx="18" fill="url(#redGrad)" filter="url(#shadow)"/>
  <rect x="357" y="405" width="310" height="100" rx="18" fill="url(#redGrad)" filter="url(#shadow)"/>

  <!-- Wheels -->
  <circle cx="390" cy="660" r="34" fill="#DC2626" opacity="0.25"/>
  <circle cx="390" cy="660" r="20" fill="#DC2626" opacity="0.45"/>
  <circle cx="634" cy="660" r="34" fill="#DC2626" opacity="0.25"/>
  <circle cx="634" cy="660" r="20" fill="#DC2626" opacity="0.45"/>

  <!-- Road -->
  <rect x="300" y="710" width="424" height="6" rx="3" fill="#DC2626" opacity="0.2"/>

  <!-- Amharic -->
  <text x="512" y="810" text-anchor="middle" font-family="sans-serif" font-weight="bold"
        font-size="76" fill="#DC2626" letter-spacing="4">እርዳታዬ</text>
  <text x="512" y="868" text-anchor="middle" font-family="sans-serif" font-weight="600"
        font-size="34" fill="#DC2626" opacity="0.5" letter-spacing="6">ERDATAYE</text>
</svg>`;

/** Favicon (simple red circle + white cross) */
const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="22" fill="#DC2626"/>
  <rect x="20" y="10" width="8" height="28" rx="2.5" fill="white"/>
  <rect x="10" y="20" width="28" height="8" rx="2.5" fill="white"/>
</svg>`;

/** Ambulance favicon (used on landing page hero — small ambulance + cross) */
const ambulanceFaviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#FF3B30"/>
      <stop offset="100%" stop-color="#B91C1C"/>
    </radialGradient>
  </defs>
  <circle cx="48" cy="48" r="44" fill="url(#bg)"/>
  <rect x="41" y="22" width="14" height="48" rx="3" fill="white"/>
  <rect x="24" y="39" width="48" height="14" rx="3" fill="white"/>
</svg>`;

// ── Generation ───────────────────────────────────────────────────────────────

async function generateIcon(svg, filename, size) {
  const buf = Buffer.from(svg);
  await sharp(buf)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, filename));
  console.log(`  ✔ ${filename} (${size}×${size})`);
}

async function main() {
  console.log("\n🎨 Generating Erdataye አዶዎች (icons)...\n");

  await generateIcon(mainIconSvg,       "icon.png",                      1024);
  await generateIcon(foregroundSvg,      "android-icon-foreground.png",   1024);
  await generateIcon(backgroundSvg,      "android-icon-background.png",   1024);
  await generateIcon(monochromeSvg,       "android-icon-monochrome.png",  1024);
  await generateIcon(splashSvg,          "splash-icon.png",               1024);
  await generateIcon(faviconSvg,         "favicon.png",                     48);
  await generateIcon(ambulanceFaviconSvg, "ambulance-favicon.png",          96);

  console.log("\n✅ All icons generated in assets/images/\n");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
