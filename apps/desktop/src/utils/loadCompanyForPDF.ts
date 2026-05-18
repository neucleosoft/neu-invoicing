// Loads the active Company record and attaches a base64-encoded, downscaled
// version of the logo (if any) at `company.logoBase64` for use by PDF generators.
// Identical logic was previously duplicated inside every page's handleDownloadPDF.
export const loadCompanyForPDF = async (): Promise<any | undefined> => {
  const companyResult = await window.electronAPI.company.get()
  const company = companyResult.success ? companyResult.data : undefined
  if (!company?.logoPath) return company

  try {
    const logoUrl = `local-resource://${company.logoPath.replace(/\\/g, '/')}`
    const response = await fetch(logoUrl)
    if (!response.ok) throw new Error('Logo file not found')
    const blob = await response.blob()
    const img = new Image()
    const imgUrl = URL.createObjectURL(blob)
    const logoBase64 = await new Promise<string>((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 600
        canvas.height = 600
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, 600, 600)
        URL.revokeObjectURL(imgUrl)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = reject
      img.src = imgUrl
    })
    company.logoBase64 = logoBase64
  } catch {
    // Logo file missing or unreadable — leave logoBase64 unset; PDFs fall back to default.
  }

  return company
}
