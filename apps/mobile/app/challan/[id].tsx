import { and, eq, like, sql } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { HiddenPdfWebView, type HiddenPdfWebViewHandle } from '@/components/HiddenPdfWebView'
import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { buildChallanPdfPayload } from '@/utils/challanPdf'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { saveAndSharePdf } from '@/utils/pdfShare'

type Challan = typeof schema.deliveryChallan.$inferSelect
type ChallanItem = typeof schema.deliveryChallanItem.$inferSelect

type Db = ReturnType<typeof useDb>

// Challan-specific invoice number: INV-YYYY-NNN where YYYY is the full calendar
// year and NNN is the next sequence among salesInvoice rows already using that
// INV-year- prefix. This is deliberately NOT the NS/SL series — desktop's
// convert-challan path stamps this plain format. Inlined here per spec.
async function generateChallanInvoiceNumber(tx: any): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`
  const rows = await tx
    .select({ num: schema.salesInvoice.invoiceNumber })
    .from(schema.salesInvoice)
    .where(like(schema.salesInvoice.invoiceNumber, `${prefix}%`))
  let max = 0
  for (const r of rows as { num: string }[]) {
    const parsed = parseInt(r.num.slice(prefix.length), 10)
    if (!isNaN(parsed) && parsed > max) max = parsed
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export default function ChallanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () => router.push({ pathname: '/challan/edit/[id]', params: { id } })

  const [challan, setChallan] = useState<Challan | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [lines, setLines] = useState<(ChallanItem & { name: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [converting, setConverting] = useState(false)
  const pdfRef = useRef<HiddenPdfWebViewHandle>(null)
  const [sharing, setSharing] = useState(false)

  async function handleSharePdf() {
    if (!id || sharing) return
    setSharing(true)
    try {
      const payload = await buildChallanPdfPayload(db, id)
      if (!payload) {
        Alert.alert('Error', 'Could not load this challan.')
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
    if (!id) {
      setLoading(false)
      return
    }
    async function load() {
      const [dc] = await db.select().from(schema.deliveryChallan).where(eq(schema.deliveryChallan.id, id)).limit(1)
      if (!dc) {
        setLoading(false)
        return
      }
      setChallan(dc)
      const [c] = await db.select({ name: schema.customer.name }).from(schema.customer).where(eq(schema.customer.id, dc.customerId)).limit(1)
      setCustomerName(c?.name ?? 'Unknown')
      const its = await db.select().from(schema.deliveryChallanItem).where(eq(schema.deliveryChallanItem.deliveryChallanId, id))
      const items = await db.select().from(schema.item)
      const nameById = new Map(items.map((i) => [i.id, i.name]))
      setLines(its.map((it) => ({ ...it, name: nameById.get(it.itemId) ?? 'Item' })))
      setLoading(false)
    }
    load()
  }, [id, db])

  // Convert is only valid for a NON_RETURNABLE challan: those goods are sold for
  // keeps, so they can become a tax invoice. RETURNABLE goods come back (no sale)
  // and CONVERTED is already done.
  const canConvert = challan?.status === 'NON_RETURNABLE'

  function handleConvert() {
    if (!challan || !canConvert) return
    Alert.alert(
      'Convert to Invoice',
      'This creates a new tax invoice from this challan (raising the customer balance). The stock already left at challan time, so it is not deducted again. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Convert',
          onPress: async () => {
            setConverting(true)
            try {
              await db.transaction(async (tx) => {
                const its = await tx.select().from(schema.deliveryChallanItem).where(eq(schema.deliveryChallanItem.deliveryChallanId, challan!.id))
                const number = await generateChallanInvoiceNumber(tx)
                const [inv] = await tx
                  .insert(schema.salesInvoice)
                  .values({
                    invoiceNumber: number,
                    type: 'INVOICE',
                    customerId: challan!.customerId,
                    invoiceDate: new Date(),
                    subtotal: challan!.subtotal,
                    taxAmount: challan!.taxAmount,
                    totalAmount: challan!.totalAmount,
                    amountPaid: 0,
                    balanceDue: challan!.totalAmount,
                    status: 'DRAFT',
                    notes: challan!.notes,
                    termsConditions: challan!.termsConditions,
                  })
                  .returning({ id: schema.salesInvoice.id })

                await tx.insert(schema.salesInvoiceItem).values(
                  its.map((l: ChallanItem) => ({
                    salesInvoiceId: inv.id,
                    itemId: l.itemId,
                    quantity: l.quantity,
                    rate: l.rate,
                    discount: l.discount,
                    taxRate: l.taxRate,
                    total: l.total,
                    hsnCode: l.hsnCode,
                    taxableAmount: l.quantity * l.rate - l.discount,
                  })),
                )

                // The challan is a receivable now: bump the customer balance.
                await tx
                  .update(schema.customer)
                  .set({ currentBalance: sql`${schema.customer.currentBalance} + ${challan!.totalAmount}` })
                  .where(eq(schema.customer.id, challan!.customerId))

                // Stock already left at challan time — don't move it again. Just
                // re-point the existing movement rows from the challan to the invoice.
                await tx
                  .update(schema.stockMovement)
                  .set({ referenceType: 'INVOICE', referenceId: inv.id })
                  .where(
                    and(
                      eq(schema.stockMovement.referenceType, 'CHALLAN'),
                      eq(schema.stockMovement.referenceId, challan!.id),
                    ),
                  )

                await tx
                  .update(schema.deliveryChallan)
                  .set({ status: 'CONVERTED', convertedToInvoiceId: inv.id })
                  .where(eq(schema.deliveryChallan.id, challan!.id))
              })
              Alert.alert('Converted', 'A new invoice was created from this challan.')
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
    Alert.alert('Delete challan', 'This reverses the stock that left and cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteChallan(db, id)
            router.back()
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete')
          }
        },
      },
    ])
  }

  const isConverted = challan?.status === 'CONVERTED'

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={false} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }
  if (!challan) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={false} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Challan not found</ThemedText>
        </View>
      </ThemedView>
    )
  }

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!isConverted} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title">{challan.challanNumber}</ThemedText>
            <ThemedText style={styles.muted}>{customerName}</ThemedText>
            <ThemedText style={styles.muted}>{challan.status}</ThemedText>
          </View>
          <View style={styles.heroRight}>
            <ThemedText type="defaultSemiBold" style={styles.heroTotal}>{formatCurrency(challan.totalAmount)}</ThemedText>
          </View>
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

        <Section title="Challan">
          <Row label="Date" value={formatDate(challan.challanDate)} />
          {challan.transportMode ? <Row label="Transport Mode" value={challan.transportMode} /> : null}
          {challan.vehicleNumber ? <Row label="Vehicle Number" value={challan.vehicleNumber} /> : null}
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
          <Row label="Subtotal" value={formatCurrency(challan.subtotal)} />
          <Row label="Tax" value={formatCurrency(challan.taxAmount)} />
          <Row label="Total" value={formatCurrency(challan.totalAmount)} />
        </Section>

        {challan.notes ? <Section title="Notes"><ThemedText style={styles.notesText}>{challan.notes}</ThemedText></Section> : null}

        {isConverted ? (
          <ThemedView lightColor="#dcfce7" darkColor="#14532d" style={styles.convertedNote}>
            <ThemedText style={styles.convertedNoteText}>Converted to invoice</ThemedText>
          </ThemedView>
        ) : (
          <>
            {canConvert ? (
              <Pressable style={[styles.convertButton, converting && styles.disabled]} onPress={handleConvert} disabled={converting}>
                <ThemedText style={styles.convertButtonText}>{converting ? 'Converting…' : 'Convert to Invoice'}</ThemedText>
              </Pressable>
            ) : null}
            <Pressable style={styles.deleteButton} onPress={handleDelete}>
              <ThemedText style={styles.deleteButtonText}>Delete challan</ThemedText>
            </Pressable>
          </>
        )}
      </ScrollView>
      {/* Off-screen pdfmake host — boots in the background, generates on demand. */}
      <HiddenPdfWebView ref={pdfRef} />
    </ThemedView>
  )
}

// Reverses the goods movement: put tracked stock back, drop the audit rows, then
// delete lines + header. Mirrors deletePurchaseBill's reversal shape.
async function deleteChallan(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [dc] = await tx.select().from(schema.deliveryChallan).where(eq(schema.deliveryChallan.id, id)).limit(1)
    if (!dc) throw new Error('Challan not found')

    const existingItems = await tx.select().from(schema.deliveryChallanItem).where(eq(schema.deliveryChallanItem.deliveryChallanId, id))
    const itemRows = await tx.select().from(schema.item)
    const trackById = new Map(itemRows.map((i: typeof schema.item.$inferSelect) => [i.id, i.trackStock]))

    for (const ei of existingItems as ChallanItem[]) {
      if (!trackById.get(ei.itemId)) continue
      await tx
        .update(schema.item)
        .set({ currentStock: sql`${schema.item.currentStock} + ${ei.quantity}` })
        .where(eq(schema.item.id, ei.itemId))
    }

    await tx
      .delete(schema.stockMovement)
      .where(
        and(
          eq(schema.stockMovement.referenceType, 'CHALLAN'),
          eq(schema.stockMovement.referenceId, id),
        ),
      )
    await tx.delete(schema.deliveryChallanItem).where(eq(schema.deliveryChallanItem.deliveryChallanId, id))
    await tx.delete(schema.deliveryChallan).where(eq(schema.deliveryChallan.id, id))
  })
}

function Header({ onBack, onEdit, editEnabled }: { onBack: () => void; onEdit: () => void; editEnabled: boolean }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerButton} hitSlop={8}><ThemedText style={styles.headerArrow}>←</ThemedText></Pressable>
      <ThemedText type="defaultSemiBold" style={styles.headerTitle}>Challan</ThemedText>
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
  convertedNote: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  convertedNoteText: { fontSize: 15, fontWeight: '600', color: '#166534' },
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
