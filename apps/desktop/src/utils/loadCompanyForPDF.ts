// Loads the active Company record and attaches base64 data-URIs for the logo
// and signature (if any) at `company.logoBase64` / `company.signatureBase64`
// for the PDF generators. Both images are OPTIONAL — a company without them
// simply prints without images. Each may be stored either as a data-URI
// already (the one-shot inline conversion in electron/main/index.ts) or as a
// legacy file path (fetched via local-resource:// and rasterized).

const inlineImage = async (
  path: string | null | undefined,
  maxSize: number,
  preserveAspect: boolean,
): Promise<string | undefined> => {
  if (!path) return undefined
  // Already inline (post one-shot conversion) — pass straight through.
  if (path.startsWith('data:')) return path
  try {
    const url = `local-resource://${path.replace(/\\/g, '/')}`
    const response = await fetch(url)
    if (!response.ok) throw new Error('Image file not found')
    const blob = await response.blob()
    const img = new Image()
    const imgUrl = URL.createObjectURL(blob)
    return await new Promise<string>((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement('canvas')
        if (preserveAspect && img.width > 0 && img.height > 0) {
          // Signatures are wide strips — squashing them square mangles them.
          canvas.width = maxSize
          canvas.height = Math.max(1, Math.round((maxSize * img.height) / img.width))
        } else {
          canvas.width = maxSize
          canvas.height = maxSize
        }
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(imgUrl)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = reject
      img.src = imgUrl
    })
  } catch {
    // Missing or unreadable file — the PDF simply omits the image.
    return undefined
  }
}

export const loadCompanyForPDF = async (): Promise<any | undefined> => {
  const companyResult = await window.electronAPI.company.get()
  const company: any = companyResult.success ? companyResult.data : undefined
  if (!company) return company

  const [logoBase64, signatureBase64] = await Promise.all([
    inlineImage(company.logoPath, 600, false),
    inlineImage(company.signaturePath, 400, true),
  ])
  if (logoBase64) company.logoBase64 = logoBase64
  if (signatureBase64) company.signatureBase64 = signatureBase64
  return company
}
