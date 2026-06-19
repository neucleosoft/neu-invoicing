import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'

type Customer = typeof schema.customer.$inferSelect

function balanceColor(balance: number): string {
  if (balance > 0) return '#dc2626'
  if (balance < 0) return '#6b7280'
  return '#16a34a'
}

function balanceWord(balance: number): string {
  if (balance > 0) return 'owes'
  if (balance < 0) return 'advance'
  return 'settled'
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () =>
    router.push({ pathname: '/customer/edit/[id]', params: { id } })
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)

  function handleDelete() {
    if (!id) return
    Alert.alert(
      'Delete customer',
      "It will be marked Deleted and left out of totals and reports. You can restore it anytime.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Soft-delete: stamp deletedAt (updatedAt auto-bumps). The row and
              // its invoices/payments/balance stay put so a restore brings the
              // customer back intact.
              await db
                .update(schema.customer)
                .set({ deletedAt: new Date() })
                .where(eq(schema.customer.id, id))
              router.back()
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Failed to delete'
              Alert.alert('Error', msg)
            }
          },
        },
      ],
    )
  }

  function handleRestore() {
    if (!id) return
    db.update(schema.customer)
      .set({ deletedAt: null })
      .where(eq(schema.customer.id, id))
      .then(() => router.back())
      .catch((e) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed to restore'))
  }

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    db.select()
      .from(schema.customer)
      .where(eq(schema.customer.id, id))
      .limit(1)
      .then((rows) => {
        setCustomer(rows[0] ?? null)
        setLoading(false)
      })
  }, [id, db])

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!customer} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }

  if (!customer) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!customer} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Customer not found</ThemedText>
          <ThemedText style={styles.muted}>
            This customer may have been deleted.
          </ThemedText>
        </View>
      </ThemedView>
    )
  }

  const placeOfSupply =
    customer.stateName ||
    [customer.city, customer.district].filter(Boolean).join(', ') ||
    null

  const isDeleted = !!customer.deletedAt

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!customer} />
      <ScrollView contentContainerStyle={styles.content}>
        {isDeleted ? (
          <ThemedView style={styles.deletedBanner}>
            <ThemedText style={styles.deletedBannerText}>
              This customer is deleted — it's left out of totals and reports. Restore it to use it again.
            </ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title" numberOfLines={2}>
              {customer.name}
            </ThemedText>
            {placeOfSupply ? (
              <ThemedText style={styles.muted}>{placeOfSupply}</ThemedText>
            ) : null}
          </View>
          <View style={styles.heroRight}>
            <ThemedText
              type="defaultSemiBold"
              style={[styles.heroBalance, { color: balanceColor(customer.currentBalance) }]}
            >
              {formatCurrency(customer.currentBalance)}
            </ThemedText>
            <ThemedText style={styles.muted}>{balanceWord(customer.currentBalance)}</ThemedText>
          </View>
        </ThemedView>

        <Pressable
          style={styles.ledgerButton}
          onPress={() => router.push({ pathname: '/ledger/customer/[id]', params: { id } })}
        >
          <ThemedText style={styles.ledgerButtonText}>View Ledger</ThemedText>
        </Pressable>

        <Section title="Contact">
          <Row label="Phone" value={customer.phone || '—'} />
          <Row label="Email" value={customer.email || '—'} />
        </Section>

        {/* GST section only renders for registered customers. Showing 5 blank
            rows for an unregistered consumer would be visual noise. */}
        {customer.taxId ? (
          <Section title="GST">
            <Row label="GSTIN" value={customer.taxId} />
            <Row label="Legal Name" value={customer.legalName || '—'} />
            <Row label="Trade Name" value={customer.tradeName || '—'} />
            <Row label="GST Status" value={customer.gstStatus || '—'} />
            <Row label="GST Type" value={customer.gstType} />
          </Section>
        ) : null}

        <Section title="Address">
          <Row label="Billing" value={customer.billingAddress || '—'} />
          <Row label="Shipping" value={customer.shippingAddress || '—'} />
          <Row label="City" value={customer.city || '—'} />
          <Row label="District" value={customer.district || '—'} />
          <Row label="Pincode" value={customer.pincode || '—'} />
        </Section>

        <Section title="Balance">
          <Row label="Opening" value={formatCurrency(customer.openingBalance)} />
          <Row label="Current" value={formatCurrency(customer.currentBalance)} />
        </Section>

        <Section title="Details">
          <Row label="Created" value={formatDate(customer.createdAt)} />
          <Row label="Updated" value={formatDate(customer.updatedAt)} />
        </Section>

        {isDeleted ? (
          <Pressable style={styles.restoreButton} onPress={handleRestore}>
            <ThemedText style={styles.restoreButtonText}>Restore customer</ThemedText>
          </Pressable>
        ) : (
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <ThemedText style={styles.deleteButtonText}>Delete customer</ThemedText>
          </Pressable>
        )}
      </ScrollView>
    </ThemedView>
  )
}

function Header({
  onBack,
  onEdit,
  editEnabled,
}: {
  onBack: () => void
  onEdit: () => void
  editEnabled: boolean
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerButton} hitSlop={8}>
        <ThemedText style={styles.headerArrow}>←</ThemedText>
      </Pressable>
      <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
        Customer Details
      </ThemedText>
      <Pressable
        onPress={onEdit}
        disabled={!editEnabled}
        style={[styles.headerButton, !editEnabled && styles.headerButtonDisabled]}
      >
        <ThemedText style={styles.headerButtonText}>Edit</ThemedText>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  headerButton: { paddingVertical: 6, paddingHorizontal: 10 },
  headerButtonDisabled: { opacity: 0.3 },
  headerButtonText: { fontSize: 16 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  centered: { textAlign: 'center', marginTop: 64 },
  centeredBlock: {
    alignItems: 'center',
    marginTop: 64,
    gap: 8,
    paddingHorizontal: 32,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  heroLeft: { flex: 1, gap: 4 },
  heroRight: { alignItems: 'flex-end', gap: 2 },
  heroBalance: { fontSize: 22 },
  muted: { opacity: 0.6, fontSize: 13 },
  deleteButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  deleteButtonText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  deletedBanner: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#fecaca' },
  deletedBannerText: { color: '#991b1b', fontSize: 13, lineHeight: 18 },
  restoreButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#16a34a',
  },
  restoreButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  ledgerButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0a7ea4',
  },
  ledgerButtonText: { color: '#0a7ea4', fontSize: 16, fontWeight: '600' },
})
