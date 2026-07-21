// Search-on-top list for picker modals — a drop-in FlatList replacement.
// renderItem / keyExtractor / ListEmptyComponent pass through untouched; this
// only adds the search box and filters rows through the SHARED matching brain
// (packages/shared/src/pickerSearch.ts) — the same code desktop's
// SearchableSelect runs, so "raj cem" finds "Rajshree Cement" identically on
// both platforms. The box only appears once the list is long enough to need
// it, so short pickers (status, payment mode) stay clean.

import { useMemo, useState } from 'react'
import { FlatList, StyleSheet, TextInput, View, type FlatListProps } from 'react-native'
import { filterPickerOptions } from '@neu/shared'

import { ThemedText } from '@/components/themed-text'
import { useColors } from '@/hooks/use-colors'

type Props<T> = {
  data: T[]
  /** Primary text to match against (gets the prefix-ranking boost). */
  getName: (row: T) => string
  /** Extra searchable fields: phone, HSN, code… (nulls fine). */
  getExtra?: (row: T) => (string | null | undefined)[]
  /** Search box appears only when the list has more rows than this. */
  searchThreshold?: number
  searchPlaceholder?: string
} & Pick<FlatListProps<T>, 'renderItem' | 'keyExtractor' | 'ListEmptyComponent'>

export function PickerSearchList<T>({
  data,
  getName,
  getExtra,
  searchThreshold = 8,
  searchPlaceholder = 'Search…',
  renderItem,
  keyExtractor,
  ListEmptyComponent,
}: Props<T>) {
  const c = useColors()
  const [query, setQuery] = useState('')
  const searchable = data.length > searchThreshold
  const trimmed = query.trim()

  const filtered = useMemo(() => {
    if (!searchable || !trimmed) return data
    return filterPickerOptions(
      data.map((row) => ({ name: getName(row), extra: getExtra?.(row), row })),
      trimmed,
    ).map((x) => x.row)
    // getName/getExtra are inline arrows at call sites — identity changes are
    // fine, the filter is cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, trimmed, searchable])

  return (
    <View style={styles.wrap}>
      {searchable && (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          placeholderTextColor={c.muted}
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.search, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]}
        />
      )}
      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          trimmed ? (
            <ThemedText style={styles.noMatch}>No matches for “{trimmed}”</ThemedText>
          ) : (
            ListEmptyComponent
          )
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 1 },
  search: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    marginBottom: 8,
  },
  noMatch: { textAlign: 'center', paddingVertical: 24, opacity: 0.6 },
})
