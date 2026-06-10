import { eq, sql } from 'drizzle-orm'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'

import { applyPayment, computeGstValues } from '@neu/shared'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Screen } from '@/components/ui/Screen'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { useColors } from '@/hooks/use-colors'
import { Radius, Spacing, Type } from '@/constants/tokens'
import { schema, useDb } from '@/db'
import { generateInvoiceNumber } from '@/utils/invoiceNumber'

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
  const c = useColors()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])
  // The seller's company — its state code drives the inter-state (IGST vs
  // CGST/SGST) decision when computing the GST split at save time.
  const [company, setCompany] = useState<Company | null>(null)

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
    db.select().from(schema.company).limit(1).then((r) => setCompany(r[0] ?? null))
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

      // Compute the GST split (place of supply, inter-state, per-line CGST/SGST
      // or IGST, supply type) the SAME way desktop does — via the shared
      // computeGstValues. Without this every mobile-created invoice would store 0
      // for the split, and the GST reports + PDF tax tables would read zero. HSN
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
            subtotal: gst.subtotal,
            taxAmount: gst.taxAmount,
            totalAmount: gst.totalAmount,
            amountPaid: 0,
            balanceDue: gst.totalAmount,
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
            poNumber: poNumber.trim() || null,
            ewayBillNo: ewayBillNo.trim() || null,
            vehicleNumber: vehicleNumber.trim() || null,
            warrantyPeriod: warrantyPeriod.trim() || null,
            dispatchedThrough: dispatchedThrough.trim() || null,
          })
          .returning()

        await tx.insert(schema.salesInvoiceItem).values(
          lines.map((l, idx) => {
            const g = gst.items[idx]
            return {
              salesInvoiceId: inserted.id,
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
    <Screen contentStyle={styles.content}>
      <Text style={[Type.title, { color: c.text }]}>New Invoice</Text>

      <SectionHeader title="Invoice Details" />

      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: c.muted }]}>Invoice #</Text>
        <View
          style={[
            styles.readOnly,
            { backgroundColor: c.surfaceAlt, borderColor: c.border },
          ]}
        >
          <Text style={[Type.body, { color: c.text }]}>{invoiceNumber}</Text>
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: c.muted }]}>Customer *</Text>
        <Pressable
          style={[
            styles.picker,
            { backgroundColor: c.surfaceAlt, borderColor: c.border },
          ]}
          onPress={() => setShowCustomerPicker(true)}
        >
          <Text style={[Type.body, { color: selectedCustomer ? c.text : c.muted }]}>
            {selectedCustomer ? selectedCustomer.name : 'Tap to select customer'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: c.muted }]}>Status</Text>
        <Pressable
          style={[
            styles.picker,
            { backgroundColor: c.surfaceAlt, borderColor: c.border },
          ]}
          onPress={() => setShowStatusPicker(true)}
        >
          <Text style={[Type.body, { color: c.text }]}>{STATUS_LABELS[status]}</Text>
        </Pressable>
      </View>

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

      <SectionHeader title="Line Items" />
      {lines.map((l, i) => (
        <Card key={i} style={styles.lineCard}>
          <View style={styles.lineTop}>
            <Text style={[Type.bodySemibold, styles.lineName, { color: c.text }]} numberOfLines={2}>
              {l.itemName}
            </Text>
            <Pressable style={styles.removeButton} onPress={() => removeLine(i)}>
              <Text style={[styles.removeText, { color: c.danger }]}>×</Text>
            </Pressable>
          </View>

          <View style={styles.lineFieldsRow}>
            <View style={styles.lineFieldSmall}>
              <Text style={[styles.lineFieldLabel, { color: c.muted }]}>Qty</Text>
              <TextInput
                style={[styles.lineInput, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
                value={String(l.qty)}
                onChangeText={(v) => updateLine(i, { qty: parseFloat(v) || 0 })}
                keyboardType="numeric"
                placeholderTextColor={c.muted}
              />
            </View>
            <View style={styles.lineField}>
              <Text style={[styles.lineFieldLabel, { color: c.muted }]}>Rate</Text>
              <TextInput
                style={[styles.lineInput, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
                value={String(l.rate)}
                onChangeText={(v) => updateLine(i, { rate: parseFloat(v) || 0 })}
                keyboardType="numeric"
                placeholderTextColor={c.muted}
              />
            </View>
          </View>

          <View style={styles.lineFieldsRow}>
            <View style={styles.lineField}>
              <Text style={[styles.lineFieldLabel, { color: c.muted }]}>Discount</Text>
              <TextInput
                style={[styles.lineInput, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
                value={String(l.discount)}
                onChangeText={(v) => updateLine(i, { discount: parseFloat(v) || 0 })}
                keyboardType="numeric"
                placeholderTextColor={c.muted}
              />
            </View>
            <View style={styles.lineFieldSmall}>
              <Text style={[styles.lineFieldLabel, { color: c.muted }]}>Tax %</Text>
              <TextInput
                style={[styles.lineInput, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
                value={String(l.taxRate)}
                onChangeText={(v) => updateLine(i, { taxRate: parseFloat(v) || 0 })}
                keyboardType="numeric"
                placeholderTextColor={c.muted}
              />
            </View>
          </View>

          <View style={[styles.lineAmountRow, { borderTopColor: c.border }]}>
            <Text style={[styles.lineMeta, { color: c.muted }]}>Amount</Text>
            <Text style={[Type.bodySemibold, { color: c.text }]}>
              ₹{lineAmount(l.qty, l.rate, l.discount, l.taxRate).toFixed(2)}
            </Text>
          </View>
        </Card>
      ))}
      <Pressable
        style={[styles.addLineButton, { borderColor: c.accent }]}
        onPress={() => setShowItemPicker(true)}
      >
        <Text style={[styles.addLineButtonText, { color: c.accent }]}>+ Add Line Item</Text>
      </Pressable>

      <Card style={styles.totals}>
        <View style={styles.totalsRow}>
          <Text style={[Type.body, { color: c.muted }]}>Subtotal</Text>
          <Text style={[Type.body, { color: c.text }]}>₹{subtotal.toFixed(2)}</Text>
        </View>
        <View style={styles.totalsRow}>
          <Text style={[Type.body, { color: c.muted }]}>Tax</Text>
          <Text style={[Type.body, { color: c.text }]}>₹{taxAmount.toFixed(2)}</Text>
        </View>
        <View style={styles.totalsRow}>
          <Text style={[Type.bodySemibold, { color: c.text }]}>Total</Text>
          <Text style={[Type.bodySemibold, { color: c.text }]}>₹{total.toFixed(2)}</Text>
        </View>
        {paid > 0 && (
          <View style={styles.totalsRow}>
            <Text style={[Type.body, { color: c.muted }]}>Balance Due</Text>
            <Text style={[Type.body, { color: c.text }]}>₹{balanceDue.toFixed(2)}</Text>
          </View>
        )}
      </Card>

      <SectionHeader title="Payment" />
      <Field
        label="Amount Paid (₹)"
        value={amountPaid}
        onChangeText={setAmountPaid}
        keyboardType="numeric"
      />
      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: c.muted }]}>Payment Mode</Text>
        <Pressable
          style={[
            styles.picker,
            { backgroundColor: c.surfaceAlt, borderColor: c.border },
          ]}
          onPress={() => setShowPaymentModePicker(true)}
        >
          <Text style={[Type.body, { color: c.text }]}>{paymentMode}</Text>
        </Pressable>
      </View>

      <SectionHeader title="Notes & Terms" />
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

      <Pressable
        style={[styles.collapseHeader, { borderColor: c.border }]}
        onPress={() => setShowAdditional(!showAdditional)}
      >
        <Text style={[Type.bodySemibold, { color: c.text }]}>
          {showAdditional ? '▼' : '▶'} Additional Fields
        </Text>
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

      <Button
        title="Save Invoice"
        variant="primary"
        loading={saving}
        onPress={handleSave}
        style={styles.saveButton}
      />

      <Modal visible={showCustomerPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: c.surface }]}>
            <Text style={[Type.title, styles.modalTitle, { color: c.text }]}>
              Select Customer
            </Text>
            <FlatList
              data={customers}
              keyExtractor={(c) => c.id}
              ListEmptyComponent={
                <Text style={[styles.modalEmpty, { color: c.muted }]}>
                  No customers yet. Add one from the Customers tab.
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.modalRow, { borderBottomColor: c.border }]}
                  onPress={() => {
                    setCustomerId(item.id)
                    setShowCustomerPicker(false)
                  }}
                >
                  <Text style={[Type.bodySemibold, { color: c.text }]}>{item.name}</Text>
                  {item.phone && <Text style={[styles.modalRowSub, { color: c.muted }]}>{item.phone}</Text>}
                </Pressable>
              )}
            />
            <Pressable
              style={[styles.modalClose, { borderTopColor: c.border }]}
              onPress={() => setShowCustomerPicker(false)}
            >
              <Text style={[styles.modalCloseText, { color: c.danger }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showItemPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: c.surface }]}>
            <Text style={[Type.title, styles.modalTitle, { color: c.text }]}>
              Select Item
            </Text>
            <FlatList
              data={items}
              keyExtractor={(it) => it.id}
              ListEmptyComponent={
                <Text style={[styles.modalEmpty, { color: c.muted }]}>
                  No items yet. Add one from the Items tab.
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.modalRow, { borderBottomColor: c.border }]}
                  onPress={() => pickItem(item)}
                >
                  <Text style={[Type.bodySemibold, { color: c.text }]}>{item.name}</Text>
                  <Text style={[styles.modalRowSub, { color: c.muted }]}>
                    ₹{item.salePrice.toFixed(2)} / {item.unit} · {item.taxRate}% GST
                  </Text>
                </Pressable>
              )}
            />
            <Pressable
              style={[styles.modalClose, { borderTopColor: c.border }]}
              onPress={() => setShowItemPicker(false)}
            >
              <Text style={[styles.modalCloseText, { color: c.danger }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showStatusPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: c.surface }]}>
            <Text style={[Type.title, styles.modalTitle, { color: c.text }]}>
              Invoice Status
            </Text>
            <FlatList
              data={STATUS_OPTIONS}
              keyExtractor={(opt) => opt}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.modalRow, { borderBottomColor: c.border }]}
                  onPress={() => {
                    setStatus(item)
                    setShowStatusPicker(false)
                  }}
                >
                  <Text
                    style={[
                      item === status ? Type.bodySemibold : Type.body,
                      { color: item === status ? c.accentDeep : c.text },
                    ]}
                  >
                    {item === status ? `✓ ${STATUS_LABELS[item]}` : STATUS_LABELS[item]}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable
              style={[styles.modalClose, { borderTopColor: c.border }]}
              onPress={() => setShowStatusPicker(false)}
            >
              <Text style={[styles.modalCloseText, { color: c.danger }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showPaymentModePicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: c.surface }]}>
            <Text style={[Type.title, styles.modalTitle, { color: c.text }]}>
              Payment Mode
            </Text>
            <FlatList
              data={PAYMENT_MODE_OPTIONS}
              keyExtractor={(opt) => opt}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.modalRow, { borderBottomColor: c.border }]}
                  onPress={() => {
                    setPaymentMode(item)
                    setShowPaymentModePicker(false)
                  }}
                >
                  <Text
                    style={[
                      item === paymentMode ? Type.bodySemibold : Type.body,
                      { color: item === paymentMode ? c.accentDeep : c.text },
                    ]}
                  >
                    {item === paymentMode ? `✓ ${item}` : item}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable
              style={[styles.modalClose, { borderTopColor: c.border }]}
              onPress={() => setShowPaymentModePicker(false)}
            >
              <Text style={[styles.modalCloseText, { color: c.danger }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  )
}

