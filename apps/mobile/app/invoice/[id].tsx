import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { PdfActions } from '@/components/PdfActions'
import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { MoneyText } from '@/components/ui/MoneyText'
import { Radius, Spacing, Type } from '@/constants/tokens'
import { useColors, type AppColors } from '@/hooks/use-colors'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { buildInvoicePdfPayload } from '@/utils/invoicePdf'
import {
  deriveDisplayStatus,
  dueCountdownColor,
  formatInvoiceStatus,
  getDueCountdown,
  STATUS_BADGE_COLORS,
} from '@/utils/invoiceStatus'
import { cancelInvoice, cancelInvoiceWithCreditNote } from '@/utils/salesCancel'

type Invoice = typeof schema.salesInvoice.$inferSelect
type Customer = typeof schema.customer.$inferSelect
type LineItem = typeof schema.salesInvoiceItem.$inferSelect
type LineRow = LineItem & { itemName: string | null }

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const c = useColors()
  const onEdit = () =>
    router.push({ pathname: '/invoice/edit/[id]', params: { id } })
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)

  // Cancel a paid invoice via credit note, an unpaid one with a plain void. Mirrors
  // desktop's handleCancel fork (Sales.tsx). Re-loads the screen so the new
  // Cancelled/Reversed state shows immediately.
  const handleCancel = () => {
    if (!invoice) return
    if ((invoice.amountPaid ?? 0) > 0) {
      Alert.alert(
        'Reverse with credit note?',
        "This invoice has a payment, so it can't just be voided. A full credit note will be issued, the sale reversed, stock returned, and the customer left in credit. The invoice stays on record.",
        [
          { text: 'Keep invoice', style: 'cancel' },
          {
            text: 'Issue credit note',
            style: 'destructive',
            onPress: async () => {
              try {
                await cancelInvoiceWithCreditNote(db, id)
                setRefresh((n) => n + 1)
              } catch (e) {
                Alert.alert('Error', e instanceof Error ? e.message : 'Failed to reverse invoice')
              }
            },
          },
        ],
      )
    } else {
      Alert.alert(
        'Cancel this invoice?',
        'The customer balance and any stock it moved are reversed, and it is marked Cancelled. This cannot be undone.',
        [
          { text: 'Keep invoice', style: 'cancel' },
          {
            text: 'Cancel invoice',
            style: 'destructive',
            onPress: async () => {
              try {
                await cancelInvoice(db, id)
                setRefresh((n) => n + 1)
              } catch (e) {
                Alert.alert('Error', e instanceof Error ? e.message : 'Failed to cancel invoice')
              }
            },
          },
        ],
      )
    }
  }

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    // Run both queries in parallel — invoice header + line items are independent.
    Promise.all([
      db
        .select({ invoice: schema.salesInvoice, customer: schema.customer })
        .from(schema.salesInvoice)
        .leftJoin(
          schema.customer,
          eq(schema.salesInvoice.customerId, schema.customer.id),
        )
        .where(eq(schema.salesInvoice.id, id))
        .limit(1),
      db
        .select({ line: schema.salesInvoiceItem, itemName: schema.item.name })
        .from(schema.salesInvoiceItem)
        .leftJoin(
          schema.item,
          eq(schema.salesInvoiceItem.itemId, schema.item.id),
        )
        .where(eq(schema.salesInvoiceItem.salesInvoiceId, id)),
    ]).then(([header, lineRows]) => {
      const h = header[0]
      setInvoice(h?.invoice ?? null)
      setCustomer(h?.customer ?? null)
      setLines(
        lineRows.map((r) => ({ ...r.line, itemName: r.itemName })),
      )
      setLoading(false)
    })
  }, [id, db, refresh])

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <Header c={c} onBack={() => router.back()} onEdit={onEdit} editEnabled={!!invoice} />
        <ThemedText style={[styles.centered, { color: c.muted }]}>Loading…</ThemedText>
      </View>
    )
  }

  if (!invoice) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <Header c={c} onBack={() => router.back()} onEdit={onEdit} editEnabled={!!invoice} />
        <View style={styles.centeredBlock}>
          <ThemedText style={[Type.subtitle, { color: c.text }]}>Invoice not found</ThemedText>
          <ThemedText style={[Type.body, { color: c.muted }]}>
            This invoice may have been deleted.
          </ThemedText>
        </View>
      </View>
    )
  }

  const isCancelled = !!invoice.cancelledAt
  const isReversed = invoice.status === 'REVERSED'
  const isInactive = isCancelled || isReversed

  const displayStatus = deriveDisplayStatus(
    invoice.status,
    invoice.dueDate,
    invoice.amountPaid,
    invoice.totalAmount,
  )
  const badge = STATUS_BADGE_COLORS[displayStatus] ?? STATUS_BADGE_COLORS.DRAFT
  // Cancelled isn't a stored status (it's the cancelledAt flag), so label the chip
  // here; Reversed flows through displayStatus → STATUS_BADGE_COLORS.REVERSED.
  const chip = isCancelled
    ? { label: 'Cancelled', bg: '#f3f4f6', text: '#4b5563' }
    : { label: formatInvoiceStatus(displayStatus), bg: badge.bg, text: badge.text }
  const countdown = isInactive
    ? null
    : getDueCountdown(
        invoice.dueDate,
        invoice.status,
        invoice.amountPaid,
        invoice.totalAmount,
      )

  const hasDiscount = invoice.discount > 0
  const hasCess = invoice.cessAmount > 0
  const hasPayments = invoice.amountPaid > 0
  const hasBalance = invoice.balanceDue > 0

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <Header
        c={c}
        onBack={() => router.back()}
        onEdit={onEdit}
        editEnabled={!!invoice && !isInactive}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {isInactive ? (
          <View style={[styles.banner, { backgroundColor: chip.bg }]}>
            <ThemedText style={[Type.bodySemibold, { color: chip.text }]}>
              {isReversed
                ? 'Reversed — a credit note was issued against this invoice.'
                : 'Cancelled — this invoice has been voided.'}
            </ThemedText>
          </View>
        ) : null}
        <Card style={[styles.hero, isInactive && styles.dimmed]}>
          <View style={styles.heroLeft}>
            <ThemedText style={[Type.title, { color: c.text }]} numberOfLines={1}>
              {invoice.invoiceNumber}
            </ThemedText>
            <ThemedText style={[Type.body, { color: c.muted }]} numberOfLines={1}>
              {customer?.name ?? 'Unknown customer'}
            </ThemedText>
            <ThemedText style={[Type.body, { color: c.muted }]}>
              {formatDate(invoice.invoiceDate)}
            </ThemedText>
          </View>
          <View style={styles.heroRight}>
            <MoneyText value={invoice.totalAmount} style={styles.heroAmount} />
            <Chip label={chip.label} bg={chip.bg} color={chip.text} />
            {countdown ? (
              <ThemedText
                style={[Type.caption, { color: dueCountdownColor[countdown.tone] }]}
              >
                {countdown.text}
              </ThemedText>
            ) : null}
          </View>
        </Card>

        <PdfActions buildPayload={() => buildInvoicePdfPayload(db, id)} />

        <Section title="Customer">
          <Pressable
            onPress={() =>
              customer &&
              router.push({
                pathname: '/customer/[id]',
                params: { id: customer.id },
              })
            }
          >
            <Row
              label="Name"
              value={
                <ThemedText style={[styles.linkValue, { color: c.accentDeep }]}>
                  {customer?.name ?? 'Unknown'}
                </ThemedText>
              }
            />
          </Pressable>
          <Row label="Phone" value={customer?.phone || '—'} />
          <Row label="GSTIN" value={customer?.taxId || '—'} />
        </Section>

        <Section title="Dates">
          <Row label="Invoice Date" value={formatDate(invoice.invoiceDate)} />
          <Row
            label="Due Date"
            value={invoice.dueDate ? formatDate(invoice.dueDate) : '—'}
          />
        </Section>

        <View style={styles.section}>
          <ThemedText style={[Type.subtitle, styles.sectionTitle, { color: c.text }]}>
            Items ({lines.length})
          </ThemedText>
          <View style={[styles.itemsBody, { backgroundColor: c.surface, borderColor: c.border }]}>
            {lines.length === 0 ? (
              <ThemedText style={[Type.body, styles.emptyItems, { color: c.muted }]}>
                No line items.
              </ThemedText>
            ) : (
              lines.map((line, idx) => (
                <View
                  key={line.id}
                  style={[
                    styles.lineItem,
                    idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                  ]}
                >
                  <View style={styles.lineItemTop}>
                    <ThemedText style={[Type.bodySemibold, styles.lineItemName, { color: c.text }]} numberOfLines={2}>
                      {line.itemName ?? 'Deleted item'}
                    </ThemedText>
                    <ThemedText style={[Type.bodySemibold, { color: c.text }]}>
                      {formatCurrency(line.total)}
                    </ThemedText>
                  </View>
                  <View style={styles.lineItemBottom}>
                    <ThemedText style={[Type.caption, { color: c.muted }]}>
                      {line.quantity} × {formatCurrency(line.rate)}
                    </ThemedText>
                    {line.taxRate > 0 ? (
                      <ThemedText style={[Type.caption, { color: c.muted }]}>
                        GST {line.taxRate}%
                      </ThemedText>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </View>
        </View>

        <Section title="Totals">
          <Row label="Subtotal" value={formatCurrency(invoice.subtotal)} />
          {hasDiscount ? (
            <Row label="Discount" value={`− ${formatCurrency(invoice.discount)}`} />
          ) : null}
          {invoice.isInterState ? (
            <Row label="IGST" value={formatCurrency(invoice.igstAmount)} />
          ) : (
            <>
              <Row label="CGST" value={formatCurrency(invoice.cgstAmount)} />
              <Row label="SGST" value={formatCurrency(invoice.sgstAmount)} />
            </>
          )}
          {hasCess ? (
            <Row label="Cess" value={formatCurrency(invoice.cessAmount)} />
          ) : null}
          <Row
            label="Total"
            value={
              <ThemedText style={[Type.bodySemibold, { color: c.text }]}>
                {formatCurrency(invoice.totalAmount)}
              </ThemedText>
            }
          />
          {hasPayments ? (
            <Row label="Amount Paid" value={formatCurrency(invoice.amountPaid)} />
          ) : null}
          {hasBalance ? (
            <Row
              label="Balance Due"
              value={
                <ThemedText
                  style={[Type.bodySemibold, { color: c.danger }]}
                >
                  {formatCurrency(invoice.balanceDue)}
                </ThemedText>
              }
            />
          ) : null}
        </Section>

        <Section title="Details">
          <Row label="Place of Supply" value={invoice.placeOfSupplyName || '—'} />
          <Row label="Supply Type" value={invoice.supplyType} />
          {invoice.notes ? <Row label="Notes" value={invoice.notes} /> : null}
          <Row label="Created" value={formatDate(invoice.createdAt)} />
          <Row label="Updated" value={formatDate(invoice.updatedAt)} />
        </Section>

        {!isInactive ? (
          <Pressable
            onPress={handleCancel}
            style={[styles.cancelButton, { borderColor: c.danger }]}
          >
            <ThemedText style={[Type.bodySemibold, { color: c.danger }]}>
              {(invoice.amountPaid ?? 0) > 0 ? 'Reverse with Credit Note' : 'Cancel Invoice'}
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  )
}

function Header({
  c,
  onBack,
  onEdit,
  editEnabled,
}: {
  c: AppColors
  onBack: () => void
  onEdit: () => void
  editEnabled: boolean
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerButton} hitSlop={8}>
        <ThemedText style={[styles.headerArrow, { color: c.text }]}>←</ThemedText>
      </Pressable>
      <ThemedText style={[Type.subtitle, styles.headerTitle, { color: c.text }]}>
        Invoice
      </ThemedText>
      <Pressable
        onPress={onEdit}
        disabled={!editEnabled}
        style={[styles.headerButton, !editEnabled && styles.headerButtonDisabled]}
      >
        <ThemedText style={[styles.headerButtonText, { color: c.accentDeep }]}>Edit</ThemedText>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  headerButton: { paddingVertical: 6, paddingHorizontal: 10 },
  headerButtonDisabled: { opacity: 0.3 },
  headerButtonText: { fontSize: 16, fontWeight: '600' },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },
  centered: { textAlign: 'center', marginTop: 64 },
  centeredBlock: { alignItems: 'center', marginTop: 64, gap: Spacing.sm, paddingHorizontal: Spacing.xxxl },
  banner: {
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  dimmed: { opacity: 0.6 },
  cancelButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  heroLeft: { flex: 1, gap: Spacing.xs },
  heroRight: { alignItems: 'flex-end', gap: Spacing.xs },
  heroAmount: { fontSize: 22 },
  section: { gap: Spacing.sm },
  sectionTitle: { paddingHorizontal: Spacing.xs },
  linkValue: { fontWeight: '500', textAlign: 'right' },
  itemsBody: {
    borderRadius: Radius.lg,
    paddingVertical: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyItems: { textAlign: 'center', paddingVertical: Spacing.lg },
  lineItem: { paddingVertical: 10, paddingHorizontal: 14, gap: Spacing.xs },
  lineItemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md },
  lineItemName: { flex: 1 },
  lineItemBottom: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
})
