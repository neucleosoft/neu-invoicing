import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'

type Item = typeof schema.item.$inferSelect
type LineRow = { itemId: string; itemName: string; qty: number; rate: number; discount: number; taxRate: number }

const STATUS_OPTIONS = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const
type StatusOption = (typeof STATUS_OPTIONS)[number]

function toIso(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}
function parseDate(s: string): Date | null {
  if (!s.trim()) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
function lineAmount(qty: number, rate: number, discount: number, taxRate: number) {
  return (qty * rate - discount) * (1 + taxRate / 100)
}

export default function EditProformaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()

  const [loading, setLoading] = useState(true)
  const [found, setFound] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [customerName, setCustomerName] = useState('')

  const [docNumber, setDocNumber] = useState('')
  const [status, setStatus] = useState<StatusOption>('DRAFT')
  const [docDate, setDocDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [deliveryTime, setDeliveryTime] = useState('')
  const [lines, setLines] = useState<LineRow[]>([])
  const [notes, setNotes] = useState('')
  const [termsConditions, setTermsConditions] = useState('')

  const [saving, setSaving] = useState(false)
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [showStatusPicker, setShowStatusPicker] = useState(false)

  useEffect(() => {
    if (!id) { setLoading(false); setFound(false); return }
    async function load() {
      const [d] = await db.select().from(schema.proformaInvoice).where(eq(schema.proformaInvoice.id, id)).limit(1)
      if (!d) { setFound(false); setLoading(false); return }
      setDocNumber(d.invoiceNumber)
      const allowed = STATUS_OPTIONS as readonly string[]
      setStatus(allowed.includes(d.status) ? (d.status as StatusOption) : 'DRAFT')
      setDocDate(toIso(d.invoiceDate))
      setExpiryDate(toIso(d.dueDate))
      setDeliveryTime(toIso(d.deliveryTime))
      setNotes(d.notes ?? '')
      setTermsConditions(d.termsConditions ?? '')
      const [c] = await db.select({ name: schema.customer.name }).from(schema.customer).where(eq(schema.customer.id, d.customerId)).limit(1)
      setCustomerName(c?.name ?? 'Unknown')
      const its = await db.select().from(schema.proformaInvoiceItem).where(eq(schema.proformaInvoiceItem.proformaInvoiceId, id))
      const allItems = await db.select().from(schema.item)
      setItems(allItems)
      const nameById = new Map(allItems.map((i) => [i.id, i.name]))
      setLines(its.map((l) => ({ itemId: l.itemId, itemName: nameById.get(l.itemId) ?? 'Item', qty: l.quantity, rate: l.rate, discount: l.discount, taxRate: l.taxRate })))
      setLoading(false)
    }
    load()
  }, [id, db])

  const subtotal = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount), 0)
  const taxAmount = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount) * (l.taxRate / 100), 0)
  const total = subtotal + taxAmount

  function pickItem(it: Item) { setLines([...lines, { itemId: it.id, itemName: it.name, qty: 1, rate: it.salePrice, discount: 0, taxRate: it.taxRate }]); setShowItemPicker(false) }
  function updateLine(i: number, patch: Partial<LineRow>) { setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l))) }
  function removeLine(i: number) { setLines(lines.filter((_, idx) => idx !== i)) }

  async function handleSave() {
    if (!id) return
    if (lines.length === 0) { Alert.alert('Validation', 'Add at least one line item'); return }
    const dDate = parseDate(docDate)
    if (!dDate) { Alert.alert('Validation', 'Invalid date (YYYY-MM-DD)'); return }
    setSaving(true)
    try {
      await db.transaction(async (tx) => {
        await tx.delete(schema.proformaInvoiceItem).where(eq(schema.proformaInvoiceItem.proformaInvoiceId, id))
        await tx.insert(schema.proformaInvoiceItem).values(
          lines.map((l) => ({
            proformaInvoiceId: id,
            itemId: l.itemId,
            quantity: l.qty,
            rate: l.rate,
            discount: l.discount,
            taxRate: l.taxRate,
            total: lineAmount(l.qty, l.rate, l.discount, l.taxRate),
            taxableAmount: l.qty * l.rate - l.discount,
          })),
        )
        await tx.update(schema.proformaInvoice).set({
          status, invoiceDate: dDate, dueDate: parseDate(expiryDate), deliveryTime: parseDate(deliveryTime),
          subtotal, taxAmount, totalAmount: total, notes: notes.trim() || null, termsConditions: termsConditions.trim() || null,
        }).where(eq(schema.proformaInvoice.id, id))
      })
      router.back()
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update proforma') } finally { setSaving(false) }
  }

  if (loading) return <ThemedView style={styles.loadingContainer}><ThemedText style={styles.centered}>Loading…</ThemedText></ThemedView>
  if (!found) return <ThemedView style={styles.loadingContainer}><ThemedText type="subtitle">Proforma not found</ThemedText><Pressable style={styles.backLink} onPress={() => router.back()}><ThemedText style={styles.backLinkText}>Go back</ThemedText></Pressable></ThemedView>

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>Edit Proforma</ThemedText>
      <ThemedText style={styles.label}>Proforma #</ThemedText>
      <View style={styles.lockedField}><ThemedText style={styles.lockedText}>{docNumber}</ThemedText><ThemedText style={styles.lockedHint}>locked</ThemedText></View>
      <ThemedText style={styles.label}>Customer</ThemedText>
      <View style={styles.lockedField}><ThemedText style={styles.lockedText}>{customerName}</ThemedText><ThemedText style={styles.lockedHint}>locked</ThemedText></View>
      <ThemedText style={styles.label}>Status</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowStatusPicker(true)}><ThemedText>{status}</ThemedText></Pressable>

      <Field label="Proforma Date" value={docDate} onChangeText={setDocDate} placeholder="YYYY-MM-DD" />
      <Field label="Expiry Date" value={expiryDate} onChangeText={setExpiryDate} placeholder="YYYY-MM-DD (optional)" />
      <Field label="Delivery Time" value={deliveryTime} onChangeText={setDeliveryTime} placeholder="YYYY-MM-DD (optional)" />

      <SectionHeader>Line Items</SectionHeader>
      {lines.map((l, i) => (
        <ThemedView key={i} lightColor="#f9fafb" darkColor="#1f2937" style={styles.lineCard}>
          <View style={styles.lineTop}>
            <ThemedText type="defaultSemiBold" style={styles.lineName} numberOfLines={2}>{l.itemName}</ThemedText>
            <Pressable style={styles.removeButton} onPress={() => removeLine(i)}><ThemedText style={styles.removeText}>×</ThemedText></Pressable>
          </View>
          <View style={styles.lineFieldsRow}>
            <MiniField label="Qty" value={l.qty} onChange={(v) => updateLine(i, { qty: v })} />
            <MiniField label="Rate" value={l.rate} onChange={(v) => updateLine(i, { rate: v })} />
          </View>
          <View style={styles.lineFieldsRow}>
            <MiniField label="Discount" value={l.discount} onChange={(v) => updateLine(i, { discount: v })} />
            <MiniField label="Tax %" value={l.taxRate} onChange={(v) => updateLine(i, { taxRate: v })} />
          </View>
          <View style={styles.lineAmountRow}><ThemedText style={styles.lineMeta}>Amount</ThemedText><ThemedText type="defaultSemiBold">₹{lineAmount(l.qty, l.rate, l.discount, l.taxRate).toFixed(2)}</ThemedText></View>
        </ThemedView>
      ))}
      <Pressable style={styles.addLineButton} onPress={() => setShowItemPicker(true)}><ThemedText style={styles.addLineButtonText}>+ Add Line Item</ThemedText></Pressable>

      <ThemedView style={styles.totals}>
        <View style={styles.totalsRow}><ThemedText>Subtotal</ThemedText><ThemedText>₹{subtotal.toFixed(2)}</ThemedText></View>
        <View style={styles.totalsRow}><ThemedText>Tax</ThemedText><ThemedText>₹{taxAmount.toFixed(2)}</ThemedText></View>
        <View style={styles.totalsRow}><ThemedText type="defaultSemiBold">Total</ThemedText><ThemedText type="defaultSemiBold">₹{total.toFixed(2)}</ThemedText></View>
      </ThemedView>

      <SectionHeader>Notes & Terms</SectionHeader>
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      <Field label="Terms & Conditions" value={termsConditions} onChangeText={setTermsConditions} multiline />

      <View style={styles.actionRow}>
        <Pressable style={styles.cancelButton} onPress={() => router.back()}><ThemedText style={styles.cancelButtonText}>Cancel</ThemedText></Pressable>
        <Pressable style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}><ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Update Proforma'}</ThemedText></Pressable>
      </View>

      <Modal visible={showStatusPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}><ThemedView style={styles.modalContent}>
          <ThemedText type="title" style={styles.modalTitle}>Status</ThemedText>
          <FlatList data={STATUS_OPTIONS} keyExtractor={(o) => o} renderItem={({ item }) => (
            <Pressable style={styles.modalRow} onPress={() => { setStatus(item); setShowStatusPicker(false) }}><ThemedText type={item === status ? 'defaultSemiBold' : undefined}>{item === status ? `✓ ${item}` : item}</ThemedText></Pressable>
          )} />
          <Pressable style={styles.modalClose} onPress={() => setShowStatusPicker(false)}><ThemedText style={styles.modalCloseText}>Cancel</ThemedText></Pressable>
        </ThemedView></View>
      </Modal>

      <Modal visible={showItemPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}><ThemedView style={styles.modalContent}>
          <ThemedText type="title" style={styles.modalTitle}>Select Item</ThemedText>
          <FlatList data={items} keyExtractor={(it) => it.id} renderItem={({ item }) => (
            <Pressable style={styles.modalRow} onPress={() => pickItem(item)}><ThemedText type="defaultSemiBold">{item.name}</ThemedText><ThemedText style={styles.modalRowSub}>₹{item.salePrice.toFixed(2)} / {item.unit} · {item.taxRate}% GST</ThemedText></Pressable>
          )} />
          <Pressable style={styles.modalClose} onPress={() => setShowItemPicker(false)}><ThemedText style={styles.modalCloseText}>Cancel</ThemedText></Pressable>
        </ThemedView></View>
      </Modal>
    </ScrollView>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) { return <ThemedText style={styles.sectionHeader}>{children}</ThemedText> }
