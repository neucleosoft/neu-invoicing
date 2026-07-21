import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search as SearchIcon, ChevronDown, Check, X } from 'lucide-react'
import { filterPickerOptions } from '@neu/shared'

export type SearchableOption = {
  id: string
  name: string
  /** Optional second line shown under the name (e.g. phone or email). */
  subtitle?: string
}

type Props = {
  value: string
  onChange: (id: string) => void
  options: SearchableOption[]
  placeholder?: string
  required?: boolean
  disabled?: boolean
  emptyMessage?: string
}

const DROPDOWN_GAP = 4
const DROPDOWN_MAX_HEIGHT = 320
const DROPDOWN_MIN_HEIGHT = 120

type DropdownLayout = {
  top: number
  left: number
  width: number
  maxHeight: number
}

const SearchableSelect = ({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  required,
  disabled,
  emptyMessage = 'No matches',
}: Props) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [dropdownLayout, setDropdownLayout] = useState<DropdownLayout | null>(null)

  const selected = useMemo(() => options.find((o) => o.id === value), [options, value])

  // The SHARED matching/ranking brain (packages/shared/src/pickerSearch.ts) —
  // the same code mobile's picker modal runs, so both apps find and rank
  // "raj cem" → "Rajshree Cement" identically.
  const filtered = useMemo(
    () => filterPickerOptions(options.map((o) => ({ ...o, extra: [o.subtitle] })), query),
    [options, query],
  )

  // Reset highlight when filter list changes
  useEffect(() => {
    setHighlighted(0)
  }, [query, open])

  // Focus search input when opening
  useEffect(() => {
    if (open) {
      // Defer focus to next tick so the input is mounted.
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery('')
      setDropdownLayout(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const updateDropdownLayout = () => {
      if (!wrapRef.current) return

      const rect = wrapRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - 8)
      const spaceAbove = Math.max(0, rect.top - 8)
      const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow
      const availableSpace = placeAbove ? spaceAbove : spaceBelow
      const maxHeight = Math.max(
        DROPDOWN_MIN_HEIGHT,
        Math.min(DROPDOWN_MAX_HEIGHT, availableSpace)
      )
      const width = Math.min(rect.width, viewportWidth - 16)
      const left = Math.min(Math.max(8, rect.left), viewportWidth - width - 8)
      const top = placeAbove
        ? Math.max(8, rect.top - maxHeight - DROPDOWN_GAP)
        : Math.min(viewportHeight - maxHeight - 8, rect.bottom + DROPDOWN_GAP)

      setDropdownLayout({ top, left, width, maxHeight })
    }

    updateDropdownLayout()
    window.addEventListener('resize', updateDropdownLayout)
    window.addEventListener('scroll', updateDropdownLayout, true)

    return () => {
      window.removeEventListener('resize', updateDropdownLayout)
      window.removeEventListener('scroll', updateDropdownLayout, true)
    }
  }, [open])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      const clickedTrigger = wrapRef.current?.contains(target)
      const clickedPanel = panelRef.current?.contains(target)
      if (!clickedTrigger && !clickedPanel) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Scroll highlighted option into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted, open])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[highlighted]
      if (opt) pick(opt.id)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      {/* Hidden input keeps native required validation working */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value}
          onChange={() => {}}
          className="pointer-events-none absolute left-0 top-1/2 h-0 w-0 -translate-y-1/2 opacity-0"
        />
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={
            selected
              ? 'truncate text-gray-900 dark:text-gray-100'
              : 'truncate text-gray-400 dark:text-gray-500'
          }
        >
          {selected ? selected.name : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && dropdownLayout && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[80] overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 dark:border-gray-700 dark:bg-gray-800 dark:ring-white/5"
          style={{
            top: dropdownLayout.top,
            left: dropdownLayout.left,
            width: dropdownLayout.width,
          }}
        >
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-700">
            <SearchIcon className="h-4 w-4 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search…"
              className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none dark:text-gray-100 dark:placeholder-gray-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {emptyMessage}
            </div>
          ) : (
            <ul
              ref={listRef}
              role="listbox"
              className="overflow-y-auto py-1"
              style={{ maxHeight: Math.max(72, dropdownLayout.maxHeight - 44) }}
            >
              {filtered.map((opt, idx) => {
                const isSelected = opt.id === value
                const isHighlighted = idx === highlighted
                return (
                  <li
                    key={opt.id}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlighted(idx)}
                    onClick={() => pick(opt.id)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                      isHighlighted
                        ? 'bg-primary-50 dark:bg-primary-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <Check
                      className={`h-4 w-4 shrink-0 ${
                        isSelected ? 'text-primary-600 dark:text-primary-400' : 'text-transparent'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-gray-900 dark:text-gray-100">{opt.name}</div>
                      {opt.subtitle && (
                        <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {opt.subtitle}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

export default SearchableSelect
