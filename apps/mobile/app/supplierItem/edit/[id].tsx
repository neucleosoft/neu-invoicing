import { asc, eq } from 'drizzle-orm'
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

const UNIT_OPTIONS = ['pcs', 'kg', 'g', 'l', 'm', 'hrs', 'box', 'carton'] as const
type UnitOption = (typeof UNIT_OPTIONS)[number]
const UNIT_LABELS: Record<UnitOption, string> = {
  pcs: 'Pieces (pcs)',
  kg: 'Kilograms (kg)',
  g: 'Grams (g)',
  l: 'Liters (l)',
  m: 'Meters (m)',
  hrs: 'Hours (hrs)',
  box: 'Box',
  carton: 'Carton',
}

type Item = typeof schema.item.$inferSelect

export default function EditSupplierItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()

  const [loading, setLoading] = useState(true)
  const [original, setOriginal] =
    useState<typeof schema.supplierItem.$inferSelect | null>(null)
  const [items, setItems] = useState<Item[]>([])
  // Supplier is locked on edit (matches desktop): moving an item to another
  // supplier would orphan past-bill references, so we only display the name.
  const [supplierLabel, setSupplierLabel] = useState('')

  const [name, setName] = useState('')
  const [hsnCode, setHsnCode] = useState('')
  const [unit, setUnit] = useState<UnitOption>('pcs')
  const [lastPurchasePrice, setLastPurchasePrice] = useState('0')
  const [defaultTaxRate, setDefaultTaxRate] = useState('0')
  const [linkedItemId, setLinkedItemId] = useState('')

  const [saving, setSaving] = useState(false)
  const [showUnitPicker, setShowUnitPicker] = useState(false)
  const [showLinkPicker, setShowLinkPicker] = useState(false)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    Promise.all([
      db.select().from(schema.supplierItem).where(eq(schema.supplierItem.id, id)).limit(1),
      db.select().from(schema.item).where(notDeleted(schema.item.deletedAt)).orderBy(asc(schema.item.name)),
    ]).then(async ([rows, it]) => {
      const si = rows[0]
      setItems(it)
      if (!si) {
        setLoading(false)
        return
      }
      setOriginal(si)
      setName(si.name)
      setHsnCode(si.hsnCode ?? '')
      const allowedUnits = UNIT_OPTIONS as readonly string[]
      setUnit(allowedUnits.includes(si.unit) ? (si.unit as UnitOption) : 'pcs')
      setLastPurchasePrice(String(si.lastPurchasePrice))
      setDefaultTaxRate(String(si.defaultTaxRate))
      setLinkedItemId(si.linkedItemId ?? '')

      const sup = await db
        .select()
        .from(schema.supplier)
        .where(eq(schema.supplier.id, si.supplierId))
        .limit(1)
      setSupplierLabel(sup[0]?.name ?? '—')
      setLoading(false)
    })
  }, [id, db])

  const linkedItemName = items.find((i) => i.id === linkedItemId)?.name ?? ''

  async function handleSave() {
    if (!id || !original) return
    if (!name.trim()) {
      Alert.alert('Validation', 'Item name is required')
      return
    }
    setSaving(true)
    try {
      await db
        .update(schema.supplierItem)
        .set({
          name: name.trim(),
          hsnCode: hsnCode.trim() || null,
          unit,
          lastPurchasePrice: parseFloat(lastPurchasePrice) || 0,
          defaultTaxRate: parseFloat(defaultTaxRate) || 0,
          linkedItemId: linkedItemId || null,
        })
        .where(eq(schema.supplierItem.id, id))
      router.back()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update supplier item'
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

  if (!original) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText type="subtitle">Supplier item not found</ThemedText>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <ThemedText style={styles.backLinkText}>Go back</ThemedText>
        </Pressable>
      </ThemedView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Edit Supplier Item
      </ThemedText>

      <ThemedText style={styles.label}>Supplier</ThemedText>
      <View style={styles.lockedField}>
        <ThemedText style={styles.lockedText}>{supplierLabel}</ThemedText>
        <ThemedText style={styles.lockedHint}>locked</ThemedText>
      </View>

      <Field label="Name *" value={name} onChangeText={setName} placeholder='e.g. "Tube Light 36W"' />
      <Field label="HSN / SAC" value={hsnCode} onChangeText={setHsnCode} placeholder="Optional" />

      <ThemedText style={styles.label}>Unit</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowUnitPicker(true)}>
        <ThemedText>{UNIT_LABELS[unit]}</ThemedText>
      </Pressable>

      <Field
        label="Last Purchase Price (₹)"
        value={lastPurchasePrice}
        onChangeText={setLastPurchasePrice}
        keyboardType="numeric"
      />
      <Field
        label="Default Tax Rate (%)"
        value={defaultTaxRate}
        onChangeText={setDefaultTaxRate}
        keyboardType="numeric"
      />

      <ThemedText style={styles.label}>Link to a sellable item (optional)</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowLinkPicker(true)}>
        <ThemedText style={linkedItemId ? undefined : styles.placeholder}>
          {linkedItemId ? linkedItemName : 'None — no stock tracking on purchase'}
        </ThemedText>
      </Pressable>

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
            {saving ? 'Saving…' : 'Update Item'}
          </ThemedText>
        </Pressable>
      </View>

      <Modal visible={showUnitPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Unit
            </ThemedText>
            <FlatList
              data={UNIT_OPTIONS}
              keyExtractor={(opt) => opt}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setUnit(item)
                    setShowUnitPicker(false)
                  }}
                >
                  <ThemedText type={item === unit ? 'defaultSemiBold' : undefined}>
                    {item === unit ? `✓ ${UNIT_LABELS[item]}` : UNIT_LABELS[item]}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowUnitPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>

      <Modal visible={showLinkPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Link to sellable item
            </ThemedText>
            <FlatList
              data={[{ id: '', name: 'None — no stock tracking' }, ...items]}
              keyExtractor={(i) => i.id || 'none'}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setLinkedItemId(item.id)
                    setShowLinkPicker(false)
                  }}
                >
                  <ThemedText type={item.id === linkedItemId ? 'defaultSemiBold' : undefined}>
                    {item.id === linkedItemId ? `✓ ${item.name}` : item.name}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowLinkPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
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
  modalContent: { maxHeight: '80%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  modalTitle: { marginBottom: 12 },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  modalClose: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  modalCloseText: { color: '#FF3B30', fontSize: 16 },
})
