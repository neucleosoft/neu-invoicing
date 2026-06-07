// Generates apps/mobile/assets/pdf/pdfHarness.html — a single self-contained HTML
// page bundling pdfmake's BROWSER build + its fonts + the shared docDefinition
// builders + a message bridge. Loaded into a hidden react-native-webview; pdfmake
// runs there (a real browser engine, so the Hermes "freeze" issues don't apply).
//
// CRITICAL: the docDefinition builders run INSIDE the WebView (bundled here via
// esbuild), NOT in the app. pdfmake table layouts are FUNCTIONS, and functions
// can't survive JSON.stringify when crossing app→WebView — so building in the app
// dropped every border rule and pdfmake drew its default full grid. The app now
// sends only plain JSON data; the WebView builds + renders.
//
// Run via `pnpm build:pdf-harness`. Re-run after upgrading pdfmake OR changing any
// shared/src/pdf builder. The generated file is committed so Metro always finds it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const pdfmakeJs = readFileSync(require.resolve('pdfmake/build/pdfmake.min.js'), 'utf8')
const vfsJs = readFileSync(require.resolve('pdfmake/build/vfs_fonts.js'), 'utf8')

// Bundle the shared pdf builders (TS) into one browser IIFE that assigns
// window.__neuPdfBuilders. Self-contained: the builders import only pure helpers,
// no drizzle/pdfmake/native deps.
const bundle = await esbuild.build({
  entryPoints: [resolve(__dirname, 'pdf-webview-entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2019',
  minify: true,
  write: false,
})
const buildersJs = bundle.outputFiles[0].text

const harnessGlue = `
<script>
(function () {
  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
  function handle(raw) {
    var payload;
    try { payload = JSON.parse(raw); } catch (e) { return post({ type: 'error', error: 'bad-json' }); }
    if (!payload || payload.type !== 'generate') return;
    var id = payload.id;
    try {
      var builders = window.__neuPdfBuilders || {};
      var fn = builders[payload.builder];
      if (!fn) throw new Error('Unknown PDF builder: ' + payload.builder);
      var dd = fn(payload.data); // built HERE, functions intact
      pdfMake.createPdf(dd).getBase64(function (b64) {
        post({ type: 'result', id: id, base64: b64 });
      });
    } catch (e) {
      post({ type: 'error', id: id, error: String((e && e.message) || e) });
    }
  }
  window.__generatePdf = handle;                                  // injectJavaScript path
  window.addEventListener('message', function (ev) { handle(ev.data); });
  document.addEventListener('message', function (ev) { handle(ev.data); }); // Android quirk
  post({ type: 'ready' });
})();
</script>`

const html =
  `<!DOCTYPE html><html><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
  `</head><body>` +
  `<script>${pdfmakeJs}</script>` +
  `<script>${vfsJs}</script>` +
  `<script>${buildersJs}</script>` +
  `${harnessGlue}` +
  `</body></html>`

const outDir = resolve(__dirname, '../assets/pdf')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'pdfHarness.html'), html, 'utf8')

// Bump the cache-bust marker in pdfHarnessHtml.ts. Metro caches that module's
// transform keyed on the .ts source — NOT on the inlined .html it pulls in — so
// without changing the .ts, a regenerated harness would be served stale. Auto-
// incrementing the marker here forces Metro to re-read the fresh harness.
const loaderPath = resolve(__dirname, '../utils/pdfHarnessHtml.ts')
let loader = readFileSync(loaderPath, 'utf8')
loader = loader.replace(/harness-rev: (\d+)/, (_, n) => `harness-rev: ${Number(n) + 1}`)
writeFileSync(loaderPath, loader, 'utf8')

console.log('Wrote assets/pdf/pdfHarness.html (%d KB) + bumped harness-rev', Math.round(html.length / 1024))
