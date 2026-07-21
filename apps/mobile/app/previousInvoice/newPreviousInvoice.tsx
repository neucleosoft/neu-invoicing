import { Image } from 'expo-image'
// Type-only import: fully erased at build time, so it does NOT pull the native
// picker module in at screen-load. The runtime value is loaded lazily inside
// pickFile, so this screen + manual entry work even on an app binary built
// before expo-image-picker was added (you'd just rebuild to enable uploads).
import type * as ImagePicker from 'expo-image-picker'
import { max } from 'drizzle-orm'
import { router } from 'expo-router'
import { useState } from 'react'
import {
  Alert,
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

// Previous Invoice = an ARCHIVE of an invoice raised BEFORE this app existed.
// The user uploads the ORIGINAL file as the record of truth. Party is free text
// (NOT a customer FK), totalAmount is typed in (NOT derived from line items),
// and there is NO balance / NO stock / NO FK link — it's a pure archival entry.

const todayStr = () => new Date().toISOString().slice(0, 10)

// Picked file held in memory until save. base64 → Buffer for the blob column.
type PickedFile = {
  base64: string
  mimeType: string
  fileName: string
  uri: string
}

export default function NewPreviousInvoiceScreen() {
  const db = useDb()

  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayStr())
  const [partyName, setPartyName] = useState('')
  const [partyGstin, setPartyGstin] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<PickedFile | null>(null)

  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  async function pickFile() {
    // Load the native picker only now. On an app binary built before the module
    // was added, this throws "Cannot find native module" — catch it and tell the
    // user to rebuild, instead of crashing the whole screen.
    let Picker: typeof ImagePicker
    try {
      Picker = await import('expo-image-picker')
    } catch {
      Alert.alert(
        'Rebuild needed',
        'Uploading a file needs a fresh app build to add the image module. Run "npx expo run:android" once, then this will work. The other fields work now.',
      )
      return
    }
    // The JS module can load even when the NATIVE module isn't in this binary
    // (import() resolves but the functions are undefined). Catch that here so we
    // show the rebuild message instead of crashing on an undefined call.
    if (typeof Picker.launchImageLibraryAsync !== 'function') {
      Alert.alert(
        'Rebuild needed',
        'The image picker isn’t in this build yet. Run "npx expo run:android" once, then file upload will work. The other fields work now.',
      )
      return
    }

    setPicking(true)
    try {
      const perm = await Picker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo access to upload the original invoice.')
        return
      }
      const result = await Picker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.8,
      })
      if (result.canceled || !result.assets?.length) return
      const asset = result.assets[0]
      if (!asset.base64) {
        Alert.alert('Error', 'Could not read the image. Try another.')
        return
      }
      setFile({
        base64: asset.base64,
        mimeType: asset.mimeType || 'image/jpeg',
        fileName: asset.fileName || 'invoice.jpg',
        uri: asset.uri,
      })
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to pick a file')
    } finally {
      setPicking(false)
    }
  }

  // Monotonic serial: max(serialNumber) + 1 over the whole table. The column is
  // a plain integer (NOT the FY-scoped doc number), so a simple running counter.
  async function nextSerialNumber(): Promise<number> {
    const [row] = await db
      .select({ value: max(schema.previousInvoice.serialNumber) })
      .from(schema.previousInvoice)
    return (row?.value ?? 0) + 1
  }

  async function handleSave() {
    if (!partyName.trim()) {
      Alert.alert('Validation', 'Enter the party name')
      return
    }
    if (!file) {
      Alert.alert('Validation', 'Upload the original invoice file')
      return
    }
    const parsedDate = new Date(invoiceDate)
    if (isNaN(parsedDate.getTime())) {
      Alert.alert('Validation', 'Invalid invoice date (use YYYY-MM-DD)')
      return
    }
    setSaving(true)
    try {
      const serialNumber = await nextSerialNumber()
      // base64 → Buffer for the blob(buffer) column (the global Buffer polyfill
      // from _layout makes this work on Hermes). Pure write — NO balance, NO
      // stock, NO FK links. It's an archival record only.
      const fileData = Buffer.from(file.base64, 'base64')
      await db.insert(schema.previousInvoice).values({
        serialNumber,
        invoiceNumber: invoiceNumber.trim() || '—',
        invoiceDate: parsedDate,
        partyName: partyName.trim(),
        partyGstin: partyGstin.trim() || null,
        totalAmount: parseFloat(totalAmount) || 0,
        notes: notes.trim() || null,
        fileData,
        fileMimeType: file.mimeType,
        fileName: file.fileName,
      })
      router.back()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save previous invoice')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <ThemedText type="title" style={styles.title}>Add Previous Invoice</ThemedText>
      <ThemedText style={styles.intro}>
        Archive an invoice you raised before this app. Upload the original file — it’s the record of truth.
      </ThemedText>

      <ThemedText style={styles.label}>Original File *</ThemedText>
      <Pressable
        style={[styles.uploadButton, picking && styles.uploadButtonDisabled]}
        onPress={pickFile}
        disabled={picking}
      >
        {file ? (
          <Image source={{ uri: file.uri }} style={styles.filePreview} contentFit="contain" />
        ) : (
          <ThemedText style={styles.uploadButtonText}>
            {picking ? 'Opening…' : '📎 Upload original invoice'}
          </ThemedText>
        )}
      </Pressable>
      {file ? (
        <View style={styles.fileMetaRow}>
          <ThemedText style={styles.attachedNote} numberOfLines={1}>✓ {file.fileName}</ThemedText>
          <Pressable onPress={() => setFile(null)} hitSlop={8}>
            <ThemedText style={styles.removeFile}>Remove</ThemedText>
          </Pressable>
        </View>
      ) : null}

      <Field
        label="Invoice # (as printed)"
        value={invoiceNumber}
        onChangeText={setInvoiceNumber}
        placeholder="INV-2023-014"
      />
      <Field
        label="Invoice Date (YYYY-MM-DD)"
        value={invoiceDate}
        onChangeText={setInvoiceDate}
        placeholder="2023-08-12"
      />
      <Field
        label="Party Name *"
        value={partyName}
        onChangeText={setPartyName}
        placeholder="Whoever the invoice was for"
      />
      <Field
        label="Party GSTIN"
        value={partyGstin}
        onChangeText={(t) => setPartyGstin(t.toUpperCase())}
        placeholder="27AABCU9603R1ZM (optional)"
        autoCapitalize="characters"
        maxLength={15}
      />
      <Field
        label="Total Amount"
        value={totalAmount}
        onChangeText={setTotalAmount}
        placeholder="0.00"
        keyboardType="numeric"
      />
      <Field
        label="Notes"
        value={notes}
        onChangeText={setNotes}
        placeholder="Optional"
        multiline
      />

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <ThemedText style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Previous Invoice'}</ThemedText>
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

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 100, gap: 12 },
  title: { marginBottom: 4 },
  intro: { fontSize: 14, opacity: 0.7, lineHeight: 20, marginBottom: 4 },
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
  uploadButton: {
    borderWidth: 1,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 72,
  },
  uploadButtonDisabled: { opacity: 0.6 },
  uploadButtonText: { color: '#007AFF', fontWeight: '600', fontSize: 15 },
  filePreview: { width: '100%', height: 180 },
  fileMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -6, gap: 8 },
  attachedNote: { fontSize: 12, color: '#16a34a', flexShrink: 1 },
  removeFile: { color: '#FF3B30', fontSize: 13 },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
})
