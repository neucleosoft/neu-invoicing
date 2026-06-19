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
    Alert.alert(
      'Delete supplier',
      "It will be marked Deleted and left out of totals and reports. You can restore it anytime.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Soft-delete: stamp deletedAt (updatedAt auto-bumps). The row stays
              // put so a restore brings the supplier back intact.
              await db
                .update(schema.supplier)
                .set({ deletedAt: new Date() })
                .where(eq(schema.supplier.id, id))
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
    db.update(schema.supplier)
      .set({ deletedAt: null })
      .where(eq(schema.supplier.id, id))
      .then(() => router.back())
      .catch((e) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed to restore'))
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

  const isDeleted = !!supplier.deletedAt

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!supplier} />
      <ScrollView contentContainerStyle={styles.content}>
        {isDeleted ? (
          <ThemedView style={styles.deletedBanner}>
            <ThemedText style={styles.deletedBannerText}>
              This supplier is deleted — it's left out of totals and reports. Restore it to use it again.
            </ThemedText>
          </ThemedView>
        ) : null}

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

        <Pressable
          style={styles.ledgerButton}
          onPress={() => router.push({ pathname: '/ledger/supplier/[id]', params: { id } })}
        >
          <ThemedText style={styles.ledgerButtonText}>View Ledger</ThemedText>
        </Pressable>

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

        {isDeleted ? (
          <Pressable style={styles.restoreButton} onPress={handleRestore}>
            <ThemedText style={styles.restoreButtonText}>Restore supplier</ThemedText>
          </Pressable>
        ) : (
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <ThemedText style={styles.deleteButtonText}>Delete supplier</ThemedText>
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
