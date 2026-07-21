import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSQLiteContext } from 'expo-sqlite'

import { ThemedText } from '@/components/themed-text'
import { useAuth } from '@/auth'
import { schema, useDb } from '@/db'
import { INDIAN_STATE_CODES } from '@neu/shared'
import { checkCloudBackup, restoreFromCloud, type CloudBackupInfo } from '@/sync/drive'
import { reloadDb } from '@/db/reload'
import { setRestoreNotice } from '@/sync/restoreNotice'
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
  const liveDb = useSQLiteContext()
  const { user, offlineMode, getFreshAccessToken } = useAuth()
  const [form, setForm] = useState<CompanyFormState>(emptyCompanyForm)
  const [saving, setSaving] = useState(false)

  // Fresh-device restore offer (mirrors desktop's boot screen): this screen
  // only renders when the device has NO company, so restoring here destroys
  // nothing — vacuously safe, like desktop's App.tsx offer.
  const [cloudBackup, setCloudBackup] = useState<CloudBackupInfo | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restorePct, setRestorePct] = useState<number | null>(null)

  useEffect(() => {
    if (!user || offlineMode) return
    let cancelled = false
    ;(async () => {
      try {
        const fresh = await getFreshAccessToken()
        if (!fresh) return
        const info = await checkCloudBackup(fresh)
        if (!cancelled && info.exists && info.size) setCloudBackup(info)
      } catch {
        // unreachable cloud = no offer; setup proceeds normally
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, offlineMode, getFreshAccessToken])

  function handleRestore() {
    const when = cloudBackup?.modifiedTime
      ? new Date(cloudBackup.modifiedTime).toLocaleString()
      : 'an unknown time'
    Alert.alert(
      'Restore your business?',
      `A cloud backup from ${when} exists for this Google account. This device is empty, so nothing is lost — your business loads and the app reloads.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Restore from Drive',
          onPress: async () => {
            setRestoring(true)
            setRestorePct(null)
            try {
              const fresh = await getFreshAccessToken()
              if (!fresh) throw new Error('Session expired — sign in again.')
              const info = await restoreFromCloud(fresh, liveDb, (f) => {
                const pct = Math.round(f * 100)
                setRestorePct((prev) => (prev === pct ? prev : pct))
              })
              setRestoreNotice(
                info.modifiedTime ? new Date(info.modifiedTime).toLocaleString() : 'the cloud backup',
              )
              // Soft reboot onto the restored DB; the company gate then routes
              // straight into the app (production-safe — DevSettings.reload
              // was a no-op in release builds).
              reloadDb()
            } catch (e) {
              setRestoring(false)
              setRestorePct(null)
              Alert.alert('Restore failed', e instanceof Error ? e.message : String(e))
            }
          },
        },
      ],
    )
  }

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

      {cloudBackup && (
        <View style={styles.restoreCard}>
          <ThemedText style={styles.restoreTitle}>
            Found your business in Google Drive
          </ThemedText>
          <ThemedText style={styles.restoreHint}>
            A backup from{' '}
            {cloudBackup.modifiedTime
              ? new Date(cloudBackup.modifiedTime).toLocaleString()
              : 'an earlier date'}{' '}
            exists for this account. Restore it instead of starting again.
          </ThemedText>
          <Pressable
            style={[styles.restoreButton, (restoring || saving) && styles.saveButtonDisabled]}
            onPress={handleRestore}
            disabled={restoring || saving}
          >
            <ThemedText style={styles.restoreButtonText}>
              {restoring
                ? restorePct != null && restorePct < 100
                  ? `Downloading backup… ${restorePct}%`
                  : 'Restoring…'
                : 'Restore from Drive'}
            </ThemedText>
          </Pressable>
        </View>
      )}

      <CompanyForm value={form} onChange={setForm} />

      <Pressable
        style={[styles.saveButton, (saving || restoring) && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving || restoring}
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
  restoreCard: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  restoreTitle: { fontWeight: '700', color: '#1d4ed8' },
  restoreHint: { fontSize: 13, lineHeight: 19, color: '#1e40af' },
  restoreButton: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  restoreButtonText: { color: 'white', fontWeight: '600' },
})
