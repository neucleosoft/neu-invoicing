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
import {
  deriveDisplayStatus,
  dueCountdownColor,
  formatInvoiceStatus,
  getDueCountdown,
  STATUS_BADGE_COLORS,
} from '@/utils/invoiceStatus'

type Invoice = typeof schema.salesInvoice.$inferSelect
type Customer = typeof schema.customer.$inferSelect
type LineItem = typeof schema.salesInvoiceItem.$inferSelect
type LineRow = LineItem & { itemName: string | null }

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () =>
    router.push({ pathname: '/invoice/edit/[id]', params: { id } })
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [loading, setLoading] = useState(true)

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
  }, [id, db])

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!invoice} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }

  if (!invoice) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!invoice} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Invoice not found</ThemedText>
          <ThemedText style={styles.muted}>
            This invoice may have been deleted.
          </ThemedText>
        </View>
      </ThemedView>
    )
  }

  const displayStatus = deriveDisplayStatus(
    invoice.status,
    invoice.dueDate,
    invoice.amountPaid,
    invoice.totalAmount,
  )
  const badge = STATUS_BADGE_COLORS[displayStatus] ?? STATUS_BADGE_COLORS.DRAFT
  const countdown = getDueCountdown(
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
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!invoice} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title" numberOfLines={1}>
              {invoice.invoiceNumber}
            </ThemedText>
            <ThemedText style={styles.muted} numberOfLines={1}>
              {customer?.name ?? 'Unknown customer'}
            </ThemedText>
            <ThemedText style={styles.muted}>
              {formatDate(invoice.invoiceDate)}
            </ThemedText>
          </View>
          <View style={styles.heroRight}>
            <ThemedText type="defaultSemiBold" style={styles.heroAmount}>
              {formatCurrency(invoice.totalAmount)}
            </ThemedText>
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <ThemedText style={[styles.statusBadgeText, { color: badge.text }]}>
                {formatInvoiceStatus(displayStatus)}
              </ThemedText>
            </View>
            {countdown ? (
              <ThemedText
                style={[styles.countdownText, { color: dueCountdownColor[countdown.tone] }]}
              >
                {countdown.text}
              </ThemedText>
            ) : null}
          </View>
        </ThemedView>

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
                <ThemedText style={styles.linkValue}>
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
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Items ({lines.length})
          </ThemedText>
          <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.itemsBody}>
            {lines.length === 0 ? (
              <ThemedText style={[styles.muted, styles.emptyItems]}>
                No line items.
              </ThemedText>
            ) : (
              lines.map((line, idx) => (
                <View
                  key={line.id}
                  style={[
                    styles.lineItem,
                    idx > 0 && styles.lineItemDivider,
                  ]}
                >
                  <View style={styles.lineItemTop}>
                    <ThemedText type="defaultSemiBold" style={styles.lineItemName} numberOfLines={2}>
                      {line.itemName ?? 'Deleted item'}
                    </ThemedText>
                    <ThemedText type="defaultSemiBold">
                      {formatCurrency(line.total)}
                    </ThemedText>
                  </View>
                  <View style={styles.lineItemBottom}>
                    <ThemedText style={styles.muted}>
                      {line.quantity} × {formatCurrency(line.rate)}
                    </ThemedText>
                    {line.taxRate > 0 ? (
                      <ThemedText style={styles.muted}>
                        GST {line.taxRate}%
                      </ThemedText>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </ThemedView>
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
              <ThemedText type="defaultSemiBold">
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
                  type="defaultSemiBold"
                  style={{ color: '#b91c1c' }}
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
        Invoice
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
  heroRight: { alignItems: 'flex-end', gap: 4 },
  heroAmount: { fontSize: 22 },
  muted: { opacity: 0.6, fontSize: 13 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: '600' },
  countdownText: { fontSize: 11, fontWeight: '500' },
  linkValue: { color: '#0a7ea4', fontWeight: '500', textAlign: 'right' },
  section: { gap: 8 },
  sectionTitle: { paddingHorizontal: 4 },
  itemsBody: { borderRadius: 12, paddingVertical: 4 },
  emptyItems: { textAlign: 'center', paddingVertical: 16 },
  lineItem: { paddingVertical: 10, paddingHorizontal: 14, gap: 4 },
  lineItemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d1d5db' },
  lineItemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  lineItemName: { flex: 1 },
  lineItemBottom: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
})
