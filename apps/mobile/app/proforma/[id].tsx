import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { createInvoiceFromSource, type SourceLine } from '@neu/shared'

import { HiddenPdfWebView, type HiddenPdfWebViewHandle } from '@/components/HiddenPdfWebView'
import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { buildProformaPdfPayload } from '@/utils/proformaPdf'
import { saveAndSharePdf } from '@/utils/pdfShare'

type Proforma = typeof schema.proformaInvoice.$inferSelect
type ProformaItem = typeof schema.proformaInvoiceItem.$inferSelect

export default function ProformaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () => router.push({ pathname: '/proforma/edit/[id]', params: { id } })

  const [doc, setDoc] = useState<Proforma | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [lines, setLines] = useState<(ProformaItem & { name: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [converting, setConverting] = useState(false)
  const pdfRef = useRef<HiddenPdfWebViewHandle>(null)
  const [sharing, setSharing] = useState(false)

  async function handleSharePdf() {
    if (!id || sharing) return
    setSharing(true)
    try {
      const payload = await buildProformaPdfPayload(db, id)
      if (!payload) {
        Alert.alert('Error', 'Could not load this proforma.')
        return
      }
      const base64 = await pdfRef.current!.generate(payload.builder, payload.data)
      await saveAndSharePdf(base64, payload.filename)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate PDF'
      Alert.alert(
        'PDF failed',
        // The WebView + sharing are native modules — a fresh `npx expo run:android`
        // is required after adding them, or generation can't run.
        `${msg}\n\nIf this is the first run after adding PDF support, rebuild the app (expo run:android).`,
      )
    } finally {
      setSharing(false)
    }
  }

  useEffect(() => {
    if (!id) { setLoading(false); return }
    async function load() {
      const [d] = await db.select().from(schema.proformaInvoice).where(eq(schema.proformaInvoice.id, id)).limit(1)
      if (!d) { setLoading(false); return }
      setDoc(d)
      const [c] = await db.select({ name: schema.customer.name }).from(schema.customer).where(eq(schema.customer.id, d.customerId)).limit(1)
      setCustomerName(c?.name ?? 'Unknown')
      const its = await db.select().from(schema.proformaInvoiceItem).where(eq(schema.proformaInvoiceItem.proformaInvoiceId, id))
      const items = await db.select().from(schema.item)
      const nameById = new Map(items.map((i) => [i.id, i.name]))
      setLines(its.map((it) => ({ ...it, name: nameById.get(it.itemId) ?? 'Item' })))
      setLoading(false)
    }
    load()
  }, [id, db])

  function handleConvert() {
    if (!doc) return
    Alert.alert('Convert to Invoice', 'Creates a new tax invoice from this proforma (raising the customer balance, reducing stock). The proforma stays as-is. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Convert',
        onPress: async () => {
          setConverting(true)
          try {
            const its = await db.select().from(schema.proformaInvoiceItem).where(eq(schema.proformaInvoiceItem.proformaInvoiceId, doc!.id))
            const sourceLines: SourceLine[] = its.map((l) => ({ itemId: l.itemId, quantity: l.quantity, rate: l.rate, discount: l.discount, taxRate: l.taxRate, total: l.total, hsnCode: l.hsnCode, taxableAmount: l.taxableAmount }))
            await db.transaction(async (tx) => {
              await createInvoiceFromSource(tx, {
                customerId: doc!.customerId,
                subtotal: doc!.subtotal,
                discount: doc!.discount,
                taxAmount: doc!.taxAmount,
                totalAmount: doc!.totalAmount,
                notes: doc!.notes,
                termsConditions: doc!.termsConditions,
                placeOfSupply: doc!.placeOfSupply,
                placeOfSupplyName: doc!.placeOfSupplyName,
                isInterState: doc!.isInterState,
                cgstAmount: doc!.cgstAmount,
                sgstAmount: doc!.sgstAmount,
                igstAmount: doc!.igstAmount,
                lines: sourceLines,
              }, { convertedFromProformaId: doc!.id })
            })
            Alert.alert('Converted', 'A new invoice was created from this proforma.')
            router.back()
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to convert')
          } finally {
            setConverting(false)
          }
        },
      },
    ])
  }

  function handleDelete() {
    if (!id) return
    Alert.alert('Delete proforma', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await db.delete(schema.proformaInvoiceItem).where(eq(schema.proformaInvoiceItem.proformaInvoiceId, id))
            await db.delete(schema.proformaInvoice).where(eq(schema.proformaInvoice.id, id))
            router.back()
          } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete') }
        },
      },
    ])
  }

  if (loading) return <ThemedView style={styles.container}><Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!doc} /><ThemedText style={styles.centered}>Loading…</ThemedText></ThemedView>
  if (!doc) return <ThemedView style={styles.container}><Header onBack={() => router.back()} onEdit={onEdit} editEnabled={false} /><View style={styles.centeredBlock}><ThemedText type="subtitle">Proforma not found</ThemedText></View></ThemedView>

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title">{doc.invoiceNumber}</ThemedText>
            <ThemedText style={styles.muted}>{customerName}</ThemedText>
            <ThemedText style={styles.muted}>{doc.status}</ThemedText>
          </View>
          <View style={styles.heroRight}><ThemedText type="defaultSemiBold" style={styles.heroTotal}>{formatCurrency(doc.totalAmount)}</ThemedText></View>
        </ThemedView>

        <Pressable
          style={[styles.shareButton, sharing && styles.shareButtonDisabled]}
          onPress={handleSharePdf}
          disabled={sharing}
        >
          {sharing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.shareButtonText}>Share PDF</ThemedText>
          )}
        </Pressable>

        <Section title="Proforma">
          <Row label="Date" value={formatDate(doc.invoiceDate)} />
          {doc.dueDate ? <Row label="Expiry" value={formatDate(doc.dueDate)} /> : null}
          {doc.deliveryTime ? <Row label="Delivery Time" value={formatDate(doc.deliveryTime)} /> : null}
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
          <Row label="Subtotal" value={formatCurrency(doc.subtotal)} />
          <Row label="Tax" value={formatCurrency(doc.taxAmount)} />
          <Row label="Total" value={formatCurrency(doc.totalAmount)} />
        </Section>

        {doc.notes ? <Section title="Notes"><ThemedText style={styles.notesText}>{doc.notes}</ThemedText></Section> : null}

        <Pressable style={[styles.convertButton, converting && styles.disabled]} onPress={handleConvert} disabled={converting}>
          <ThemedText style={styles.convertButtonText}>{converting ? 'Converting…' : 'Convert to Invoice'}</ThemedText>
        </Pressable>
        <Pressable style={styles.deleteButton} onPress={handleDelete}><ThemedText style={styles.deleteButtonText}>Delete proforma</ThemedText></Pressable>
      </ScrollView>
      {/* Off-screen pdfmake host — boots in the background, generates on demand. */}
      <HiddenPdfWebView ref={pdfRef} />
    </ThemedView>
  )
}

function Header({ onBack, onEdit, editEnabled }: { onBack: () => void; onEdit: () => void; editEnabled: boolean }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerButton} hitSlop={8}><ThemedText style={styles.headerArrow}>←</ThemedText></Pressable>
      <ThemedText type="defaultSemiBold" style={styles.headerTitle}>Proforma</ThemedText>
      <Pressable onPress={onEdit} disabled={!editEnabled} style={[styles.headerButton, !editEnabled && styles.headerButtonDisabled]}><ThemedText style={styles.headerButtonText}>Edit</ThemedText></Pressable>
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
  shareButton: {
    backgroundColor: '#0a7ea4',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  shareButtonDisabled: { opacity: 0.6 },
  shareButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
