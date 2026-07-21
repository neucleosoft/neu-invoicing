import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { createInvoiceFromSource, type SourceLine } from '@neu/shared'

import { PdfActions } from '@/components/PdfActions'
import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { buildQuotationPdfPayload } from '@/utils/quotationPdf'

type Quotation = typeof schema.quotation.$inferSelect
type QuotationItem = typeof schema.quotationItem.$inferSelect

export default function QuotationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () => router.push({ pathname: '/quotation/edit/[id]', params: { id } })

  const [quote, setQuote] = useState<Quotation | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [lines, setLines] = useState<(QuotationItem & { name: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [converting, setConverting] = useState(false)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    async function load() {
      const [q] = await db.select().from(schema.quotation).where(eq(schema.quotation.id, id)).limit(1)
      if (!q) {
        setLoading(false)
        return
      }
      setQuote(q)
      const [c] = await db.select({ name: schema.customer.name }).from(schema.customer).where(eq(schema.customer.id, q.customerId)).limit(1)
      setCustomerName(c?.name ?? 'Unknown')
      const its = await db.select().from(schema.quotationItem).where(eq(schema.quotationItem.quotationId, id))
      const items = await db.select().from(schema.item)
      const nameById = new Map(items.map((i) => [i.id, i.name]))
      setLines(its.map((it) => ({ ...it, name: nameById.get(it.itemId) ?? 'Item' })))
      setLoading(false)
    }
    load()
  }, [id, db])

  function handleConvert() {
    if (!quote) return
    Alert.alert(
      'Convert to Invoice',
      'This creates a new tax invoice from this quotation (raising the customer balance and reducing stock). The quotation stays as-is. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Convert',
          onPress: async () => {
            setConverting(true)
            try {
              const its = await db.select().from(schema.quotationItem).where(eq(schema.quotationItem.quotationId, quote!.id))
              const sourceLines: SourceLine[] = its.map((l) => ({
                itemId: l.itemId,
                quantity: l.quantity,
                rate: l.rate,
                discount: l.discount,
                taxRate: l.taxRate,
                total: l.total,
                hsnCode: l.hsnCode,
                taxableAmount: l.taxableAmount,
              }))
              await db.transaction(async (tx) => {
                await createInvoiceFromSource(
                  tx,
                  {
                    id: quote!.id,
                    customerId: quote!.customerId,
                    subtotal: quote!.subtotal,
                    discount: quote!.discount,
                    taxAmount: quote!.taxAmount,
                    totalAmount: quote!.totalAmount,
                    notes: quote!.notes,
                    termsConditions: quote!.termsConditions,
                    placeOfSupply: quote!.placeOfSupply,
                    placeOfSupplyName: quote!.placeOfSupplyName,
                    isInterState: quote!.isInterState,
                    cgstAmount: quote!.cgstAmount,
                    sgstAmount: quote!.sgstAmount,
                    igstAmount: quote!.igstAmount,
                    lines: sourceLines,
                  },
                  { convertedFromQuotationId: quote!.id },
                )
              })
              Alert.alert('Converted', 'A new invoice was created from this quotation.')
              router.back()
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to convert')
            } finally {
              setConverting(false)
            }
          },
        },
      ],
    )
  }

  function handleDelete() {
    if (!id) return
    Alert.alert(
      'Delete quotation',
      "It will be marked Deleted and left out of totals and reports. You can restore it anytime.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Soft-delete: stamp deletedAt (updatedAt auto-bumps). The row and its
              // line items stay put so a restore brings the whole document back intact.
              await db
                .update(schema.quotation)
                .set({ deletedAt: new Date() })
                .where(eq(schema.quotation.id, id))
              router.back()
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete')
            }
          },
        },
      ],
    )
  }

  function handleRestore() {
    if (!id) return
    db.update(schema.quotation)
      .set({ deletedAt: null })
      .where(eq(schema.quotation.id, id))
      .then(() => router.back())
      .catch((e) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed to restore'))
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!quote} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }
  if (!quote) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={false} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Quotation not found</ThemedText>
        </View>
      </ThemedView>
    )
  }

  const isDeleted = !!quote.deletedAt

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled />
      <ScrollView contentContainerStyle={styles.content}>
        {isDeleted ? (
          <ThemedView style={styles.deletedBanner}>
            <ThemedText style={styles.deletedBannerText}>
              This quotation is deleted — it&apos;s left out of totals and reports. Restore it to use it again.
            </ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title">{quote.invoiceNumber}</ThemedText>
            <ThemedText style={styles.muted}>{customerName}</ThemedText>
            <ThemedText style={styles.muted}>{quote.status}</ThemedText>
          </View>
          <View style={styles.heroRight}>
            <ThemedText type="defaultSemiBold" style={styles.heroTotal}>{formatCurrency(quote.totalAmount)}</ThemedText>
          </View>
        </ThemedView>

        <PdfActions buildPayload={() => buildQuotationPdfPayload(db, id)} />

        <Section title="Quotation">
          <Row label="Date" value={formatDate(quote.invoiceDate)} />
          {quote.dueDate ? <Row label="Expiry" value={formatDate(quote.dueDate)} /> : null}
          {quote.deliveryTime ? <Row label="Delivery Time" value={formatDate(quote.deliveryTime)} /> : null}
        </Section>

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.itemsCard}>
          <ThemedText type="defaultSemiBold" style={styles.itemsTitle}>Items ({lines.length})</ThemedText>
          {lines.map((l, idx) => (
            <View key={l.id} style={[styles.itemRow, idx > 0 && styles.itemRowDivider]}>
              <View style={styles.itemLeft}>
                <ThemedText numberOfLines={2}>{l.name}</ThemedText>
                <ThemedText style={styles.itemMeta}>{l.quantity} × {formatCurrency(l.rate)}{l.discount ? ` − ${formatCurrency(l.discount)}` : ''} · {l.taxRate}% tax</ThemedText>
              </View>
              <ThemedText type="defaultSemiBold">{formatCurrency(l.total)}</ThemedText>
            </View>
          ))}
        </ThemedView>

        <Section title="Totals">
          <Row label="Subtotal" value={formatCurrency(quote.subtotal)} />
          <Row label="Tax" value={formatCurrency(quote.taxAmount)} />
          <Row label="Total" value={formatCurrency(quote.totalAmount)} />
        </Section>

        {quote.notes ? <Section title="Notes"><ThemedText style={styles.notesText}>{quote.notes}</ThemedText></Section> : null}

        {isDeleted ? (
          <Pressable style={styles.restoreButton} onPress={handleRestore}>
            <ThemedText style={styles.restoreButtonText}>Restore quotation</ThemedText>
          </Pressable>
        ) : (
          <>
            <Pressable style={[styles.convertButton, converting && styles.disabled]} onPress={handleConvert} disabled={converting}>
              <ThemedText style={styles.convertButtonText}>{converting ? 'Converting…' : 'Convert to Invoice'}</ThemedText>
            </Pressable>
            <Pressable style={styles.deleteButton} onPress={handleDelete}>
              <ThemedText style={styles.deleteButtonText}>Delete quotation</ThemedText>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ThemedView>
  )
}

function Header({ onBack, onEdit, editEnabled }: { onBack: () => void; onEdit: () => void; editEnabled: boolean }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerButton} hitSlop={8}><ThemedText style={styles.headerArrow}>←</ThemedText></Pressable>
      <ThemedText type="defaultSemiBold" style={styles.headerTitle}>Quotation</ThemedText>
      <Pressable onPress={onEdit} disabled={!editEnabled} style={[styles.headerButton, !editEnabled && styles.headerButtonDisabled]}>
        <ThemedText style={styles.headerButtonText}>Edit</ThemedText>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 10 },
  headerButtonDisabled: { opacity: 0.3 },
  headerButtonText: { fontSize: 16 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  centered: { textAlign: 'center', marginTop: 64 },
  centeredBlock: { alignItems: 'center', marginTop: 64, gap: 8, paddingHorizontal: 32 },
  hero: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, borderRadius: 12, gap: 12 },
  heroLeft: { flex: 1, gap: 4 },
  heroRight: { alignItems: 'flex-end' },
  heroTotal: { fontSize: 22 },
  muted: { opacity: 0.6, fontSize: 13 },
  itemsCard: { borderRadius: 12, padding: 14, gap: 4 },
  itemsTitle: { marginBottom: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: 12 },
  itemRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d1d5db' },
  itemLeft: { flex: 1, gap: 2 },
  itemMeta: { fontSize: 12, opacity: 0.6 },
  notesText: { fontSize: 14, lineHeight: 20, paddingVertical: 4 },
  convertButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, backgroundColor: '#007AFF' },
  convertButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  deleteButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#FF3B30' },
  deleteButtonText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  deletedBanner: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#fecaca' },
  deletedBannerText: { color: '#991b1b', fontSize: 13, lineHeight: 18 },
  restoreButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, backgroundColor: '#16a34a' },
  restoreButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
})
