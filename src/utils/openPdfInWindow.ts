// Open a PDF Blob in a new window so the browser's PDF viewer renders it
// (preview UX). If the popup is blocked, fall back to a download with the
// given filename. Object URL is revoked after a delay to give the new
// window time to fetch.
export const openPdfInWindow = (bytes: Uint8Array, filename: string): void => {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank')
  if (!opened) {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
