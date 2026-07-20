import { and, asc, eq } from 'drizzle-orm'
// Type-only import: fully erased at build time, so it does NOT pull the native
// picker module in at screen-load. The runtime value is loaded lazily inside
// runScan, so this screen + manual entry work even on an app binary built
// before expo-image-picker was added (you'd just rebuild to enable scanning).
import type * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
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
import { PickerSearchList } from '@/components/PickerSearchList'
import { schema, useDb } from '@/db'
import { notDeleted } from '@/db/softDelete'
import { extractBillFromImage } from '@/utils/billOcr'
import { formatCurrency } from '@/utils/currency'
import type { PurchaseTaxOverride } from '@neu/shared'

import {
  listOpenPurchaseOrders,
  loadPoLinesForBill,
  type OpenPoSummary,
} from '@/utils/poSave'
import {
  createPurchaseBill,
  generateBillNumber,
  type PurchaseLineInput,
} from '@/utils/purchaseSave'

type Supplier = typeof schema.supplier.$inferSelect
type SupplierItem = typeof schema.supplierItem.$inferSelect

// Form-local line. supplierItemId set = picked from the supplier's catalog;
// null = a new item the user typed, which find-or-creates on save.
type BillLine = {
  supplierItemId: string | null
  name: string
  hsnCode: string
  qty: number
  rate: number
  discount: number
  taxRate: number
}

const todayStr = () => new Date().toISOString().slice(0, 10)

const lineAmount = (l: BillLine) => (l.qty * l.rate - l.discount) * (1 + l.taxRate / 100)

