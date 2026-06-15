import { and, desc, eq, sql } from 'drizzle-orm'
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

import { computeGstValues } from '@neu/shared'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { notDeleted } from '@/db/softDelete'

type Item = typeof schema.item.$inferSelect
type Invoice = typeof schema.salesInvoice.$inferSelect
type Company = typeof schema.company.$inferSelect
type LineRow = { itemId: string; itemName: string; qty: number; rate: number; discount: number; taxRate: number }

type NoteType = 'CREDIT_NOTE' | 'DEBIT_NOTE'

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

export default function EditCreditNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()

  const [loading, setLoading] = useState(true)
  const [found, setFound] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customerName, setCustomerName] = useState('')
  // The seller's company + the note's customer GST fields — both feed the shared
  // GST split so an edit recomputes inter-state / CGST-SGST-IGST correctly.
  const [company, setCompany] = useState<Company | null>(null)
  const [customerGst, setCustomerGst] = useState<{
    taxId: string | null
    stateCode: string | null
    stateName: string | null
  } | null>(null)

  // Locked-on-edit values.
  const [noteNumber, setNoteNumber] = useState('')
  const [type, setType] = useState<NoteType>('CREDIT_NOTE')

  const [referenceInvoiceId, setReferenceInvoiceId] = useState<string | null>(null)
  const [noteDate, setNoteDate] = useState('')
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<LineRow[]>([])
  const [notes, setNotes] = useState('')
  const [termsConditions, setTermsConditions] = useState('')

  const [saving, setSaving] = useState(false)
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [showInvoicePicker, setShowInvoicePicker] = useState(false)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      setFound(false)
      return
    }
    async function load() {
      const [n] = await db.select().from(schema.creditDebitNote).where(eq(schema.creditDebitNote.id, id)).limit(1)
      if (!n) {
        setFound(false)
        setLoading(false)
        return
      }
      setNoteNumber(n.noteNumber)
      setType(n.type === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'CREDIT_NOTE')
      setReferenceInvoiceId(n.referenceInvoiceId)
      setNoteDate(toIso(n.noteDate))
      setReason(n.reason ?? '')
      setNotes(n.notes ?? '')
      setTermsConditions(n.termsConditions ?? '')
      const [c] = await db
        .select({
          name: schema.customer.name,
          taxId: schema.customer.taxId,
          stateCode: schema.customer.stateCode,
          stateName: schema.customer.stateName,
        })
        .from(schema.customer)
        .where(eq(schema.customer.id, n.customerId))
        .limit(1)
      setCustomerName(c?.name ?? 'Unknown')
      setCustomerGst(
        c
          ? { taxId: c.taxId, stateCode: c.stateCode, stateName: c.stateName }
          : null,
      )
      const [comp] = await db.select().from(schema.company).limit(1)
      setCompany(comp ?? null)
      const invs = await db.select().from(schema.salesInvoice).where(and(eq(schema.salesInvoice.customerId, n.customerId), notDeleted(schema.salesInvoice.deletedAt))).orderBy(desc(schema.salesInvoice.invoiceDate))
      setInvoices(invs)
      const its = await db.select().from(schema.creditDebitNoteItem).where(eq(schema.creditDebitNoteItem.creditDebitNoteId, id))
      const allItems = await db.select().from(schema.item).where(notDeleted(schema.item.deletedAt))
      setItems(allItems)
      const nameById = new Map(allItems.map((i) => [i.id, i.name]))
      setLines(its.map((l) => ({ itemId: l.itemId, itemName: nameById.get(l.itemId) ?? 'Item', qty: l.quantity, rate: l.rate, discount: l.discount, taxRate: l.taxRate })))
      setLoading(false)
    }
    load()
  }, [id, db])

  const selectedInvoice = invoices.find((i) => i.id === referenceInvoiceId) ?? null
  const subtotal = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount), 0)
  const taxAmount = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount) * (l.taxRate / 100), 0)
  const total = subtotal + taxAmount

  function pickItem(it: Item) {
    setLines([...lines, { itemId: it.id, itemName: it.name, qty: 1, rate: it.salePrice, discount: 0, taxRate: it.taxRate }])
    setShowItemPicker(false)
  }
  function updateLine(i: number, patch: Partial<LineRow>) { setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l))) }
  function removeLine(i: number) { setLines(lines.filter((_, idx) => idx !== i)) }

  async function handleSave() {
    if (!id) return
    if (lines.length === 0) {
      Alert.alert('Validation', 'Add at least one line item')
      return
    }
    const nDate = parseDate(noteDate)
    if (!nDate) {
      Alert.alert('Validation', 'Invalid date (YYYY-MM-DD)')
      return
    }
    // Recompute the GST split for the edited lines (same shared path as create)
    // so the stored CGST/SGST/IGST stay correct after an edit. The helper works
    // on the SAME positive quantity*rate-discount the existing total math uses,
    // so gst.totalAmount === total (magnitude); the reverse/reapply sign logic
    // below is unchanged.
    const gst = computeGstValues({
      company: company
        ? { stateCode: company.stateCode, stateName: company.stateName }
        : null,
      party: {
        taxId: customerGst?.taxId,
        stateCode: customerGst?.stateCode,
        stateName: customerGst?.stateName,
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

    setSaving(true)
    try {
      // Reverse-then-reapply (modeled on paymentSave.updatePayment): the note has
      // a balance effect, so editing must undo the OLD effect with the original
      // type/amount/refInvoice, rewrite the rows, then apply the NEW effect.
      await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(schema.creditDebitNote).where(eq(schema.creditDebitNote.id, id)).limit(1)
        if (!existing) throw new Error('Note not found')

        // 1. Reverse the OLD effect (opposite of what create applied).
        const oldReverseSign = existing.type === 'CREDIT_NOTE' ? 1 : -1
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} + ${oldReverseSign * existing.totalAmount}` })
          .where(eq(schema.customer.id, existing.customerId))
        if (existing.referenceInvoiceId) {
          await tx
            .update(schema.salesInvoice)
            .set({ balanceDue: sql`${schema.salesInvoice.balanceDue} + ${oldReverseSign * existing.totalAmount}` })
            .where(eq(schema.salesInvoice.id, existing.referenceInvoiceId))
        }

        // 2. Delete + reinsert lines.
        await tx.delete(schema.creditDebitNoteItem).where(eq(schema.creditDebitNoteItem.creditDebitNoteId, id))
        await tx.insert(schema.creditDebitNoteItem).values(
          lines.map((l, idx) => {
            const g = gst.items[idx]
            return {
              creditDebitNoteId: id,
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

        // 3. Update the header (type stays the same as the original).
        await tx
          .update(schema.creditDebitNote)
          .set({
            referenceInvoiceId,
            noteDate: nDate,
            reason: reason.trim() || null,
            subtotal: gst.subtotal,
            taxAmount: gst.taxAmount,
            totalAmount: gst.totalAmount,
            isInterState: gst.isInterState,
            cgstAmount: gst.totalCgst,
            sgstAmount: gst.totalSgst,
            igstAmount: gst.totalIgst,
            notes: notes.trim() || null,
            termsConditions: termsConditions.trim() || null,
          })
          .where(eq(schema.creditDebitNote.id, id))

        // 4. Apply the NEW effect (same type, new amount + possibly new ref invoice).
        const newSign = existing.type === 'CREDIT_NOTE' ? -1 : 1
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} + ${newSign * total}` })
          .where(eq(schema.customer.id, existing.customerId))
        if (referenceInvoiceId) {
          await tx
            .update(schema.salesInvoice)
            .set({ balanceDue: sql`${schema.salesInvoice.balanceDue} + ${newSign * total}` })
            .where(eq(schema.salesInvoice.id, referenceInvoiceId))
        }
      })
      router.back()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update note')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <ThemedView style={styles.loadingContainer}><ThemedText style={styles.centered}>Loading…</ThemedText></ThemedView>
  }
  if (!found) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText type="subtitle">Note not found</ThemedText>
        <Pressable style={styles.backLink} onPress={() => router.back()}><ThemedText style={styles.backLinkText}>Go back</ThemedText></Pressable>
      </ThemedView>
    )
  }

  const typeLabel = type === 'CREDIT_NOTE' ? 'Credit Note' : 'Debit Note'

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>Edit Note</ThemedText>

      <ThemedText style={styles.label}>Type</ThemedText>
      <View style={styles.lockedField}>
        <ThemedText style={styles.lockedText}>{typeLabel}</ThemedText>
        <ThemedText style={styles.lockedHint}>locked</ThemedText>
      </View>

      <ThemedText style={styles.label}>Note #</ThemedText>
      <View style={styles.lockedField}>
        <ThemedText style={styles.lockedText}>{noteNumber}</ThemedText>
        <ThemedText style={styles.lockedHint}>locked</ThemedText>
      </View>

      <ThemedText style={styles.label}>Customer</ThemedText>
      <View style={styles.lockedField}>
        <ThemedText style={styles.lockedText}>{customerName}</ThemedText>
        <ThemedText style={styles.lockedHint}>locked</ThemedText>
      </View>

      <ThemedText style={styles.label}>Reference Invoice</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowInvoicePicker(true)}>
        <ThemedText style={selectedInvoice ? undefined : styles.placeholder}>
          {selectedInvoice ? selectedInvoice.invoiceNumber : 'None'}
        </ThemedText>
      </Pressable>

      <Field label="Note Date" value={noteDate} onChangeText={setNoteDate} placeholder="YYYY-MM-DD" />
      <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Why this note is being raised" multiline />

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
          <View style={styles.lineAmountRow}>
            <ThemedText style={styles.lineMeta}>Amount</ThemedText>
            <ThemedText type="defaultSemiBold">₹{lineAmount(l.qty, l.rate, l.discount, l.taxRate).toFixed(2)}</ThemedText>
          </View>
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
        <Pressable style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
          <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Update Note'}</ThemedText>
        </Pressable>
      </View>

      <Modal visible={showInvoicePicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Reference Invoice</ThemedText>
            <FlatList
              data={[{ id: '', invoiceNumber: 'None' }, ...invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber }))]}
              keyExtractor={(o) => o.id || 'none'}
              renderItem={({ item }) => {
                const isSelected = (item.id || null) === referenceInvoiceId
                return (
                  <Pressable style={styles.modalRow} onPress={() => { setReferenceInvoiceId(item.id || null); setShowInvoicePicker(false) }}>
                    <ThemedText type={isSelected ? 'defaultSemiBold' : undefined}>{isSelected ? `✓ ${item.invoiceNumber}` : item.invoiceNumber}</ThemedText>
                  </Pressable>
                )
              }}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowInvoicePicker(false)}><ThemedText style={styles.modalCloseText}>Cancel</ThemedText></Pressable>
          </ThemedView>
        </View>
      </Modal>

      <Modal visible={showItemPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Select Item</ThemedText>
            <FlatList data={items} keyExtractor={(it) => it.id} renderItem={({ item }) => (
              <Pressable style={styles.modalRow} onPress={() => pickItem(item)}>
                <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
                <ThemedText style={styles.modalRowSub}>₹{item.salePrice.toFixed(2)} / {item.unit} · {item.taxRate}% GST</ThemedText>
              </Pressable>
            )} />
            <Pressable style={styles.modalClose} onPress={() => setShowItemPicker(false)}><ThemedText style={styles.modalCloseText}>Cancel</ThemedText></Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ScrollView>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) { return <ThemedText style={styles.sectionHeader}>{children}</ThemedText> }
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
