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
import { validateGSTIN, type GstValidationResult } from '@neu/shared'

const GST_TYPE_OPTIONS = [
  'REGULAR',
  'COMPOSITION',
  'UNREGISTERED',
  'CONSUMER',
  'SEZ',
  'DEEMED_EXPORT',
] as const

type GstTypeOption = (typeof GST_TYPE_OPTIONS)[number]

export default function NewCustomerScreen() {
  const db = useDb()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [taxId, setTaxId] = useState('')
  const [gstType, setGstType] = useState<GstTypeOption>('REGULAR')
  const [billingAddress, setBillingAddress] = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [stateName, setStateName] = useState('')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [saving, setSaving] = useState(false)
  const [showGstTypePicker, setShowGstTypePicker] = useState(false)
  const [gstValidation, setGstValidation] = useState<GstValidationResult | null>(null)

  // Validate GSTIN as user types; auto-fill state when valid.
  useEffect(() => {
    if (taxId.length === 0) {
      setGstValidation(null)
      return
    }
    const result = validateGSTIN(taxId)
    setGstValidation(result)
    if (result.valid && result.stateCode && result.stateName) {
      setStateCode(result.stateCode)
      setStateName(result.stateName)
    }
  }, [taxId])

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Validation', 'Name is required')
      return
    }
    setSaving(true)
    try {
      const opening = parseFloat(openingBalance) || 0
      await db.insert(schema.customer).values({
        name: name.trim(),
        type: 'CUSTOMER',
        phone: phone.trim() || null,
        email: email.trim() || null,
        taxId: taxId.trim().toUpperCase() || null,
        gstType,
        billingAddress: billingAddress.trim() || null,
        shippingAddress: shippingAddress.trim() || null,
        city: city.trim() || null,
        pincode: pincode.trim() || null,
        stateCode: stateCode.trim() || null,
        stateName: stateName.trim() || null,
        openingBalance: opening,
        currentBalance: opening,
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
        New Customer
      </ThemedText>

      <Field label="Name *" value={name} onChangeText={setName} placeholder="Business or person name" />
      <Field
        label="Phone"
        value={phone}
        onChangeText={setPhone}
        placeholder="+91 9876543210"
        keyboardType="phone-pad"
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="customer@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <Field
        label="GSTIN"
        value={taxId}
        onChangeText={setTaxId}
        placeholder="27AABCU9603R1ZM"
        autoCapitalize="characters"
        maxLength={15}
      />
      {gstValidation && taxId.length > 0 && (
        <ThemedText
          style={[
            styles.gstStatus,
            { color: gstValidation.valid ? '#0a8a3c' : '#cc3300' },
          ]}
        >
          {gstValidation.valid
            ? `✓ Valid GSTIN — ${gstValidation.stateName}`
            : `✗ ${gstValidation.error}`}
        </ThemedText>
      )}

      <ThemedText style={styles.label}>GST Registration Type</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowGstTypePicker(true)}>
        <ThemedText>{gstType}</ThemedText>
      </Pressable>

      <Field
        label="Billing Address"
        value={billingAddress}
        onChangeText={setBillingAddress}
        placeholder="Street, area..."
        multiline
      />
      <Field
        label="Shipping Address"
        value={shippingAddress}
        onChangeText={setShippingAddress}
        placeholder="Same as billing if blank"
        multiline
      />

      <Field label="City" value={city} onChangeText={setCity} placeholder="City name" />
      <Field
        label="PIN Code"
        value={pincode}
        onChangeText={setPincode}
        placeholder="6-digit PIN"
        keyboardType="numeric"
        maxLength={6}
      />
      <Field
        label="State"
        value={stateName}
        onChangeText={setStateName}
        placeholder="Auto-filled from GSTIN"
      />

      <Field
        label="Opening Balance (₹)"
        value={openingBalance}
        onChangeText={setOpeningBalance}
        keyboardType="numeric"
      />

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</ThemedText>
      </Pressable>

      <Modal visible={showGstTypePicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              GST Registration Type
            </ThemedText>
            <FlatList
              data={GST_TYPE_OPTIONS}
              keyExtractor={(opt) => opt}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setGstType(item)
                    setShowGstTypePicker(false)
                  }}
                >
                  <ThemedText type={item === gstType ? 'defaultSemiBold' : undefined}>
                    {item === gstType ? `✓ ${item}` : item}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowGstTypePicker(false)}>
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
  gstStatus: { fontSize: 13, marginTop: -8, marginBottom: 4 },
  picker: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
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
