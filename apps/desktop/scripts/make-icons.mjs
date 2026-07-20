// App-icon generator — the single source of truth for every icon both apps
// ship. Renders the inline SVG below (a white "N" monogram on the brand
// sky-blue gradient, tailwind `primary` 500→600) to every required PNG via
// puppeteer (already a devDependency), then scripts/.ico assembly is done by
// png-to-ico (run through pnpm dlx by the caller).
//
//   node scripts/make-icons.mjs
//   pnpm dlx png-to-ico resources/ico-256.png ... > resources/icon.ico
//
// Re-run whenever the logo changes; commit the regenerated assets.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopRes = path.join(here, '..', 'resources')
const mobileAssets = path.join(here, '..', '..', 'mobile', 'assets', 'images')
fs.mkdirSync(desktopRes, { recursive: true })

// ── The mark ────────────────────────────────────────────────────────────────
// Geometry only (no fonts — rendering must be deterministic everywhere).
// N monogram: two uprights + a diagonal band, drawn in a 1024 box.
const N_PATHS = `
  <rect x="312" y="292" width="80" height="440" rx="14" fill="#fff"/>
  <rect x="632" y="292" width="80" height="440" rx="14" fill="#fff"/>
  <polygon points="392,292 392,442 632,732 632,582" fill="#fff"/>
`

const GRADIENT = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0ea5e9"/>
      <stop offset="1" stop-color="#0369a1"/>
    </linearGradient>
  </defs>
`

// Full-bleed square (iOS masks its own corners; also the adaptive background).
const svgFull = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  ${GRADIENT}
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <polygon points="0,0 1024,0 0,1024" fill="#ffffff" opacity="0.06"/>
  ${N_PATHS}
</svg>`

// Rounded tile (Windows .ico, linux png, splash mark, favicon).
const svgRounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  ${GRADIENT}
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <polygon points="0,0 1024,0 0,1024" fill="#ffffff" opacity="0.06" clip-path="inset(0 round 224px)"/>
  ${N_PATHS}
</svg>`

// White mark on transparency, scaled into the adaptive-icon safe zone
// (Android masks everything outside the middle ~66% circle).
const svgMark = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${N_PATHS}</g>
</svg>`

// ── Rendering ───────────────────────────────────────────────────────────────

const TARGETS = [
  // Desktop
  { svg: svgRounded, size: 512, out: path.join(desktopRes, 'icon.png') },
  ...[256, 128, 64, 48, 32, 24, 16].map((s) => ({
    svg: svgRounded, size: s, out: path.join(desktopRes, `ico-${s}.png`),
  })),
  // Mobile
  { svg: svgFull, size: 1024, out: path.join(mobileAssets, 'icon.png') },
  { svg: svgFull, size: 1024, out: path.join(mobileAssets, 'android-icon-background.png') },
  { svg: svgMark(0.62), size: 1024, out: path.join(mobileAssets, 'android-icon-foreground.png') },
  { svg: svgMark(0.62), size: 1024, out: path.join(mobileAssets, 'android-icon-monochrome.png') },
  { svg: svgRounded, size: 1024, out: path.join(mobileAssets, 'splash-icon.png') },
  { svg: svgRounded, size: 64, out: path.join(mobileAssets, 'favicon.png') },
]

const browser = await puppeteer.launch()
const page = await browser.newPage()
for (const t of TARGETS) {
  await page.setViewport({ width: t.size, height: t.size, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><style>*{margin:0;padding:0}body{background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${t.svg}`,
  )
  await page.screenshot({ path: t.out, omitBackground: true })
  console.log('wrote', path.relative(path.join(here, '..', '..', '..'), t.out), `${t.size}px`)
}
await browser.close()
console.log('\nNow assemble the Windows .ico:')
console.log('  pnpm dlx png-to-ico resources/ico-256.png resources/ico-128.png resources/ico-64.png resources/ico-48.png resources/ico-32.png resources/ico-24.png resources/ico-16.png > resources/icon.ico')
