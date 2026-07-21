import { Image } from 'expo-image'
import { useState } from 'react'
import {
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { PickerModal } from '@/components/PickerModal'
import { INDIAN_STATE_CODES } from '@neu/shared'

// Shared company-profile form, used by BOTH the first-run setup screen
// (company/setup.tsx) and the Settings → Company Profile editor. Keeping it in
// one place means the two entry points can never drift on fields or validation.
//
// Mirrors desktop Onboarding.tsx fields, plus the schema's bank/terms/state.
// Logo + signature are stored as base64 data-URI strings (not file paths): the
// DB syncs as one whole file, so the image travels with it and survives cache
// purge / reinstall — unlike a mobile cache path, which is the exact failure
// mode behind the boss-DB signature breakage.

export const FY_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD'] as const

// [code, name] tuples sorted by code, same as the customer/supplier state picker.
const STATE_ENTRIES = Object.entries(INDIAN_STATE_CODES).sort(([a], [b]) =>
  a.localeCompare(b),
) as [string, string][]

// The editable shape. Matches the company table's user-facing columns.
export type CompanyFormState = {
  name: string
  address: string
  phone: string
  email: string
  taxId: string
  stateCode: string
  fiscalYearStart: number // 1-12
  currency: string
  invoicePrefix: string
  bankDetails: string
  termsConditions: string
  logoPath: string // base64 data-URI or ''
  signaturePath: string // base64 data-URI or ''
}

export const emptyCompanyForm: CompanyFormState = {
  name: '',
  address: '',
  phone: '',
  email: '',
  taxId: '',
  stateCode: '',
  fiscalYearStart: 4, // April — Indian SMB default
  currency: 'INR',
  invoicePrefix: 'INV',
  bankDetails: '',
  termsConditions: '',
  logoPath: '',
  signaturePath: '',
}

// Guess an image mime from a filename or uri extension.
function mimeFromName(name?: string | null): string | null {
  if (!name) return null
  const l = name.toLowerCase()
  if (l.endsWith('.png')) return 'image/png'
  if (/\.jpe?g(\?|$)/.test(l)) return 'image/jpeg'
  if (l.endsWith('.webp')) return 'image/webp'
  return null
}

// Read a local file's ORIGINAL bytes as a base64 data-URI. Reading the raw file
// (rather than a picker's re-encoded base64) keeps the original format — so a
// transparent PNG stays a transparent PNG instead of being flattened to JPEG.
async function readAsDataUri(uri: string, mime: string): Promise<string | null> {
  try {
    const FS = await import('expo-file-system/legacy')
    const base64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 })
    return `data:${mime};base64,${base64}`
  } catch {
    return null
  }
}

// Pick a logo / signature and return it as a base64 data-URI. Opens the device
// FILE browser (Recents / Downloads / Drive / gallery) via the document picker —
// a logo is usually a PNG file, and this reaches it wherever it lives. Reads the
// ORIGINAL bytes so the PNG (and its transparency) survives untouched. Native
// module → guarded so it degrades to a clear message on an older binary.
async function pickImageAsDataUri(): Promise<string | null> {
  let DocPicker: typeof import('expo-document-picker')
  try {
    DocPicker = await import('expo-document-picker')
  } catch {
    Alert.alert('Rebuild needed', 'Browsing files needs a fresh app build (EAS / expo run:android) to add the file-picker module.')
    return null
  }
  if (typeof DocPicker.getDocumentAsync !== 'function') {
    Alert.alert('Rebuild needed', 'The file picker isn’t in this build yet. Rebuild the app (EAS / expo run:android) once.')
    return null
  }
  const res = await DocPicker.getDocumentAsync({
    type: ['image/png', 'image/jpeg', 'image/webp'],
    copyToCacheDirectory: true, // copy SAF content:// → a readable file:// in cache
    multiple: false,
  })
  if (res.canceled || !res.assets?.length) return null
  const asset = res.assets[0]
  const mime = asset.mimeType || mimeFromName(asset.name) || 'image/png'
  const data = await readAsDataUri(asset.uri, mime)
  if (!data) Alert.alert('Error', 'Could not read that file. Try another.')
  return data
}

