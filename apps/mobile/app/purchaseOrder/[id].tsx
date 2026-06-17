import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { PdfActions } from '@/components/PdfActions'
import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { buildPurchaseOrderPdfPayload } from '@/utils/purchaseOrderPdf'
import { deletePurchaseOrder, markPoReceived, restorePurchaseOrder } from '@/utils/poSave'

type PurchaseOrder = typeof schema.purchaseOrder.$inferSelect
type POItem = typeof schema.purchaseOrderItem.$inferSelect

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PARTIALLY_RECEIVED: 'Partially Received',
  RECEIVED: 'Received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

export default function PurchaseOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () => router.push({ pathname: '/purchaseOrder/edit/[id]', params: { id } })

  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [lines, setLines] = useState<(POItem & { name: string })[]>([])
  const [loading, setLoading] = useState(true)

  // Mark-received modal: maps lineId → the received qty being entered.
  const [showReceive, setShowReceive] = useState(false)
  const [received, setReceived] = useState<Record<string, string>>({})
  const [savingReceive, setSavingReceive] = useState(false)

  const load = async () => {
    if (!id) { setLoading(false); return }
    const [p] = await db.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, id)).limit(1)
    if (!p) { setLoading(false); return }
    setPo(p)
    const [s] = await db.select({ name: schema.supplier.name }).from(schema.supplier).where(eq(schema.supplier.id, p.supplierId)).limit(1)
    setSupplierName(s?.name ?? 'Unknown')
    const its = await db.select().from(schema.purchaseOrderItem).where(eq(schema.purchaseOrderItem.purchaseOrderId, id))
    const cat = await db.select().from(schema.supplierItem)
    const nameById = new Map(cat.map((c) => [c.id, c.name]))
    setLines(its.map((it) => ({ ...it, name: nameById.get(it.supplierItemId) ?? 'Item' })))
    setLoading(false)
  }

  useEffect(() => { load() }, [id, db])

  function openReceive() {
    const init: Record<string, string> = {}
    lines.forEach((l) => { init[l.id] = String(l.receivedQuantity) })
    setReceived(init)
    setShowReceive(true)
  }

  async function handleReceive() {
    if (!id) return
    setSavingReceive(true)
    try {
      const updates = lines.map((l) => ({ lineId: l.id, receivedQuantity: parseFloat(received[l.id]) || 0 }))
      await markPoReceived(db, id, updates)
      setShowReceive(false)
      await load()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setSavingReceive(false)
    }
  }

  function handleDelete() {
    if (!id) return
    Alert.alert('Delete purchase order', 'It will be marked Deleted and left out of totals and reports. You can restore it anytime.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deletePurchaseOrder(db, id); router.back() }
        catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete') }
      } },
    ])
  }

  function handleRestore() {
    if (!id) return
    restorePurchaseOrder(db, id)
      .then(() => router.back())
      .catch((e) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed to restore'))
  }

  if (loading) return <ThemedView style={styles.container}><Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!po} /><ThemedText style={styles.centered}>Loading…</ThemedText></ThemedView>
  if (!po) return <ThemedView style={styles.container}><Header onBack={() => router.back()} onEdit={onEdit} editEnabled={false} /><View style={styles.centeredBlock}><ThemedText type="subtitle">Purchase order not found</ThemedText></View></ThemedView>

  const isDeleted = !!po.deletedAt

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled />
      <ScrollView contentContainerStyle={styles.content}>
        {isDeleted ? (
          <ThemedView style={styles.deletedBanner}>
            <ThemedText style={styles.deletedBannerText}>
              This purchase order is deleted — it's left out of totals and reports. Restore it to use it again.
            </ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title">{po.orderNumber}</ThemedText>
            <ThemedText style={styles.muted}>{supplierName}</ThemedText>
            <ThemedText style={styles.muted}>{STATUS_LABEL[po.status] ?? po.status}</ThemedText>
          </View>
          <View style={styles.heroRight}><ThemedText type="defaultSemiBold" style={styles.heroTotal}>{formatCurrency(po.totalAmount)}</ThemedText></View>
        </ThemedView>

        <Section title="Order">
          <Row label="Order Date" value={formatDate(po.orderDate)} />
          {po.expectedDate ? <Row label="Expected" value={formatDate(po.expectedDate)} /> : null}
        </Section>

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.itemsCard}>
          <ThemedText type="defaultSemiBold" style={styles.itemsTitle}>Items ({lines.length})</ThemedText>
          {lines.map((l, idx) => (
            <View key={l.id} style={[styles.itemRow, idx > 0 && styles.itemRowDivider]}>
              <View style={styles.itemLeft}>
                <ThemedText numberOfLines={2}>{l.name}</ThemedText>
                <ThemedText style={styles.itemMeta}>{l.quantity} × {formatCurrency(l.rate)} · received {l.receivedQuantity}/{l.quantity}</ThemedText>
              </View>
              <ThemedText type="defaultSemiBold">{formatCurrency(l.total)}</ThemedText>
            </View>
          ))}
        </ThemedView>

        <Section title="Totals">
          <Row label="Subtotal" value={formatCurrency(po.subtotal)} />
          <Row label="Tax" value={formatCurrency(po.taxAmount)} />
          <Row label="Total" value={formatCurrency(po.totalAmount)} />
        </Section>

        {po.notes ? <Section title="Notes"><ThemedText style={styles.notesText}>{po.notes}</ThemedText></Section> : null}

        <PdfActions buildPayload={() => buildPurchaseOrderPdfPayload(db, id)} />
        {isDeleted ? (
          <Pressable style={styles.restoreButton} onPress={handleRestore}><ThemedText style={styles.restoreButtonText}>Restore order</ThemedText></Pressable>
        ) : (
          <>
            <Pressable style={styles.receiveButton} onPress={openReceive}><ThemedText style={styles.receiveButtonText}>Mark Received</ThemedText></Pressable>
            <Pressable style={styles.deleteButton} onPress={handleDelete}><ThemedText style={styles.deleteButtonText}>Delete order</ThemedText></Pressable>
          </>
        )}
      </ScrollView>

      <Modal visible={showReceive} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Mark Received</ThemedText>
            <ThemedText style={styles.muted}>Enter how many of each line have arrived.</ThemedText>
            <ScrollView style={{ maxHeight: 360 }}>
              {lines.map((l) => (
                <View key={l.id} style={styles.receiveRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText numberOfLines={1}>{l.name}</ThemedText>
                    <ThemedText style={styles.itemMeta}>ordered {l.quantity}</ThemedText>
                  </View>
                  <TextInput
                    style={styles.receiveInput}
                    value={received[l.id] ?? '0'}
                    onChangeText={(t) => setReceived((p) => ({ ...p, [l.id]: t }))}
                    keyboardType="numeric"
                    placeholderTextColor="#999"
                  />
                </View>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowReceive(false)}><ThemedText style={styles.cancelBtnText}>Cancel</ThemedText></Pressable>
              <Pressable style={[styles.saveBtn, savingReceive && styles.disabled]} onPress={handleReceive} disabled={savingReceive}><ThemedText style={styles.saveBtnText}>{savingReceive ? 'Saving…' : 'Save'}</ThemedText></Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  )
}

function Header({ onBack, onEdit, editEnabled }: { onBack: () => void; onEdit: () => void; editEnabled: boolean }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerButton} hitSlop={8}><ThemedText style={styles.headerArrow}>←</ThemedText></Pressable>
      <ThemedText type="defaultSemiBold" style={styles.headerTitle}>Purchase Order</ThemedText>
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
  receiveButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, backgroundColor: '#007AFF' },
  receiveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  deleteButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#FF3B30' },
  deleteButtonText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  deletedBanner: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#fecaca' },
  deletedBannerText: { color: '#991b1b', fontSize: 13, lineHeight: 18 },
  restoreButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, backgroundColor: '#16a34a' },
  restoreButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { maxHeight: '85%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  modalTitle: { marginBottom: 8 },
  receiveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  receiveInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, color: '#000', backgroundColor: '#f5f5f5', width: 80, textAlign: 'right' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#ccc' },
  cancelBtnText: { fontSize: 16, fontWeight: '600' },
  saveBtn: { flex: 2, backgroundColor: '#007AFF', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
})
