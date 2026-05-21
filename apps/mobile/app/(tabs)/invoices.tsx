import { desc, eq } from 'drizzle-orm'
import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'

type Invoice = typeof schema.salesInvoice.$inferSelect
type Row = Invoice & { customerName: string | null }

export default function InvoicesScreen() {
  const db = useDb()
  const [rows, setRows] = useState<Row[]>([])

  useFocusEffect(
    useCallback(() => {
      db.select({
        invoice: schema.salesInvoice,
        customerName: schema.customer.name,
      })
        .from(schema.salesInvoice)
        .leftJoin(schema.customer, eq(schema.salesInvoice.customerId, schema.customer.id))
        .orderBy(desc(schema.salesInvoice.invoiceDate))
        .then((result) => {
          setRows(result.map((r) => ({ ...r.invoice, customerName: r.customerName })))
        })
    }, [db])
  )

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Invoices</ThemedText>
        <Link href="/invoice/new" asChild>
          <Pressable style={styles.addButton}>
            <ThemedText style={styles.addButtonText}>+ New</ThemedText>
          </Pressable>
        </Link>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ThemedText>No invoices yet. Tap + New to create one.</ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <ThemedText type="defaultSemiBold">{item.invoiceNumber}</ThemedText>
              <ThemedText style={styles.subRow}>
                {item.customerName ?? 'Unknown customer'} · {new Date(item.invoiceDate).toLocaleDateString()}
              </ThemedText>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <ThemedText type="defaultSemiBold">₹{item.totalAmount.toFixed(2)}</ThemedText>
              <ThemedText style={styles.statusBadge}>{item.status}</ThemedText>
            </View>
          </View>
        )}
      />
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  addButton: { backgroundColor: '#007AFF', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  addButtonText: { color: 'white', fontWeight: '600' },
  empty: { padding: 32, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#888',
    alignItems: 'center',
  },
  subRow: { fontSize: 13, opacity: 0.6, marginTop: 2 },
  statusBadge: { fontSize: 11, opacity: 0.6, marginTop: 2 },
})
