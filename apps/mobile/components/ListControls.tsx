// Shared date-range + sort controls for document lists — the mobile
// counterpart of desktop's list filter chips (all/7d/1m/1q/1y) and column
// sorting. One horizontal chip row: date window first, then sort order.
// Filtering/sorting happens in memory over the already-loaded rows via
// applyListControls, matching how every list screen works today.

import { ScrollView, StyleSheet, Pressable } from 'react-native'

import { ThemedText } from '@/components/themed-text'

export type DateRangeKey = 'all' | '7d' | '1m' | '3m' | '1y'
export type SortKey = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'

const RANGES: { key: DateRangeKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: '7d', label: '7D' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '1y', label: '1Y' },
]

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Newest' },
  { key: 'date_asc', label: 'Oldest' },
  { key: 'amount_desc', label: '₹ High' },
  { key: 'amount_asc', label: '₹ Low' },
]

// Start of the window (inclusive); null = no lower bound. Mirrors desktop's
// getDateRange day math.
export function rangeStart(key: DateRangeKey): Date | null {
  if (key === 'all') return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (key === '7d') start.setDate(start.getDate() - 6)
  else if (key === '1m') start.setDate(start.getDate() - 29)
  else if (key === '3m') start.setMonth(start.getMonth() - 3)
  else start.setDate(start.getDate() - 364)
  return start
}

export function applyListControls<T>(
  rows: T[],
  range: DateRangeKey,
  sort: SortKey,
  dateOf: (row: T) => Date | string | number,
  amountOf: (row: T) => number,
): T[] {
  const start = rangeStart(range)
  const windowed = start
    ? rows.filter((r) => new Date(dateOf(r)).getTime() >= start.getTime())
    : rows
  const sorted = [...windowed]
  sorted.sort((a, b) => {
    switch (sort) {
      case 'date_asc':
        return new Date(dateOf(a)).getTime() - new Date(dateOf(b)).getTime()
      case 'amount_desc':
        return amountOf(b) - amountOf(a)
      case 'amount_asc':
        return amountOf(a) - amountOf(b)
      default:
        return new Date(dateOf(b)).getTime() - new Date(dateOf(a)).getTime()
    }
  })
  return sorted
}

export function ListControls({
  range,
  onRange,
  sort,
  onSort,
}: {
  range: DateRangeKey
  onRange: (k: DateRangeKey) => void
  sort: SortKey
  onSort: (k: SortKey) => void
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.row}
      contentContainerStyle={styles.rowContent}
    >
      {RANGES.map((r) => (
        <Pressable
          key={r.key}
          onPress={() => onRange(r.key)}
          style={[styles.chip, range === r.key && styles.chipActive]}
        >
          <ThemedText style={range === r.key ? styles.chipTextActive : styles.chipText}>
            {r.label}
          </ThemedText>
        </Pressable>
      ))}
      <ThemedText style={styles.divider}>·</ThemedText>
      {SORTS.map((s) => (
        <Pressable
          key={s.key}
          onPress={() => onSort(s.key)}
          style={[styles.chip, sort === s.key && styles.chipActive]}
        >
          <ThemedText style={sort === s.key ? styles.chipTextActive : styles.chipText}>
            {s.label}
          </ThemedText>
        </Pressable>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexGrow: 0, marginBottom: 12 },
  rowContent: { alignItems: 'center', gap: 8, paddingRight: 8 },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  chipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  // lineHeight must shrink with fontSize: ThemedText's body ramp is 15/21, and
  // a 12px label inside a 21px line box makes the chip tall and the text sit
  // off-center — the "weird chip padding" was really leftover line height.
  chipText: { fontSize: 12, lineHeight: 16 },
  chipTextActive: { fontSize: 12, lineHeight: 16, color: 'white', fontWeight: '600' },
  divider: { opacity: 0.4, paddingHorizontal: 2 },
})
