// Render the first page of a PDF to a raster image (PNG or JPEG) using
// pdfjs-dist + Chromium canvas. Used by:
//   - downloadHelpers (PNG/JPEG download artifacts for any document)
//   - Purchase / PreviousInvoices upload flow (most OCR providers reject PDFs
//     and only accept image MIME types — rasterize page 1 and send the image)
//
// Lives in the renderer because Chromium has canvas built-in — no native node
// dep. Lazy-loads pdfjs so the bundle isn't pulled in unless something
// actually needs it, and caches the loaded module so GlobalWorkerOptions
// .workerSrc is set exactly once.

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

const loadPdfjs = (): Promise<typeof import('pdfjs-dist')> => {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      // `new URL(..., import.meta.url)` is the Vite-recommended way to
      // reference a worker file. Avoids the `?url` import-suffix syntax which
      // would need a separate type declaration.
      lib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()
      return lib
    })
  }
  return pdfjsPromise
}

export type PdfRasterFormat = 'png' | 'jpeg'

export const renderPdfFirstPage = async (
  pdfBytes: Uint8Array,
  format: PdfRasterFormat = 'png',
  scale = 2,
): Promise<Uint8Array<ArrayBuffer>> => {
  const pdfjsLib = await loadPdfjs()

  // pdfjs detaches the input buffer when transferring to its worker — pass a
  // fresh copy so the caller's bytes survive (often needed again, e.g. to save
  // the original PDF as the bill's attachment).
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D canvas context')

  // White background — JPEGs don't support transparency; PNGs look cleaner with it too.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: ctx, viewport, canvas }).promise

  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, mime, format === 'jpeg' ? 0.92 : undefined),
  )
  if (!blob) throw new Error('canvas.toBlob returned null')
  return new Uint8Array(await blob.arrayBuffer())
}
