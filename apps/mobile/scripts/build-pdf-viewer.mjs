// Generates apps/mobile/assets/pdf/pdfViewer.html — a single self-contained
// HTML page bundling pdf.js (pdfjs-dist 3.x, the last plain-script build) + a
// render bridge. Loaded into a VISIBLE react-native-webview by the in-app PDF
// preview screen (app/pdfPreview.tsx): the app injects a base64 PDF, the page
// draws every page onto a fit-width canvas. Fully offline — Android's WebView
// cannot display PDFs natively, and the artifact CSP-free world of a device
// with no network must still preview invoices.
//
// The worker is embedded as a STRING and booted from a Blob URL — pdf.js
// insists on a workerSrc, and there is no second file to point at when the
// whole viewer is one inline HTML string.
//
// Run via `pnpm build:pdf-viewer`. Re-run after upgrading pdfjs-dist. The
// generated file is committed so Metro always finds it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Guard against a literal "</script" anywhere in the embedded sources ending
// our <script> tags early. Inside JS strings/regexes "<\/" === "</".
const escapeScriptEnd = (s) => s.replace(/<\/script/gi, '<\\/script')

const pdfJs = escapeScriptEnd(readFileSync(require.resolve('pdfjs-dist/build/pdf.min.js'), 'utf8'))
const workerJs = readFileSync(require.resolve('pdfjs-dist/build/pdf.worker.min.js'), 'utf8')
const workerLiteral = escapeScriptEnd(JSON.stringify(workerJs))

const viewerGlue = `
<script>
(function () {
  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));

  function fail(e) {
    var box = document.getElementById('err');
    box.style.display = 'block';
    box.textContent = 'Could not display this PDF: ' + String((e && e.message) || e);
    post({ type: 'error', error: String((e && e.message) || e) });
  }

  window.__renderPdf = function (b64) {
    try {
      var raw = atob(b64);
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      pdfjsLib.getDocument({ data: bytes }).promise.then(async function (doc) {
        var container = document.getElementById('pages');
        container.innerHTML = '';
        var cssWidth = document.documentElement.clientWidth - 16;
        // Render at device-pixel resolution so a moderate pinch-zoom stays
        // sharp; cap the multiplier to bound canvas memory on long documents.
        var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        for (var n = 1; n <= doc.numPages; n++) {
          var page = await doc.getPage(n);
          var base = page.getViewport({ scale: 1 });
          var vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
          var canvas = document.createElement('canvas');
          canvas.className = 'page';
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = vp.width / dpr + 'px';
          canvas.style.height = vp.height / dpr + 'px';
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        }
        post({ type: 'rendered', pages: doc.numPages });
      }).catch(fail);
    } catch (e) {
      fail(e);
    }
    return true;
  };
  post({ type: 'ready' });
})();
</script>`

const html =
  `<!DOCTYPE html><html><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
  `<style>` +
  `body{margin:0;padding:8px 0;background:#3c4043}` +
  `.page{display:block;margin:0 auto 8px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.5)}` +
  `#err{display:none;color:#fff;font-family:sans-serif;padding:24px;text-align:center}` +
  `</style></head><body>` +
  `<div id="pages"></div><div id="err"></div>` +
  `<script>${pdfJs}</script>` +
  `<script>var WORKER_SOURCE = ${workerLiteral};</script>` +
  `${viewerGlue}` +
  `</body></html>`

const outDir = resolve(__dirname, '../assets/pdf')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'pdfViewer.html'), html, 'utf8')

// Same Metro cache trick as build-pdf-harness.mjs: bump the loader's rev
// marker so the fresh .html is actually re-read.
const loaderPath = resolve(__dirname, '../utils/pdfViewerHtml.ts')
try {
  let loader = readFileSync(loaderPath, 'utf8')
  loader = loader.replace(/viewer-rev: (\d+)/, (_, n) => `viewer-rev: ${Number(n) + 1}`)
  writeFileSync(loaderPath, loader, 'utf8')
} catch {
  // loader not created yet on first run — fine, it ships with rev 1
}

console.log('Wrote assets/pdf/pdfViewer.html (%d KB)', Math.round(html.length / 1024))
