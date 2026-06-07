import { eq, sql } from 'drizzle-orm'
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
import { generateChallanNumber } from '@/utils/docNumber'

type Customer = typeof schema.customer.$inferSelect
type Item = typeof schema.item.$inferSelect
type Company = typeof schema.company.$inferSelect

type LineRow = {
  itemId: string
  itemName: string
  trackStock: boolean
  qty: number
  rate: number
  discount: number
  taxRate: number
}

// Delivery Challan = a goods-movement note. Same GST line math as the invoice,
// but NO receivable: it never touches the customer balance. It DOES move stock
// out at create (the goods physically leave), unlike a quotation. Status is a
// 3-value lifecycle the user controls (RETURNABLE / NON_RETURNABLE); CONVERTED
// is set only by the convert-to-invoice action.
const STATUS_OPTIONS = ['RETURNABLE', 'NON_RETURNABLE'] as const
type StatusOption = (typeof STATUS_OPTIONS)[number]
const TRANSPORT_MODES = ['Road', 'Rail', 'Air', 'Ship'] as const

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

export default function NewChallanScreen() {
  const db = useDb()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])
  // The seller's company — its state code drives the inter-state (IGST vs
  // CGST/SGST) decision when computing the GST split at save time.
  const [company, setCompany] = useState<Company | null>(null)

  const [challanNumber, setChallanNumber] = useState('…')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusOption>('NON_RETURNABLE')
  const [challanDate, setChallanDate] = useState(todayIso())
  const [transportMode, setTransportMode] = useState<string>('Road')
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [lines, setLines] = useState<LineRow[]>([])
  const [notes, setNotes] = useState('')
  const [termsConditions, setTermsConditions] = useState('')

  const [saving, setSaving] = useState(false)
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [showStatusPicker, setShowStatusPicker] = useState(false)
  const [showTransportPicker, setShowTransportPicker] = useState(false)

  useEffect(() => {
    db.select().from(schema.customer).then(setCustomers)
    db.select().from(schema.item).then(setItems)
    db.select().from(schema.company).limit(1).then((r) => setCompany(r[0] ?? null))
    generateChallanNumber(db).then(setChallanNumber)
  }, [db])

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null
  const subtotal = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount), 0)
  const taxAmount = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount) * (l.taxRate / 100), 0)
  const total = subtotal + taxAmount

  function pickItem(it: Item) {
    setLines([...lines, { itemId: it.id, itemName: it.name, trackStock: it.trackStock, qty: 1, rate: it.salePrice, discount: 0, taxRate: it.taxRate }])
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
    const cDate = parseDate(challanDate)
    if (!cDate) {
      Alert.alert('Validation', 'Invalid challan date (use YYYY-MM-DD)')
      return
    }
    setSaving(true)
    try {
      const number = await generateChallanNumber(db)

      // Compute the GST split the SAME way desktop/invoices do — via the shared
      // computeGstValues — so the stored totals and per-line HSN match the GST
      // reports + PDF tax tables. NOTE: the DeliveryChallan/DeliveryChallanItem
      // tables only carry subtotal/taxAmount/totalAmount on the header and hsnCode
      // on the line; they have no place-of-supply / inter-state / CGST/SGST/IGST/
      // cess columns, so only those existing fields are persisted (the rest of the
      // computed split is dropped). HSN falls back to the catalog item.
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

      // A challan moves goods out, so stock + audit rows happen here. It never
      // touches the customer balance (no receivable). All side-effects in one tx.
      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.deliveryChallan)
          .values({
            challanNumber: number,
            customerId,
            status,
            challanDate: cDate,
            subtotal: gst.subtotal,
            taxAmount: gst.taxAmount,
            totalAmount: gst.totalAmount,
            transportMode: transportMode || null,
            vehicleNumber: vehicleNumber.trim() || null,
            notes: notes.trim() || null,
            termsConditions: termsConditions.trim() || null,
          })
          .returning({ id: schema.deliveryChallan.id })

        await tx.insert(schema.deliveryChallanItem).values(
          lines.map((l, idx) => {
            const g = gst.items[idx]
            return {
              deliveryChallanId: inserted.id,
              itemId: l.itemId,
              quantity: l.qty,
              rate: l.rate,
              discount: l.discount,
              taxRate: l.taxRate,
              total: g.total,
              hsnCode: g.hsnCode || null,
            }
          }),
        )

        // Goods leave: decrement tracked items' stock and log a DELIVERY movement.
        for (const l of lines) {
          if (!l.trackStock) continue
          await tx
            .update(schema.item)
            .set({ currentStock: sql`${schema.item.currentStock} - ${l.qty}` })
            .where(eq(schema.item.id, l.itemId))
          await tx.insert(schema.stockMovement).values({
            itemId: l.itemId,
            movementType: 'DELIVERY',
            quantity: -l.qty,
            referenceType: 'CHALLAN',
            referenceId: inserted.id,
          })
        }
      })
      router.back()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save challan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>New Delivery Challan</ThemedText>

      <ThemedText style={styles.label}>Challan #</ThemedText>
      <ThemedView style={styles.readOnly}><ThemedText>{challanNumber}</ThemedText></ThemedView>

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

      <Field label="Challan Date" value={challanDate} onChangeText={setChallanDate} placeholder="YYYY-MM-DD" />

      <ThemedText style={styles.label}>Transport Mode</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowTransportPicker(true)}>
        <ThemedText>{transportMode}</ThemedText>
      </Pressable>

      <Field label="Vehicle Number" value={vehicleNumber} onChangeText={setVehicleNumber} placeholder="e.g. MH12AB1234 (optional)" />

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
        <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Challan'}</ThemedText>
      </Pressable>

      <PickerModal visible={showCustomerPicker} title="Select Customer" data={customers.map((c) => ({ key: c.id, label: c.name }))} selectedKey={customerId ?? ''} onSelect={setCustomerId} onClose={() => setShowCustomerPicker(false)} />
      <PickerModal visible={showStatusPicker} title="Status" data={STATUS_OPTIONS.map((s) => ({ key: s, label: s }))} selectedKey={status} onSelect={(k) => setStatus(k as StatusOption)} onClose={() => setShowStatusPicker(false)} />
      <PickerModal visible={showTransportPicker} title="Transport Mode" data={TRANSPORT_MODES.map((m) => ({ key: m, label: m }))} selectedKey={transportMode} onSelect={setTransportMode} onClose={() => setShowTransportPicker(false)} />

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
