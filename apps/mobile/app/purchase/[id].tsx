import { eq } from 'drizzle-orm'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { PdfActions } from '@/components/PdfActions'
import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { useAuth } from '@/auth'
import { schema, useDb } from '@/db'
import { ensureBillAttachment } from '@/sync/imageStore'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { createPayment } from '@/utils/paymentSave'
import { buildPurchaseBillPdfPayload } from '@/utils/purchaseBillPdf'
import { cancelPurchaseBill } from '@/utils/purchaseSave'

const PAY_MODES = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'] as const

type PurchaseBill = typeof schema.purchaseBill.$inferSelect
type PurchaseBillItem = typeof schema.purchaseBillItem.$inferSelect

const BILL_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT: { label: 'Unpaid', bg: '#fee2e2', text: '#991b1b' },
  PARTIAL: { label: 'Partial', bg: '#fef9c3', text: '#854d0e' },
  PAID: { label: 'Paid', bg: '#dcfce7', text: '#166534' },
}

type LineWithName = PurchaseBillItem & { name: string }

export default function PurchaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const { getFreshAccessToken } = useAuth()
  const onEdit = () => router.push({ pathname: '/purchase/edit/[id]', params: { id } })

  const [bill, setBill] = useState<PurchaseBill | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [lines, setLines] = useState<LineWithName[]>([])
  const [loading, setLoading] = useState(true)
  // Data URI of the attached bill photo, built once from the stored blob.
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [showPhoto, setShowPhoto] = useState(false)
  const [linkedPoNumber, setLinkedPoNumber] = useState<string | null>(null)

  // Record-payment-against-THIS-bill (mirrors desktop's bill-detail action).
  // Goes through the shared payment logic, so the bill's amountPaid/balanceDue/
  // status and the supplier balance all move together.
  const [showPayModal, setShowPayModal] = useState(false)
  const [payAmountStr, setPayAmountStr] = useState('')
  const [payMode, setPayMode] = useState<string>('CASH')
  const [paySaving, setPaySaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    async function load() {
      const [b] = await db
        .select()
        .from(schema.purchaseBill)
        .where(eq(schema.purchaseBill.id, id))
        .limit(1)
      if (!b) {
        setLoading(false)
        return
      }
      setBill(b)

      // The blob comes back as a Buffer (via the global polyfill); turn it into
      // a data URI so expo-image can render it. Only when a photo was saved.
      if (b.attachmentData && b.attachmentMimeType) {
        const buf = b.attachmentData as unknown as { toString: (enc: string) => string }
        const base64 = buf.toString('base64')
        setPhotoUri(`data:${b.attachmentMimeType};base64,${base64}`)
      } else if (b.attachmentMimeType && !b.attachmentData) {
        // Synced-in bill: the photo lives on Drive as its own file (S4 image
        // split) — fetch it lazily on first view, then it's local forever.
        void (async () => {
          const token = await getFreshAccessToken()
          if (!token) return
          if (await ensureBillAttachment(db, token, id)) {
            const [fresh] = await db
              .select({
                attachmentData: schema.purchaseBill.attachmentData,
                attachmentMimeType: schema.purchaseBill.attachmentMimeType,
              })
              .from(schema.purchaseBill)
              .where(eq(schema.purchaseBill.id, id))
              .limit(1)
            if (fresh?.attachmentData && fresh.attachmentMimeType) {
              const buf = fresh.attachmentData as unknown as { toString: (enc: string) => string }
              setPhotoUri(`data:${fresh.attachmentMimeType};base64,${buf.toString('base64')}`)
            }
          }
        })()
      }

      const [sup] = await db
        .select({ name: schema.supplier.name })
        .from(schema.supplier)
        .where(eq(schema.supplier.id, b.supplierId))
        .limit(1)
      setSupplierName(sup?.name ?? 'Unknown supplier')

      if (b.purchaseOrderId) {
        const [po] = await db
          .select({ orderNumber: schema.purchaseOrder.orderNumber })
          .from(schema.purchaseOrder)
          .where(eq(schema.purchaseOrder.id, b.purchaseOrderId))
          .limit(1)
        setLinkedPoNumber(po?.orderNumber ?? null)
      }

      const billItems = await db
        .select()
        .from(schema.purchaseBillItem)
        .where(eq(schema.purchaseBillItem.purchaseBillId, id))
      const cat = await db
        .select()
        .from(schema.supplierItem)
        .where(eq(schema.supplierItem.supplierId, b.supplierId))
      const nameById = new Map(cat.map((c) => [c.id, c.name]))
      setLines(billItems.map((bi) => ({ ...bi, name: nameById.get(bi.supplierItemId) ?? 'Item' })))
      setLoading(false)
    }
    load()
  }, [id, db, getFreshAccessToken, refreshKey])

  async function handleRecordPayment() {
    if (!bill) return
    const amount = parseFloat(payAmountStr) || 0
    if (amount <= 0) {
      Alert.alert('Validation', 'Enter a payment amount')
      return
    }
    if (amount > bill.balanceDue + 0.005) {
      Alert.alert('Validation', `Amount exceeds the balance due (${formatCurrency(bill.balanceDue)})`)
      return
    }
    setPaySaving(true)
    try {
      await createPayment(db, {
        type: 'PAYMENT_OUT',
        customerId: null,
        supplierId: bill.supplierId,
        amount,
        paymentMode: payMode,
        paymentDate: new Date(),
        notes: `Payment for ${bill.billNumber}`,
        purchaseBillId: bill.id,
        referenceType: 'BILL',
      })
      setShowPayModal(false)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to record payment')
    } finally {
      setPaySaving(false)
    }
  }

  function handleCancel() {
    if (!id) return
    Alert.alert(
      'Cancel purchase bill',
      'This reverses the supplier balance and any stock it added, and marks the bill Cancelled for your records. It cannot be undone.',
      [
        { text: 'Keep bill', style: 'cancel' },
        {
          text: 'Cancel bill',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelPurchaseBill(db, id)
              router.back()
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Failed to cancel'
              Alert.alert('Error', msg)
            }
          },
        },
      ],
    )
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!bill} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }

  if (!bill) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!bill} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Purchase bill not found</ThemedText>
          <ThemedText style={styles.muted}>This bill may have been deleted.</ThemedText>
        </View>
      </ThemedView>
    )
  }

  const badge = BILL_STATUS[bill.status] ?? BILL_STATUS.DRAFT
  const isCancelled = !!bill.cancelledAt

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!bill && !isCancelled} />
      <ScrollView contentContainerStyle={styles.content}>
        {isCancelled ? (
          <ThemedView style={styles.cancelledBanner}>
            <ThemedText style={styles.cancelledBannerText}>
              This bill is cancelled — its supplier balance and stock were reversed and it&apos;s left out of reports. It can&apos;t be restored.
            </ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title">{bill.billNumber}</ThemedText>
            <ThemedText style={styles.muted}>{supplierName}</ThemedText>
            {isCancelled ? (
              <View style={styles.cancelledBadge}>
                <ThemedText style={styles.cancelledBadgeText}>Cancelled</ThemedText>
              </View>
            ) : (
              <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                <ThemedText style={[styles.statusBadgeText, { color: badge.text }]}>{badge.label}</ThemedText>
              </View>
            )}
          </View>
          <View style={styles.heroRight}>
            <ThemedText type="defaultSemiBold" style={styles.heroTotal}>
              {formatCurrency(bill.totalAmount)}
            </ThemedText>
          </View>
        </ThemedView>

        <PdfActions buildPayload={() => buildPurchaseBillPdfPayload(db, id)} />

        <Section title="Bill">
          <Row label="Bill Date" value={formatDate(bill.billDate)} />
          <Row label="Supplier Inv. #" value={bill.supplierInvoiceNumber || '—'} />
          {linkedPoNumber ? <Row label="Linked PO" value={linkedPoNumber} /> : null}
          {bill.supplierInvoiceDate ? (
            <Row label="Supplier Inv. Date" value={formatDate(bill.supplierInvoiceDate)} />
          ) : null}
        </Section>

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.itemsCard}>
          <ThemedText type="defaultSemiBold" style={styles.itemsTitle}>
            Items ({lines.length})
          </ThemedText>
          {lines.map((l, idx) => (
            <View key={l.id} style={[styles.itemRow, idx > 0 && styles.itemRowDivider]}>
              <View style={styles.itemLeft}>
                <ThemedText numberOfLines={2}>{l.name}</ThemedText>
                <ThemedText style={styles.itemMeta}>
                  {l.quantity} × {formatCurrency(l.rate)}
                  {l.discount ? ` − ${formatCurrency(l.discount)}` : ''} · {l.taxRate}% tax
                </ThemedText>
              </View>
              <ThemedText type="defaultSemiBold">{formatCurrency(l.total)}</ThemedText>
            </View>
          ))}
        </ThemedView>

        <Section title="Totals">
          <Row label="Subtotal" value={formatCurrency(bill.subtotal)} />
          <Row label="Tax" value={formatCurrency(bill.taxAmount)} />
          <Row label="Total" value={formatCurrency(bill.totalAmount)} />
          <Row label="Amount Paid" value={formatCurrency(bill.amountPaid)} />
          <Row label="Balance Due" value={formatCurrency(bill.balanceDue)} />
        </Section>

        {!isCancelled && bill.balanceDue > 0.005 ? (
          <Pressable
            style={styles.payButton}
            onPress={() => {
              setPayAmountStr(String(bill.balanceDue))
              setPayMode('CASH')
              setShowPayModal(true)
            }}
          >
            <ThemedText style={styles.payButtonText}>Record Payment</ThemedText>
          </Pressable>
        ) : null}

        {bill.notes ? (
          <Section title="Notes">
            <ThemedText style={styles.notesText}>{bill.notes}</ThemedText>
          </Section>
        ) : null}

        {photoUri ? (
          <Pressable style={styles.photoButton} onPress={() => setShowPhoto(true)}>
            <ThemedText style={styles.photoButtonText}>View original bill photo</ThemedText>
          </Pressable>
        ) : null}

        {isCancelled ? null : (
          <Pressable style={styles.deleteButton} onPress={handleCancel}>
            <ThemedText style={styles.deleteButtonText}>Cancel bill</ThemedText>
          </Pressable>
        )}
      </ScrollView>

      {photoUri ? (
        <Modal visible={showPhoto} transparent animationType="fade">
          <Pressable style={styles.photoOverlay} onPress={() => setShowPhoto(false)}>
            <Image source={{ uri: photoUri }} style={styles.photoFull} contentFit="contain" />
            <ThemedText style={styles.photoCloseHint}>Tap anywhere to close</ThemedText>
          </Pressable>
        </Modal>
      ) : null}

      <Modal visible={showPayModal} transparent animationType="slide">
        <View style={styles.payOverlay}>
          <ThemedView style={styles.payCard}>
            <ThemedText type="subtitle">Record Payment</ThemedText>
            <ThemedText style={styles.payHint}>
              Pays down this bill and the supplier&apos;s balance together.
            </ThemedText>
            <ThemedText style={styles.payLabel}>Amount (due {formatCurrency(bill.balanceDue)})</ThemedText>
            <TextInput
              value={payAmountStr}
              onChangeText={setPayAmountStr}
              keyboardType="decimal-pad"
              style={styles.payInput}
              placeholderTextColor="#999"
            />
            <View style={styles.payModes}>
              {PAY_MODES.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setPayMode(m)}
                  style={[styles.payModeChip, payMode === m && styles.payModeChipActive]}
                >
                  <ThemedText style={payMode === m ? styles.payModeTextActive : styles.payModeText}>
                    {m === 'BANK_TRANSFER' ? 'Bank' : m[0] + m.slice(1).toLowerCase()}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <View style={styles.payActions}>
              <Pressable style={styles.payCancel} onPress={() => setShowPayModal(false)} disabled={paySaving}>
                <ThemedText>Cancel</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.paySave, paySaving && styles.paySaveDisabled]}
                onPress={handleRecordPayment}
                disabled={paySaving}
              >
                <ThemedText style={styles.paySaveText}>{paySaving ? 'Saving…' : 'Save payment'}</ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>
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
        Purchase Bill
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
  payButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  payButtonText: { color: 'white', fontWeight: '600' },
  payOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  payCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 36,
    gap: 10,
  },
  payHint: { fontSize: 13, opacity: 0.7 },
  payLabel: { fontSize: 13, opacity: 0.8, marginTop: 4 },
  payInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  payModes: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  payModeChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  payModeChipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  payModeText: { fontSize: 13 },
  payModeTextActive: { fontSize: 13, color: 'white', fontWeight: '600' },
  payActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8, alignItems: 'center' },
  payCancel: { paddingVertical: 10, paddingHorizontal: 12 },
  paySave: {
    backgroundColor: '#16a34a',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  paySaveDisabled: { opacity: 0.5 },
  paySaveText: { color: 'white', fontWeight: '600' },
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
  heroLeft: { flex: 1, gap: 6, alignItems: 'flex-start' },
  heroRight: { alignItems: 'flex-end' },
  heroTotal: { fontSize: 22 },
  muted: { opacity: 0.6, fontSize: 13 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText: { fontSize: 11, fontWeight: '600' },
  itemsCard: { borderRadius: 12, padding: 14, gap: 4 },
  itemsTitle: { marginBottom: 8 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    gap: 12,
  },
  itemRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d1d5db',
  },
  itemLeft: { flex: 1, gap: 2 },
  itemMeta: { fontSize: 12, opacity: 0.6 },
  notesText: { fontSize: 14, lineHeight: 20, paddingVertical: 4 },
  photoButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  photoButtonText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
  deleteButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  deleteButtonText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  cancelledBanner: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#fecaca' },
  cancelledBannerText: { color: '#991b1b', fontSize: 13, lineHeight: 18 },
  cancelledBadge: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#e5e7eb' },
  cancelledBadgeText: { fontSize: 10, fontWeight: '600', color: '#6b7280' },
  photoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  photoFull: { width: '100%', height: '85%' },
  photoCloseHint: { color: 'white', opacity: 0.7, marginTop: 12, fontSize: 13 },
})
