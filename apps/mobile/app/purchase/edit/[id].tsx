import { and, asc, eq } from 'drizzle-orm'
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
import { notDeleted } from '@/db/softDelete'
import { formatCurrency } from '@/utils/currency'
import { updatePurchaseBill, type PurchaseLineInput } from '@/utils/purchaseSave'

type Supplier = typeof schema.supplier.$inferSelect
type SupplierItem = typeof schema.supplierItem.$inferSelect

type BillLine = {
  supplierItemId: string | null
  name: string
  hsnCode: string
  qty: number
  rate: number
  discount: number
  taxRate: number
}

const lineAmount = (l: BillLine) => (l.qty * l.rate - l.discount) * (1 + l.taxRate / 100)

export default function EditPurchaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()

  const [loading, setLoading] = useState(true)
  const [found, setFound] = useState(true)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [catalog, setCatalog] = useState<SupplierItem[]>([])

  const [supplierId, setSupplierId] = useState('')
  const [billNumber, setBillNumber] = useState('')
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [billDate, setBillDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<BillLine[]>([])

  const [saving, setSaving] = useState(false)
  const [showSupplierPicker, setShowSupplierPicker] = useState(false)
  const [showCatalogPicker, setShowCatalogPicker] = useState(false)

  useEffect(() => {
    db.select()
      .from(schema.supplier)
      .where(notDeleted(schema.supplier.deletedAt))
      .orderBy(asc(schema.supplier.name))
      .then(setSuppliers)
  }, [db])

  // Catalog tracks the selected supplier. Lines are NOT cleared here (that only
  // happens when the user actively picks a different supplier) so the loaded
  // bill's lines survive the initial supplier set.
  useEffect(() => {
    if (!supplierId) {
      setCatalog([])
      return
    }
    db.select()
      .from(schema.supplierItem)
      .where(
        and(
          eq(schema.supplierItem.supplierId, supplierId),
          notDeleted(schema.supplierItem.deletedAt),
        ),
      )
      .orderBy(asc(schema.supplierItem.name))
      .then(setCatalog)
  }, [supplierId, db])

  useEffect(() => {
    if (!id) {
      setLoading(false)
      setFound(false)
      return
    }
    async function load() {
      const [bill] = await db
        .select()
        .from(schema.purchaseBill)
        .where(eq(schema.purchaseBill.id, id))
        .limit(1)
      if (!bill) {
        setFound(false)
        setLoading(false)
        return
      }
      setSupplierId(bill.supplierId)
      setBillNumber(bill.billNumber)
      setSupplierInvoiceNumber(bill.supplierInvoiceNumber ?? '')
      setBillDate(new Date(bill.billDate).toISOString().slice(0, 10))
      setNotes(bill.notes ?? '')

      // Resolve each line's name from this supplier's catalog.
      const billItems = await db
        .select()
        .from(schema.purchaseBillItem)
        .where(eq(schema.purchaseBillItem.purchaseBillId, id))
      const cat = await db
        .select()
        .from(schema.supplierItem)
        .where(eq(schema.supplierItem.supplierId, bill.supplierId))
      const nameById = new Map(cat.map((c) => [c.id, c.name]))
      setLines(
        billItems.map((bi) => ({
          supplierItemId: bi.supplierItemId,
          name: nameById.get(bi.supplierItemId) ?? 'Item',
          hsnCode: bi.hsnCode ?? '',
          qty: bi.quantity,
          rate: bi.rate,
          discount: bi.discount,
          taxRate: bi.taxRate,
        })),
      )
      setLoading(false)
    }
    load()
  }, [id, db])

  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? ''

  const subtotal = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount), 0)
  const taxAmount = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount) * (l.taxRate / 100), 0)
  const total = subtotal + taxAmount

  function pickSupplier(newId: string) {
    if (newId !== supplierId) setLines([])
    setSupplierId(newId)
    setShowSupplierPicker(false)
  }

  function addFromCatalog(si: SupplierItem) {
    setLines((prev) => [
      ...prev,
      {
        supplierItemId: si.id,
        name: si.name,
        hsnCode: si.hsnCode ?? '',
        qty: 1,
        rate: si.lastPurchasePrice,
        discount: 0,
        taxRate: si.defaultTaxRate,
      },
    ])
    setShowCatalogPicker(false)
  }

  function addNewLine() {
    setLines((prev) => [
      ...prev,
      { supplierItemId: null, name: '', hsnCode: '', qty: 1, rate: 0, discount: 0, taxRate: 0 },
    ])
  }

  function updateLine(index: number, patch: Partial<BillLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    if (!id) return
    if (!supplierId) {
      Alert.alert('Validation', 'Please select a supplier')
      return
    }
    if (lines.length === 0) {
      Alert.alert('Validation', 'Add at least one line item')
      return
    }
    if (lines.some((l) => !l.supplierItemId && !l.name.trim())) {
      Alert.alert('Validation', 'Every new line needs an item name')
      return
    }
    setSaving(true)
    try {
      const parsedDate = new Date(billDate)
      const header = {
        supplierId,
        billNumber,
        billDate: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
        supplierInvoiceNumber: supplierInvoiceNumber.trim() || null,
        supplierInvoiceDate: null,
        notes: notes.trim() || null,
      }
      const lineInputs: PurchaseLineInput[] = lines.map((l) => ({
        supplierItemId: l.supplierItemId,
        name: l.name.trim(),
        hsnCode: l.hsnCode.trim(),
        quantity: l.qty,
        rate: l.rate,
        discount: l.discount,
        taxRate: l.taxRate,
      }))
      await updatePurchaseBill(db, id, header, lineInputs)
      router.back()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update bill'
      Alert.alert('Error', msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }

  if (!found) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText type="subtitle">Purchase bill not found</ThemedText>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <ThemedText style={styles.backLinkText}>Go back</ThemedText>
        </Pressable>
      </ThemedView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <ThemedText type="title" style={styles.title}>Edit Purchase Bill</ThemedText>

      <ThemedText style={styles.label}>Internal Bill #</ThemedText>
      <View style={styles.lockedField}>
        <ThemedText style={styles.lockedText}>{billNumber}</ThemedText>
        <ThemedText style={styles.lockedHint}>locked</ThemedText>
      </View>

      <ThemedText style={styles.label}>Supplier *</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowSupplierPicker(true)}>
        <ThemedText style={supplierId ? undefined : styles.placeholder}>
          {supplierId ? supplierName : 'Pick a supplier'}
        </ThemedText>
      </Pressable>

      <Field
        label="Bill Date (YYYY-MM-DD)"
        value={billDate}
        onChangeText={setBillDate}
        placeholder="2026-05-29"
      />
      <Field
        label="Supplier's Invoice #"
        value={supplierInvoiceNumber}
        onChangeText={setSupplierInvoiceNumber}
        placeholder="As printed on their bill"
      />

      <View style={styles.linesHeader}>
        <ThemedText type="defaultSemiBold">Items</ThemedText>
      </View>

      {lines.length === 0 ? (
        <ThemedText style={styles.noLines}>No items. Add from the catalog or type a new one.</ThemedText>
      ) : (
        lines.map((line, index) => (
          <ThemedView key={index} lightColor="#f9fafb" darkColor="#1f2937" style={styles.lineCard}>
            <View style={styles.lineTop}>
              {line.supplierItemId ? (
                <ThemedText type="defaultSemiBold" style={styles.lineName} numberOfLines={2}>
                  {line.name}
                </ThemedText>
              ) : (
                <TextInput
                  style={[styles.input, styles.lineNameInput]}
                  value={line.name}
                  onChangeText={(t) => updateLine(index, { name: t })}
                  placeholder="New item name"
                  placeholderTextColor="#999"
                />
              )}
              <Pressable onPress={() => removeLine(index)} hitSlop={8} style={styles.removeBtn}>
                <ThemedText style={styles.removeBtnText}>✕</ThemedText>
              </Pressable>
            </View>

            <View style={styles.lineRow}>
              <MiniField label="Qty" value={line.qty} onChange={(v) => updateLine(index, { qty: v })} />
              <MiniField label="Rate" value={line.rate} onChange={(v) => updateLine(index, { rate: v })} />
            </View>
            <View style={styles.lineRow}>
              <MiniField label="Discount" value={line.discount} onChange={(v) => updateLine(index, { discount: v })} />
              <MiniField label="Tax %" value={line.taxRate} onChange={(v) => updateLine(index, { taxRate: v })} />
            </View>
            <TextInput
              style={[styles.input, styles.hsnInput]}
              value={line.hsnCode}
              onChangeText={(t) => updateLine(index, { hsnCode: t })}
              placeholder="HSN / SAC (optional)"
              placeholderTextColor="#999"
            />
            <ThemedText style={styles.lineAmount}>{formatCurrency(lineAmount(line))}</ThemedText>
          </ThemedView>
        ))
      )}

      <View style={styles.addRow}>
        <Pressable
          style={[styles.addBtn, !supplierId && styles.addBtnDisabled]}
          disabled={!supplierId}
          onPress={() => setShowCatalogPicker(true)}
        >
          <ThemedText style={styles.addBtnText}>+ From catalog</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.addBtn, !supplierId && styles.addBtnDisabled]}
          disabled={!supplierId}
          onPress={addNewLine}
        >
          <ThemedText style={styles.addBtnText}>+ New item</ThemedText>
        </Pressable>
      </View>

      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline />

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.totals}>
        <TotalRow label="Subtotal" value={subtotal} />
        <TotalRow label="Tax" value={taxAmount} />
        <TotalRow label="Total" value={total} bold />
      </ThemedView>

      <View style={styles.actionRow}>
        <Pressable style={styles.cancelButton} onPress={() => router.back()}>
          <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Update Bill'}</ThemedText>
        </Pressable>
      </View>

      <Modal visible={showSupplierPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Select Supplier</ThemedText>
            <FlatList
              data={suppliers}
              keyExtractor={(s) => s.id}
              renderItem={({ item }) => (
                <Pressable style={styles.modalRow} onPress={() => pickSupplier(item.id)}>
                  <ThemedText type={item.id === supplierId ? 'defaultSemiBold' : undefined}>
                    {item.id === supplierId ? `✓ ${item.name}` : item.name}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowSupplierPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>

      <Modal visible={showCatalogPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Add from catalog</ThemedText>
            {catalog.length === 0 ? (
              <ThemedText style={styles.emptyCatalog}>
                This supplier has no catalog items yet. Close this and use “+ New item”.
              </ThemedText>
            ) : (
              <FlatList
                data={catalog}
                keyExtractor={(c) => c.id}
                renderItem={({ item }) => (
                  <Pressable style={styles.modalRow} onPress={() => addFromCatalog(item)}>
                    <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
                    <ThemedText style={styles.catalogMeta}>
                      {formatCurrency(item.lastPurchasePrice)} · {item.defaultTaxRate}% · {item.unit}
                    </ThemedText>
                  </Pressable>
                )}
              />
            )}
            <Pressable style={styles.modalClose} onPress={() => setShowCatalogPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Close</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ScrollView>
  )
}

function Field({ label, ...inputProps }: { label: string } & TextInputProps) {
  return (
    <ThemedView style={styles.fieldGroup}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TextInput style={styles.input} placeholderTextColor="#999" {...inputProps} />
    </ThemedView>
  )
}

function MiniField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <View style={styles.miniField}>
      <ThemedText style={styles.miniLabel}>{label}</ThemedText>
      <TextInput
        style={styles.input}
        value={String(value)}
        onChangeText={(t) => onChange(parseFloat(t) || 0)}
        keyboardType="numeric"
        placeholderTextColor="#999"
      />
    </View>
  )
}

function TotalRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <ThemedText type={bold ? 'defaultSemiBold' : undefined}>{label}</ThemedText>
      <ThemedText type={bold ? 'defaultSemiBold' : undefined}>{formatCurrency(value)}</ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 100, gap: 12 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  title: { marginBottom: 8 },
  centered: { textAlign: 'center' },
  backLink: { paddingVertical: 10 },
  backLinkText: { color: '#007AFF', fontSize: 16 },
  fieldGroup: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#f5f5f5',
  },
  lockedField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#f0f0f0',
  },
  lockedText: { fontSize: 16 },
  lockedHint: { fontSize: 12, opacity: 0.5 },
  picker: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  placeholder: { opacity: 0.5 },
  linesHeader: { marginTop: 8 },
  noLines: { opacity: 0.6, fontSize: 14, paddingVertical: 8 },
  lineCard: { borderRadius: 12, padding: 12, gap: 8 },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineName: { flex: 1 },
  lineNameInput: { flex: 1 },
  removeBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  removeBtnText: { fontSize: 16, color: '#FF3B30', fontWeight: '600' },
  lineRow: { flexDirection: 'row', gap: 10 },
  miniField: { flex: 1, gap: 4 },
  miniLabel: { fontSize: 12, opacity: 0.6 },
  hsnInput: { fontSize: 14 },
  lineAmount: { textAlign: 'right', fontWeight: '600' },
  addRow: { flexDirection: 'row', gap: 10 },
  addBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: '#007AFF', fontWeight: '600' },
  totals: { borderRadius: 12, padding: 14, gap: 8, marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  cancelButtonText: { fontSize: 16, fontWeight: '600' },
  saveButton: {
    flex: 2,
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { maxHeight: '80%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  modalTitle: { marginBottom: 12 },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
    gap: 2,
  },
  catalogMeta: { fontSize: 12, opacity: 0.6 },
  emptyCatalog: { opacity: 0.6, paddingVertical: 16, textAlign: 'center' },
  modalClose: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  modalCloseText: { color: '#FF3B30', fontSize: 16 },
})
