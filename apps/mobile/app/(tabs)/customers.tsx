import { asc } from 'drizzle-orm'
import { router, useFocusEffect } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import { FlatList, type ListRenderItem, Pressable, StyleSheet, TextInput, View } from 'react-native'

import EmptyState from '@/components/EmptyState'
import Fab from '@/components/Fab'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'

type Customer = typeof schema.customer.$inferSelect

// Pick the balance color by sign. Positive = customer owes money (red); zero =
// settled (green); negative = we owe them an advance (muted grey). Indian SMB
// apps universally use this red/green/grey convention.
function balanceColor(balance: number): string {
  if (balance > 0) return '#dc2626' // red-600
  if (balance < 0) return '#6b7280' // gray-500
  return '#16a34a' // green-600
}

export default function CustomersScreen() {
  const db = useDb()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')

  useFocusEffect(
    useCallback(() => {
      db.select()
        .from(schema.customer)
        .orderBy(asc(schema.customer.name))
        .then(setCustomers)
    }, [db]),
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((c) => c.name.toLowerCase().includes(q))
  }, [customers, search])

  const renderItem = useCallback<ListRenderItem<Customer>>(
    ({ item }) => <CustomerRow customer={item} />,
    [],
  )
  const keyExtractor = useCallback((row: Customer) => row.id, [])

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Customers</ThemedText>
        <ThemedView lightColor="#e5e7eb" darkColor="#374151" style={styles.countChip}>
          <ThemedText style={styles.countText}>{customers.length}</ThemedText>
        </ThemedView>
      </View>

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search customers…"
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
            <EmptyState title="No matches" description={`No customers match "${search}"`} />
          ) : (
            <EmptyState
              title="No customers yet"
              description="Add your first customer to start invoicing them."
              action={{ label: 'Add Customer', onPress: () => router.push('/customer/new') }}
            />
          )
        }
        renderItem={renderItem}
      />

      <Fab onPress={() => router.push('/customer/new')} label="Add customer" />
    </ThemedView>
  )
}

const CustomerRow = memo(function CustomerRow({ customer }: { customer: Customer }) {
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/customer/[id]', params: { id: customer.id } })
      }
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
        <View style={styles.cardLeft}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {customer.name}
          </ThemedText>
          <View style={styles.metaRow}>
            <ThemedText style={styles.metaText}>
              {customer.phone || 'No phone'}
            </ThemedText>
            {customer.taxId ? (
              <View style={styles.gstChip}>
                <ThemedText style={styles.gstChipText}>GSTIN</ThemedText>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.cardRight}>
          <ThemedText
            type="defaultSemiBold"
            style={{ color: balanceColor(customer.currentBalance) }}
          >
            {formatCurrency(customer.currentBalance)}
          </ThemedText>
          <ThemedText style={styles.muted}>
            {customer.currentBalance > 0
              ? 'owes'
              : customer.currentBalance < 0
              ? 'advance'
              : 'settled'}
          </ThemedText>
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
  cardLeft: { flex: 1, gap: 4 },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaText: { fontSize: 12, opacity: 0.6 },
  gstChip: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gstChipText: { fontSize: 10, color: '#1e40af', fontWeight: '600' },
  muted: { fontSize: 11, opacity: 0.5 },
})
