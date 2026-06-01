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

type Supplier = typeof schema.supplier.$inferSelect

// Mirror of the customer balance colours, but read from the payable side:
// positive = we owe them (red), negative = they owe us (green), zero settled.
function balanceColor(balance: number): string {
  if (balance > 0) return '#dc2626'
  if (balance < 0) return '#16a34a'
  return '#6b7280'
}

function balanceWord(balance: number): string {
  if (balance > 0) return 'To Pay'
  if (balance < 0) return 'To Collect'
  return 'settled'
}

export default function SupplierDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () =>
    router.push({ pathname: '/supplier/edit/[id]', params: { id } })
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)

  function handleDelete() {
    if (!id) return
    Alert.alert('Delete supplier', `Delete "${supplier?.name ?? ''}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            // Guard (mirrors desktop supplier:delete): block if the supplier has
            // any purchase bills or payments — deleting would orphan those and
            // corrupt the payable ledger. Remove those records first.
            const [bill] = await db
              .select({ id: schema.purchaseBill.id })
              .from(schema.purchaseBill)
              .where(eq(schema.purchaseBill.supplierId, id))
              .limit(1)
            const [pay] = await db
              .select({ id: schema.paymentTransaction.id })
              .from(schema.paymentTransaction)
              .where(eq(schema.paymentTransaction.supplierId, id))
              .limit(1)
            if (bill || pay) {
              Alert.alert(
                'Cannot delete',
                'This supplier has purchase bills or payments. Delete those records first.',
              )
              return
            }
            await db.delete(schema.supplier).where(eq(schema.supplier.id, id))
            router.back()
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to delete'
            Alert.alert('Error', msg)
          }
        },
      },
    ])
  }

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    db.select()
      .from(schema.supplier)
      .where(eq(schema.supplier.id, id))
      .limit(1)
      .then((rows) => {
        setSupplier(rows[0] ?? null)
        setLoading(false)
      })
  }, [id, db])

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!supplier} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }

  if (!supplier) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!supplier} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Supplier not found</ThemedText>
          <ThemedText style={styles.muted}>
            This supplier may have been deleted.
          </ThemedText>
        </View>
      </ThemedView>
    )
  }

  const placeOfSupply =
    supplier.stateName ||
    [supplier.city, supplier.district].filter(Boolean).join(', ') ||
    null

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!supplier} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title" numberOfLines={2}>
              {supplier.name}
            </ThemedText>
            {placeOfSupply ? (
              <ThemedText style={styles.muted}>{placeOfSupply}</ThemedText>
            ) : null}
          </View>
          <View style={styles.heroRight}>
            <ThemedText
              type="defaultSemiBold"
              style={[styles.heroBalance, { color: balanceColor(supplier.currentBalance) }]}
            >
              {formatCurrency(Math.abs(supplier.currentBalance))}
            </ThemedText>
            <ThemedText style={styles.muted}>{balanceWord(supplier.currentBalance)}</ThemedText>
          </View>
        </ThemedView>

        <Section title="Contact">
          <Row label="Phone" value={supplier.phone || '—'} />
          <Row label="Email" value={supplier.email || '—'} />
        </Section>

        {supplier.taxId ? (
          <Section title="GST">
            <Row label="GSTIN" value={supplier.taxId} />
            <Row label="Legal Name" value={supplier.legalName || '—'} />
            <Row label="Trade Name" value={supplier.tradeName || '—'} />
            <Row label="GST Status" value={supplier.gstStatus || '—'} />
            <Row label="GST Type" value={supplier.gstType} />
          </Section>
        ) : null}

        <Section title="Address">
          <Row label="Billing" value={supplier.billingAddress || '—'} />
          <Row label="Shipping" value={supplier.shippingAddress || '—'} />
          <Row label="City" value={supplier.city || '—'} />
          <Row label="District" value={supplier.district || '—'} />
          <Row label="Pincode" value={supplier.pincode || '—'} />
        </Section>

        <Section title="Balance">
          <Row label="Opening" value={formatCurrency(supplier.openingBalance)} />
          <Row label="Current" value={formatCurrency(supplier.currentBalance)} />
        </Section>

        <Section title="Details">
          <Row label="Created" value={formatDate(supplier.createdAt)} />
          <Row label="Updated" value={formatDate(supplier.updatedAt)} />
        </Section>

        <Pressable style={styles.deleteButton} onPress={handleDelete}>
          <ThemedText style={styles.deleteButtonText}>Delete supplier</ThemedText>
        </Pressable>
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
        Supplier Details
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
})
