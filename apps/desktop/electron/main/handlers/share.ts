import { ipcMain, app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'

const sanitizeFilename = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 120)

// Put the file (not its path text) on the Windows clipboard so Ctrl+V in
// WhatsApp Desktop attaches it as a document. PowerShell's Set-Clipboard
// supports -LiteralPath on Win 10+. Returns true on success.
const copyFileToClipboardWindows = (filePath: string): Promise<boolean> =>
  new Promise((resolve) => {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Set-Clipboard -LiteralPath ${JSON.stringify(filePath)}`,
      ],
      { windowsHide: true }
    )
    ps.on('error', () => resolve(false))
    ps.on('close', (code) => resolve(code === 0))
  })

type ShareTarget = 'whatsapp' | 'email'

// WhatsApp deep links want digits only with country code, no '+'.
// Indian numbers are stored as 10 digits; default to country code 91.
// Returns null if the number can't be confidently normalized.
const normalizePhone = (raw: string): string | null => {
  const digits = (raw || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('91')) return digits
  if (digits.length >= 11 && digits.length <= 15) return digits
  return null
}

const isLikelyEmail = (raw?: string): boolean =>
  !!raw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())

const buildExternalUrl = (
  target: ShareTarget,
  args: { subject?: string; phone?: string; email?: string }
): string => {
  if (target === 'whatsapp') {
    const phone = normalizePhone(args.phone || '')
    // wa.me opens the chat with the given contact; falls back to the desktop
    // app if installed, web otherwise. With no phone, just launch the app.
    return phone ? `https://wa.me/${phone}` : 'whatsapp://'
  }

  // Gmail compose in the browser — bypasses Windows' default mail handler
  // (which would otherwise launch Outlook). User pastes the PDF with Ctrl+V.
  const params: string[] = ['view=cm', 'fs=1']
  if (isLikelyEmail(args.email)) params.push(`to=${encodeURIComponent(args.email!.trim())}`)
  if (args.subject) params.push(`su=${encodeURIComponent(args.subject)}`)
  return `https://mail.google.com/mail/?${params.join('&')}`
}

export const setupShareHandlers = () => {
  ipcMain.handle(
    'share:sharePdf',
    async (
      _,
      args: {
        pdfBytes: Uint8Array
        filename: string
        target: ShareTarget
        subject?: string
        phone?: string
        email?: string
      }
    ) => {
      try {
        const dir = app.getPath('downloads')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

        const safeName = sanitizeFilename(args.filename || 'document')
        const finalName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`
        const savedPath = path.join(dir, finalName)

        fs.writeFileSync(savedPath, Buffer.from(args.pdfBytes))

        const clipboardCopied =
          process.platform === 'win32' ? await copyFileToClipboardWindows(savedPath) : false

        // Non-Windows can't auto-attach via clipboard reliably — fall back to
        // revealing the file so the user can drag/attach it manually.
        if (!clipboardCopied) {
          shell.showItemInFolder(savedPath)
        }

        const url = buildExternalUrl(args.target, {
          subject: args.subject,
          phone: args.phone,
          email: args.email,
        })
        const recipientPrefilled =
          args.target === 'whatsapp'
            ? !!normalizePhone(args.phone || '')
            : isLikelyEmail(args.email)
        try {
          await shell.openExternal(url)
        } catch {
          // Only WhatsApp can fail here (desktop app not installed) — fall back to web.
          // The Gmail URL is plain HTTPS and any default browser will handle it.
          if (args.target === 'whatsapp') {
            await shell.openExternal('https://web.whatsapp.com')
          } else {
            throw new Error('Failed to open the default browser.')
          }
        }

        return { success: true, data: { savedPath, clipboardCopied, recipientPrefilled } }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to share PDF',
        }
      }
    }
  )
}
