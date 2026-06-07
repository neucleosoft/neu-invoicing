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

type Proforma = typeof schema.proformaInvoice.$inferSelect
type Customer = typeof schema.customer.$inferSelect

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: '#e5e7eb', text: '#374151' },
  SENT: { bg: '#dbeafe', text: '#1e40af' },
  ACCEPTED: { bg: '#dcfce7', text: '#166534' },
  REJECTED: { bg: '#fee2e2', text: '#991b1b' },
  EXPIRED: { bg: '#fef9c3', text: '#854d0e' },
}

export default function ProformaScreen() {
  const db = useDb()
  const [docs, setDocs] = useState<Proforma[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        db.select().from(schema.proformaInvoice).orderBy(desc(schema.proformaInvoice.invoiceDate)),
        db.select().from(schema.customer),
      ]).then(([d, c]) => { setDocs(d); setCustomers(c) })
    }, [db]),
  )

  const customerName = useMemo(() => {
    const m = new Map(customers.map((c) => [c.id, c.name]))
    return (id: string) => m.get(id) ?? 'Unknown'
  }, [customers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return docs
    return docs.filter((x) => x.invoiceNumber.toLowerCase().includes(q) || customerName(x.customerId).toLowerCase().includes(q))
  }, [docs, search, customerName])

  const renderItem = useCallback<ListRenderItem<Proforma>>(({ item }) => <Row d={item} customerName={customerName(item.customerId)} />, [customerName])

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}><ThemedText style={styles.headerArrow}>←</ThemedText></Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Proforma</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}><ThemedText style={styles.countText}>{docs.length}</ThemedText></ThemedView>
      </View>
      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search proforma…" placeholderTextColor="#9ca3af" style={styles.searchInput} />
      </ThemedView>
      <FlatList
        data={filtered}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={search ? <EmptyState title="No matches" description={`No proforma match "${search}"`} /> : <EmptyState title="No proforma yet" description="Create a provisional invoice you can later convert." action={{ label: 'New Proforma', onPress: () => router.push('/proforma/newProforma') }} />}
        renderItem={renderItem}
      />
      <Fab onPress={() => router.push('/proforma/newProforma')} label="New proforma" />
    </ThemedView>
  )
}

const Row = memo(function Row({ d, customerName }: { d: Proforma; customerName: string }) {
  const badge = STATUS_COLORS[d.status] ?? STATUS_COLORS.DRAFT
  return (
    <Pressable onPress={() => router.push({ pathname: '/proforma/[id]', params: { id: d.id } })} style={({ pressed }) => [pressed && styles.cardPressed]}>
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>{d.invoiceNumber}</ThemedText>
          <ThemedText style={styles.metaText} numberOfLines={1}>{customerName}</ThemedText>
          <ThemedText style={styles.dateText}>{formatDate(d.invoiceDate)}</ThemedText>
        </View>
        <View style={styles.cardRight}>
          <ThemedText type="defaultSemiBold">{formatCurrency(d.totalAmount)}</ThemedText>
          <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}><ThemedText style={[styles.statusBadgeText, { color: badge.text }]}>{d.status}</ThemedText></View>
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
})