export function CompanyForm({
  value,
  onChange,
}: {
  value: CompanyFormState
  onChange: (next: CompanyFormState) => void
}) {
  const [showFyPicker, setShowFyPicker] = useState(false)
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false)
  const [showStatePicker, setShowStatePicker] = useState(false)
  const [pickingLogo, setPickingLogo] = useState(false)
  const [pickingSig, setPickingSig] = useState(false)

  const set = <K extends keyof CompanyFormState>(key: K, v: CompanyFormState[K]) =>
    onChange({ ...value, [key]: v })

  const stateName = INDIAN_STATE_CODES[value.stateCode] || ''

  async function pickLogo() {
    setPickingLogo(true)
    try {
      const uri = await pickImageAsDataUri()
      if (uri) set('logoPath', uri)
    } finally {
      setPickingLogo(false)
    }
  }

  async function pickSignature() {
    setPickingSig(true)
    try {
      const uri = await pickImageAsDataUri()
      if (uri) set('signaturePath', uri)
    } finally {
      setPickingSig(false)
    }
  }

  return (
    <View style={styles.wrap}>
      <Field label="Business Name *" value={value.name} onChangeText={(t) => set('name', t)} placeholder="Your business name" />
      <Field
        label="Business Address *"
        value={value.address}
        onChangeText={(t) => set('address', t)}
        placeholder="Street, city, state…"
        multiline
      />
      <Field label="Phone" value={value.phone} onChangeText={(t) => set('phone', t)} placeholder="+91 9876543210" keyboardType="phone-pad" />
      <Field label="Email" value={value.email} onChangeText={(t) => set('email', t)} placeholder="business@example.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="GSTIN / Tax ID" value={value.taxId} onChangeText={(t) => set('taxId', t.toUpperCase())} placeholder="27AABCU9603R1ZM" autoCapitalize="characters" maxLength={15} />

      <ThemedText style={styles.label}>State</ThemedText>
      <Pressable style={styles.picker} onPress={() => setShowStatePicker(true)}>
        <ThemedText style={value.stateCode ? undefined : styles.placeholder}>
          {value.stateCode ? `${value.stateCode} — ${stateName}` : 'Select state'}
        </ThemedText>
      </Pressable>

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <ThemedText style={styles.label}>Fiscal Year Start</ThemedText>
          <Pressable style={styles.picker} onPress={() => setShowFyPicker(true)}>
            <ThemedText>{FY_MONTHS[value.fiscalYearStart - 1]}</ThemedText>
          </Pressable>
        </View>
        <View style={styles.rowItem}>
          <ThemedText style={styles.label}>Currency</ThemedText>
          <Pressable style={styles.picker} onPress={() => setShowCurrencyPicker(true)}>
            <ThemedText>{value.currency}</ThemedText>
          </Pressable>
        </View>
      </View>

      <Field label="Invoice Prefix" value={value.invoicePrefix} onChangeText={(t) => set('invoicePrefix', t)} placeholder="INV" autoCapitalize="characters" />
      <Field label="Bank Details" value={value.bankDetails} onChangeText={(t) => set('bankDetails', t)} placeholder="Account no, IFSC, bank name… (shown on invoices)" multiline />
      <Field label="Terms & Conditions" value={value.termsConditions} onChangeText={(t) => set('termsConditions', t)} placeholder="Default T&C printed on documents" multiline />

      <ThemedText style={styles.label}>Logo</ThemedText>
      <Pressable style={styles.imagePick} onPress={pickLogo} disabled={pickingLogo}>
        {value.logoPath ? (
          <Image source={{ uri: value.logoPath }} style={styles.imagePreview} contentFit="contain" />
        ) : (
          <ThemedText style={styles.imagePickText}>
            {pickingLogo ? 'Opening…' : 'Tap to add a logo (shown on invoices)'}
          </ThemedText>
        )}
      </Pressable>
      {value.logoPath ? (
        <Pressable onPress={() => set('logoPath', '')} hitSlop={8}>
          <ThemedText style={styles.clearImage}>Remove logo</ThemedText>
        </Pressable>
      ) : null}

      <ThemedText style={styles.label}>Signature</ThemedText>
      <Pressable style={styles.imagePick} onPress={pickSignature} disabled={pickingSig}>
        {value.signaturePath ? (
          <Image source={{ uri: value.signaturePath }} style={styles.imagePreview} contentFit="contain" />
        ) : (
          <ThemedText style={styles.imagePickText}>
            {pickingSig ? 'Opening…' : 'Tap to add a signature'}
          </ThemedText>
        )}
      </Pressable>
      {value.signaturePath ? (
        <Pressable onPress={() => set('signaturePath', '')} hitSlop={8}>
          <ThemedText style={styles.clearImage}>Remove signature</ThemedText>
        </Pressable>
      ) : null}

      <PickerModal
        visible={showFyPicker}
        title="Fiscal Year Start"
        data={FY_MONTHS.map((m, i) => ({ key: String(i + 1), label: m }))}
        selectedKey={String(value.fiscalYearStart)}
        onSelect={(k) => set('fiscalYearStart', parseInt(k, 10))}
        onClose={() => setShowFyPicker(false)}
      />
      <PickerModal
        visible={showCurrencyPicker}
        title="Currency"
        data={CURRENCY_OPTIONS.map((c) => ({ key: c, label: c }))}
        selectedKey={value.currency}
        onSelect={(k) => set('currency', k)}
        onClose={() => setShowCurrencyPicker(false)}
      />
      <PickerModal
        visible={showStatePicker}
        title="Select State"
        data={STATE_ENTRIES.map(([code, label]) => ({ key: code, label: `${code} — ${label}` }))}
        selectedKey={value.stateCode}
        onSelect={(k) => set('stateCode', k)}
        onClose={() => setShowStatePicker(false)}
      />
    </View>
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
  wrap: { gap: 12 },
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
  row: { flexDirection: 'row', gap: 12 },
  rowItem: { flex: 1, gap: 4 },
  imagePick: {
    borderWidth: 1,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 72,
  },
  imagePickText: { color: '#007AFF', fontSize: 14 },
  imagePreview: { width: 160, height: 64 },
  clearImage: { color: '#FF3B30', fontSize: 13, marginTop: -6 },
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
