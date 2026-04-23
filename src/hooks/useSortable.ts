import { useState, useMemo } from 'react'

type SortDir = 'asc' | 'desc' | null

export interface SortableColumn<T> {
  key: string
  accessor: (row: T) => string | number | null | undefined
}

export function useSortable<T>(items: T[], columns: SortableColumn<T>[]) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortKey(null)
      setSortDir(null)
    }
  }

  const sortedItems = useMemo(() => {
    if (!sortKey || !sortDir) return items
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return items
    const dir = sortDir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => {
      const av = col.accessor(a)
      const bv = col.accessor(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [items, sortKey, sortDir, columns])

  return { sortedItems, sortKey, sortDir, toggleSort }
}
