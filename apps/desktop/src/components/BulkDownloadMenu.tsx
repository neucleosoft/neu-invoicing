import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, FileArchive, FileSpreadsheet } from 'lucide-react'

type Props = {
  count: number
  busy: boolean
  onPdfs: () => void
  onExcel: () => void
}

const MENU_WIDTH = 240
const MENU_HEIGHT = 160

const BulkDownloadMenu = ({ count, busy, onPdfs, onExcel }: Props) => {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Anchor the portal-rendered menu under the trigger; clamp to viewport so it
  // never opens offscreen, flip above when there's no room below.
  const positionMenu = () => {
    const btn = triggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = rect.right - MENU_WIDTH
    let top = rect.bottom + 4
    if (left + MENU_WIDTH > vw - margin) left = vw - MENU_WIDTH - margin
    if (left < margin) left = margin
    if (top + MENU_HEIGHT > vh - margin && rect.top - MENU_HEIGHT - 4 > margin) {
      top = rect.top - MENU_HEIGHT - 4
    } else if (top + MENU_HEIGHT > vh - margin) {
      top = Math.max(margin, vh - MENU_HEIGHT - margin)
    }
    setPos({ top, left })
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
    window.addEventListener('scroll', onResize, true)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [open])

  const pickPdfs = () => { setOpen(false); onPdfs() }
  const pickExcel = () => { setOpen(false); onExcel() }

  const disabled = busy || count === 0

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="btn btn-primary text-sm inline-flex items-center gap-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? 'Downloading…' : `Download All (${count})`}
        {!busy && <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="z-[60] origin-top-right overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10 animate-pop-in"
        >
          <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Download all as
            </p>
          </div>
          <ul className="py-1">
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={pickPdfs}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700/60"
              >
                <FileArchive className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                <span className="flex-1">
                  <span className="block font-medium text-gray-900 dark:text-gray-100">PDFs (.zip)</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">One PDF per invoice, zipped</span>
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={pickExcel}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700/60"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="flex-1">
                  <span className="block font-medium text-gray-900 dark:text-gray-100">Excel (.xlsx)</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">Summary + Line Items sheets</span>
                </span>
              </button>
            </li>
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}

export default BulkDownloadMenu
