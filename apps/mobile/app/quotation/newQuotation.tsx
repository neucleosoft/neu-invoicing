import { router } from 'expo-router'
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

import { computeGstValues } from '@neu/shared'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { generateQuotationNumber } from '@/utils/docNumber'

type Customer = typeof schema.customer.$inferSelect
type Item = typeof schema.item.$inferSelect
type Company = typeof schema.company.$inferSelect

type LineRow = {
  itemId: string
  itemName: string
  qty: number
  rate: number
  discount: number
  taxRate: number
}

// Quotation = a non-binding price offer. Same GST line math as the invoice, but
// NO payment, NO balance/stock effect — those only happen later when it's
// converted to an invoice. Status is the offer lifecycle (gates nothing).
const STATUS_OPTIONS = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const
type StatusOption = (typeof STATUS_OPTIONS)[number]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function parseDate(s: string): Date | null {
  if (!s.trim()) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
function lineAmount(qty: number, rate: number, discount: number, taxRate: number) {
  return (qty * rate - discount) * (1 + taxRate / 100)
}

export default function NewQuotationScreen() {
  const db = useDb()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])
  // The seller's company — its state code drives the inter-state (IGST vs
  // CGST/SGST) decision when computing the GST split at save time.
  const [company, setCompany] = useState<Company | null>(null)

  const [quoteNumber, setQuoteNumber] = useState('…')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusOption>('DRAFT')
  const [quoteDate, setQuoteDate] = useState(todayIso())
  const [expiryDate, setExpiryDate] = useState('')
  const [deliveryTime, setDeliveryTime] = useState('')
  const [lines, setLines] = useState<LineRow[]>([])
  const [notes, setNotes] = useState('')
  const [termsConditions, setTermsConditions] = useState('')

  const [saving, setSaving] = useState(false)
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [showStatusPicker, setShowStatusPicker] = useState(false)

  useEffect(() => {
    db.select().from(schema.customer).then(setCustomers)
    db.select().from(schema.item).then(setItems)
    db.select().from(schema.company).limit(1).then((r) => setCompany(r[0] ?? null))
    generateQuotationNumber(db).then(setQuoteNumber)
  }, [db])

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null
  const subtotal = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount), 0)
  const taxAmount = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount) * (l.taxRate / 100), 0)
  const total = subtotal + taxAmount

  function pickItem(it: Item) {
    setLines([...lines, { itemId: it.id, itemName: it.name, qty: 1, rate: it.salePrice, discount: 0, taxRate: it.taxRate }])
    setShowItemPicker(false)
  }
  function updateLine(index: number, patch: Partial<LineRow>) {
    setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }
  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index))
  }

  async function handleSave() {
    if (!customerId) {
      Alert.alert('Validation', 'Please select a customer')
      return
    }
    if (lines.length === 0) {
      Alert.alert('Validation', 'Add at least one line item')
      return
    }
    const qDate = parseDate(quoteDate)
    if (!qDate) {
      Alert.alert('Validation', 'Invalid quotation date (use YYYY-MM-DD)')
      return
    }
    setSaving(true)
    try {
      const number = await generateQuotationNumber(db)

      // Compute the GST split (place of supply, inter-state, per-line CGST/SGST
      // or IGST, supply type) the SAME way invoices do — via the shared
      // computeGstValues. Without this every mobile-created quotation would store
      // 0 for the split, and the GST reports + PDF tax tables would read zero. HSN
      // falls back to the catalog item's hsnCode/skuHsn.
      const gst = computeGstValues({
        company: company
          ? { stateCode: company.stateCode, stateName: company.stateName }
          : null,
        party: {
          taxId: selectedCustomer?.taxId,
          stateCode: selectedCustomer?.stateCode,
          stateName: selectedCustomer?.stateName,
        },
        items: lines.map((l) => {
          const cat = items.find((i) => i.id === l.itemId)
          return {
            quantity: l.qty,
            rate: l.rate,
            discount: l.discount,
            taxRate: l.taxRate,
            catalogHsnCode: cat?.hsnCode,
            catalogSkuHsn: cat?.skuHsn,
          }
        }),
      })

      // Pure write — NO balance, NO stock (a quote is non-binding).
      const [inserted] = await db
        .insert(schema.quotation)
        .values({
          invoiceNumber: number,
          customerId,
          status,
          invoiceDate: qDate,
          dueDate: parseDate(expiryDate),
          deliveryTime: parseDate(deliveryTime),
          subtotal: gst.subtotal,
          taxAmount: gst.taxAmount,
          totalAmount: gst.totalAmount,
          notes: notes.trim() || null,
          termsConditions: termsConditions.trim() || null,
          placeOfSupply: gst.placeOfSupply || null,
          placeOfSupplyName: gst.placeOfSupplyName || null,
          isInterState: gst.isInterState,
          cgstAmount: gst.totalCgst,
          sgstAmount: gst.totalSgst,
          igstAmount: gst.totalIgst,
          cessAmount: gst.totalCess,
          supplyType: gst.supplyType,
        })
        .returning({ id: schema.quotation.id })

      await db.insert(schema.quotationItem).values(
        lines.map((l, idx) => {
          const g = gst.items[idx]
          return {
            quotationId: inserted.id,
            itemId: l.itemId,
            quantity: l.qty,
            rate: l.rate,
            discount: l.discount,
            taxRate: l.taxRate,
            total: g.total,
            hsnCode: g.hsnCode || null,
            taxableAmount: g.taxableAmount,
            cgstRate: g.cgstRate,
            cgstAmount: g.cgstAmount,
            sgstRate: g.sgstRate,
            sgstAmount: g.sgstAmount,
            igstRate: g.igstRate,
            igstAmount: g.igstAmount,
            cessRate: g.cessRate,
            cessAmount: g.cessAmount,
          }
        }),
      )
      router.back()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save quotation')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>New Quotation</ThemedText>

      <ThemedText style={styles.label}>Quotation #</ThemedText>
      <ThemedView style={styles.readOnly}><ThemedText>{quoteNumber}</ThemedText></ThemedView>

      <ThemedText style={styles.label}>Customer *</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowCustomerPicker(true)}>
        <ThemedText style={selectedCustomer ? undefined : styles.placeholder}>
          {selectedCustomer ? selectedCustomer.name : 'Tap to select customer'}
        </ThemedText>
      </Pressable>

      <ThemedText style={styles.label}>Status</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowStatusPicker(true)}>
        <ThemedText>{status}</ThemedText>
      </Pressable>

      <Field label="Quotation Date" value={quoteDate} onChangeText={setQuoteDate} placeholder="YYYY-MM-DD" />
      <Field label="Expiry Date" value={expiryDate} onChangeText={setExpiryDate} placeholder="YYYY-MM-DD (optional)" />
      <Field label="Delivery Time" value={deliveryTime} onChangeText={setDeliveryTime} placeholder="YYYY-MM-DD (optional)" />

      <SectionHeader>Line Items</SectionHeader>
      {lines.map((l, i) => (
        <ThemedView key={i} lightColor="#f9fafb" darkColor="#1f2937" style={styles.lineCard}>
          <View style={styles.lineTop}>
            <ThemedText type="defaultSemiBold" style={styles.lineName} numberOfLines={2}>{l.itemName}</ThemedText>
            <Pressable style={styles.removeButton} onPress={() => removeLine(i)}>
              <ThemedText style={styles.removeText}>×</ThemedText>
            </Pressable>
          </View>
          <View style={styles.lineFieldsRow}>
            <MiniField label="Qty" value={l.qty} onChange={(v) => updateLine(i, { qty: v })} />
            <MiniField label="Rate" value={l.rate} onChange={(v) => updateLine(i, { rate: v })} />
          </View>
          <View style={styles.lineFieldsRow}>
            <MiniField label="Discount" value={l.discount} onChange={(v) => updateLine(i, { discount: v })} />
            <MiniField label="Tax %" value={l.taxRate} onChange={(v) => updateLine(i, { taxRate: v })} />
          </View>
          <View style={styles.lineAmountRow}>
            <ThemedText style={styles.lineMeta}>Amount</ThemedText>
            <ThemedText type="defaultSemiBold">₹{lineAmount(l.qty, l.rate, l.discount, l.taxRate).toFixed(2)}</ThemedText>
          </View>
        </ThemedView>
      ))}
      <Pressable style={styles.addLineButton} onPress={() => setShowItemPicker(true)}>
        <ThemedText style={styles.addLineButtonText}>+ Add Line Item</ThemedText>
      </Pressable>

      <ThemedView style={styles.totals}>
        <TotalRow label="Subtotal" value={subtotal} />
        <TotalRow label="Tax" value={taxAmount} />
        <TotalRow label="Total" value={total} bold />
      </ThemedView>

      <SectionHeader>Notes & Terms</SectionHeader>
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Internal notes" multiline />
      <Field label="Terms & Conditions" value={termsConditions} onChangeText={setTermsConditions} placeholder="Custom T&C" multiline />

      <Pressable style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
        <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Quotation'}</ThemedText>
      </Pressable>

      <PickerModal visible={showCustomerPicker} title="Select Customer" data={customers.map((c) => ({ key: c.id, label: c.name }))} selectedKey={customerId ?? ''} onSelect={setCustomerId} onClose={() => setShowCustomerPicker(false)} />
      <PickerModal visible={showStatusPicker} title="Status" data={STATUS_OPTIONS.map((s) => ({ key: s, label: s }))} selectedKey={status} onSelect={(k) => setStatus(k as StatusOption)} onClose={() => setShowStatusPicker(false)} />

      <Modal visible={showItemPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Select Item</ThemedText>
            <FlatList
              data={items}
              keyExtractor={(it) => it.id}
              ListEmptyComponent={<ThemedText style={styles.modalEmpty}>No items yet.</ThemedText>}
              renderItem={({ item }) => (
                <Pressable style={styles.modalRow} onPress={() => pickItem(item)}>
                  <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
                  <ThemedText style={styles.modalRowSub}>₹{item.salePrice.toFixed(2)} / {item.unit} · {item.taxRate}% GST</ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowItemPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ScrollView>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <ThemedText style={styles.sectionHeader}>{children}</ThemedText>
}
function Field({ label, ...inputProps }: { label: string } & TextInputProps) {
  return (
    <ThemedView style={styles.fieldGroup}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TextInput style={styles.input} placeholderTextColor="#999" {...inputProps} />
    </ThemedView>
  )
}
function MiniField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.lineField}>
      <ThemedText style={styles.lineFieldLabel}>{label}</ThemedText>
      <TextInput style={styles.lineInput} value={String(value)} onChangeText={(t) => onChange(parseFloat(t) || 0)} keyboardType="numeric" placeholderTextColor="#999" />
    </View>
  )
}
function TotalRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <View style={styles.totalsRow}>
      <ThemedText type={bold ? 'defaultSemiBold' : undefined}>{label}</ThemedText>
      <ThemedText type={bold ? 'defaultSemiBold' : undefined}>₹{value.toFixed(2)}</ThemedText>
    </View>
  )
}
function PickerModal({ visible, title, data, selectedKey, onSelect, onClose }: { visible: boolean; title: string; data: { key: string; label: string }[]; selectedKey: string; onSelect: (k: string) => void; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <ThemedView style={styles.modalContent}>
          <ThemedText type="title" style={styles.modalTitle}>{title}</ThemedText>
          <FlatList
            data={data}
            keyExtractor={(o) => o.key}
            ListEmptyComponent={<ThemedText style={styles.modalEmpty}>Nothing here yet.</ThemedText>}
            renderItem={({ item }) => (
              <Pressable style={styles.modalRow} onPress={() => { onSelect(item.key); onClose() }}>
                <ThemedText type={item.key === selectedKey ? 'defaultSemiBold' : undefined}>
                  {item.key === selectedKey ? `✓ ${item.label}` : item.label}
                </ThemedText>
              </Pressable>
            )}
          />
          <Pressable style={styles.modalClose} onPress={onClose}>
            <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
          </Pressable>
        </ThemedView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 100, gap: 12 },
  title: { marginBottom: 8 },
  sectionHeader: { fontSize: 13, fontWeight: '700', opacity: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 4, letterSpacing: 0.5 },
  fieldGroup: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#000', backgroundColor: '#f5f5f5' },
  readOnly: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#f9f9f9' },
  picker: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#007AFF' },
  placeholder: { opacity: 0.5 },
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
  saveButton: { backgroundColor: '#007AFF', paddingVertical: 14, borderRadius: 8, marginTop: 24, alignItems: 'center' },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { maxHeight: '80%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  modalTitle: { marginBottom: 12 },
  modalRow: { paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  modalRowSub: { fontSize: 13, opacity: 0.6, marginTop: 2 },
  modalEmpty: { padding: 20, textAlign: 'center', opacity: 0.6 },
  modalClose: { paddingVertical: 14, alignItems: 'center', marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ccc' },
  modalCloseText: { color: '#FF3B30', fontSize: 16 },
})