export default function NewPurchaseScreen() {
  const db = useDb()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [catalog, setCatalog] = useState<SupplierItem[]>([])

  const [supplierId, setSupplierId] = useState('')
  const [billNumber, setBillNumber] = useState('')
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [billDate, setBillDate] = useState(todayStr())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<BillLine[]>([])
  // Up-front payment typed on the form — becomes a real tagged PAYMENT_OUT row
  // on save (mirrors desktop's create form). Kept as text for free typing.
  const [amountPaidStr, setAmountPaidStr] = useState('')
  // Document-level discount, subtracted from the grand total AFTER tax
  // (totalAmount = subtotal + tax − discount, mirrors desktop).
  const [docDiscountStr, setDocDiscountStr] = useState('')
  // Bill-level tax from a scanned bill that shows tax only at the bottom
  // (every line taxRate 0): the total plus, when the bill printed one, its
  // explicit CGST/SGST/IGST breakdown. Deactivates automatically if the user
  // types any per-line tax rate, so the two can never both apply.
  const [taxOverride, setTaxOverride] = useState<PurchaseTaxOverride | null>(null)

  const [saving, setSaving] = useState(false)
  const [showSupplierPicker, setShowSupplierPicker] = useState(false)
  const [showCatalogPicker, setShowCatalogPicker] = useState(false)

  // Reference PO (optional link, mirrors desktop): open POs for the chosen
  // supplier feed the picker; selecting one offers to pre-fill the lines.
  const [openPOs, setOpenPOs] = useState<OpenPoSummary[]>([])
  const [purchaseOrderId, setPurchaseOrderId] = useState('')
  const [showPoPicker, setShowPoPicker] = useState(false)

  // AI scan state. The base64 image is kept so it can be saved as the bill's
  // attachment on submit (matching desktop's "Original" audit trail).
  const [scanning, setScanning] = useState(false)
  const [attachmentBase64, setAttachmentBase64] = useState<string | null>(null)
  const [attachmentMimeType, setAttachmentMimeType] = useState<string | null>(null)

  useEffect(() => {
    db.select()
      .from(schema.supplier)
      .where(notDeleted(schema.supplier.deletedAt))
      .orderBy(asc(schema.supplier.name))
      .then(setSuppliers)
  }, [db])

  // Catalog is per-supplier — reload it (and clear lines tied to the old
  // supplier) whenever the supplier changes. Mirrors desktop.
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
    if (!supplierId) {
      setOpenPOs([])
      return
    }
    listOpenPurchaseOrders(db, supplierId).then(setOpenPOs)
  }, [supplierId, db])

  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? ''

  const subtotal = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount), 0)
  const computedTax = lines.reduce((s, l) => s + (l.qty * l.rate - l.discount) * (l.taxRate / 100), 0)
  const overrideActive = taxOverride != null && lines.every((l) => !l.taxRate)
  const taxAmount = overrideActive ? (taxOverride?.taxAmount ?? 0) : computedTax
  const docDiscount = parseFloat(docDiscountStr) || 0
  const total = subtotal + taxAmount - docDiscount

  function pickSupplier(id: string) {
    if (id !== supplierId) {
      setLines([])
      setPurchaseOrderId('')
    }
    setSupplierId(id)
    setShowSupplierPicker(false)
  }

  async function applyPoPrefill(poId: string) {
    const poLines = await loadPoLinesForBill(db, poId)
    setLines(
      poLines.map((l) => ({
        supplierItemId: l.supplierItemId,
        name: l.name ?? '',
        hsnCode: l.hsnCode ?? '',
        qty: l.quantity,
        rate: l.rate,
        discount: l.discount ?? 0,
        taxRate: l.taxRate ?? 0,
      })),
    )
  }

  // Selecting a PO links it and offers to pre-fill the lines. Declining keeps
  // just the link — same behavior as desktop's handleSelectPO.
  function handleSelectPO(poId: string) {
    setShowPoPicker(false)
    if (!poId) {
      setPurchaseOrderId('')
      return
    }
    setPurchaseOrderId(poId)
    if (lines.length === 0) {
      void applyPoPrefill(poId)
      return
    }
    Alert.alert('Pre-fill from PO?', "Replace the current line items with this PO's items?", [
      { text: 'Keep my items', style: 'cancel' },
      { text: 'Replace', onPress: () => void applyPoPrefill(poId) },
    ])
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

  // Try to auto-pick a supplier from extracted data: GSTIN match wins
  // (definitive), then case-insensitive name match. Mirrors desktop.
  function matchSupplier(gstin: string | null, name: string | null): Supplier | null {
    if (gstin) {
      const g = gstin.toLowerCase().trim()
      const byGstin = suppliers.find((s) => s.taxId?.toLowerCase().trim() === g)
      if (byGstin) return byGstin
    }
    if (name) {
      const n = name.toLowerCase().trim()
      const byName = suppliers.find((s) => s.name.toLowerCase().trim() === n)
      if (byName) return byName
    }
    return null
  }

  async function runScan(source: 'camera' | 'library') {
    // Load the native picker only now. On an app binary built before the module
    // was added, this throws "Cannot find native module" — catch it and tell the
    // user to rebuild, instead of crashing the whole screen.
    let Picker: typeof ImagePicker
    try {
      Picker = await import('expo-image-picker')
    } catch {
      Alert.alert(
        'Rebuild needed',
        'Bill scanning needs a fresh app build to add the camera module. Run "npx expo run:android" once, then this will work. Manual entry works now.',
      )
      return
    }
    // The JS module can load even when the NATIVE module isn't in this binary
    // (import() resolves but the functions are undefined). Catch that here so we
    // show the rebuild message instead of crashing on an undefined call.
    if (typeof Picker.launchCameraAsync !== 'function') {
      Alert.alert(
        'Rebuild needed',
        'The camera module isn’t in this build yet. Run "npx expo run:android" once, then bill scanning will work. Manual entry works now.',
      )
      return
    }

    try {
      // Permission first — Expo returns granted:false rather than throwing.
      const perm =
        source === 'camera'
          ? await Picker.requestCameraPermissionsAsync()
          : await Picker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        Alert.alert(
          'Permission needed',
          source === 'camera'
            ? 'Allow camera access to photograph a bill.'
            : 'Allow photo access to pick a bill image.',
        )
        return
      }

      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        base64: true,
        quality: 0.7,
      }
      const result =
        source === 'camera'
          ? await Picker.launchCameraAsync(opts)
          : await Picker.launchImageLibraryAsync(opts)
      if (result.canceled || !result.assets?.length) return

      const asset = result.assets[0]
      if (!asset.base64) {
        Alert.alert('Error', 'Could not read the image data. Try another photo.')
        return
      }
      const mime = asset.mimeType || 'image/jpeg'

      setScanning(true)
      const ocr = await extractBillFromImage(asset.base64, mime)
      if (!ocr.success) {
        Alert.alert('Scan failed', ocr.error)
        return
      }
      const data = ocr.data

      // Keep the image so it's saved as the bill attachment on submit.
      setAttachmentBase64(asset.base64)
      setAttachmentMimeType(mime)

      // Supplier: auto-select if we can match; otherwise leave for the user to
      // pick (we don't auto-create suppliers on mobile — keep it explicit).
      const matched = matchSupplier(data.supplierGstin, data.supplierName)
      if (matched) {
        setSupplierId(matched.id)
      }

      // Header fields from extraction.
      if (data.billNumber) setSupplierInvoiceNumber(data.billNumber)
      if (data.billDate) setBillDate(data.billDate)

      // Lines come in as new (typed) items — supplierItemId null — so the save
      // path find-or-creates them in the matched supplier's catalog, exactly
      // like desktop's auto-create on save.
      setLines(
        data.items.map((it) => ({
          supplierItemId: null,
          name: it.name,
          hsnCode: it.hsnCode ?? '',
          qty: it.quantity || 1,
          rate: it.rate || 0,
          discount: 0,
          taxRate: it.taxRate || 0,
        })),
      )

      // Bills that show tax only as a bottom line arrive with every line's
      // taxRate 0 and a doc-level taxAmount — honor that figure (and the bill's
      // printed CGST/SGST/IGST breakdown, when the model extracted one) as the
      // bill-level override. Same rule as desktop; the shared helper normalises
      // an impossible split against the supplier's state.
      const linesCarryTax = data.items.some((it) => (it.taxRate || 0) > 0)
      setTaxOverride(
        !linesCarryTax && data.taxAmount > 0
          ? {
              taxAmount: data.taxAmount,
              cgstAmount: data.cgstAmount,
              sgstAmount: data.sgstAmount,
              igstAmount: data.igstAmount,
            }
          : null,
      )

      const supplierMsg = matched
        ? `Supplier matched: ${matched.name}.`
        : data.supplierName
          ? `Couldn't match "${data.supplierName}" — pick or add the supplier.`
          : 'Pick the supplier.'
      Alert.alert('Bill scanned', `${supplierMsg} Review the fields and items, then save.`)
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to scan bill')
    } finally {
      setScanning(false)
    }
  }

  function handleScanPress() {
    Alert.alert('Scan a bill', 'Choose where to get the bill photo from.', [
      { text: 'Take photo', onPress: () => runScan('camera') },
      { text: 'Choose from library', onPress: () => runScan('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function handleSave() {
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
      const number = billNumber.trim() || (await generateBillNumber(db))
      const parsedDate = new Date(billDate)
      // Convert the scanned base64 image to the Buffer the blob(buffer) column
      // expects (the global Buffer polyfill from _layout makes this work on
      // Hermes). Undefined when no photo was scanned.
      const attachmentData = attachmentBase64
        ? Buffer.from(attachmentBase64, 'base64')
        : null
      const header = {
        supplierId,
        billNumber: number,
        billDate: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
        supplierInvoiceNumber: supplierInvoiceNumber.trim() || null,
        supplierInvoiceDate: null,
        purchaseOrderId: purchaseOrderId || null,
        notes: notes.trim() || null,
        discount: docDiscount,
        taxOverride: overrideActive ? taxOverride : null,
        amountPaid: parseFloat(amountPaidStr) || 0,
        paymentMode: 'CASH',
        attachmentData,
        attachmentMimeType,
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
      await createPurchaseBill(db, header, lineInputs)
      router.back()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save bill'
      Alert.alert('Error', msg)
    } finally {
      setSaving(false)
    }
  }

  if (suppliers.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title" style={styles.title}>New Purchase Bill</ThemedText>
        <ThemedText style={styles.emptyNote}>
          You need at least one supplier first — a bill always belongs to a supplier.
        </ThemedText>
        <Pressable style={styles.saveButton} onPress={() => router.replace('/supplier/newSupplier')}>
          <ThemedText style={styles.saveButtonText}>Add a supplier first</ThemedText>
        </Pressable>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <ThemedText type="title" style={styles.title}>New Purchase Bill</ThemedText>

      <Pressable
        style={[styles.scanButton, scanning && styles.scanButtonDisabled]}
        onPress={handleScanPress}
        disabled={scanning}
      >
        {scanning ? (
          <>
            <ActivityIndicator color="#007AFF" />
            <ThemedText style={styles.scanButtonText}>Reading bill…</ThemedText>
          </>
        ) : (
          <ThemedText style={styles.scanButtonText}>📷 Scan bill from photo</ThemedText>
        )}
      </Pressable>
      {attachmentBase64 ? (
        <ThemedText style={styles.attachedNote}>✓ Photo attached to this bill</ThemedText>
      ) : null}

      <ThemedText style={styles.label}>Supplier *</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowSupplierPicker(true)}>
        <ThemedText style={supplierId ? undefined : styles.placeholder}>
          {supplierId ? supplierName : 'Pick a supplier'}
        </ThemedText>
      </Pressable>

      {supplierId && openPOs.length > 0 ? (
        <>
          <ThemedText style={styles.label}>Reference PO (optional)</ThemedText>
          <Pressable style={styles.picker} onPress={() => setShowPoPicker(true)}>
            <ThemedText style={purchaseOrderId ? undefined : styles.placeholder}>
              {purchaseOrderId
                ? openPOs.find((p) => p.id === purchaseOrderId)?.orderNumber ?? 'Linked PO'
                : `Link one of ${openPOs.length} open PO${openPOs.length === 1 ? '' : 's'}`}
            </ThemedText>
          </Pressable>
        </>
      ) : null}

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
      <Field
        label="Internal Bill # (auto if blank)"
        value={billNumber}
        onChangeText={setBillNumber}
        placeholder="BILL-2026-001"
      />

      <View style={styles.linesHeader}>
        <ThemedText type="defaultSemiBold">Items</ThemedText>
      </View>

      {lines.length === 0 ? (
        <ThemedText style={styles.noLines}>No items yet. Add from the catalog or type a new one.</ThemedText>
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

      <Field
        label="Bill Discount (optional)"
        value={docDiscountStr}
        onChangeText={setDocDiscountStr}
        placeholder="0"
        keyboardType="numeric"
      />

      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.totals}>
        <TotalRow label="Subtotal" value={subtotal} />
        <TotalRow label={overrideActive ? 'Tax (from scanned bill)' : 'Tax'} value={taxAmount} />
        {docDiscount > 0 && <TotalRow label="Discount" value={-docDiscount} />}
        <TotalRow label="Total" value={total} bold />
      </ThemedView>

      <Field
        label="Amount Paid now (optional)"
        value={amountPaidStr}
        onChangeText={setAmountPaidStr}
        placeholder="0"
        keyboardType="numeric"
      />

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Bill'}</ThemedText>
      </Pressable>

      <Modal visible={showSupplierPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Select Supplier</ThemedText>
            <PickerSearchList
              data={suppliers}
              getName={(x) => x.name}
              getExtra={(x) => [x.phone]}
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

      <Modal visible={showPoPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Link a Purchase Order</ThemedText>
            <FlatList
              data={[{ id: '', orderNumber: 'None — no PO link', orderDate: new Date(), totalAmount: 0 } as OpenPoSummary, ...openPOs]}
              keyExtractor={(p) => p.id || 'none'}
              renderItem={({ item }) => (
                <Pressable style={styles.modalRow} onPress={() => handleSelectPO(item.id)}>
                  <ThemedText type={item.id === purchaseOrderId ? 'defaultSemiBold' : undefined}>
                    {item.id === purchaseOrderId ? `✓ ${item.orderNumber}` : item.orderNumber}
                  </ThemedText>
                  {item.id ? (
                    <ThemedText style={styles.catalogMeta}>
                      {new Date(item.orderDate).toLocaleDateString()} · {formatCurrency(item.totalAmount)}
                    </ThemedText>
                  ) : null}
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowPoPicker(false)}>
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
              <PickerSearchList
                data={catalog}
                getName={(x) => x.name}
                getExtra={(x) => [x.hsnCode]}
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
  title: { marginBottom: 8 },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
  },
  scanButtonDisabled: { opacity: 0.6 },
  scanButtonText: { color: '#007AFF', fontWeight: '600', fontSize: 15 },
  attachedNote: { fontSize: 12, color: '#16a34a', marginTop: -6 },
  emptyNote: { fontSize: 15, opacity: 0.7, lineHeight: 22 },
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
  saveButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 16,
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
