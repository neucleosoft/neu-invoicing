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

import { applyPayment } from '@neu/shared'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { generateInvoiceNumber } from '@/utils/invoiceNumber'

type Customer = typeof schema.customer.$inferSelect
type Item = typeof schema.item.$inferSelect

type LineRow = {
  itemId: string
  itemName: string
  qty: number
  rate: number
  discount: number
  taxRate: number
}

// Mirror desktop Sales.tsx status dropdown exactly: DRAFT (labeled "Unpaid"),
// PAID, PARTIAL, OVERDUE. No SENT — desktop doesn't expose it on this form.
const STATUS_OPTIONS = ['DRAFT', 'PAID', 'PARTIAL', 'OVERDUE'] as const
const STATUS_LABELS: Record<(typeof STATUS_OPTIONS)[number], string> = {
  DRAFT: 'Unpaid',
  PAID: 'Paid',
  PARTIAL: 'Partial',
  OVERDUE: 'Overdue',
}
const PAYMENT_MODE_OPTIONS = [
  'CASH',
  'BANK_TRANSFER',
  'CARD',
  'CHEQUE',
  'UPI',
  'OTHER',
] as const

type StatusOption = (typeof STATUS_OPTIONS)[number]
type PaymentModeOption = (typeof PAYMENT_MODE_OPTIONS)[number]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function parseDate(s: string): Date | null {
  if (!s.trim()) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// Per-line amount mirrors desktop Sales.tsx:451 — discount reduces the
// taxable base, tax is applied after discount.
function lineAmount(qty: number, rate: number, discount: number, taxRate: number) {
  return (qty * rate - discount) * (1 + taxRate / 100)
}

export default function NewInvoiceScreen() {
  const db = useDb()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])

  // Sequential FY-scoped number (NS/SL/{FY}/NN), generated on mount to mirror
  // desktop. Shown read-only as a preview; re-resolved at save time so a number
  // taken by another save in between can't collide.
  const [invoiceNumber, setInvoiceNumber] = useState('…')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusOption>('DRAFT')
  const [invoiceDate, setInvoiceDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState('')
  const [lines, setLines] = useState<LineRow[]>([])
  const [amountPaid, setAmountPaid] = useState('0')
  const [paymentMode, setPaymentMode] = useState<PaymentModeOption>('CASH')
  const [notes, setNotes] = useState('')
  const [termsConditions, setTermsConditions] = useState('')

  const [showAdditional, setShowAdditional] = useState(false)
  const [poNumber, setPoNumber] = useState('')
  const [ewayBillNo, setEwayBillNo] = useState('')
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [warrantyPeriod, setWarrantyPeriod] = useState('')
  const [dispatchedThrough, setDispatchedThrough] = useState('')

  const [saving, setSaving] = useState(false)
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [showStatusPicker, setShowStatusPicker] = useState(false)
  const [showPaymentModePicker, setShowPaymentModePicker] = useState(false)

  useEffect(() => {
    db.select().from(schema.customer).then(setCustomers)
    db.select().from(schema.item).then(setItems)
    generateInvoiceNumber(db).then(setInvoiceNumber)
  }, [db])

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null
  // Subtotal/tax mirror desktop Sales.tsx:460-479: discount reduces the
  // taxable base before tax is applied.
  const subtotal = lines.reduce(
    (s, l) => s + (l.qty * l.rate - l.discount),
    0,
  )
  const taxAmount = lines.reduce(
    (s, l) => s + (l.qty * l.rate - l.discount) * (l.taxRate / 100),
    0,
  )
  const total = subtotal + taxAmount
  const paid = parseFloat(amountPaid) || 0
  const balanceDue = total - paid

  function pickItem(it: Item) {
    setLines([
      ...lines,
      {
        itemId: it.id,
        itemName: it.name,
        qty: 1,
        rate: it.salePrice,
        discount: 0,
        taxRate: it.taxRate,
      },
    ])
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
    const invDate = parseDate(invoiceDate)
    if (!invDate) {
      Alert.alert('Validation', 'Invalid invoice date (use YYYY-MM-DD)')
      return
    }
    const due = parseDate(dueDate)

    setSaving(true)
    try {
      // Re-resolve the number at save time: the preview was generated on mount,
      // but another invoice could have been saved since, so we recompute to take
      // the truly-next number and avoid a unique-constraint collision.
      const finalNumber = await generateInvoiceNumber(db)

      // Everything below is one transaction so the invoice, its lines, the
      // customer-balance bump, and the stock decrements all commit together — a
      // half-write must never leave the customer balance out of sync with the
      // invoice. Mirrors desktop sales.ts create ($transaction).
      await db.transaction(async (tx) => {
        // Insert the invoice in its UNPAID state (amountPaid 0, full balance
        // due). Any up-front payment is then applied via the shared applyPayment
        // below — the SAME path the standalone Payments screen uses. This keeps
        // all payment math in one place (packages/shared/paymentLogic) so the
        // two can never drift.
        const [inserted] = await tx
          .insert(schema.salesInvoice)
          .values({
            invoiceNumber: finalNumber,
            customerId,
            status: 'DRAFT',
            invoiceDate: invDate,
            dueDate: due,
            subtotal,
            taxAmount,
            totalAmount: total,
            amountPaid: 0,
            balanceDue: total,
            notes: notes.trim() || null,
            termsConditions: termsConditions.trim() || null,
            poNumber: poNumber.trim() || null,
            ewayBillNo: ewayBillNo.trim() || null,
            vehicleNumber: vehicleNumber.trim() || null,
            warrantyPeriod: warrantyPeriod.trim() || null,
            dispatchedThrough: dispatchedThrough.trim() || null,
          })
          .returning()

        await tx.insert(schema.salesInvoiceItem).values(
          lines.map((l) => ({
            salesInvoiceId: inserted.id,
            itemId: l.itemId,
            quantity: l.qty,
            rate: l.rate,
            discount: l.discount,
            taxRate: l.taxRate,
            total: lineAmount(l.qty, l.rate, l.discount, l.taxRate),
          })),
        )

        // Raise what the customer owes by the FULL invoice total — they owe all
        // of it until a payment is applied. (Mirrors desktop sales.ts: balance up
        // by the invoice; the up-front payment then reduces it below.)
        if (total !== 0) {
          await tx
            .update(schema.customer)
            .set({
              currentBalance: sql`${schema.customer.currentBalance} + ${total}`,
            })
            .where(eq(schema.customer.id, customerId))
        }

        // Selling reduces stock. For each stock-tracked item, decrement its
        // currentStock and log a SALE movement. Mirrors desktop sales.ts:125-143.
        for (const l of lines) {
          const item = items.find((i) => i.id === l.itemId)
          if (item?.trackStock) {
            await tx
              .update(schema.item)
              .set({ currentStock: sql`${schema.item.currentStock} - ${l.qty}` })
              .where(eq(schema.item.id, l.itemId))
            await tx.insert(schema.stockMovement).values({
              itemId: l.itemId,
              movementType: 'SALE',
              quantity: -l.qty,
              referenceType: 'INVOICE',
              referenceId: inserted.id,
            })
          }
        }

        // Up-front payment: record the row, then route its effect through the
        // shared applyPayment. That decrements the customer by `paid` (netting
        // the balance to total - paid) AND sets the invoice's amountPaid /
        // balanceDue / status from their freshly-inserted zero state. No
        // double-count: the customer was bumped by `total`, applyPayment removes
        // `paid`; the invoice started at amountPaid 0, applyPayment adds `paid`.
        if (paid > 0) {
          await tx.insert(schema.paymentTransaction).values({
            type: 'PAYMENT_IN',
            customerId,
            amount: paid,
            paymentMode,
            paymentDate: invDate,
            referenceType: 'INVOICE',
            referenceId: inserted.id,
            salesInvoiceId: inserted.id,
          })
          await applyPayment(tx, {
            type: 'PAYMENT_IN',
            amount: paid,
            customerId,
            supplierId: null,
            salesInvoiceId: inserted.id,
            purchaseBillId: null,
          })
        }
      })

      router.back()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save'
      Alert.alert('Error', msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>
        New Invoice
      </ThemedText>

      <SectionHeader>Invoice Details</SectionHeader>

      <ThemedText style={styles.label}>Invoice #</ThemedText>
      <ThemedView style={styles.readOnly}>
        <ThemedText>{invoiceNumber}</ThemedText>
      </ThemedView>

      <ThemedText style={styles.label}>Customer *</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowCustomerPicker(true)}>
        <ThemedText style={selectedCustomer ? undefined : styles.placeholder}>
          {selectedCustomer ? selectedCustomer.name : 'Tap to select customer'}
        </ThemedText>
      </Pressable>

      <ThemedText style={styles.label}>Status</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowStatusPicker(true)}>
        <ThemedText>{STATUS_LABELS[status]}</ThemedText>
      </Pressable>

      <Field
        label="Invoice Date"
        value={invoiceDate}
        onChangeText={setInvoiceDate}
        placeholder="YYYY-MM-DD"
      />
      <Field
        label="Due Date"
        value={dueDate}
        onChangeText={setDueDate}
        placeholder="YYYY-MM-DD (optional)"
      />

      <SectionHeader>Line Items</SectionHeader>
      {lines.map((l, i) => (
        <ThemedView
          key={i}
          lightColor="#f9fafb"
          darkColor="#1f2937"
          style={styles.lineCard}
        >
          <View style={styles.lineTop}>
            <ThemedText type="defaultSemiBold" style={styles.lineName} numberOfLines={2}>
              {l.itemName}
            </ThemedText>
            <Pressable style={styles.removeButton} onPress={() => removeLine(i)}>
              <ThemedText style={styles.removeText}>×</ThemedText>
            </Pressable>
          </View>

          <View style={styles.lineFieldsRow}>
            <View style={styles.lineFieldSmall}>
              <ThemedText style={styles.lineFieldLabel}>Qty</ThemedText>
              <TextInput
                style={styles.lineInput}
                value={String(l.qty)}
                onChangeText={(v) => updateLine(i, { qty: parseFloat(v) || 0 })}
                keyboardType="numeric"
                placeholderTextColor="#999"
              />
            </View>
            <View style={styles.lineField}>
              <ThemedText style={styles.lineFieldLabel}>Rate</ThemedText>
              <TextInput
                style={styles.lineInput}
                value={String(l.rate)}
                onChangeText={(v) => updateLine(i, { rate: parseFloat(v) || 0 })}
                keyboardType="numeric"
                placeholderTextColor="#999"
              />
            </View>
          </View>

          <View style={styles.lineFieldsRow}>
            <View style={styles.lineField}>
              <ThemedText style={styles.lineFieldLabel}>Discount</ThemedText>
              <TextInput
                style={styles.lineInput}
                value={String(l.discount)}
                onChangeText={(v) => updateLine(i, { discount: parseFloat(v) || 0 })}
                keyboardType="numeric"
                placeholderTextColor="#999"
              />
            </View>
            <View style={styles.lineFieldSmall}>
              <ThemedText style={styles.lineFieldLabel}>Tax %</ThemedText>
              <TextInput
                style={styles.lineInput}
                value={String(l.taxRate)}
                onChangeText={(v) => updateLine(i, { taxRate: parseFloat(v) || 0 })}
                keyboardType="numeric"
                placeholderTextColor="#999"
              />
            </View>
          </View>

          <View style={styles.lineAmountRow}>
            <ThemedText style={styles.lineMeta}>Amount</ThemedText>
            <ThemedText type="defaultSemiBold">
              ₹{lineAmount(l.qty, l.rate, l.discount, l.taxRate).toFixed(2)}
            </ThemedText>
          </View>
        </ThemedView>
      ))}
      <Pressable style={styles.addLineButton} onPress={() => setShowItemPicker(true)}>
        <ThemedText style={styles.addLineButtonText}>+ Add Line Item</ThemedText>
      </Pressable>

      <ThemedView style={styles.totals}>
        <View style={styles.totalsRow}>
          <ThemedText>Subtotal</ThemedText>
          <ThemedText>₹{subtotal.toFixed(2)}</ThemedText>
        </View>
        <View style={styles.totalsRow}>
          <ThemedText>Tax</ThemedText>
          <ThemedText>₹{taxAmount.toFixed(2)}</ThemedText>
        </View>
        <View style={styles.totalsRow}>
          <ThemedText type="defaultSemiBold">Total</ThemedText>
          <ThemedText type="defaultSemiBold">₹{total.toFixed(2)}</ThemedText>
        </View>
        {paid > 0 && (
          <View style={styles.totalsRow}>
            <ThemedText>Balance Due</ThemedText>
            <ThemedText>₹{balanceDue.toFixed(2)}</ThemedText>
          </View>
        )}
      </ThemedView>

      <SectionHeader>Payment</SectionHeader>
      <Field
        label="Amount Paid (₹)"
        value={amountPaid}
        onChangeText={setAmountPaid}
        keyboardType="numeric"
      />
      <ThemedText style={styles.label}>Payment Mode</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowPaymentModePicker(true)}>
        <ThemedText>{paymentMode}</ThemedText>
      </Pressable>

      <SectionHeader>Notes & Terms</SectionHeader>
      <Field
        label="Notes"
        value={notes}
        onChangeText={setNotes}
        placeholder="Internal notes for this invoice"
        multiline
      />
      <Field
        label="Terms & Conditions"
        value={termsConditions}
        onChangeText={setTermsConditions}
        placeholder="Custom T&C for this invoice"
        multiline
      />

      <Pressable style={styles.collapseHeader} onPress={() => setShowAdditional(!showAdditional)}>
        <ThemedText type="defaultSemiBold">
          {showAdditional ? '▼' : '▶'} Additional Fields
        </ThemedText>
      </Pressable>
      {showAdditional && (
        <>
          <Field
            label="PO Number"
            value={poNumber}
            onChangeText={setPoNumber}
            placeholder="Customer's purchase order #"
          />
          <Field label="E-way Bill #" value={ewayBillNo} onChangeText={setEwayBillNo} />
          <Field
            label="Vehicle Number"
            value={vehicleNumber}
            onChangeText={setVehicleNumber}
            placeholder="MH 12 AB 1234"
            autoCapitalize="characters"
          />
          <Field
            label="Warranty Period"
            value={warrantyPeriod}
            onChangeText={setWarrantyPeriod}
            placeholder="e.g., 6 months / 1 year"
          />
          <Field
            label="Dispatched Through"
            value={dispatchedThrough}
            onChangeText={setDispatchedThrough}
            placeholder="Self / Courier / Transport name"
          />
        </>
      )}

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Invoice'}</ThemedText>
      </Pressable>

      <Modal visible={showCustomerPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Select Customer
            </ThemedText>
            <FlatList
              data={customers}
              keyExtractor={(c) => c.id}
              ListEmptyComponent={
                <ThemedText style={styles.modalEmpty}>
                  No customers yet. Add one from the Customers tab.
                </ThemedText>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setCustomerId(item.id)
                    setShowCustomerPicker(false)
                  }}
                >
                  <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
                  {item.phone && <ThemedText style={styles.modalRowSub}>{item.phone}</ThemedText>}
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowCustomerPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>

      <Modal visible={showItemPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Select Item
            </ThemedText>
            <FlatList
              data={items}
              keyExtractor={(it) => it.id}
              ListEmptyComponent={
                <ThemedText style={styles.modalEmpty}>
                  No items yet. Add one from the Items tab.
                </ThemedText>
              }
              renderItem={({ item }) => (
                <Pressable style={styles.modalRow} onPress={() => pickItem(item)}>
                  <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
                  <ThemedText style={styles.modalRowSub}>
                    ₹{item.salePrice.toFixed(2)} / {item.unit} · {item.taxRate}% GST
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowItemPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>

      <Modal visible={showStatusPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Invoice Status
            </ThemedText>
            <FlatList
              data={STATUS_OPTIONS}
              keyExtractor={(opt) => opt}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setStatus(item)
                    setShowStatusPicker(false)
                  }}
                >
                  <ThemedText type={item === status ? 'defaultSemiBold' : undefined}>
                    {item === status ? `✓ ${STATUS_LABELS[item]}` : STATUS_LABELS[item]}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowStatusPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>

      <Modal visible={showPaymentModePicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Payment Mode
            </ThemedText>
            <FlatList
              data={PAYMENT_MODE_OPTIONS}
              keyExtractor={(opt) => opt}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setPaymentMode(item)
                    setShowPaymentModePicker(false)
                  }}
                >
                  <ThemedText type={item === paymentMode ? 'defaultSemiBold' : undefined}>
                    {item === paymentMode ? `✓ ${item}` : item}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowPaymentModePicker(false)}>
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

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 100, gap: 12 },
  title: { marginBottom: 8 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    opacity: 0.5,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
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
  readOnly: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
  },
  picker: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  placeholder: { opacity: 0.5 },
  lineCard: {
    padding: 12,
    borderRadius: 10,
    gap: 8,
    marginTop: 4,
  },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineName: { flex: 1 },
  lineFieldsRow: { flexDirection: 'row', gap: 8 },
  lineField: { flex: 1, gap: 4 },
  lineFieldSmall: { width: 80, gap: 4 },
  lineFieldLabel: { fontSize: 12, opacity: 0.6 },
  lineInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: '#000',
    backgroundColor: '#fff',
  },
  lineAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
  },
  lineMeta: { fontSize: 13, opacity: 0.6 },
  removeButton: { paddingHorizontal: 8, paddingVertical: 2 },
  removeText: { fontSize: 22, color: '#FF3B30' },
  addLineButton: {
    borderWidth: 1,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  addLineButtonText: { color: '#007AFF', fontWeight: '600' },
  totals: { padding: 12, borderRadius: 8, marginTop: 16, gap: 6 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  collapseHeader: {
    paddingVertical: 12,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 24,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    maxHeight: '80%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  modalTitle: { marginBottom: 12 },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  modalRowSub: { fontSize: 13, opacity: 0.6, marginTop: 2 },
  modalEmpty: { padding: 20, textAlign: 'center', opacity: 0.6 },
  modalClose: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  modalCloseText: { color: '#FF3B30', fontSize: 16 },
})
