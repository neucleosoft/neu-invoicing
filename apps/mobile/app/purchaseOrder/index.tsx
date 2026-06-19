import { desc, eq } from 'drizzle-orm'
import { router, useFocusEffect } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import { FlatList, type ListRenderItem, Pressable, StyleSheet, TextInput, View } from 'react-native'

import EmptyState from '@/components/EmptyState'
import Fab from '@/components/Fab'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { restorePurchaseOrder } from '@/utils/poSave'

type PurchaseOrder = typeof schema.purchaseOrder.$inferSelect
type Supplier = typeof schema.supplier.$inferSelect

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: '#e5e7eb', text: '#374151' },
  PARTIALLY_RECEIVED: { bg: '#fef9c3', text: '#854d0e' },
  RECEIVED: { bg: '#dcfce7', text: '#166534' },
  CLOSED: { bg: '#dbeafe', text: '#1e40af' },
  CANCELLED: { bg: '#fee2e2', text: '#991b1b' },
}

export default function PurchaseOrdersScreen() {
  const db = useDb()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    return Promise.all([
      db.select().from(schema.purchaseOrder).orderBy(desc(schema.purchaseOrder.orderDate)),
      db.select().from(schema.supplier),
    ]).then(([o, s]) => { setOrders(o); setSuppliers(s) })
  }, [db])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const handleRestore = useCallback(
    (id: string) => {
      restorePurchaseOrder(db, id).then(load)
    },
    [db, load],
  )

  // The count chip shows live orders only — deleted ones stay visible in the
  // list (marked) but never count toward a number.
  const activeCount = useMemo(() => orders.filter((o) => !o.deletedAt).length, [orders])

  const supplierName = useMemo(() => {
    const m = new Map(suppliers.map((s) => [s.id, s.name]))
    return (id: string) => m.get(id) ?? 'Unknown'
  }, [suppliers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orders
    return orders.filter((o) => o.orderNumber.toLowerCase().includes(q) || supplierName(o.supplierId).toLowerCase().includes(q))
  }, [orders, search, supplierName])

  const renderItem = useCallback<ListRenderItem<PurchaseOrder>>(
    ({ item }) => (
      <Row
        o={item}
        supplierName={supplierName(item.supplierId)}
        deleted={!!item.deletedAt}
        onRestore={handleRestore}
      />
    ),
    [supplierName, handleRestore],
  )

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}><ThemedText style={styles.headerArrow}>←</ThemedText></Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Purchase Orders</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}><ThemedText style={styles.countText}>{activeCount}</ThemedText></ThemedView>
      </View>
      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search by PO # or supplier…" placeholderTextColor="#9ca3af" style={styles.searchInput} />
      </ThemedView>
      <FlatList
        data={filtered}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={search ? <EmptyState title="No matches" description={`No orders match "${search}"`} /> : <EmptyState title="No purchase orders yet" description="Issue an order to a supplier; convert it to a bill when goods arrive." action={{ label: 'New Purchase Order', onPress: () => router.push('/purchaseOrder/newPurchaseOrder') }} />}
        renderItem={renderItem}
      />
      <Fab onPress={() => router.push('/purchaseOrder/newPurchaseOrder')} label="New purchase order" />
    </ThemedView>
  )
}

const Row = memo(function Row({
  o,
  supplierName,
  deleted,
  onRestore,
}: {
  o: PurchaseOrder
  supplierName: string
  deleted: boolean
  onRestore: (id: string) => void
}) {
  const badge = STATUS_COLORS[o.status] ?? STATUS_COLORS.DRAFT
  return (
    <Pressable onPress={() => router.push({ pathname: '/purchaseOrder/[id]', params: { id: o.id } })} style={({ pressed }) => [pressed && styles.cardPressed]}>
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={[styles.card, deleted && styles.cardDeleted]}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>{o.orderNumber}</ThemedText>
          <ThemedText style={styles.metaText} numberOfLines={1}>{supplierName}</ThemedText>
          <ThemedText style={styles.dateText}>{formatDate(o.orderDate)}</ThemedText>
        </View>
        <View style={styles.cardRight}>
          <ThemedText type="defaultSemiBold">{formatCurrency(o.totalAmount)}</ThemedText>
          {deleted ? (
            <>
              <View style={styles.deletedBadge}>
                <ThemedText style={styles.deletedBadgeText}>Deleted</ThemedText>
              </View>
              <Pressable onPress={() => onRestore(o.id)} hitSlop={8} style={styles.restoreLink}>
                <ThemedText style={styles.restoreLinkText}>Restore</ThemedText>
              </Pressable>
            </>
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}><ThemedText style={[styles.statusBadgeText, { color: badge.text }]}>{o.status.replace('_', ' ')}</ThemedText></View>
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
  card: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 10, gap: 12 },
  cardDeleted: { opacity: 0.6 },
  cardPressed: { opacity: 0.7 },
  cardLeft: { flex: 1, gap: 3 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  metaText: { fontSize: 12, opacity: 0.6 },
  dateText: { fontSize: 11, opacity: 0.5 },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: '600' },
  deletedBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#e5e7eb' },
  deletedBadgeText: { fontSize: 10, fontWeight: '600', color: '#6b7280' },
  restoreLink: { paddingVertical: 2 },
  restoreLinkText: { fontSize: 12, fontWeight: '600', color: '#007AFF' },
})
