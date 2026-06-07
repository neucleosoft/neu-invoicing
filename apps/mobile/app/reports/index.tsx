import { asc } from 'drizzle-orm'
import { router, useFocusEffect } from 'expo-router'
import { type ComponentProps, useCallback, useState } from 'react'
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { IconSymbol } from '@/components/ui/icon-symbol'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'

// Reports hub — the entry point into every reporting screen. Same hub-card
// pattern as the Purchases / Sales hubs. The two ledger cards open a party picker
// first (ledgers are per-party); the rest route straight through.

type Customer = typeof schema.customer.$inferSelect
type Supplier = typeof schema.supplier.$inferSelect

type Card = {
  title: string
  subtitle: string
  icon: ComponentProps<typeof IconSymbol>['name']
  action: 'route' | 'pickCustomer' | 'pickSupplier'
  route?: string
}

const CARDS: Card[] = [
  {
    title: 'Business Reports',
    subtitle: 'Sales, stock, receivables, payables, tax',
    icon: 'chart.line.uptrend.xyaxis',
    action: 'route',
    route: '/reports/business',
  },
  {
    title: 'GST Reports',
    subtitle: 'GSTR-1, GSTR-2, GSTR-3B, GSTR-9, HSN',
    icon: 'doc.text.fill',
    action: 'route',
    route: '/reports/gst',
  },
  {
    title: 'Customer Statement',
    subtitle: 'A customer’s account over a date range',
    icon: 'person.fill',
    action: 'route',
    route: '/reports/statement',
  },
  {
    title: 'Customer Ledger',
    subtitle: 'A customer’s full running account',
    icon: 'person.fill',
    action: 'pickCustomer',
  },
  {
    title: 'Supplier Ledger',
    subtitle: 'A supplier’s full running account',
    icon: 'person.fill',
    action: 'pickSupplier',
  },
]

export default function ReportsHubScreen() {
  const db = useDb()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [picker, setPicker] = useState<'customer' | 'supplier' | null>(null)

  const reload = useCallback(() => {
    Promise.all([
      db.select().from(schema.customer).orderBy(asc(schema.customer.name)),
      db.select().from(schema.supplier).orderBy(asc(schema.supplier.name)),
    ]).then(([c, s]) => {
      setCustomers(c)
      setSuppliers(s)
    })
  }, [db])

  useFocusEffect(reload)

  function onCard(card: Card) {
    if (card.action === 'route' && card.route) {
      router.push(card.route as never)
    } else if (card.action === 'pickCustomer') {
      setPicker('customer')
    } else if (card.action === 'pickSupplier') {
      setPicker('supplier')
    }
  }

  const pickerParties = picker === 'customer' ? customers : suppliers

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Reports</ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {CARDS.map((card) => (
          <Pressable
            key={card.title}
            onPress={() => onCard(card)}
            style={({ pressed }) => [pressed && styles.cardPressed]}
          >
            <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
              <View style={styles.iconWrap}>
                <IconSymbol name={card.icon} size={24} color="#0a7ea4" />
              </View>
              <View style={styles.cardText}>
                <ThemedText type="defaultSemiBold">{card.title}</ThemedText>
                <ThemedText style={styles.subtitle}>{card.subtitle}</ThemedText>
              </View>
              <IconSymbol name="chevron.right" size={20} color="#9ca3af" />
            </ThemedView>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={picker != null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Select {picker === 'customer' ? 'Customer' : 'Supplier'}
            </ThemedText>
            <FlatList
              data={pickerParties}
              keyExtractor={(p) => p.id}
              ListEmptyComponent={
                <ThemedText style={styles.modalEmpty}>
                  No {picker === 'customer' ? 'customers' : 'suppliers'} yet.
                </ThemedText>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    const kind = picker
                    setPicker(null)
                    router.push({
                      pathname:
                        kind === 'customer' ? '/ledger/customer/[id]' : '/ledger/supplier/[id]',
                      params: { id: item.id },
                    })
                  }}
                >
                  <ThemedText>{item.name}</ThemedText>
                  <ThemedText style={styles.partyBalance}>
                    Balance: {formatCurrency(Math.abs(item.currentBalance))}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setPicker(null)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1 },
  listContent: { paddingBottom: 96, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 14,
  },
  cardPressed: { opacity: 0.7 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,126,164,0.12)',
  },
  cardText: { flex: 1, gap: 2 },
  subtitle: { fontSize: 12, opacity: 0.6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { maxHeight: '85%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  modalTitle: { marginBottom: 12 },
  modalEmpty: { textAlign: 'center', paddingVertical: 24, opacity: 0.6 },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
    gap: 2,
  },
  partyBalance: { fontSize: 12, opacity: 0.6 },
  modalClose: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  modalCloseText: { color: '#FF3B30', fontSize: 16 },
})
