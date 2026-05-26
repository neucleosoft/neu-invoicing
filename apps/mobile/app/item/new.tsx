import { router } from 'expo-router'
import { useState } from 'react'
import {
  Alert,
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

export default function NewItemScreen() {
  const db = useDb()

  // One useState per field. Verbose but easy to read; could be condensed into a single object later.
  const [name, setName] = useState('')
  const [skuHsn, setSkuHsn] = useState('')
  const [type, setType] = useState<TypeOption>('PRODUCT')
  const [unit, setUnit] = useState('pcs')
  const [salePrice, setSalePrice] = useState('0')
  const [purchasePrice, setPurchasePrice] = useState('0')
  const [taxRate, setTaxRate] = useState('0')
  const [trackStock, setTrackStock] = useState(false)
  const [currentStock, setCurrentStock] = useState('0')
  const [lowStockWarning, setLowStockWarning] = useState('10')
  const [saving, setSaving] = useState(false)

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
        unit: unit.trim() || 'pcs',
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

      <Field label="Unit" value={unit} onChangeText={setUnit} placeholder="pcs, kg, hrs..." />
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
})
