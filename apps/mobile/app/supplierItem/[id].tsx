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

type SupplierItem = typeof schema.supplierItem.$inferSelect

// Same 8-unit labels the form uses — shown here read-only.
const UNIT_LABELS: Record<string, string> = {
  pcs: 'Pieces (pcs)',
  kg: 'Kilograms (kg)',
  g: 'Grams (g)',
  l: 'Liters (l)',
  m: 'Meters (m)',
  hrs: 'Hours (hrs)',
  box: 'Box',
  carton: 'Carton',
}

export default function SupplierItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () =>
    router.push({ pathname: '/supplierItem/edit/[id]', params: { id } })

  const [row, setRow] = useState<SupplierItem | null>(null)
  const [supplierName, setSupplierName] = useState('—')
  const [linkedName, setLinkedName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    async function load() {
      const [si] = await db
        .select()
        .from(schema.supplierItem)
        .where(eq(schema.supplierItem.id, id))
        .limit(1)
      if (!si) {
        setLoading(false)
        return
      }
      setRow(si)

      const [sup] = await db
        .select({ name: schema.supplier.name })
        .from(schema.supplier)
        .where(eq(schema.supplier.id, si.supplierId))
        .limit(1)
      setSupplierName(sup?.name ?? '—')

      if (si.linkedItemId) {
        const [it] = await db
          .select({ name: schema.item.name })
          .from(schema.item)
          .where(eq(schema.item.id, si.linkedItemId))
          .limit(1)
        setLinkedName(it?.name ?? null)
      }
      setLoading(false)
    }
    load()
  }, [id, db])

  function handleDelete() {
    if (!id) return
    Alert.alert('Delete supplier item', `Delete "${row?.name ?? ''}" from this catalog?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            // Guard (mirrors desktop): refuse if any purchase bill line still
            // references this supplier item — deleting would orphan that line.
            const refs = await db
              .select({ id: schema.purchaseBillItem.id })
              .from(schema.purchaseBillItem)
              .where(eq(schema.purchaseBillItem.supplierItemId, id))
              .limit(1)
            if (refs.length > 0) {
              Alert.alert(
                'Cannot delete',
                'This supplier item is used on one or more purchase bills. Remove it from those bills first.',
              )
              return
            }
            await db.delete(schema.supplierItem).where(eq(schema.supplierItem.id, id))
            router.back()
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to delete'
            Alert.alert('Error', msg)
          }
        },
      },
    ])
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!row} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }

  if (!row) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!row} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Supplier item not found</ThemedText>
          <ThemedText style={styles.muted}>This item may have been deleted.</ThemedText>
        </View>
      </ThemedView>
    )
  }

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!row} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title" numberOfLines={2}>
              {row.name}
            </ThemedText>
            <ThemedText style={styles.muted}>{supplierName}</ThemedText>
          </View>
          <View style={styles.heroRight}>
            <ThemedText type="defaultSemiBold" style={styles.heroPrice}>
              {formatCurrency(row.lastPurchasePrice)}
            </ThemedText>
            <ThemedText style={styles.muted}>per {row.unit}</ThemedText>
          </View>
        </ThemedView>

        <Section title="Catalog">
          <Row label="Supplier" value={supplierName} />
          <Row label="HSN / SAC" value={row.hsnCode || '—'} />
          <Row label="Unit" value={UNIT_LABELS[row.unit] ?? row.unit} />
          <Row label="Last Purchase Price" value={formatCurrency(row.lastPurchasePrice)} />
          <Row label="Default Tax Rate" value={`${row.defaultTaxRate}%`} />
        </Section>

        <Section title="Stock Link">
          <Row
            label="Linked Item"
            value={
              linkedName ? (
                <View style={styles.linkChip}>
                  <ThemedText style={styles.linkChipText}>↔ {linkedName}</ThemedText>
                </View>
              ) : (
                'None — no stock tracking on purchase'
              )
            }
          />
        </Section>

        <Section title="Details">
          <Row label="Created" value={formatDate(row.createdAt)} />
          <Row label="Updated" value={formatDate(row.updatedAt)} />
        </Section>

        <Pressable style={styles.deleteButton} onPress={handleDelete}>
          <ThemedText style={styles.deleteButtonText}>Delete supplier item</ThemedText>
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
        Supplier Item
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
  centeredBlock: { alignItems: 'center', marginTop: 64, gap: 8, paddingHorizontal: 32 },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  heroLeft: { flex: 1, gap: 4 },
  heroRight: { alignItems: 'flex-end', gap: 2 },
  heroPrice: { fontSize: 22 },
  muted: { opacity: 0.6, fontSize: 13 },
  linkChip: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-end',
  },
  linkChipText: { fontSize: 13, color: '#166534', fontWeight: '600' },
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
