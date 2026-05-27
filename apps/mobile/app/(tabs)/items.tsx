import { desc } from 'drizzle-orm'
import { router, useFocusEffect } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import { FlatList, type ListRenderItem, Pressable, StyleSheet, TextInput, View } from 'react-native'

import EmptyState from '@/components/EmptyState'
import Fab from '@/components/Fab'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'

type Item = typeof schema.item.$inferSelect

export default function ItemsScreen() {
  const db = useDb()
  const [items, setItems] = useState<Item[]>([])
  const [search, setSearch] = useState('')

  // Re-fetch every time the tab regains focus, e.g. after returning from /item/newItem.
  useFocusEffect(
    useCallback(() => {
      db.select()
        .from(schema.item)
        .orderBy(desc(schema.item.updatedAt))
        .then(setItems)
    }, [db]),
  )

  // Client-side filter by name (case-insensitive). At 161 rows this is
  // instantaneous; the boundary at which SQL beats memory is ~5k rows.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => it.name.toLowerCase().includes(q))
  }, [items, search])

  // Stable identities for FlatList's optimization — without these, every
  // keystroke in the search box would mark all rows as "renderItem changed"
  // and re-render the entire list.
  const renderItem = useCallback<ListRenderItem<Item>>(
    ({ item }) => <ItemRow item={item} />,
    [],
  )
  const keyExtractor = useCallback((row: Item) => row.id, [])

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Items</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}>
          <ThemedText style={styles.countText}>{items.length}</ThemedText>
        </ThemedView>
      </View>

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search items…"
          placeholderTextColor="#9ca3af"
          style={styles.searchInput}
        />
      </ThemedView>

      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          search ? (
            <EmptyState title="No matches" description={`No items match "${search}"`} />
          ) : (
            <EmptyState
              title="No items yet"
              description="Add your first product or service to start invoicing."
              action={{ label: 'Add Item', onPress: () => router.push('/item/newItem') }}
            />
          )
        }
        renderItem={renderItem}
      />

      <Fab onPress={() => router.push('/item/newItem')} label="Add item" />
    </ThemedView>
  )
}

// React.memo so rows don't re-render when the parent's search/state changes.
// Comparison is the default shallow check on `item`, which is fine because
// Drizzle returns new row objects only when the underlying data actually changed.
const ItemRow = memo(function ItemRow({ item }: { item: Item }) {
  const isLowStock =
    item.trackStock && item.currentStock < item.lowStockWarning

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/item/[id]', params: { id: item.id } })
      }
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {item.name}
          </ThemedText>
          <View style={styles.metaRow}>
            <ThemedText style={styles.metaText}>
              {item.hsnCode || 'No HSN'}
            </ThemedText>
            <View style={styles.gstChip}>
              <ThemedText style={styles.gstChipText}>
                {item.taxRate}% GST
              </ThemedText>
            </View>
            {isLowStock ? (
              <View style={styles.lowStockChip}>
                <ThemedText style={styles.lowStockChipText}>Low stock</ThemedText>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.cardRight}>
          <ThemedText type="defaultSemiBold">{formatCurrency(item.salePrice)}</ThemedText>
          <ThemedText style={styles.unitText}>per {item.unit}</ThemedText>
          {/* Nested Pressable: inner press wins, so tapping Edit navigates to
              edit without also triggering the card's tap-to-view. */}
          <Pressable
            onPress={() =>
              router.push({ pathname: '/item/edit/[id]', params: { id: item.id } })
            }
            hitSlop={8}
            style={({ pressed }) => [styles.editChip, pressed && styles.editChipPressed]}
          >
            <ThemedText style={styles.editChipText}>Edit</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  countChip: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12,
  },
  countText: { fontSize: 12, fontWeight: '500', opacity: 0.7 },
  searchWrap: {
    borderRadius: 10,
    marginBottom: 12,
  },
  searchInput: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  // 96px bottom padding leaves room for the FAB so the last row isn't
  // covered by it when the list is scrolled to the end.
  listContent: { paddingBottom: 96 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    gap: 12,
  },
  cardPressed: { opacity: 0.7 },
  cardLeft: { flex: 1, gap: 4 },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaText: { fontSize: 12, opacity: 0.6 },
  gstChip: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gstChipText: { fontSize: 10, color: '#1e40af', fontWeight: '600' },
  lowStockChip: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  lowStockChipText: { fontSize: 10, color: '#991b1b', fontWeight: '600' },
  unitText: { fontSize: 12, opacity: 0.6 },
  editChip: { paddingHorizontal: 6, paddingVertical: 2 },
  editChipPressed: { opacity: 0.5 },
  editChipText: { fontSize: 12, fontWeight: '600', color: '#16a34a' },
})
