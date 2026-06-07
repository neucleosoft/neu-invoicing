import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { schema, useDb } from '@/db'
import { INDIAN_STATE_CODES } from '@neu/shared'
import {
  CompanyForm,
  emptyCompanyForm,
  type CompanyFormState,
} from '@/utils/companyForm'

// First-run company setup. Mirrors desktop Onboarding.tsx — one Company row IS
// the sender identity behind every invoice/PDF and the dashboard's FY math, so
// the app gates on it (see the company check in app/_layout.tsx). Reachable
// only when signed in with no company yet.
export default function CompanySetupScreen() {
  const db = useDb()
  const [form, setForm] = useState<CompanyFormState>(emptyCompanyForm)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!form.name.trim()) {
      Alert.alert('Validation', 'Business name is required')
      return
    }
    if (!form.address.trim()) {
      Alert.alert('Validation', 'Business address is required')
      return
    }
    setSaving(true)
    try {
      await db.insert(schema.company).values({
        name: form.name.trim(),
        address: form.address.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        taxId: form.taxId.trim() || null,
        stateCode: form.stateCode || null,
        stateName: form.stateCode ? INDIAN_STATE_CODES[form.stateCode] || null : null,
        fiscalYearStart: form.fiscalYearStart,
        currency: form.currency,
        invoicePrefix: form.invoicePrefix.trim() || 'INV',
        bankDetails: form.bankDetails.trim() || null,
        termsConditions: form.termsConditions.trim() || null,
        logoPath: form.logoPath || null,
        signaturePath: form.signaturePath || null,
      })
      // Company now exists → the _layout gate will let the app through.
      router.replace('/(tabs)')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save company'
      Alert.alert('Error', msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <ThemedText type="title" style={styles.title}>
        Set up your business
      </ThemedText>
      <ThemedText style={styles.subtitle}>
        This appears on your invoices and documents. You can change it anytime in
        Settings.
      </ThemedText>

      <CompanyForm value={form} onChange={setForm} />

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <ThemedText style={styles.saveButtonText}>
          {saving ? 'Saving…' : 'Complete Setup'}
        </ThemedText>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 100, gap: 12 },
  title: { marginBottom: 4 },
  subtitle: { fontSize: 14, opacity: 0.65, lineHeight: 20, marginBottom: 8 },
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
