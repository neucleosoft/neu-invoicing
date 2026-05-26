import { desc, eq } from 'drizzle-orm'
import { router, useFocusEffect } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import {
  FlatList,
  type ListRenderItem,
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
import { formatDate } from '@/utils/date'
import {
  deriveDisplayStatus,
  formatInvoiceStatus,
  STATUS_BADGE_COLORS,
} from '@/utils/invoiceStatus'

type Invoice = typeof schema.salesInvoice.$inferSelect
type Row = Invoice & { customerName: string | null }

export default function InvoicesScreen() {
  const db = useDb()
  const [rows, setRows] = useState<Row[]>([])
  const [search, setSearch] = useState('')

  useFocusEffect(
    useCallback(() => {
      db.select({
        invoice: schema.salesInvoice,
        customerName: schema.customer.name,
      })
        .from(schema.salesInvoice)
        .leftJoin(
          schema.customer,
          eq(schema.salesInvoice.customerId, schema.customer.id),
        )
        .orderBy(desc(schema.salesInvoice.invoiceDate))
        .then((result) => {
          setRows(
            result.map((r) => ({ ...r.invoice, customerName: r.customerName })),
          )
        })
    }, [db]),
  )

  // Search matches invoice number OR customer name (both fields useful when
  // scanning — a bookkeeper might know "Sharma Trading" but not the invoice #,
  // or vice versa).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const hay = `${r.invoiceNumber} ${r.customerName ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, search])

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item }) => <InvoiceRow row={item} />,
    [],
  )
  const keyExtractor = useCallback((row: Row) => row.id, [])

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Invoices</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}>
          <ThemedText style={styles.countText}>{rows.length}</ThemedText>
        </ThemedView>
      </View>

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by invoice # or customer…"
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
            <EmptyState
              title="No matches"
              description={`No invoices match "${search}"`}
            />
          ) : (
            <EmptyState
              title="No invoices yet"
              description="Create your first invoice to start billing customers."
              action={{
                label: 'New Invoice',
                onPress: () => router.push('/invoice/new'),
              }}
            />
          )
        }
        renderItem={renderItem}
      />

      <Fab onPress={() => router.push('/invoice/new')} label="New invoice" />
    </ThemedView>
  )
}

const InvoiceRow = memo(function InvoiceRow({ row }: { row: Row }) {
  // OVERDUE is computed at render time, not stored — so the pill stays correct
  // without a nightly status-bump job.
  const displayStatus = deriveDisplayStatus(
    row.status,
    row.dueDate,
    row.amountPaid,
    row.totalAmount,
  )
  const badge = STATUS_BADGE_COLORS[displayStatus] ?? STATUS_BADGE_COLORS.DRAFT

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/invoice/[id]', params: { id: row.id } })
      }
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {row.invoiceNumber}
          </ThemedText>
          <ThemedText numberOfLines={1} style={styles.customerName}>
            {row.customerName ?? 'Unknown customer'}
          </ThemedText>
          <ThemedText style={styles.dateText}>
            {formatDate(row.invoiceDate)}
          </ThemedText>
        </View>
        <View style={styles.cardRight}>
          <ThemedText type="defaultSemiBold">
            {formatCurrency(row.totalAmount)}
          </ThemedText>
          <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
            <ThemedText style={[styles.statusBadgeText, { color: badge.text }]}>
              {formatInvoiceStatus(displayStatus)}
            </ThemedText>
          </View>
        </View>
      </ThemedView>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
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
  cardLeft: { flex: 1, gap: 2 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  customerName: { fontSize: 13 },
  dateText: { fontSize: 12, opacity: 0.6 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeText: { fontSize: 10, fontWeight: '600' },
})
