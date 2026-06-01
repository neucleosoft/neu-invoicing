import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
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
import {
  INDIAN_STATE_CODES,
  validateGSTIN,
  type GstValidationResult,
} from '@neu/shared'

const GST_TYPE_OPTIONS = [
  'REGULAR',
  'COMPOSITION',
  'UNREGISTERED',
  'CONSUMER',
  'SEZ',
  'DEEMED_EXPORT',
] as const

type GstTypeOption = (typeof GST_TYPE_OPTIONS)[number]

const STATE_ENTRIES = Object.entries(INDIAN_STATE_CODES).sort(([a], [b]) =>
  a.localeCompare(b),
) as [string, string][]

export default function EditSupplierScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()

  const [loading, setLoading] = useState(true)
  const [originalSupplier, setOriginalSupplier] =
    useState<typeof schema.supplier.$inferSelect | null>(null)

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

  const [saving, setSaving] = useState(false)
  const [showGstTypePicker, setShowGstTypePicker] = useState(false)
  const [showStatePicker, setShowStatePicker] = useState(false)
  const [gstValidation, setGstValidation] = useState<GstValidationResult | null>(null)
  // Skip the GSTIN auto-fill side-effect on the first render: we just loaded
  // the row and don't want the validator overwriting the saved stateCode.
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    db.select()
      .from(schema.supplier)
      .where(eq(schema.supplier.id, id))
      .limit(1)
      .then((rows) => {
        const s = rows[0]
        if (!s) {
          setLoading(false)
          return
        }
        setOriginalSupplier(s)
        setName(s.name)
        setPhone(s.phone ?? '')
        setEmail(s.email ?? '')
        setTaxId(s.taxId ?? '')
        const allowed = GST_TYPE_OPTIONS as readonly string[]
        setGstType(
          allowed.includes(s.gstType) ? (s.gstType as GstTypeOption) : 'REGULAR',
        )
        setBillingAddress(s.billingAddress ?? '')
        setShippingAddress(s.shippingAddress ?? '')
        setCity(s.city ?? '')
        setPincode(s.pincode ?? '')
        setStateCode(
          s.stateCode && INDIAN_STATE_CODES[s.stateCode] ? s.stateCode : '',
        )
        setLoading(false)
        requestAnimationFrame(() => setInitialized(true))
      })
  }, [id, db])

  // GSTIN live validation + state auto-fill (after initial load).
  useEffect(() => {
    if (!initialized) return
    if (taxId.length === 0) {
      setGstValidation(null)
      return
    }
    const result = validateGSTIN(taxId)
    setGstValidation(result)
    if (result.valid && result.stateCode) {
      setStateCode(result.stateCode)
    }
  }, [taxId, initialized])

  const selectedStateName = useMemo(
    () => INDIAN_STATE_CODES[stateCode] || '',
    [stateCode],
  )

  async function handleSave() {
    if (!id || !originalSupplier) return
    if (!name.trim()) {
      Alert.alert('Validation', 'Name is required')
      return
    }
    setSaving(true)
    try {
      // Never touches currentBalance or openingBalance on edit — those are owned
      // by the payable ledger (purchase bills + payments + the opening entry).
      await db
        .update(schema.supplier)
        .set({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          taxId: taxId.trim().toUpperCase() || null,
          gstType,
          billingAddress: billingAddress.trim() || null,
          shippingAddress: shippingAddress.trim() || null,
          city: city.trim() || null,
          pincode: pincode.trim() || null,
          stateCode: stateCode || null,
          stateName: selectedStateName || null,
        })
        .where(eq(schema.supplier.id, id))
      router.back()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update supplier'
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

  if (!originalSupplier) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText type="subtitle">Supplier not found</ThemedText>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <ThemedText style={styles.backLinkText}>Go back</ThemedText>
        </Pressable>
      </ThemedView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Edit Supplier
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
        placeholder="supplier@example.com"
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

      <ThemedText style={styles.label}>State</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowStatePicker(true)}>
        <ThemedText style={stateCode ? undefined : styles.placeholder}>
          {stateCode ? `${stateCode} — ${selectedStateName}` : 'Select state'}
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
            {saving ? 'Saving…' : 'Update Supplier'}
          </ThemedText>
        </Pressable>
      </View>

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

      <Modal visible={showStatePicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Select State
            </ThemedText>
            <FlatList
              data={STATE_ENTRIES}
              keyExtractor={([code]) => code}
              renderItem={({ item: [code, label] }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setStateCode(code)
                    setShowStatePicker(false)
                  }}
                >
                  <ThemedText type={code === stateCode ? 'defaultSemiBold' : undefined}>
                    {code === stateCode ? `✓ ${code} — ${label}` : `${code} — ${label}`}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowStatePicker(false)}>
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
  gstStatus: { fontSize: 13, marginTop: -8, marginBottom: 4 },
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
