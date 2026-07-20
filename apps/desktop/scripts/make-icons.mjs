// App-icon generator — renders every icon both apps ship from ONE source
// image: resources/logo-source.png (the tricolor mark, transparent RGBA).
// Puppeteer (already a devDependency) composes each target on a canvas:
//
//   tiles     white rounded/square backgrounds with the logo centered
//             (the mark's silver arc needs a light backdrop)
//   adaptive  Android foreground = logo on transparency inside the safe
//             zone; background = white; monochrome = a white silhouette
//             cut from the logo's own alpha channel
//
//   node scripts/make-icons.mjs
//   pnpm dlx png-to-ico resources/ico-256.png resources/ico-128.png resources/ico-64.png resources/ico-48.png resources/ico-32.png resources/ico-24.png resources/ico-16.png > resources/icon.ico
//
// To change the logo: replace resources/logo-source.png, re-run, rebuild.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopRes = path.join(here, '..', 'resources')
const mobileAssets = path.join(here, '..', '..', 'mobile', 'assets', 'images')
fs.mkdirSync(desktopRes, { recursive: true })

const SOURCE = path.join(desktopRes, 'logo-source.png')
const sourceB64 = fs.readFileSync(SOURCE).toString('base64')

// kind: 'tile-rounded' | 'tile-square' | 'mark' | 'mono' | 'solid-white'
const TARGETS = [
  // Desktop
  { kind: 'tile-rounded', size: 512, out: path.join(desktopRes, 'icon.png') },
  ...[256, 128, 64, 48, 32, 24, 16].map((s) => ({
    kind: 'tile-rounded', size: s, out: path.join(desktopRes, `ico-${s}.png`),
  })),
  // Mobile
  { kind: 'tile-square', size: 1024, out: path.join(mobileAssets, 'icon.png') },
  { kind: 'solid-white', size: 1024, out: path.join(mobileAssets, 'android-icon-background.png') },
  { kind: 'mark', size: 1024, scale: 0.58, out: path.join(mobileAssets, 'android-icon-foreground.png') },
  { kind: 'mono', size: 1024, scale: 0.58, out: path.join(mobileAssets, 'android-icon-monochrome.png') },
  { kind: 'tile-rounded', size: 1024, out: path.join(mobileAssets, 'splash-icon.png') },
  { kind: 'tile-rounded', size: 64, out: path.join(mobileAssets, 'favicon.png') },
]

const browser = await puppeteer.launch()
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

// Load the source once, measure its content bounding box (transparent-cropped).
await page.evaluate(async (b64) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0
  for (let y = 0; y < c.height; y += 2) {
    for (let xx = 0; xx < c.width; xx += 2) {
      if (d[(y * c.width + xx) * 4 + 3] > 8) {
        if (xx < minX) minX = xx
        if (xx > maxX) maxX = xx
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  window.__logo = { img, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } }
}, sourceB64)

for (const t of TARGETS) {
  const dataUrl = await page.evaluate(({ kind, size, scale }) => {
    const { img, box } = window.__logo
    const c = document.getElementById('c')
    c.width = size
    c.height = size
    const x = c.getContext('2d')
    x.clearRect(0, 0, size, size)
    x.imageSmoothingQuality = 'high'

    const drawLogo = (frac) => {
      const s = (size * frac) / Math.max(box.w, box.h)
      const w = box.w * s
      const h = box.h * s
      x.drawImage(img, box.x, box.y, box.w, box.h, (size - w) / 2, (size - h) / 2, w, h)
    }

    if (kind === 'solid-white') {
      x.fillStyle = '#ffffff'
      x.fillRect(0, 0, size, size)
    } else if (kind === 'tile-square') {
      x.fillStyle = '#ffffff'
      x.fillRect(0, 0, size, size)
      drawLogo(0.76)
    } else if (kind === 'tile-rounded') {
      const r = size * 0.22
      x.beginPath()
      x.roundRect(0.5, 0.5, size - 1, size - 1, r)
      x.fillStyle = '#ffffff'
      x.fill()
      // hairline so a white tile keeps its edge on white surfaces
      x.strokeStyle = 'rgba(0,0,0,0.10)'
      x.lineWidth = Math.max(1, size / 256)
      x.stroke()
      x.save()
      x.clip()
      drawLogo(0.74)
      x.restore()
    } else if (kind === 'mark') {
      drawLogo(scale)
    } else if (kind === 'mono') {
      drawLogo(scale)
      // White silhouette cut from the logo's own alpha channel.
      x.globalCompositeOperation = 'source-in'
      x.fillStyle = '#ffffff'
      x.fillRect(0, 0, size, size)
      x.globalCompositeOperation = 'source-over'
    }
    return c.toDataURL('image/png')
  }, t)
  fs.writeFileSync(t.out, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('wrote', path.relative(path.join(here, '..', '..', '..'), t.out), `${t.size}px`)
}

await browser.close()
console.log('\nNow assemble the Windows .ico:')
console.log('  pnpm dlx png-to-ico resources/ico-256.png resources/ico-128.png resources/ico-64.png resources/ico-48.png resources/ico-32.png resources/ico-24.png resources/ico-16.png > resources/icon.ico')
