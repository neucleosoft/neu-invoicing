import { and, desc, eq, sql } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { PdfActions } from '@/components/PdfActions'
import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { buildChallanPdfPayload } from '@/utils/challanPdf'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'

type Challan = typeof schema.deliveryChallan.$inferSelect
type ChallanItem = typeof schema.deliveryChallanItem.$inferSelect

type Db = ReturnType<typeof useDb>

// Challan-convert invoice number — a byte-for-byte port of desktop's
// challan:convertToInvoice numbering (challan.ts): prefix from
// company.invoicePrefix (fallback 'INV'), sequence = the GLOBAL last invoice
// number's final '-'-segment + 1. The two apps must mint the SAME number from
// the same data, or converts on different devices fork the series. (The old
// mobile version scoped the sequence to its own INV-year prefix — a silent
// divergence from desktop.)
async function generateChallanInvoiceNumber(tx: any): Promise<string> {
  const [lastInvoice] = await tx
    .select({ invoiceNumber: schema.salesInvoice.invoiceNumber })
    .from(schema.salesInvoice)
    .where(eq(schema.salesInvoice.type, 'INVOICE'))
    .orderBy(desc(schema.salesInvoice.invoiceNumber))
    .limit(1)
  const [company] = await tx
    .select({ invoicePrefix: schema.company.invoicePrefix })
    .from(schema.company)
    .limit(1)
  const prefix = company?.invoicePrefix || 'INV'
  const year = new Date().getFullYear()
  const parsed = lastInvoice
    ? parseInt(lastInvoice.invoiceNumber.split('-').pop() || '0', 10)
    : 0
  const lastNumber = isNaN(parsed) ? 0 : parsed
  return `${prefix}-${year}-${String(lastNumber + 1).padStart(3, '0')}`
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

  function handleCancel() {
    if (!id) return
    Alert.alert('Cancel challan', 'This returns the dispatched stock and marks the challan Cancelled for your records. It cannot be undone.', [
      { text: 'Keep challan', style: 'cancel' },
      {
        text: 'Cancel challan',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelChallan(db, id)
            router.back()
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to cancel')
          }
        },
      },
    ])
  }

  const isConverted = challan?.status === 'CONVERTED'
  const isCancelled = !!challan?.cancelledAt

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
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!isConverted && !isCancelled} />
      <ScrollView contentContainerStyle={styles.content}>
        {isCancelled ? (
          <ThemedView style={styles.cancelledBanner}>
            <ThemedText style={styles.cancelledBannerText}>
              This challan is cancelled — the dispatched stock was returned and it&apos;s left out of reports. It can&apos;t be restored.
            </ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title">{challan.challanNumber}</ThemedText>
            <ThemedText style={styles.muted}>{customerName}</ThemedText>
            <ThemedText style={styles.muted}>{isCancelled ? 'Cancelled' : challan.status}</ThemedText>
          </View>
          <View style={styles.heroRight}>
            <ThemedText type="defaultSemiBold" style={styles.heroTotal}>{formatCurrency(challan.totalAmount)}</ThemedText>
          </View>
        </ThemedView>

        <PdfActions buildPayload={() => buildChallanPdfPayload(db, id)} />

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

        {isCancelled ? null : isConverted ? (
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
            <Pressable style={styles.deleteButton} onPress={handleCancel}>
              <ThemedText style={styles.deleteButtonText}>Cancel challan</ThemedText>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ThemedView>
  )
}

// Cancel (Mode B): return tracked stock by APPENDING a "returned" movement (never
// deleting the originals), then stamp cancelledAt. The challan, its items, and its
// movements all stay on record. Terminal — there is no restore.
async function cancelChallan(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [dc] = await tx.select().from(schema.deliveryChallan).where(eq(schema.deliveryChallan.id, id)).limit(1)
    if (!dc) throw new Error('Challan not found')
    if (dc.cancelledAt) return // already cancelled — never reverse the stock twice
    if (dc.status === 'CONVERTED') {
      throw new Error('This challan was converted to an invoice — cancel the invoice instead.')
    }

    const existingItems = await tx.select().from(schema.deliveryChallanItem).where(eq(schema.deliveryChallanItem.deliveryChallanId, id))
    const itemRows = await tx.select().from(schema.item)
    const trackById = new Map(itemRows.map((i: typeof schema.item.$inferSelect) => [i.id, i.trackStock]))

    for (const ei of existingItems as ChallanItem[]) {
      if (!trackById.get(ei.itemId)) continue
      await tx
        .update(schema.item)
        .set({ currentStock: sql`${schema.item.currentStock} + ${ei.quantity}` })
        .where(eq(schema.item.id, ei.itemId))
      await tx.insert(schema.stockMovement).values({
        itemId: ei.itemId,
        movementType: 'DELIVERY',
        quantity: ei.quantity, // positive = goods returned by the cancel
        referenceType: 'CHALLAN',
        referenceId: id,
        notes: 'Challan cancelled — stock returned',
      })
    }

    await tx
      .update(schema.deliveryChallan)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.deliveryChallan.id, id))
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
  cancelledBanner: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#fecaca' },
  cancelledBannerText: { color: '#991b1b', fontSize: 13, lineHeight: 18 },
  convertedNote: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  convertedNoteText: { fontSize: 15, fontWeight: '600', color: '#166534' },
})
