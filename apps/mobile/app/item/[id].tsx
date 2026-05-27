import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

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
  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)

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
        <Header onBack={() => router.back()} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }

  if (!item) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} />
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

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
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
      </ScrollView>
    </ThemedView>
  )
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerButton} hitSlop={8}>
        <ThemedText style={styles.headerArrow}>←</ThemedText>
      </Pressable>
      <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
        Item Details
      </ThemedText>
      {/* Edit placeholder — wired up in a future slice. Disabled so the user
          sees where editing will live without us promising it now. */}
      <Pressable disabled style={[styles.headerButton, styles.headerButtonDisabled]}>
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
})
