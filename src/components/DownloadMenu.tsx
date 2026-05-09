import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Download,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  FileDown,
  Printer,
  X,
} from 'lucide-react'
import {
  generateArtifact,
  saveArtifact,
  DownloadFormat,
  DispatchOpts,
  Artifact,
} from '../utils/downloadHelpers'

type Variant = 'link' | 'button'

type Props = {
  // Returns the dispatch options for the row this menu belongs to. Called
  // each time a format is picked, so the closure can rebuild PDF caches lazily.
  getOpts: () => Promise<DispatchOpts> | DispatchOpts
  variant?: Variant
  label?: string
}

type Option = {
  format: DownloadFormat
  label: string
  hint: string
  Icon: typeof Download
  iconClass: string
}

const OPTIONS: Option[] = [
  { format: 'pdf', label: 'PDF', hint: 'Save as PDF', Icon: FileText, iconClass: 'text-red-600 dark:text-red-400' },
  { format: 'png', label: 'PNG image', hint: 'High-quality image', Icon: ImageIcon, iconClass: 'text-purple-600 dark:text-purple-400' },
  { format: 'jpeg', label: 'JPEG image', hint: 'Smaller image file', Icon: ImageIcon, iconClass: 'text-amber-600 dark:text-amber-400' },
  { format: 'excel', label: 'Excel (.xlsx)', hint: 'Spreadsheet', Icon: FileSpreadsheet, iconClass: 'text-emerald-600 dark:text-emerald-400' },
  { format: 'csv', label: 'CSV', hint: 'Plain text data', Icon: FileDown, iconClass: 'text-blue-600 dark:text-blue-400' },
  { format: 'print', label: 'Print', hint: 'Open print dialog', Icon: Printer, iconClass: 'text-slate-600 dark:text-slate-400' },
]

// Build an object URL for the artifact bytes — preview-time only. Lives on the
// component so we can revoke it when the modal closes / artifact changes.
const useObjectUrl = (artifact: Artifact | null): string | null => {
  return useMemo(() => {
    if (!artifact) return null
    const blob = new Blob([artifact.bytes as BlobPart], { type: artifact.mime })
    return URL.createObjectURL(blob)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact])
}

