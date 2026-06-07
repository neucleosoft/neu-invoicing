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

// Slim list row — we MUST NOT select fileData here. The blob is the original
// invoice image (potentially megabytes each); pulling it on every list row would
// load the whole archive into memory. We select only the header columns the row
// needs and fetch the file lazily on the detail screen.
type ArchiveRow = {
  id: string
  serialNumber: number | null
  invoiceNumber: string
  invoiceDate: Date
  partyName: string
  totalAmount: number
}

export default function PreviousInvoicesScreen() {
  const db = useDb()
  const [invoices, setInvoices] = useState<ArchiveRow[]>([])
  const [search, setSearch] = useState('')

  useFocusEffect(
    useCallback(() => {
      db.select({
        id: schema.previousInvoice.id,
        serialNumber: schema.previousInvoice.serialNumber,
        invoiceNumber: schema.previousInvoice.invoiceNumber,
        invoiceDate: schema.previousInvoice.invoiceDate,
        partyName: schema.previousInvoice.partyName,
        totalAmount: schema.previousInvoice.totalAmount,
      })
        .from(schema.previousInvoice)
        .orderBy(desc(schema.previousInvoice.invoiceDate))
        .then(setInvoices)
    }, [db]),
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoices
    return invoices.filter(
      (x) =>
        x.invoiceNumber.toLowerCase().includes(q) ||
        x.partyName.toLowerCase().includes(q),
    )
  }, [invoices, search])

  const renderItem = useCallback<ListRenderItem<ArchiveRow>>(
    ({ item }) => <Row invoice={item} />,
    [],
  )

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Previous Invoices</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}>
          <ThemedText style={styles.countText}>{invoices.length}</ThemedText>
        </ThemedView>
      </View>

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by invoice # or party…"
          placeholderTextColor="#9ca3af"
          style={styles.searchInput}
        />
      </ThemedView>

      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          search ? (
            <EmptyState title="No matches" description={`No invoices match "${search}"`} />
          ) : (
            <EmptyState
              title="No previous invoices yet"
              description="Archive invoices you raised before this app — upload the original file to keep a searchable record."
              action={{ label: 'Add Previous Invoice', onPress: () => router.push('/previousInvoice/newPreviousInvoice') }}
            />
          )
        }
        renderItem={renderItem}
      />

      <Fab onPress={() => router.push('/previousInvoice/newPreviousInvoice')} label="Add previous invoice" />
    </ThemedView>
  )
}

const Row = memo(function Row({ invoice }: { invoice: ArchiveRow }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/previousInvoice/[id]', params: { id: invoice.id } })}
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>{invoice.invoiceNumber}</ThemedText>
          <ThemedText style={styles.metaText} numberOfLines={1}>{invoice.partyName}</ThemedText>
          <ThemedText style={styles.dateText}>{formatDate(invoice.invoiceDate)}</ThemedText>
        </View>
        <View style={styles.cardRight}>
          <ThemedText type="defaultSemiBold">{formatCurrency(invoice.totalAmount)}</ThemedText>
          {invoice.serialNumber != null ? (
            <View style={styles.serialBadge}>
              <ThemedText style={styles.serialBadgeText}>#{invoice.serialNumber}</ThemedText>
            </View>
          ) : null}
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
  serialBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#e5e7eb' },
  serialBadgeText: { fontSize: 10, fontWeight: '600', color: '#374151' },
})
