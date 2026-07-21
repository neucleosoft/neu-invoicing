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

type Item = typeof schema.item.$inferSelect

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () =>
    router.push({ pathname: '/item/edit/[id]', params: { id } })
  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)

  function handleDelete() {
    if (!id) return
    Alert.alert(
      'Delete item',
      'It will be marked Deleted and left out of totals and reports. You can restore it anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Soft-delete: stamp deletedAt (updatedAt auto-bumps). The row stays
              // put so a restore brings it back intact, and invoice/supplier links survive.
              await db
                .update(schema.item)
                .set({ deletedAt: new Date() })
                .where(eq(schema.item.id, id))
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
    db.update(schema.item)
      .set({ deletedAt: null })
      .where(eq(schema.item.id, id))
      .then(() => router.back())
      .catch((e) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed to restore'))
  }

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    db.select()
      .from(schema.item)
      .where(eq(schema.item.id, id))
      .limit(1)
      .then((rows) => {
        setItem(rows[0] ?? null)
        setLoading(false)
      })
  }, [id, db])

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!item} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }

  if (!item) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!item} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Item not found</ThemedText>
          <ThemedText style={styles.muted}>
            This item may have been deleted.
          </ThemedText>
        </View>
      </ThemedView>
    )
  }

  const isLowStock =
    item.trackStock && item.currentStock < item.lowStockWarning
  const isDeleted = !!item.deletedAt

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!item} />
      <ScrollView contentContainerStyle={styles.content}>
        {isDeleted ? (
          <ThemedView style={styles.deletedBanner}>
            <ThemedText style={styles.deletedBannerText}>
              This item is deleted — it&apos;s left out of totals and reports. Restore it to use it again.
            </ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title" numberOfLines={2}>
              {item.name}
            </ThemedText>
            <ThemedText style={styles.muted}>
              {item.hsnCode ? `HSN ${item.hsnCode}` : 'No HSN'} · {item.type}
            </ThemedText>
          </View>
          <View style={styles.heroRight}>
            <ThemedText type="defaultSemiBold" style={styles.heroPrice}>
              {formatCurrency(item.salePrice)}
            </ThemedText>
            <ThemedText style={styles.muted}>per {item.unit}</ThemedText>
          </View>
        </ThemedView>

        <Section title="Pricing">
          <Row label="Sale Price" value={formatCurrency(item.salePrice)} />
          <Row label="Purchase Price" value={formatCurrency(item.purchasePrice)} />
          <Row label="GST Rate" value={`${item.taxRate}%`} />
          <Row label="GST Type" value={item.gstType} />
        </Section>

        {item.trackStock ? (
          <Section title="Stock">
            <Row
              label="Current Stock"
              value={
                <View style={styles.stockRowValue}>
                  <ThemedText type="defaultSemiBold">
                    {item.currentStock}
                  </ThemedText>
                  {isLowStock ? (
                    <View style={styles.lowStockChip}>
                      <ThemedText style={styles.lowStockChipText}>Low</ThemedText>
                    </View>
                  ) : null}
                </View>
              }
            />
            <Row
              label="Warning Level"
              value={String(item.lowStockWarning)}
            />
            <Row label="Unit" value={item.unit} />
          </Section>
        ) : null}

        <Section title="Details">
          <Row label="SKU" value={item.skuHsn || '—'} />
          <Row label="Created" value={formatDate(item.createdAt)} />
          <Row label="Updated" value={formatDate(item.updatedAt)} />
        </Section>

        {isDeleted ? (
          <Pressable style={styles.restoreButton} onPress={handleRestore}>
            <ThemedText style={styles.restoreButtonText}>Restore item</ThemedText>
          </Pressable>
        ) : (
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <ThemedText style={styles.deleteButtonText}>Delete item</ThemedText>
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
        Item Details
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
  heroPrice: { fontSize: 22 },
  muted: { opacity: 0.6, fontSize: 13 },
  stockRowValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lowStockChip: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  lowStockChipText: { fontSize: 10, color: '#991b1b', fontWeight: '600' },
  deleteButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  deleteButtonText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  deletedBanner: {
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  deletedBannerText: { color: '#991b1b', fontSize: 13, lineHeight: 18 },
  restoreButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#16a34a',
  },
  restoreButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
})
