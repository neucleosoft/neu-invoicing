import { and, asc, eq, isNull, sql } from 'drizzle-orm'
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

import { computeGstValues, computePaymentStatus } from '@neu/shared'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { notDeleted } from '@/db/softDelete'

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

// Mirror desktop Sales.tsx status dropdown exactly. Payment fields are hidden
// in edit mode (desktop Sales.tsx:1010), so SENT is not exposed here either.
const STATUS_OPTIONS = ['DRAFT', 'PAID', 'PARTIAL', 'OVERDUE'] as const
const STATUS_LABELS: Record<(typeof STATUS_OPTIONS)[number], string> = {
  DRAFT: 'Unpaid',
  PAID: 'Paid',
  PARTIAL: 'Partial',
  OVERDUE: 'Overdue',
}

type StatusOption = (typeof STATUS_OPTIONS)[number]

const PAYMENT_MODE_OPTIONS = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'UPI', 'OTHER'] as const

// Marks the up-front payment auto-managed by the invoice form (matches the create
// screen + desktop's INLINE_PAYMENT_NOTE), so we re-sync exactly that row on edit.
const INLINE_PAYMENT_NOTE = 'Paid with invoice'

function toIsoDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function parseDate(s: string): Date | null {
  if (!s.trim()) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// Mirrors desktop Sales.tsx:451 — discount reduces the taxable base, then tax
// is applied on top.
function lineAmount(qty: number, rate: number, discount: number, taxRate: number) {
  return (qty * rate - discount) * (1 + taxRate / 100)
}

export default function EditInvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()

  const [loading, setLoading] = useState(true)
  const [originalInvoice, setOriginalInvoice] =
    useState<typeof schema.salesInvoice.$inferSelect | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [company, setCompany] = useState<Company | null>(null)

  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusOption>('DRAFT')
  const [amountPaidInput, setAmountPaidInput] = useState('0')
  const [paymentMode, setPaymentMode] = useState<string>('CASH')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [lines, setLines] = useState<LineRow[]>([])
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
    if (!id) {
      setLoading(false)
      return
    }
    Promise.all([
      db
        .select()
        .from(schema.salesInvoice)
        .where(eq(schema.salesInvoice.id, id))
        .limit(1),
      db
        .select({ line: schema.salesInvoiceItem, itemName: schema.item.name })
        .from(schema.salesInvoiceItem)
        .leftJoin(
          schema.item,
          eq(schema.salesInvoiceItem.itemId, schema.item.id),
        )
        .where(eq(schema.salesInvoiceItem.salesInvoiceId, id)),
      db.select().from(schema.customer).where(notDeleted(schema.customer.deletedAt)),
      db.select().from(schema.item).where(notDeleted(schema.item.deletedAt)),
      db.select().from(schema.company).limit(1),
    ]).then(([invRows, lineRows, customerList, itemList, companyRows]) => {
      const inv = invRows[0]
      if (!inv) {
        setLoading(false)
        return
      }
      setOriginalInvoice(inv)
      setInvoiceNumber(inv.invoiceNumber)
      setCustomerId(inv.customerId)
      // If the stored status isn't in our 4-option set (e.g. legacy SENT),
      // default to DRAFT — same as desktop's edit form, which silently maps
      // anything outside its 4 options to the first.
      const allowed = STATUS_OPTIONS as readonly string[]
      setStatus(
        allowed.includes(inv.status) ? (inv.status as StatusOption) : 'DRAFT',
      )
      setAmountPaidInput(String(inv.amountPaid ?? 0))
      setInvoiceDate(toIsoDate(inv.invoiceDate))
      setDueDate(toIsoDate(inv.dueDate))
      setNotes(inv.notes ?? '')
      setTermsConditions(inv.termsConditions ?? '')
      setPoNumber(inv.poNumber ?? '')
      setEwayBillNo(inv.ewayBillNo ?? '')
      setVehicleNumber(inv.vehicleNumber ?? '')
      setWarrantyPeriod(inv.warrantyPeriod ?? '')
      setDispatchedThrough(inv.dispatchedThrough ?? '')
      // Auto-expand Additional Fields if any are populated (mirrors desktop
      // Sales.tsx:400-402).
      if (
        inv.poNumber ||
        inv.ewayBillNo ||
        inv.vehicleNumber ||
        inv.warrantyPeriod ||
        inv.dispatchedThrough
      ) {
        setShowAdditional(true)
      }
      setLines(
        lineRows.map((r) => ({
          itemId: r.line.itemId,
          itemName: r.itemName ?? 'Deleted item',
          qty: r.line.quantity,
          rate: r.line.rate,
          discount: r.line.discount,
          taxRate: r.line.taxRate,
        })),
      )
      setCustomers(customerList)
      setItems(itemList)
      setCompany(companyRows[0] ?? null)
      setLoading(false)
    })
  }, [id, db])

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null
  const subtotal = lines.reduce(
    (s, l) => s + (l.qty * l.rate - l.discount),
    0,
  )
  const taxAmount = lines.reduce(
    (s, l) => s + (l.qty * l.rate - l.discount) * (l.taxRate / 100),
    0,
  )
  const total = subtotal + taxAmount
  // Amount Paid is editable, driven by the Status (mirrors desktop): Paid = full
  // total, Partial = the entered amount, Unpaid/Overdue = nothing paid — so the label
  // can never contradict the money.
  const paid =
    status === 'PAID'
      ? total
      : status === 'PARTIAL'
      ? parseFloat(amountPaidInput) || 0
      : 0
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
    if (!id || !originalInvoice) return
    // Reversed / cancelled invoices are terminal — editing them would un-reverse the
    // balance/stock. The detail screen hides Edit for these; this is the safety net.
    if (originalInvoice.status === 'REVERSED' || originalInvoice.cancelledAt) {
      Alert.alert('Locked', 'This invoice has been reversed or cancelled and can no longer be edited.')
      return
    }
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
    if (status === 'PARTIAL' && (paid <= 0 || paid >= total)) {
      Alert.alert('Validation', 'For a Partial invoice, enter an amount between 0 and the total')
      return
    }
    const due = parseDate(dueDate)

    // Enforce unique invoice number if it changed (mirrors desktop sales.ts:176-179).
    if (invoiceNumber !== originalInvoice.invoiceNumber) {
      const dup = await db
        .select({ id: schema.salesInvoice.id })
        .from(schema.salesInvoice)
        .where(eq(schema.salesInvoice.invoiceNumber, invoiceNumber))
        .limit(1)
      if (dup.length > 0) {
        Alert.alert('Duplicate', `Invoice number ${invoiceNumber} already exists`)
        return
      }
    }

    // Recompute the GST split for the edited lines/customer (same shared path as
    // create) so the stored CGST/SGST/IGST + place of supply stay correct after
    // an edit. balanceDue continues to preserve amountPaid.
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

    setSaving(true)
    try {
      // Wrap the whole edit in a transaction so a half-write can't leave the
      // invoice with old totals but new line items. Mirrors desktop's
      // prisma.$transaction in handlers/sales.ts:165.
      await db.transaction(async (tx) => {
        // Delete then reinsert all line items — same approach as desktop
        // sales.ts:188 (deleteMany) + items.create on update.
        await tx
          .delete(schema.salesInvoiceItem)
          .where(eq(schema.salesInvoiceItem.salesInvoiceId, id))

        await tx.insert(schema.salesInvoiceItem).values(
          lines.map((l, idx) => {
            const g = gst.items[idx]
            return {
              salesInvoiceId: id,
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

        await tx
          .update(schema.salesInvoice)
          .set({
            invoiceNumber,
            customerId,
            // Status follows the money (OVERDUE preserved — it's about the due date).
            status: status === 'OVERDUE' ? 'OVERDUE' : computePaymentStatus(gst.totalAmount, paid),
            invoiceDate: invDate,
            dueDate: due,
            subtotal: gst.subtotal,
            taxAmount: gst.taxAmount,
            totalAmount: gst.totalAmount,
            amountPaid: paid,
            balanceDue: gst.totalAmount - paid,
            placeOfSupply: gst.placeOfSupply || null,
            placeOfSupplyName: gst.placeOfSupplyName || null,
            isInterState: gst.isInterState,
            cgstAmount: gst.totalCgst,
            sgstAmount: gst.totalSgst,
            igstAmount: gst.totalIgst,
            cessAmount: gst.totalCess,
            supplyType: gst.supplyType,
            notes: notes.trim() || null,
            termsConditions: termsConditions.trim() || null,
            poNumber: poNumber.trim() || null,
            ewayBillNo: ewayBillNo.trim() || null,
            vehicleNumber: vehicleNumber.trim() || null,
            warrantyPeriod: warrantyPeriod.trim() || null,
            dispatchedThrough: dispatchedThrough.trim() || null,
          })
          .where(eq(schema.salesInvoice.id, id))

        // Customer balance adjustment, matching desktop sales.ts:230-249.
        // If customer changed: reverse old customer's old balanceDue, apply new
        // customer's new balanceDue. Otherwise: apply the delta.
        if (customerId !== originalInvoice.customerId) {
          await tx
            .update(schema.customer)
            .set({
              currentBalance: sql`${schema.customer.currentBalance} - ${originalInvoice.balanceDue}`,
            })
            .where(eq(schema.customer.id, originalInvoice.customerId))
          await tx
            .update(schema.customer)
            .set({
              currentBalance: sql`${schema.customer.currentBalance} + ${balanceDue}`,
            })
            .where(eq(schema.customer.id, customerId))
        } else {
          const diff = balanceDue - originalInvoice.balanceDue
          if (diff !== 0) {
            await tx
              .update(schema.customer)
              .set({
                currentBalance: sql`${schema.customer.currentBalance} + ${diff}`,
              })
              .where(eq(schema.customer.id, customerId))
          }
        }

        // Re-sync the invoice's up-front payment row to the edited amount, so the
        // customer's statement always agrees with the invoice. Only the tagged inline
        // row is touched — payments from the Payments screen are left alone. The
        // customer balance was already handled by the delta above, so this row is the
        // ledger record only (NOT re-applied). Updating an existing row keeps its mode.
        let inline: typeof schema.paymentTransaction.$inferSelect | null =
          (
            await tx
              .select()
              .from(schema.paymentTransaction)
              .where(
                and(
                  eq(schema.paymentTransaction.salesInvoiceId, id),
                  eq(schema.paymentTransaction.notes, INLINE_PAYMENT_NOTE),
                  isNull(schema.paymentTransaction.cancelledAt),
                ),
              )
              .limit(1)
          )[0] ?? null
        // Fallback for invoices made before this feature: the up-front payment isn't
        // tagged, so find the untagged payment created in the SAME transaction as the
        // invoice (their createdAt timestamps are essentially identical; a payment
        // added later from the Payments screen is seconds+ apart). We adjust & tag that
        // row instead of leaving a stale duplicate. Read + tag only — never deletes.
        if (!inline) {
          const invCreated = originalInvoice.createdAt
            ? new Date(originalInvoice.createdAt as any).getTime()
            : 0
          const candidates = await tx
            .select()
            .from(schema.paymentTransaction)
            .where(
              and(
                eq(schema.paymentTransaction.salesInvoiceId, id),
                eq(schema.paymentTransaction.type, 'PAYMENT_IN'),
                isNull(schema.paymentTransaction.notes),
                isNull(schema.paymentTransaction.cancelledAt),
              ),
            )
            .orderBy(asc(schema.paymentTransaction.createdAt))
          inline =
            candidates.find(
              (p) =>
                !!invCreated &&
                Math.abs(new Date(p.createdAt as any).getTime() - invCreated) < 5000,
            ) ?? null
        }
        if (paid > 0) {
          if (inline) {
            // Tag it on touch so future edits find it directly.
            await tx
              .update(schema.paymentTransaction)
              .set({ amount: paid, paymentDate: invDate, customerId, notes: INLINE_PAYMENT_NOTE })
              .where(eq(schema.paymentTransaction.id, inline.id))
          } else if (paid !== (originalInvoice.amountPaid ?? 0)) {
            // No up-front payment row at all (e.g. a desktop-origin invoice) AND the
            // paid amount changed → record it. Unchanged amount does nothing.
            await tx.insert(schema.paymentTransaction).values({
              type: 'PAYMENT_IN',
              customerId,
              amount: paid,
              paymentMode,
              paymentDate: invDate,
              referenceType: 'INVOICE',
              referenceId: id,
              salesInvoiceId: id,
              notes: INLINE_PAYMENT_NOTE,
            })
          }
        } else if (inline) {
          await tx
            .update(schema.paymentTransaction)
            .set({ cancelledAt: new Date(), cancelReason: 'Invoice marked unpaid' })
            .where(eq(schema.paymentTransaction.id, inline.id))
        }
      })

      router.back()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update invoice'
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

  if (!originalInvoice) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText type="subtitle">Invoice not found</ThemedText>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <ThemedText style={styles.backLinkText}>Go back</ThemedText>
        </Pressable>
      </ThemedView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Edit Invoice
      </ThemedText>

      <SectionHeader>Invoice Details</SectionHeader>

      <Field
        label="Invoice # *"
        value={invoiceNumber}
        onChangeText={setInvoiceNumber}
        placeholder="Invoice number"
        autoCapitalize="characters"
      />

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
        label="Invoice Date *"
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
          <>
            <View style={styles.totalsRow}>
              <ThemedText>Amount Paid</ThemedText>
              <ThemedText>₹{paid.toFixed(2)}</ThemedText>
            </View>
            <View style={styles.totalsRow}>
              <ThemedText>Balance Due</ThemedText>
              <ThemedText>₹{balanceDue.toFixed(2)}</ThemedText>
            </View>
          </>
        )}
      </ThemedView>

      <SectionHeader>Payment</SectionHeader>
      {/* Amount Paid is driven by the Status: editable only for Partial; Paid uses the
          full total, Unpaid/Overdue zero — both locked, so it can't disagree with the
          status. */}
      {status === 'PARTIAL' ? (
        <Field
          label="Amount Paid (₹)"
          value={amountPaidInput}
          onChangeText={setAmountPaidInput}
          keyboardType="numeric"
        />
      ) : (
        <>
          <ThemedText style={styles.label}>Amount Paid (₹)</ThemedText>
          <View style={styles.picker}>
            <ThemedText style={styles.placeholder}>
              ₹{(status === 'PAID' ? total : 0).toFixed(2)} — set by status
            </ThemedText>
          </View>
        </>
      )}
      {(status === 'PAID' || status === 'PARTIAL') && (
        <>
          <ThemedText style={styles.label}>Payment Mode</ThemedText>
          <Pressable style={styles.picker} onPress={() => setShowPaymentModePicker(true)}>
            <ThemedText>{paymentMode}</ThemedText>
          </Pressable>
        </>
      )}

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

      <View style={styles.actionRow}>
        <Pressable style={styles.cancelButton} onPress={() => router.back()}>
          <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <ThemedText style={styles.saveButtonText}>
            {saving ? 'Saving…' : 'Update Invoice'}
          </ThemedText>
        </Pressable>
      </View>

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
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
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
