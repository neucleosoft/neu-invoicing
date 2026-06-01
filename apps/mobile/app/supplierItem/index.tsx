import { asc } from 'drizzle-orm'
import { router, useFocusEffect } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import {
  FlatList,
  type ListRenderItem,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'

import EmptyState from '@/components/EmptyState'
import Fab from '@/components/Fab'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'

type SupplierItem = typeof schema.supplierItem.$inferSelect
type Supplier = typeof schema.supplier.$inferSelect
type Item = typeof schema.item.$inferSelect

export default function SupplierItemsScreen() {
  const db = useDb()
  const [rows, setRows] = useState<SupplierItem[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [search, setSearch] = useState('')
  // 'ALL' shows every supplier's items; otherwise filter to one supplier's catalog.
  const [supplierFilter, setSupplierFilter] = useState<string>('ALL')
  const [showFilter, setShowFilter] = useState(false)

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        db.select().from(schema.supplierItem).orderBy(asc(schema.supplierItem.name)),
        db.select().from(schema.supplier).orderBy(asc(schema.supplier.name)),
        db.select().from(schema.item),
      ]).then(([si, sup, it]) => {
        setRows(si)
        setSuppliers(sup)
        setItems(it)
      })
    }, [db]),
  )

  // Lookup maps so each row can show its supplier's name and (if linked) the
  // sellable item it feeds stock into, without an N+1 query per row.
  const supplierName = useMemo(() => {
    const m = new Map(suppliers.map((s) => [s.id, s.name]))
    return (id: string) => m.get(id) ?? '—'
  }, [suppliers])

  const linkedName = useMemo(() => {
    const m = new Map(items.map((i) => [i.id, i.name]))
    return (id: string | null) => (id ? m.get(id) ?? null : null)
  }, [items])

  const filtered = useMemo(() => {
    let list = rows
    if (supplierFilter !== 'ALL') {
      list = list.filter((r) => r.supplierId === supplierFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          supplierName(r.supplierId).toLowerCase().includes(q) ||
          (r.hsnCode ?? '').toLowerCase().includes(q) ||
          (linkedName(r.linkedItemId) ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [rows, supplierFilter, search, supplierName, linkedName])

  const renderItem = useCallback<ListRenderItem<SupplierItem>>(
    ({ item }) => (
      <SupplierItemRow
        row={item}
        supplierName={supplierName(item.supplierId)}
        linkedName={linkedName(item.linkedItemId)}
      />
    ),
    [supplierName, linkedName],
  )
  const keyExtractor = useCallback((row: SupplierItem) => row.id, [])

  const filterLabel =
    supplierFilter === 'ALL' ? 'All suppliers' : supplierName(supplierFilter)

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Supplier Items</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}>
          <ThemedText style={styles.countText}>{rows.length}</ThemedText>
        </ThemedView>
      </View>

      <View style={styles.filterRow}>
        <Pressable
          style={styles.filterPill}
          onPress={() => setShowFilter(true)}
        >
          <ThemedText style={styles.filterPillText} numberOfLines={1}>
            {filterLabel} ▾
          </ThemedText>
        </Pressable>
      </View>

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, supplier, HSN…"
          placeholderTextColor="#9ca3af"
          style={styles.searchInput}
        />
      </ThemedView>

      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          search || supplierFilter !== 'ALL' ? (
            <EmptyState title="No matches" description="No supplier items match your filters." />
          ) : (
            <EmptyState
              title="No supplier items yet"
              description="A supplier item is one product, from one supplier, at their price. Add one, or they'll appear automatically when you scan bills later."
              action={{ label: 'Add Supplier Item', onPress: () => router.push('/supplierItem/newSupplierItem') }}
            />
          )
        }
        renderItem={renderItem}
      />

      <Fab onPress={() => router.push('/supplierItem/newSupplierItem')} label="Add supplier item" />

      <Modal visible={showFilter} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Filter by supplier
            </ThemedText>
            <FlatList
              data={[{ id: 'ALL', name: 'All suppliers' }, ...suppliers]}
              keyExtractor={(s) => s.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setSupplierFilter(item.id)
                    setShowFilter(false)
                  }}
                >
                  <ThemedText type={item.id === supplierFilter ? 'defaultSemiBold' : undefined}>
                    {item.id === supplierFilter ? `✓ ${item.name}` : item.name}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowFilter(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  )
}

const SupplierItemRow = memo(function SupplierItemRow({
  row,
  supplierName,
  linkedName,
}: {
  row: SupplierItem
  supplierName: string
  linkedName: string | null
}) {
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/supplierItem/edit/[id]', params: { id: row.id } })
      }
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {row.name}
          </ThemedText>
          <ThemedText style={styles.supplierText} numberOfLines={1}>
            {supplierName}
          </ThemedText>
          <View style={styles.metaRow}>
            <ThemedText style={styles.metaText}>{row.hsnCode || 'No HSN'}</ThemedText>
            <View style={styles.gstChip}>
              <ThemedText style={styles.gstChipText}>{row.defaultTaxRate}% GST</ThemedText>
            </View>
            {linkedName ? (
              <View style={styles.linkChip}>
                <ThemedText style={styles.linkChipText}>↔ {linkedName}</ThemedText>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.cardRight}>
          <ThemedText type="defaultSemiBold">{formatCurrency(row.lastPurchasePrice)}</ThemedText>
          <ThemedText style={styles.unitText}>per {row.unit}</ThemedText>
        </View>
      </ThemedView>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1 },
  countChip: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12 },
  countText: { fontSize: 12, fontWeight: '500', opacity: 0.7 },
  filterRow: { flexDirection: 'row', marginBottom: 10 },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    maxWidth: '70%',
  },
  filterPillText: { color: '#007AFF', fontSize: 13, fontWeight: '600' },
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
  cardPressed: { opacity: 0.7 },
  cardLeft: { flex: 1, gap: 3 },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  supplierText: { fontSize: 12, opacity: 0.6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaText: { fontSize: 12, opacity: 0.6 },
  gstChip: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gstChipText: { fontSize: 10, color: '#1e40af', fontWeight: '600' },
  linkChip: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  linkChipText: { fontSize: 10, color: '#166534', fontWeight: '600' },
  unitText: { fontSize: 12, opacity: 0.6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { maxHeight: '80%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  modalTitle: { marginBottom: 12 },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  modalClose: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  modalCloseText: { color: '#FF3B30', fontSize: 16 },
})
