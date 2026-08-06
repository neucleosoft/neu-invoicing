// Payment reconciliation screen (reached from Settings → Data Health).
// Lists invoices whose paid status isn't backed by recorded payments; the
// user unticks anything NOT actually settled, then one tap records the
// missing amounts as real linked PAYMENT_IN rows. Statuses are never
// downgraded here — the ledger is completed to match the human's truth.

import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useFocusEffect } from 'expo-router'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import {
  applyReconciliation,
  findUnbackedInvoices,
  type UnbackedInvoice,
} from '@/utils/reconcilePayments'

export default function ReconcilePaymentsScreen() {
  const db = useDb()
  const [rows, setRows] = useState<UnbackedInvoice[] | null>(null)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const reload = useCallback(() => {
    findUnbackedInvoices(db)
      .then((r) => {
        setRows(r)
        // Nothing pre-selected — recording money must be a per-invoice,
        // deliberate act. (Pre-ticking everything once turned one tap into 31
        // wrong payment records on a device holding stale statuses.)
        setUnticked(new Set(r.map((x) => x.id)))
      })
      .catch((e) => {
        Alert.alert('Error', e instanceof Error ? e.message : 'Failed to scan invoices')
        setRows([])
      })
  }, [db])

  useFocusEffect(reload)

  const selected = (rows ?? []).filter((r) => !unticked.has(r.id))
  const selectedTotal = selected.reduce((s, r) => s + r.gap, 0)

  function toggle(id: string) {
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleRecord() {
    if (selected.length === 0 || saving) return
    Alert.alert(
      'Record missing payments?',
      `${selected.length} payment(s) totalling ${formatCurrency(selectedTotal)} will be recorded against their invoices (cash, dated to each invoice). This completes your ledger — invoice statuses are not changed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Record',
          onPress: async () => {
            setSaving(true)
            try {
              const n = await applyReconciliation(db, selected)
              Alert.alert(
                'Done',
                `${n} payment(s) recorded. Data Health should now report these invoices as clean, and the records will sync to your other devices.`,
              )
              reload()
            } catch (e) {
              Alert.alert('Failed', e instanceof Error ? e.message : 'Could not record payments')
            } finally {
              setSaving(false)
            }
          },
        },
      ],
    )
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ThemedText style={styles.headerBack}>‹ Back</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Reconcile Payments</ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText style={styles.intro}>
          These invoices claim money that has no payment record behind it. Tick ONLY the invoices
          you are certain the customer fully settled — each ticked one gets a real payment entry
          for the missing amount. If unsure about an invoice, leave it unticked and check with
          your books first.
        </ThemedText>

        {rows === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : rows.length === 0 ? (
          <ThemedText style={styles.empty}>
            Nothing to reconcile — every invoice&apos;s paid amount is fully backed by recorded
            payments. 🎉
          </ThemedText>
        ) : (
          rows.map((r) => {
            const on = !unticked.has(r.id)
            return (
              <Pressable key={r.id} style={styles.row} onPress={() => toggle(r.id)}>
                <View style={[styles.checkbox, on && styles.checkboxOn]}>
                  {on ? <ThemedText style={styles.checkmark}>✓</ThemedText> : null}
                </View>
                <View style={styles.rowBody}>
                  <ThemedText type="defaultSemiBold">{r.invoiceNumber}</ThemedText>
                  <ThemedText style={styles.rowMeta}>
                    {r.customerName} · {formatDate(r.invoiceDate)}
                  </ThemedText>
                  <ThemedText style={styles.rowMeta}>
                    {formatCurrency(r.covered)} of {formatCurrency(r.claimed)} recorded
                  </ThemedText>
                </View>
                <ThemedText style={styles.gap}>{formatCurrency(r.gap)}</ThemedText>
              </Pressable>
            )
          })
        )}
      </ScrollView>

      {rows !== null && rows.length > 0 ? (
        <View style={styles.footer}>
          <ThemedText style={styles.footerSummary}>
            {selected.length} of {rows.length} selected · {formatCurrency(selectedTotal)}
          </ThemedText>
          <Pressable
            style={[styles.recordBtn, (selected.length === 0 || saving) && styles.recordBtnDisabled]}
            onPress={handleRecord}
            disabled={selected.length === 0 || saving}
          >
            <ThemedText style={styles.recordBtnText}>
              {saving ? 'Recording…' : `Record ${selected.length} payment(s)`}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  headerBack: { fontSize: 16, color: '#007AFF' },
  headerTitle: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 24 },
  intro: { fontSize: 13, opacity: 0.7, lineHeight: 18, marginBottom: 6 },
  spinner: { marginTop: 32 },
  empty: { textAlign: 'center', marginTop: 32, opacity: 0.7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#9ca3af',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  checkmark: { color: 'white', fontSize: 14, lineHeight: 18, fontWeight: '700' },
  rowBody: { flex: 1, gap: 2 },
  rowMeta: { fontSize: 12, opacity: 0.6 },
  gap: { fontWeight: '600', color: '#dc2626' },
  footer: {
    padding: 16,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.35)',
  },
  footerSummary: { textAlign: 'center', fontSize: 13, opacity: 0.7 },
  recordBtn: { backgroundColor: '#007AFF', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  recordBtnDisabled: { opacity: 0.5 },
  recordBtnText: { color: 'white', fontWeight: '600', fontSize: 16 },
})
