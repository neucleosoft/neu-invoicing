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
import { formatDate } from '@/utils/date'

type PurchaseBill = typeof schema.purchaseBill.$inferSelect
type Supplier = typeof schema.supplier.$inferSelect

// Bill status reads from the payable side: a brand-new bill is "Unpaid".
const BILL_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT: { label: 'Unpaid', bg: '#fee2e2', text: '#991b1b' },
  PARTIAL: { label: 'Partial', bg: '#fef9c3', text: '#854d0e' },
  PAID: { label: 'Paid', bg: '#dcfce7', text: '#166534' },
}

export default function PurchaseBillsScreen() {
  const db = useDb()
  const [bills, setBills] = useState<PurchaseBill[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        db.select().from(schema.purchaseBill).orderBy(desc(schema.purchaseBill.billDate)),
        db.select().from(schema.supplier),
      ]).then(([b, s]) => {
        setBills(b)
        setSuppliers(s)
      })
    }, [db]),
  )

  const supplierName = useMemo(() => {
    const m = new Map(suppliers.map((s) => [s.id, s.name]))
    return (id: string) => m.get(id) ?? 'Unknown supplier'
  }, [suppliers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bills
    return bills.filter(
      (b) =>
        b.billNumber.toLowerCase().includes(q) ||
        supplierName(b.supplierId).toLowerCase().includes(q),
    )
  }, [bills, search, supplierName])

  const renderItem = useCallback<ListRenderItem<PurchaseBill>>(
    ({ item }) => <BillRow bill={item} supplierName={supplierName(item.supplierId)} />,
    [supplierName],
  )
  const keyExtractor = useCallback((row: PurchaseBill) => row.id, [])

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Purchase Bills</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}>
          <ThemedText style={styles.countText}>{bills.length}</ThemedText>
        </ThemedView>
      </View>

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by bill # or supplier…"
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
            <EmptyState title="No matches" description={`No bills match "${search}"`} />
          ) : (
            <EmptyState
              title="No purchase bills yet"
              description="Record what you buy from suppliers to track what you owe and top up stock."
              action={{ label: 'New Purchase Bill', onPress: () => router.push('/purchase/newPurchase') }}
            />
          )
        }
        renderItem={renderItem}
      />

      <Fab onPress={() => router.push('/purchase/newPurchase')} label="New purchase bill" />
    </ThemedView>
  )
}

const BillRow = memo(function BillRow({
  bill,
  supplierName,
}: {
  bill: PurchaseBill
  supplierName: string
}) {
  const badge = BILL_STATUS[bill.status] ?? BILL_STATUS.DRAFT
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/purchase/[id]', params: { id: bill.id } })
      }
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {bill.billNumber}
          </ThemedText>
          <ThemedText style={styles.metaText} numberOfLines={1}>
            {supplierName}
          </ThemedText>
          <ThemedText style={styles.dateText}>{formatDate(bill.billDate)}</ThemedText>
        </View>
        <View style={styles.cardRight}>
          <ThemedText type="defaultSemiBold">{formatCurrency(bill.totalAmount)}</ThemedText>
          <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
            <ThemedText style={[styles.statusBadgeText, { color: badge.text }]}>
              {badge.label}
            </ThemedText>
          </View>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/purchase/edit/[id]', params: { id: bill.id } })
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
  cardPressed: { opacity: 0.7 },
  cardLeft: { flex: 1, gap: 3 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  metaText: { fontSize: 12, opacity: 0.6 },
  dateText: { fontSize: 11, opacity: 0.5 },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: '600' },
  editChip: { paddingHorizontal: 6, paddingVertical: 2 },
  editChipPressed: { opacity: 0.5 },
  editChipText: { fontSize: 12, fontWeight: '600', color: '#16a34a' },
})
