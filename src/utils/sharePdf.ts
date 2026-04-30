type ToastApi = {
  success: (msg: string) => void
  error: (msg: string) => void
}

export type ShareTarget = 'whatsapp' | 'email'

const TARGET_LABEL: Record<ShareTarget, string> = {
  whatsapp: 'WhatsApp',
  email: 'Gmail',
}

// Saves the PDF to Downloads, copies it to the Windows clipboard so Ctrl+V
// inside the target app attaches it, then launches the target
// (WhatsApp Desktop or Gmail compose in the browser).
// Falls back to revealing the file in Explorer when clipboard copy isn't possible.
type ShareOpts = {
  subject?: string
  phone?: string
  email?: string
  partyName?: string
}

export const sharePdf = async (
  pdfBytes: Uint8Array,
  filename: string,
  target: ShareTarget,
  toast: ToastApi,
  opts: ShareOpts = {}
): Promise<void> => {
  try {
    const result = await window.electronAPI.share.sharePdf({
      pdfBytes,
      filename,
      target,
      subject: opts.subject,
      phone: opts.phone,
      email: opts.email,
    })

    if (!result.success) {
      toast.error(result.error || `Failed to share to ${TARGET_LABEL[target]}`)
      return
    }

    const tgt = TARGET_LABEL[target]
    const who = opts.partyName ? ` for ${opts.partyName}` : ''
    const recipientNote = result.data?.recipientPrefilled
      ? ` Chat${target === 'email' ? '/recipient' : ''}${who} is prefilled.`
      : ''

    if (result.data?.clipboardCopied) {
      toast.success(`PDF copied — press Ctrl+V in ${tgt} to attach.${recipientNote}`)
    } else {
      toast.success(`PDF saved to Downloads — attach it from there in ${tgt}.${recipientNote}`)
    }
  } catch (error) {
    console.error(`Error sharing to ${target}:`, error)
    toast.error(`Failed to share to ${TARGET_LABEL[target]}`)
  }
}
