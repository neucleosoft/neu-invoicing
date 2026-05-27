import { router } from 'expo-router'
import { useState } from 'react'
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'

const TYPE_OPTIONS = ['PRODUCT', 'SERVICE'] as const
type TypeOption = (typeof TYPE_OPTIONS)[number]

// Same 8 options desktop Items.tsx:327-334 exposes. Locking to a preset list
// keeps reports able to GROUP BY unit cleanly — free-text would turn "pcs"
// and "PCS" into two different units in a stock summary.
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

export default function NewItemScreen() {
  const db = useDb()

  const [name, setName] = useState('')
  const [skuHsn, setSkuHsn] = useState('')
  const [type, setType] = useState<TypeOption>('PRODUCT')
  const [unit, setUnit] = useState<UnitOption>('pcs')
  const [salePrice, setSalePrice] = useState('0')
  const [purchasePrice, setPurchasePrice] = useState('0')
  const [taxRate, setTaxRate] = useState('0')
  const [trackStock, setTrackStock] = useState(false)
  const [currentStock, setCurrentStock] = useState('0')
  const [lowStockWarning, setLowStockWarning] = useState('10')
  const [saving, setSaving] = useState(false)
  const [showUnitPicker, setShowUnitPicker] = useState(false)

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Validation', 'Name is required')
      return
    }
    setSaving(true)
    try {
      await db.insert(schema.item).values({
        name: name.trim(),
        skuHsn: skuHsn.trim() || null,
        type,
        unit,
        salePrice: parseFloat(salePrice) || 0,
        purchasePrice: parseFloat(purchasePrice) || 0,
        taxRate: parseFloat(taxRate) || 0,
        trackStock,
        currentStock: parseFloat(currentStock) || 0,
        lowStockWarning: parseFloat(lowStockWarning) || 10,
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
        New Item
      </ThemedText>

      <Field label="Name *" value={name} onChangeText={setName} placeholder="Product or service name" />
      <Field label="SKU / HSN" value={skuHsn} onChangeText={setSkuHsn} placeholder="SKU or HSN/SAC code" />

      <ThemedText style={styles.label}>Type</ThemedText>
      <Segment options={TYPE_OPTIONS} selected={type} onSelect={setType} />

      <ThemedText style={styles.label}>Unit</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowUnitPicker(true)}>
        <ThemedText>{UNIT_LABELS[unit]}</ThemedText>
      </Pressable>

      <Field label="Sale Price (₹)" value={salePrice} onChangeText={setSalePrice} keyboardType="numeric" />
      <Field label="Purchase Price (₹)" value={purchasePrice} onChangeText={setPurchasePrice} keyboardType="numeric" />
      <Field label="Tax Rate (%)" value={taxRate} onChangeText={setTaxRate} keyboardType="numeric" />

      <View style={styles.toggleRow}>
        <ThemedText style={styles.label}>Track Stock</ThemedText>
        <Switch value={trackStock} onValueChange={setTrackStock} />
      </View>

      {trackStock && (
        <>
          <Field label="Current Stock" value={currentStock} onChangeText={setCurrentStock} keyboardType="numeric" />
          <Field
            label="Low Stock Warning Level"
            value={lowStockWarning}
            onChangeText={setLowStockWarning}
            keyboardType="numeric"
          />
        </>
      )}

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</ThemedText>
      </Pressable>

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

function Segment<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: readonly T[]
  selected: T
  onSelect: (v: T) => void
}) {
  return (
    <View style={styles.segment}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          style={[styles.segmentButton, selected === opt && styles.segmentButtonActive]}
          onPress={() => onSelect(opt)}
        >
          <ThemedText style={selected === opt ? styles.segmentTextActive : styles.segmentText}>{opt}</ThemedText>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 100, gap: 12 },
  title: { marginBottom: 8 },
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
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
    overflow: 'hidden',
  },
  segmentButton: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segmentButtonActive: { backgroundColor: '#007AFF' },
  segmentText: { color: '#007AFF', fontSize: 13 },
  segmentTextActive: { color: 'white', fontSize: 13 },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
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
  modalClose: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  modalCloseText: { color: '#FF3B30', fontSize: 16 },
})
