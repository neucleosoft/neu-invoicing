import { and, desc, eq, like, sql } from 'drizzle-orm'
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
import { notDeleted } from '@/db/softDelete'

type Customer = typeof schema.customer.$inferSelect
type Item = typeof schema.item.$inferSelect
type Invoice = typeof schema.salesInvoice.$inferSelect
type Company = typeof schema.company.$inferSelect

type Db = ReturnType<typeof useDb>

type LineRow = {
  itemId: string
  itemName: string
  qty: number
  rate: number
  discount: number
  taxRate: number
}

// A credit/debit note adjusts what a customer owes AFTER an invoice was raised.
// CREDIT_NOTE reduces the customer balance (e.g. a sales return); DEBIT_NOTE
// raises it (e.g. an undercharge). The type is chosen at create and locked after.
type NoteType = 'CREDIT_NOTE' | 'DEBIT_NOTE'

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

// Inline number generator. Format: CN-YYYY-NNN / DN-YYYY-NNN. YYYY = full
// calendar year, NNN = 3-digit zero-padded. Sequence is PER-TYPE: scan the
// notes of that type with the matching year prefix and take max tail + 1.
async function generateNoteNumber(db: Db, type: NoteType, now: Date = new Date()): Promise<string> {
  const code = type === 'CREDIT_NOTE' ? 'CN' : 'DN'
  const prefix = `${code}-${now.getFullYear()}-`
  const rows = await db
    .select({ num: schema.creditDebitNote.noteNumber })
    .from(schema.creditDebitNote)
    .where(like(schema.creditDebitNote.noteNumber, `${prefix}%`))
  let max = 0
  for (const r of rows) {
    const tail = parseInt(r.num.slice(prefix.length), 10)
    if (!isNaN(tail) && tail > max) max = tail
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export default function NewCreditNoteScreen() {
  const db = useDb()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  // The seller's company — its state code drives the inter-state (IGST vs
  // CGST/SGST) decision when computing the GST split at save time.
  const [company, setCompany] = useState<Company | null>(null)

  const [type, setType] = useState<NoteType>('CREDIT_NOTE')
  const [noteNumber, setNoteNumber] = useState('…')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [referenceInvoiceId, setReferenceInvoiceId] = useState<string | null>(null)
  const [noteDate, setNoteDate] = useState(todayIso())
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<LineRow[]>([])
  const [notes, setNotes] = useState('')
  const [termsConditions, setTermsConditions] = useState('')

  const [saving, setSaving] = useState(false)
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [showInvoicePicker, setShowInvoicePicker] = useState(false)
  const [showItemPicker, setShowItemPicker] = useState(false)

  useEffect(() => {
    db.select().from(schema.customer).where(notDeleted(schema.customer.deletedAt)).then(setCustomers)
    db.select().from(schema.item).where(notDeleted(schema.item.deletedAt)).then(setItems)
    db.select().from(schema.company).limit(1).then((r) => setCompany(r[0] ?? null))
  }, [db])

  // The number depends on the chosen type, so regenerate whenever it flips.
  useEffect(() => {
    generateNoteNumber(db, type).then(setNoteNumber)
  }, [db, type])

  // Dependent reference-invoice list: only this customer's invoices, newest first.
  useEffect(() => {
    if (!customerId) {
      setInvoices([])
      return
    }
    db.select()
      .from(schema.salesInvoice)
      .where(and(eq(schema.salesInvoice.customerId, customerId), notDeleted(schema.salesInvoice.deletedAt)))
      .orderBy(desc(schema.salesInvoice.invoiceDate))
      .then(setInvoices)
  }, [db, customerId])

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null
  const selectedInvoice = invoices.find((i) => i.id === referenceInvoiceId) ?? null
  const subtotal = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount), 0)
  const taxAmount = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount) * (l.taxRate / 100), 0)
  const total = subtotal + taxAmount

  function pickCustomer(id: string) {
    setCustomerId(id)
    // Reset the reference invoice whenever the customer changes — the old one
    // belongs to a different party.
    setReferenceInvoiceId(null)
  }
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
    const nDate = parseDate(noteDate)
    if (!nDate) {
      Alert.alert('Validation', 'Invalid note date (use YYYY-MM-DD)')
      return
    }
    setSaving(true)
    try {
      const number = await generateNoteNumber(db, type)

      // Compute the GST split (inter-state, per-line CGST/SGST or IGST) the SAME
      // way invoices do — via the shared computeGstValues. Credit/debit notes
      // feed the GSTR-1 CDN section, so without this every mobile-created note
      // would store 0 for the split and the GST reports would read zero. The
      // helper works on the SAME positive quantity*rate-discount the existing
      // line/total math uses, so gst.totalAmount === total (magnitude); the
      // CREDIT/DEBIT sign stays only on the balance effects below. HSN falls back
      // to the catalog item's hsnCode/skuHsn.
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

      // Money side-effects (customer balance, ref invoice balanceDue) must be
      // atomic with the insert, so the whole thing is one transaction.
      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.creditDebitNote)
          .values({
            noteNumber: number,
            noteDate: nDate,
            type,
            customerId,
            referenceInvoiceId,
            reason: reason.trim() || null,
            subtotal: gst.subtotal,
            taxAmount: gst.taxAmount,
            totalAmount: gst.totalAmount,
            isInterState: gst.isInterState,
            cgstAmount: gst.totalCgst,
            sgstAmount: gst.totalSgst,
            igstAmount: gst.totalIgst,
            status: 'ACTIVE',
            notes: notes.trim() || null,
            termsConditions: termsConditions.trim() || null,
          })
          .returning({ id: schema.creditDebitNote.id })

        await tx.insert(schema.creditDebitNoteItem).values(
          lines.map((l, idx) => {
            const g = gst.items[idx]
            return {
              creditDebitNoteId: inserted.id,
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
            }
          }),
        )

        // CREDIT_NOTE lowers what the customer owes; DEBIT_NOTE raises it.
        const sign = type === 'CREDIT_NOTE' ? -1 : 1
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} + ${sign * total}` })
          .where(eq(schema.customer.id, customerId))

        if (referenceInvoiceId) {
          await tx
            .update(schema.salesInvoice)
            .set({ balanceDue: sql`${schema.salesInvoice.balanceDue} + ${sign * total}` })
            .where(eq(schema.salesInvoice.id, referenceInvoiceId))
        }
      })
      router.back()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>New Credit / Debit Note</ThemedText>

      <ThemedText style={styles.label}>Type</ThemedText>
      <View style={styles.segment}>
        {(['CREDIT_NOTE', 'DEBIT_NOTE'] as NoteType[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.segmentButton, type === t && (t === 'CREDIT_NOTE' ? styles.segmentActiveCredit : styles.segmentActiveDebit)]}
            onPress={() => setType(t)}
          >
            <ThemedText style={type === t ? styles.segmentTextActive : styles.segmentText}>
              {t === 'CREDIT_NOTE' ? 'Credit Note' : 'Debit Note'}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ThemedText style={styles.label}>Note #</ThemedText>
      <ThemedView style={styles.readOnly}><ThemedText>{noteNumber}</ThemedText></ThemedView>

      <ThemedText style={styles.label}>Customer *</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowCustomerPicker(true)}>
        <ThemedText style={selectedCustomer ? undefined : styles.placeholder}>
          {selectedCustomer ? selectedCustomer.name : 'Tap to select customer'}
        </ThemedText>
      </Pressable>

      <ThemedText style={styles.label}>Reference Invoice</ThemedText>
      <Pressable
        style={[styles.picker, !customerId && styles.pickerDisabled]}
        onPress={() => customerId && setShowInvoicePicker(true)}
      >
        <ThemedText style={selectedInvoice ? undefined : styles.placeholder}>
          {selectedInvoice ? selectedInvoice.invoiceNumber : customerId ? 'None' : 'Select a customer first'}
        </ThemedText>
      </Pressable>

      <Field label="Note Date" value={noteDate} onChangeText={setNoteDate} placeholder="YYYY-MM-DD" />
      <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Why this note is being raised" multiline />

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
        <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Note'}</ThemedText>
      </Pressable>

      <PickerModal visible={showCustomerPicker} title="Select Customer" data={customers.map((c) => ({ key: c.id, label: c.name }))} selectedKey={customerId ?? ''} onSelect={pickCustomer} onClose={() => setShowCustomerPicker(false)} />
      <PickerModal
        visible={showInvoicePicker}
        title="Reference Invoice"
        data={[{ key: '', label: 'None' }, ...invoices.map((i) => ({ key: i.id, label: i.invoiceNumber }))]}
        selectedKey={referenceInvoiceId ?? ''}
        onSelect={(k) => setReferenceInvoiceId(k || null)}
        onClose={() => setShowInvoicePicker(false)}
      />

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
  segment: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: '#ccc', overflow: 'hidden' },
  segmentButton: { flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: '#f5f5f5' },
  segmentActiveCredit: { backgroundColor: '#16a34a' },
  segmentActiveDebit: { backgroundColor: '#dc2626' },
  segmentText: { fontWeight: '600', color: '#374151' },
  segmentTextActive: { fontWeight: '600', color: 'white' },
  sectionHeader: { fontSize: 13, fontWeight: '700', opacity: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 4, letterSpacing: 0.5 },
  fieldGroup: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#000', backgroundColor: '#f5f5f5' },
  readOnly: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#f9f9f9' },
  picker: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#007AFF' },
  pickerDisabled: { borderColor: '#ccc', backgroundColor: '#f0f0f0' },
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
