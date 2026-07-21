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

type Note = typeof schema.creditDebitNote.$inferSelect
type Customer = typeof schema.customer.$inferSelect

type Filter = 'ALL' | 'CREDIT_NOTE' | 'DEBIT_NOTE'

// CREDIT_NOTE is shown green (it credits the customer / lowers their balance),
// DEBIT_NOTE red (it debits / raises their balance) — matches the payments hue.
const TYPE_BADGE: Record<string, { bg: string; text: string; short: string }> = {
  CREDIT_NOTE: { bg: '#dcfce7', text: '#166534', short: 'CN' },
  DEBIT_NOTE: { bg: '#fee2e2', text: '#991b1b', short: 'DN' },
}

export default function CreditNotesScreen() {
  const db = useDb()
  const [notes, setNotes] = useState<Note[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('ALL')
  const [range, setRange] = useState<DateRangeKey>('all')
  const [sort, setSort] = useState<SortKey>('date_desc')

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        db.select().from(schema.creditDebitNote).orderBy(desc(schema.creditDebitNote.noteDate)),
        db.select().from(schema.customer),
      ]).then(([n, c]) => {
        setNotes(n)
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
    const matches = notes.filter((x) => {
      if (filter !== 'ALL' && x.type !== filter) return false
      if (!q) return true
      return x.noteNumber.toLowerCase().includes(q) || customerName(x.customerId).toLowerCase().includes(q)
    })
    return applyListControls(matches, range, sort, (x) => x.noteDate, (x) => x.totalAmount)
  }, [notes, search, filter, customerName, range, sort])

  // Count chip shows live notes only — cancelled notes stay visible in the list
  // (marked) but never count toward a number.
  const activeCount = useMemo(() => notes.filter((n) => !n.cancelledAt).length, [notes])

  const renderItem = useCallback<ListRenderItem<Note>>(
    ({ item }) => <Row n={item} customerName={customerName(item.customerId)} cancelled={!!item.cancelledAt} />,
    [customerName],
  )

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Credit / Debit Notes</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}>
          <ThemedText style={styles.countText}>{activeCount}</ThemedText>
        </ThemedView>
      </View>

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search notes…" placeholderTextColor="#9ca3af" style={styles.searchInput} />
      </ThemedView>

      <View style={styles.filterRow}>
        {(['ALL', 'CREDIT_NOTE', 'DEBIT_NOTE'] as Filter[]).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterChip, filter === f && styles.filterChipActive]}>
            <ThemedText style={filter === f ? styles.filterChipTextActive : styles.filterChipText}>
              {f === 'ALL' ? 'ALL' : f === 'CREDIT_NOTE' ? 'CREDIT' : 'DEBIT'}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ListControls range={range} onRange={setRange} sort={sort} onSort={setSort} />

      <FlatList
        data={filtered}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          search ? (
            <EmptyState title="No matches" description={`No notes match "${search}"`} />
          ) : (
            <EmptyState title="No notes yet" description="Raise a credit or debit note to adjust a customer's balance." action={{ label: 'New Note', onPress: () => router.push('/creditNote/newCreditNote') }} />
          )
        }
        renderItem={renderItem}
      />

      <Fab onPress={() => router.push('/creditNote/newCreditNote')} label="New note" />
    </ThemedView>
  )
}

const Row = memo(function Row({ n, customerName, cancelled }: { n: Note; customerName: string; cancelled: boolean }) {
  const badge = TYPE_BADGE[n.type] ?? TYPE_BADGE.CREDIT_NOTE
  return (
    <Pressable onPress={() => router.push({ pathname: '/creditNote/[id]', params: { id: n.id } })} style={({ pressed }) => [pressed && styles.cardPressed]}>
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={[styles.card, cancelled && styles.cardCancelled]}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>{n.noteNumber}</ThemedText>
          <ThemedText style={styles.metaText} numberOfLines={1}>{customerName}</ThemedText>
          <ThemedText style={styles.dateText}>{formatDate(n.noteDate)}</ThemedText>
        </View>
        <View style={styles.cardRight}>
          <ThemedText type="defaultSemiBold">{formatCurrency(n.totalAmount)}</ThemedText>
          {cancelled ? (
            <View style={styles.cancelledBadge}>
              <ThemedText style={styles.cancelledBadgeText}>Cancelled</ThemedText>
            </View>
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <ThemedText style={[styles.statusBadgeText, { color: badge.text }]}>{badge.short}</ThemedText>
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
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#e5e7eb' },
  filterChipActive: { backgroundColor: '#007AFF' },
  filterChipText: { fontSize: 13, color: '#374151' },
  filterChipTextActive: { fontSize: 13, color: 'white', fontWeight: '600' },
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
