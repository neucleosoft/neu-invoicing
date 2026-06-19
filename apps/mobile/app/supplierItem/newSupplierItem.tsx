import { asc } from 'drizzle-orm'
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

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { notDeleted } from '@/db/softDelete'

// Same 8 units as Items — a locked list keeps reports able to GROUP BY unit.
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

type Supplier = typeof schema.supplier.$inferSelect
type Item = typeof schema.item.$inferSelect

export default function NewSupplierItemScreen() {
  const db = useDb()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<Item[]>([])

  const [supplierId, setSupplierId] = useState('')
  const [name, setName] = useState('')
  const [hsnCode, setHsnCode] = useState('')
  const [unit, setUnit] = useState<UnitOption>('pcs')
  const [lastPurchasePrice, setLastPurchasePrice] = useState('0')
  const [defaultTaxRate, setDefaultTaxRate] = useState('0')
  const [linkedItemId, setLinkedItemId] = useState('')

  const [saving, setSaving] = useState(false)
  const [showSupplierPicker, setShowSupplierPicker] = useState(false)
  const [showUnitPicker, setShowUnitPicker] = useState(false)
  const [showLinkPicker, setShowLinkPicker] = useState(false)

  useEffect(() => {
    Promise.all([
      db.select().from(schema.supplier).where(notDeleted(schema.supplier.deletedAt)).orderBy(asc(schema.supplier.name)),
      db.select().from(schema.item).where(notDeleted(schema.item.deletedAt)).orderBy(asc(schema.item.name)),
    ]).then(([sup, it]) => {
      setSuppliers(sup)
      setItems(it)
    })
  }, [db])

  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? ''
  const linkedItemName = items.find((i) => i.id === linkedItemId)?.name ?? ''

  async function handleSave() {
    if (!supplierId) {
      Alert.alert('Validation', 'Please pick a supplier')
      return
    }
    if (!name.trim()) {
      Alert.alert('Validation', 'Item name is required')
      return
    }
    setSaving(true)
    try {
      await db.insert(schema.supplierItem).values({
        supplierId,
        name: name.trim(),
        hsnCode: hsnCode.trim() || null,
        unit,
        lastPurchasePrice: parseFloat(lastPurchasePrice) || 0,
        defaultTaxRate: parseFloat(defaultTaxRate) || 0,
        linkedItemId: linkedItemId || null,
      })
      router.back()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save'
      Alert.alert('Error', msg)
    } finally {
      setSaving(false)
    }
  }

  // A supplier item must belong to a supplier — block the form if none exist
  // yet, and point the user at where to create one.
  if (suppliers.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title" style={styles.title}>
          New Supplier Item
        </ThemedText>
        <ThemedText style={styles.emptyNote}>
          You need at least one supplier first — a supplier item is something a
          specific supplier sells you.
        </ThemedText>
        <Pressable
          style={styles.saveButton}
          onPress={() => router.replace('/supplier/newSupplier')}
        >
          <ThemedText style={styles.saveButtonText}>Add a supplier first</ThemedText>
        </Pressable>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>
        New Supplier Item
      </ThemedText>

      <ThemedText style={styles.label}>Supplier *</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowSupplierPicker(true)}>
        <ThemedText style={supplierId ? undefined : styles.placeholder}>
          {supplierId ? supplierName : 'Pick a supplier'}
        </ThemedText>
      </Pressable>

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
      <ThemedText style={styles.hint}>
        Link only if this is the same product you also sell — purchases will then
        bump that item's stock.
      </ThemedText>

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</ThemedText>
      </Pressable>

      <Modal visible={showSupplierPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Select Supplier
            </ThemedText>
            <FlatList
              data={suppliers}
              keyExtractor={(s) => s.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setSupplierId(item.id)
                    setShowSupplierPicker(false)
                  }}
                >
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
  title: { marginBottom: 8 },
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
  hint: { fontSize: 12, opacity: 0.6, marginTop: -6 },
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