function Field({ label, ...inputProps }: { label: string } & TextInputProps) {
  const c = useColors()
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text },
        ]}
        placeholderTextColor={c.muted}
        {...inputProps}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md },
  fieldGroup: { gap: Spacing.xs },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 16,
  },
  readOnly: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  picker: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  lineCard: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  lineName: { flex: 1 },
  lineFieldsRow: { flexDirection: 'row', gap: Spacing.sm },
  lineField: { flex: 1, gap: Spacing.xs },
  lineFieldSmall: { width: 80, gap: Spacing.xs },
  lineFieldLabel: { fontSize: 12 },
  lineInput: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    fontSize: 15,
  },
  lineAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  lineMeta: { fontSize: 13 },
  removeButton: { paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  removeText: { fontSize: 22 },
  addLineButton: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  addLineButtonText: { fontWeight: '600' },
  totals: { marginTop: Spacing.lg, gap: Spacing.sm },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  collapseHeader: {
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  saveButton: { marginTop: Spacing.xxl },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    maxHeight: '80%',
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.lg,
  },
  modalTitle: { marginBottom: Spacing.md },
  modalRow: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRowSub: { fontSize: 13, marginTop: 2 },
  modalEmpty: { padding: Spacing.xl, textAlign: 'center' },
  modalClose: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    marginTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modalCloseText: { fontSize: 16 },
})
