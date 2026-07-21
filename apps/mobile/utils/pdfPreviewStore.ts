// Hand-off slot for the in-app PDF preview screen. The document screens'
// PdfActions bar stores the payload here and navigates to /pdfPreview; the
// screen consumes it on mount. A module-level slot instead of route params
// because the payload's `data` object is a whole document (customer, lines,
// company…) — far past what belongs in a URL.

export type PdfPreviewPayload = {
  builder: string
  data: object
  filename: string
}

let pending: PdfPreviewPayload | null = null

export function setPdfPreviewPayload(p: PdfPreviewPayload) {
  pending = p
}

/** Returns the payload once, then clears it (a reload of the route without a
 *  fresh navigation has nothing to show and backs out). */
export function consumePdfPreviewPayload(): PdfPreviewPayload | null {
  const p = pending
  pending = null
  return p
}
