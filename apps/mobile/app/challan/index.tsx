import { desc } from 'drizzle-orm'
import { router, useFocusEffect } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import { FlatList, type ListRenderItem, Pressable, StyleSheet, TextInput, View } from 'react-native'

import EmptyState from '@/components/EmptyState'
import {
  applyListControls,
  ListControls,
  type DateRangeKey,
  type SortKey,
} from '@/components/ListControls'
import Fab from '@/components/Fab'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'

type Challan = typeof schema.deliveryChallan.$inferSelect
type Customer = typeof schema.customer.$inferSelect

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  RETURNABLE: { bg: '#fef3c7', text: '#92400e' },
  NON_RETURNABLE: { bg: '#dbeafe', text: '#1e40af' },
  CONVERTED: { bg: '#dcfce7', text: '#166534' },
}

export default function ChallansScreen() {
  const db = useDb()
  const [challans, setChallans] = useState<Challan[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<DateRangeKey>('all')
  const [sort, setSort] = useState<SortKey>('date_desc')

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        db.select().from(schema.deliveryChallan).orderBy(desc(schema.deliveryChallan.challanDate)),
        db.select().from(schema.customer),
      ]).then(([dc, c]) => {
        setChallans(dc)
        setCustomers(c)
      })
    }, [db]),
  )

  const customerName = useMemo(() => {
    const m = new Map(customers.map((c) => [c.id, c.name]))
    return (id: string) => m.get(id) ?? 'Unknown'
  }, [customers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = q
      ? challans.filter(
          (x) => x.challanNumber.toLowerCase().includes(q) || customerName(x.customerId).toLowerCase().includes(q),
        )
      : challans
    return applyListControls(matches, range, sort, (x) => x.challanDate, (x) => x.totalAmount)
  }, [challans, search, customerName, range, sort])

  const activeCount = useMemo(() => challans.filter((c) => !c.cancelledAt).length, [challans])

  const renderItem = useCallback<ListRenderItem<Challan>>(
    ({ item }) => <Row dc={item} customerName={customerName(item.customerId)} cancelled={!!item.cancelledAt} />,
    [customerName],
  )

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Delivery Challans</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}>
          <ThemedText style={styles.countText}>{activeCount}</ThemedText>
        </ThemedView>
      </View>

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search challans…" placeholderTextColor="#9ca3af" style={styles.searchInput} />
      </ThemedView>

      <ListControls range={range} onRange={setRange} sort={sort} onSort={setSort} />

      <FlatList
        data={filtered}
        keyExtractor={(dc) => dc.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          search ? (
            <EmptyState title="No matches" description={`No challans match "${search}"`} />
          ) : (
            <EmptyState title="No challans yet" description="Create a delivery note for goods you've dispatched." action={{ label: 'New Challan', onPress: () => router.push('/challan/newChallan') }} />
          )
        }
        renderItem={renderItem}
      />

      <Fab onPress={() => router.push('/challan/newChallan')} label="New challan" />
    </ThemedView>
  )
}

const Row = memo(function Row({ dc, customerName, cancelled }: { dc: Challan; customerName: string; cancelled: boolean }) {
  const badge = STATUS_COLORS[dc.status] ?? STATUS_COLORS.NON_RETURNABLE
  return (
    <Pressable onPress={() => router.push({ pathname: '/challan/[id]', params: { id: dc.id } })} style={({ pressed }) => [pressed && styles.cardPressed]}>
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={[styles.card, cancelled && styles.cardCancelled]}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>{dc.challanNumber}</ThemedText>
          <ThemedText style={styles.metaText} numberOfLines={1}>{customerName}</ThemedText>
          <ThemedText style={styles.dateText}>{formatDate(dc.challanDate)}</ThemedText>
        </View>
        <View style={styles.cardRight}>
          <ThemedText type="defaultSemiBold">{formatCurrency(dc.totalAmount)}</ThemedText>
          {cancelled ? (
            <View style={styles.cancelledBadge}>
              <ThemedText style={styles.cancelledBadgeText}>Cancelled</ThemedText>
            </View>
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <ThemedText style={[styles.statusBadgeText, { color: badge.text }]}>{dc.status}</ThemedText>
            </View>
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
  cardPressed: { opacity: 0.7 },
  cardLeft: { flex: 1, gap: 3 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  metaText: { fontSize: 12, opacity: 0.6 },
  dateText: { fontSize: 11, opacity: 0.5 },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: '600' },
  cardCancelled: { opacity: 0.6 },
  cancelledBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#e5e7eb' },
  cancelledBadgeText: { fontSize: 10, fontWeight: '600', color: '#6b7280' },
})