function Field({ label, ...inputProps }: { label: string } & TextInputProps) { return (<ThemedView style={styles.fieldGroup}><ThemedText style={styles.label}>{label}</ThemedText><TextInput style={styles.input} placeholderTextColor="#999" {...inputProps} /></ThemedView>) }
function MiniField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) { return (<View style={styles.lineField}><ThemedText style={styles.lineFieldLabel}>{label}</ThemedText><TextInput style={styles.lineInput} value={String(value)} onChangeText={(t) => onChange(parseFloat(t) || 0)} keyboardType="numeric" placeholderTextColor="#999" /></View>) }

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 100, gap: 12 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  title: { marginBottom: 8 },
  centered: { textAlign: 'center' },
  backLink: { paddingVertical: 10 },
  backLinkText: { color: '#007AFF', fontSize: 16 },
  sectionHeader: { fontSize: 13, fontWeight: '700', opacity: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 4, letterSpacing: 0.5 },
  fieldGroup: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#000', backgroundColor: '#f5f5f5' },
  lockedField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#f0f0f0' },
  lockedText: { fontSize: 16 },
  lockedHint: { fontSize: 12, opacity: 0.5 },
  picker: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#007AFF' },
  lineCard: { padding: 12, borderRadius: 10, gap: 8, marginTop: 4 },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineName: { flex: 1 },
  lineFieldsRow: { flexDirection: 'row', gap: 8 },
  lineField: { flex: 1, gap: 4 },
  lineFieldLabel: { fontSize: 12, opacity: 0.6 },
  lineInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, color: '#000', backgroundColor: '#fff' },
  lineAmountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 },
  lineMeta: { fontSize: 13, opacity: 0.6 },
  removeButton: { paddingHorizontal: 8, paddingVertical: 2 },
  removeText: { fontSize: 22, color: '#FF3B30' },
  addLineButton: { borderWidth: 1, borderColor: '#007AFF', borderStyle: 'dashed', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  addLineButtonText: { color: '#007AFF', fontWeight: '600' },
  totals: { padding: 12, borderRadius: 8, marginTop: 16, gap: 6 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelButton: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#ccc' },
  cancelButtonText: { fontSize: 16, fontWeight: '600' },
  saveButton: { flex: 2, backgroundColor: '#007AFF', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { maxHeight: '80%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  modalTitle: { marginBottom: 12 },
  modalRow: { paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  modalRowSub: { fontSize: 13, opacity: 0.6, marginTop: 2 },
  modalClose: { paddingVertical: 14, alignItems: 'center', marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ccc' },
  modalCloseText: { color: '#FF3B30', fontSize: 16 },
})
