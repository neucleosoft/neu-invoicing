import { eq } from 'drizzle-orm'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { INDIAN_STATE_CODES } from '@neu/shared'
import {
  CompanyForm,
  emptyCompanyForm,
  type CompanyFormState,
} from '@/utils/companyForm'

// Edit the existing company profile (reached from Settings). Loads the single
// Company row, edits via the shared CompanyForm, updates in place. Same fields
// and the same base64 image handling as setup — one form component, two
// entry points.
export default function CompanyEditScreen() {
  const db = useDb()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [form, setForm] = useState<CompanyFormState>(emptyCompanyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    db.select()
      .from(schema.company)
      .limit(1)
      .then((rows) => {
        const c = rows[0]
        if (c) {
          setCompanyId(c.id)
          setForm({
            name: c.name,
            address: c.address,
            phone: c.phone ?? '',
            email: c.email ?? '',
            taxId: c.taxId ?? '',
            stateCode:
              c.stateCode && INDIAN_STATE_CODES[c.stateCode] ? c.stateCode : '',
            fiscalYearStart: c.fiscalYearStart,
            currency: c.currency,
            invoicePrefix: c.invoicePrefix,
            bankDetails: c.bankDetails ?? '',
            termsConditions: c.termsConditions ?? '',
            logoPath: c.logoPath ?? '',
            signaturePath: c.signaturePath ?? '',
          })
        }
        setLoading(false)
      })
  }, [db])

  async function handleSave() {
    if (!companyId) return
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
      await db
        .update(schema.company)
        .set({
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
        .where(eq(schema.company.id, companyId))
      router.back()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update company'
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

  if (!companyId) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText type="subtitle">No company yet</ThemedText>
        <Pressable style={styles.backLink} onPress={() => router.replace('/company/setup')}>
          <ThemedText style={styles.backLinkText}>Set up your business</ThemedText>
        </Pressable>
      </ThemedView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Company Profile</ThemedText>
      </View>

      <CompanyForm value={form} onChange={setForm} />

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <ThemedText style={styles.saveButtonText}>
          {saving ? 'Saving…' : 'Save Changes'}
        </ThemedText>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 100, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  centered: { textAlign: 'center' },
  backLink: { paddingVertical: 10 },
  backLinkText: { color: '#007AFF', fontSize: 16 },
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
