import { asc, eq } from 'drizzle-orm'
import { router, useFocusEffect } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import { FlatList, type ListRenderItem, Pressable, StyleSheet, TextInput, View } from 'react-native'

import EmptyState from '@/components/EmptyState'
import Fab from '@/components/Fab'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'

type Supplier = typeof schema.supplier.$inferSelect

// Supplier balances are the mirror of customer balances. Positive = WE owe the
// supplier money (a payable → red "To Pay"); negative = they owe us, e.g. an
// advance we paid (green "To Collect"); zero = settled (grey).
function balanceColor(balance: number): string {
  if (balance > 0) return '#dc2626' // red-600
  if (balance < 0) return '#16a34a' // green-600
  return '#6b7280' // gray-500
}

function balanceWord(balance: number): string {
  if (balance > 0) return 'To Pay'
  if (balance < 0) return 'To Collect'
  return 'settled'
}

export default function SuppliersScreen() {
  const db = useDb()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    return db
      .select()
      .from(schema.supplier)
      .orderBy(asc(schema.supplier.name))
      .then(setSuppliers)
  }, [db])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const handleRestore = useCallback(
    (id: string) => {
      db.update(schema.supplier)
        .set({ deletedAt: null })
        .where(eq(schema.supplier.id, id))
        .then(load)
    },
    [db, load],
  )

  // The count chip shows live suppliers only — deleted ones stay visible in the
  // list (marked) but never count toward a number.
  const activeCount = useMemo(() => suppliers.filter((s) => !s.deletedAt).length, [suppliers])

  // Multi-field search (mirrors desktop): name, phone, email, GSTIN.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) =>
      `${s.name} ${s.phone ?? ''} ${s.email ?? ''} ${s.taxId ?? ''}`.toLowerCase().includes(q),
    )
  }, [suppliers, search])

  const renderItem = useCallback<ListRenderItem<Supplier>>(
    ({ item }) => (
      <SupplierRow supplier={item} deleted={!!item.deletedAt} onRestore={handleRestore} />
    ),
    [handleRestore],
  )
  const keyExtractor = useCallback((row: Supplier) => row.id, [])

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Suppliers</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}>
          <ThemedText style={styles.countText}>{activeCount}</ThemedText>
        </ThemedView>
      </View>

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search suppliers…"
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
            <EmptyState title="No matches" description={`No suppliers match "${search}"`} />
          ) : (
            <EmptyState
              title="No suppliers yet"
              description="Add suppliers to start recording purchase bills and what you owe them."
              action={{ label: 'Add Supplier', onPress: () => router.push('/supplier/newSupplier') }}
            />
          )
        }
        renderItem={renderItem}
      />

      <Fab onPress={() => router.push('/supplier/newSupplier')} label="Add supplier" />
    </ThemedView>
  )
}

const SupplierRow = memo(function SupplierRow({
  supplier,
  deleted,
  onRestore,
}: {
  supplier: Supplier
  deleted: boolean
  onRestore: (id: string) => void
}) {
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/supplier/[id]', params: { id: supplier.id } })
      }
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={[styles.card, deleted && styles.cardDeleted]}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {supplier.name}
          </ThemedText>
          <View style={styles.metaRow}>
            <ThemedText style={styles.metaText}>
              {supplier.phone || 'No phone'}
            </ThemedText>
            {supplier.taxId ? (
              <View style={styles.gstChip}>
                <ThemedText style={styles.gstChipText}>GSTIN</ThemedText>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.cardRight}>
          <ThemedText
            type="defaultSemiBold"
            style={{ color: balanceColor(supplier.currentBalance) }}
          >
            {formatCurrency(Math.abs(supplier.currentBalance))}
          </ThemedText>
          <ThemedText style={styles.muted}>{balanceWord(supplier.currentBalance)}</ThemedText>
          {deleted ? (
            <>
              <View style={styles.deletedBadge}>
                <ThemedText style={styles.deletedBadgeText}>Deleted</ThemedText>
              </View>
              <Pressable onPress={() => onRestore(supplier.id)} hitSlop={8} style={styles.restoreLink}>
                <ThemedText style={styles.restoreLinkText}>Restore</ThemedText>
              </Pressable>
            </>
          ) : (
            /* Nested Pressable: inner press wins, so tapping Edit navigates to
               edit without also triggering the card's tap-to-view. */
            <Pressable
              onPress={() =>
                router.push({ pathname: '/supplier/edit/[id]', params: { id: supplier.id } })
              }
              hitSlop={8}
              style={({ pressed }) => [styles.editChip, pressed && styles.editChipPressed]}
            >
              <ThemedText style={styles.editChipText}>Edit</ThemedText>
            </Pressable>
          )}
        </View>
      </ThemedView>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1 },
  countChip: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12 },
  countText: { fontSize: 12, fontWeight: '500', opacity: 0.7 },
  searchWrap: { borderRadius: 10, marginBottom: 12 },
  searchInput: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#111827' },
  listContent: { paddingBottom: 96 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    gap: 12,
  },
  cardDeleted: { opacity: 0.6 },
  cardPressed: { opacity: 0.7 },
  cardLeft: { flex: 1, gap: 4 },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaText: { fontSize: 12, opacity: 0.6 },
  gstChip: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gstChipText: { fontSize: 10, color: '#1e40af', fontWeight: '600' },
  muted: { fontSize: 11, opacity: 0.5 },
  editChip: { paddingHorizontal: 6, paddingVertical: 2 },
  editChipPressed: { opacity: 0.5 },
  editChipText: { fontSize: 12, fontWeight: '600', color: '#16a34a' },
  deletedBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#e5e7eb' },
  deletedBadgeText: { fontSize: 10, fontWeight: '600', color: '#6b7280' },
  restoreLink: { paddingVertical: 2 },
  restoreLinkText: { fontSize: 12, fontWeight: '600', color: '#007AFF' },
})
