import { useEffect, useState } from 'react'
import { Share2, Mail, X } from 'lucide-react'
import type { ShareTarget } from '../utils/sharePdf'

type Variant = 'link' | 'button'

type Props = {
  onShare: (target: ShareTarget) => void
  variant?: Variant
  label?: string
  /** Party phone — shown as recipient hint next to the WhatsApp option. */
  phone?: string
  /** Party email — shown as recipient hint next to the Email option. */
  email?: string
  /** Party display name — used in the dialog header. */
  partyName?: string
}

const isLikelyEmail = (raw?: string): boolean =>
  !!raw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())

const formatPhoneHint = (raw?: string): string | null => {
  const digits = (raw || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`
  if (digits.length === 12 && digits.startsWith('91'))
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  return raw!.trim()
}

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.81 11.81 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.518 5.26l-.999 3.648 3.97-1.041zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
  </svg>
)

const ShareMenu = ({
  onShare,
  variant = 'link',
  label = 'Share',
  phone,
  email,
  partyName,
}: Props) => {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const triggerClass =
    variant === 'button'
      ? 'btn bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center justify-center p-2'
      : 'inline-flex items-center justify-center text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300'

  const pick = (target: ShareTarget) => {
    setOpen(false)
    onShare(target)
  }

  const phoneHint = formatPhoneHint(phone)
  const hasEmail = isLikelyEmail(email)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClass}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Share2 className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="relative w-full max-w-md animate-menuIn overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5 dark:bg-gray-800 dark:ring-white/10">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-700">
              <div className="min-w-0">
                <h2
                  id="share-dialog-title"
                  className="text-lg font-semibold text-gray-900 dark:text-gray-100"
                >
                  Share PDF
                </h2>
                {partyName && (
                  <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">
                    to {partyName}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-mr-2 -mt-1 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Options */}
            <div className="grid grid-cols-2 gap-3 p-6">
              <button
                type="button"
                onClick={() => pick('whatsapp')}
                className="group flex flex-col items-center gap-3 rounded-xl border-2 border-gray-200 bg-white p-5 text-center transition hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-emerald-500 dark:hover:bg-emerald-900/20"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 transition group-hover:scale-110 dark:bg-emerald-900/40 dark:text-emerald-400">
                  <WhatsAppIcon className="h-8 w-8" />
                </span>
                <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                  WhatsApp
                </span>
                <span className="block w-full truncate text-xs text-gray-500 dark:text-gray-400">
                  {phoneHint || 'Open WhatsApp'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => pick('email')}
                className="group flex flex-col items-center gap-3 rounded-xl border-2 border-gray-200 bg-white p-5 text-center transition hover:border-rose-500 hover:bg-rose-50 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-rose-500 dark:hover:bg-rose-900/20"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-600 transition group-hover:scale-110 dark:bg-rose-900/40 dark:text-rose-400">
                  <Mail className="h-8 w-8" />
                </span>
                <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Gmail
                </span>
                <span className="block w-full truncate text-xs text-gray-500 dark:text-gray-400">
                  {hasEmail ? email!.trim() : 'Open Gmail compose'}
                </span>
              </button>
            </div>

            {/* Footer hint */}
            <div className="rounded-b-xl border-t border-gray-100 bg-gray-50 px-6 py-3 dark:border-gray-700 dark:bg-gray-900/50">
              <p className="break-words text-center text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                Saved to Downloads. Press{' '}
                <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  Ctrl
                </kbd>
                {' + '}
                <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  V
                </kbd>{' '}
                in the app to attach.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default ShareMenu