const PreviewModal = ({
  artifact,
  onClose,
  onSave,
}: {
  artifact: Artifact
  onClose: () => void
  onSave: () => void
}) => {
  const url = useObjectUrl(artifact)

  useEffect(() => {
    return () => {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 5_000)
    }
  }, [url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isImage = artifact.format === 'png' || artifact.format === 'jpeg'
  const isPdf = artifact.format === 'pdf'
  const isTable = artifact.format === 'csv' || artifact.format === 'excel'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2
              id="download-preview-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Preview · {artifact.format.toUpperCase()}
            </h2>
            <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">
              {artifact.filename}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-1 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-gray-100 p-4 dark:bg-gray-900/40">
          {isPdf && url && (
            <iframe
              title="PDF preview"
              src={url}
              className="h-full w-full rounded-md border border-gray-200 bg-white dark:border-gray-700"
            />
          )}

          {isImage && url && (
            <div className="flex h-full items-start justify-center">
              <img
                src={url}
                alt="Preview"
                className="max-h-full max-w-full rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-700"
              />
            </div>
          )}

          {isTable && artifact.table && (() => {
            // Mirror the saved-file layout: meta before headers, suffix after,
            // all on one header row; each data row carries meta/suffix values.
            const metaPairs = artifact.table.meta || []
            const sufPairs = artifact.table.metaSuffix || []
            const metaKeys = metaPairs.map(([k]) => k)
            const metaVals = metaPairs.map(([, v]) => v)
            const sufKeys = sufPairs.map(([k]) => k)
            const sufVals = sufPairs.map(([, v]) => v)
            const allHeaders = [...metaKeys, ...artifact.table.headers, ...sufKeys]
            const dataRows = artifact.table.rows.filter((r) => r.length > 0)
            return (
              <div className="overflow-auto rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-indigo-50 dark:bg-indigo-900/30">
                      {allHeaders.map((h, i) => (
                        <th
                          key={i}
                          className="px-4 py-2 text-left font-semibold text-gray-800 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, ri) => (
                      <tr key={ri} className="even:bg-gray-50 dark:even:bg-gray-700/30">
                        {[...metaVals, ...row, ...sufVals].map((cell, ci) => (
                          <td
                            key={ci}
                            className="px-4 py-2 text-gray-900 dark:text-gray-100 border-b border-gray-100 dark:border-gray-700/60 whitespace-nowrap"
                          >
                            {cell === undefined || cell === null ? '' : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isTable
              ? 'Preview shows the first rows; the saved file contains everything.'
              : 'Preview is exactly what will be saved.'}
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="button" onClick={onSave} className="btn btn-primary inline-flex items-center gap-2">
              <Download className="h-4 w-4" />
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Estimated dropdown size (must match the rendered panel below — only used
// for viewport-fit math so the menu doesn't open offscreen).
const MENU_WIDTH = 240
const MENU_HEIGHT = 360

const DownloadMenu = ({ getOpts, variant = 'link', label = 'Download' }: Props) => {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<DownloadFormat | null>(null)
  const [preview, setPreview] = useState<Artifact | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Position the portal-rendered menu against the trigger, flipping/clamping
  // so it stays inside the viewport — handles edge-of-screen rows where a
  // right-anchored dropdown would otherwise hang off the page.
  const positionMenu = () => {
    const btn = triggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Default: align right edge of menu to right edge of trigger, drop below.
    let left = rect.right - MENU_WIDTH
    let top = rect.bottom + 4

    // Clamp horizontally so the menu never escapes the viewport.
    if (left + MENU_WIDTH > vw - margin) left = vw - MENU_WIDTH - margin
    if (left < margin) left = margin

    // Flip above the trigger if not enough room below.
    if (top + MENU_HEIGHT > vh - margin && rect.top - MENU_HEIGHT - 4 > margin) {
      top = rect.top - MENU_HEIGHT - 4
    } else if (top + MENU_HEIGHT > vh - margin) {
      // Neither below nor above fully fits — pin to bottom margin.
      top = Math.max(margin, vh - MENU_HEIGHT - margin)
    }

    setMenuPos({ top, left })
  }

  useLayoutEffect(() => {
    if (!open) return
    positionMenu()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(t) &&
        menuRef.current && !menuRef.current.contains(t)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onResize = () => positionMenu()
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true) // capture phase to catch table scrolls
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [open])

  const triggerClass =
    variant === 'button'
      ? 'btn btn-primary inline-flex items-center justify-center gap-2'
      : 'inline-flex items-center justify-center text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'

  const pick = async (fmt: DownloadFormat) => {
    setBusy(fmt)
    try {
      const opts = await getOpts()
      const artifact = await generateArtifact(fmt, opts)
      // Print bypasses the preview modal — the OS print dialog IS the preview.
      if (fmt === 'print') {
        saveArtifact(artifact)
        setOpen(false)
      } else {
        setPreview(artifact)
        setOpen(false)
      }
    } catch (err) {
      console.error('Failed to generate download:', err)
    } finally {
      setBusy(null)
    }
  }

  const handleSave = () => {
    if (!preview) return
    saveArtifact(preview)
    setPreview(null)
  }

  return (
    <>
      <div ref={containerRef} className="relative inline-block">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={triggerClass}
          title={label}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Download className="h-4 w-4" />
          {variant === 'button' && <span>{label}</span>}
        </button>
      </div>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
          className="z-[60] origin-top-right overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10 animate-pop-in"
        >
          <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Preview as</p>
          </div>
          <ul className="py-1 max-h-[70vh] overflow-y-auto">
            {OPTIONS.map(({ format, label: optLabel, hint, Icon, iconClass }) => (
              <li key={format}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => pick(format)}
                  disabled={busy !== null}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700/60"
                >
                  <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
                  <span className="flex-1">
                    <span className="block font-medium text-gray-900 dark:text-gray-100">{optLabel}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>
                  </span>
                  {busy === format && <span className="text-xs text-gray-400">…</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}

      {preview && (
        <PreviewModal
          artifact={preview}
          onClose={() => setPreview(null)}
          onSave={handleSave}
        />
      )}
    </>
  )
}

export default DownloadMenu
