import { asc } from 'drizzle-orm'
import { notDeleted } from '@/db/softDelete'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'

import LedgerView from '@/components/LedgerView'
import { PdfActions } from '@/components/PdfActions'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import { presetRange, toIsoLocal, type DatePreset } from '@/utils/dateRanges'
import { buildCustomerLedger, sliceToDateRange, type LedgerData } from '@/utils/ledger'
import { buildStatementPdfPayload } from '@/utils/statementPdf'

// Customer Statement — a customer ledger constrained to a [from, to] date range.
// Transactions before `from` fold into the carried-forward opening balance; only
// in-range rows are listed. Mirrors desktop CustomerStatement.tsx. Reached from
// the Reports hub. Defaults: from = April 1 of the current financial year, to = today.

type Customer = typeof schema.customer.$inferSelect

// One-tap period chips (shared math in utils/dateRanges). No "All Time" here —
// a statement is a from→to slice by definition, both dates are required.
type PeriodChoice = DatePreset | 'custom'

const PERIOD_CHIPS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'thisQuarter', label: 'This Quarter' },
  { id: 'lastQuarter', label: 'Last Quarter' },
  { id: 'thisYear', label: 'This FY' },
]

function parseDate(s: string): Date | null {
  if (!s.trim()) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export default function CustomerStatementScreen() {
  const db = useDb()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerId, setCustomerId] = useState('')
  // Default = current FY start → today. toIsoLocal, NOT toISOString: the old
  // ISO slice ran in UTC, so IST users got "March 31" as FY start and saw
  // yesterday as "today" before 5:30 AM.
  const [period, setPeriod] = useState<PeriodChoice>('thisYear')
  const [fromDate, setFromDate] = useState(presetRange('thisYear').start)
  const [toDate, setToDate] = useState(toIsoLocal(new Date()))
  const [showPicker, setShowPicker] = useState(false)
  const [loading, setLoading] = useState(false)

  // The generated result (with the customer + period it was generated for, so
  // editing the filters afterwards doesn't relabel a stale result). The party
  // snapshot is kept too, so a Share PDF after the fact uses the customer the
  // statement was actually generated for — not whatever the picker shows now.
  const [result, setResult] = useState<{
    data: LedgerData
    customerName: string
    from: string
    to: string
    party: {
      name: string
      email?: string
      phone?: string
      billingAddress?: string
      taxId?: string
    }
  } | null>(null)

  const reload = useCallback(() => {
    db
      .select()
      .from(schema.customer)
      .where(notDeleted(schema.customer.deletedAt))
      .orderBy(asc(schema.customer.name))
      .then(setCustomers)
  }, [db])

  useFocusEffect(reload)

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null

  async function handleGenerate() {
    if (!customerId || !selectedCustomer) {
      Alert.alert('Validation', 'Please select a customer.')
      return
    }
    const from = parseDate(fromDate)
    const to = parseDate(toDate)
    if (!from || !to) {
      Alert.alert('Validation', 'Please select a valid date range (YYYY-MM-DD).')
      return
    }
    if (from > to) {
      Alert.alert('Validation', '"From" date cannot be later than "To" date.')
      return
    }
    setLoading(true)
    try {
      const full = await buildCustomerLedger(db, selectedCustomer.id, selectedCustomer.openingBalance)
      const sliced = sliceToDateRange(full, from, to)
      setResult({
        data: sliced,
        customerName: selectedCustomer.name,
        from: fromDate,
        to: toDate,
        party: {
          name: selectedCustomer.name,
          email: selectedCustomer.email ?? undefined,
          phone: selectedCustomer.phone ?? undefined,
          billingAddress: selectedCustomer.billingAddress ?? undefined,
          taxId: selectedCustomer.taxId ?? undefined,
        },
      })
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to generate statement')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Customer Statement</ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText style={styles.intro}>
          All invoices, payments, and credit/debit notes for a customer over a date range.
        </ThemedText>

        <ThemedText style={styles.label}>Customer *</ThemedText>
        <Pressable style={styles.picker} onPress={() => setShowPicker(true)}>
          <ThemedText style={customerId ? undefined : styles.placeholder}>
            {selectedCustomer ? selectedCustomer.name : 'Select customer'}
          </ThemedText>
        </Pressable>

        <ThemedText style={styles.label}>Period</ThemedText>
        <View style={styles.presetRow}>
          {PERIOD_CHIPS.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => {
                setPeriod(p.id)
                const r = presetRange(p.id)
                setFromDate(r.start)
                setToDate(r.end)
              }}
              style={[styles.presetChip, period === p.id && styles.presetChipActive]}
            >
              <ThemedText style={period === p.id ? styles.presetTextActive : styles.presetText}>
                {p.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <ThemedText style={styles.label}>From</ThemedText>
            <TextInput
              style={styles.input}
              value={fromDate}
              onChangeText={(v) => {
                setFromDate(v)
                setPeriod('custom')
              }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#999"
            />
          </View>
          <View style={styles.dateCol}>
            <ThemedText style={styles.label}>To</ThemedText>
            <TextInput
              style={styles.input}
              value={toDate}
              onChangeText={(v) => {
                setToDate(v)
                setPeriod('custom')
              }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#999"
            />
          </View>
        </View>

        <Pressable
          style={[styles.generateBtn, loading && styles.generateBtnDisabled]}
          onPress={handleGenerate}
          disabled={loading}
        >
          <ThemedText style={styles.generateBtnText}>
            {loading ? 'Generating…' : 'Generate Statement'}
          </ThemedText>
        </Pressable>

        {result ? (
          <View style={styles.resultBlock}>
            <View style={styles.resultHeader}>
              <ThemedText type="subtitle" numberOfLines={1}>{result.customerName}</ThemedText>
              <ThemedText style={styles.period}>
                {formatDate(result.from)} — {formatDate(result.to)}
              </ThemedText>
            </View>
            <PdfActions
              buildPayload={() =>
                buildStatementPdfPayload(db, {
                  ledger: result.data,
                  party: result.party,
                  title: 'CUSTOMER STATEMENT',
                  fromDate: result.from,
                  toDate: result.to,
                })
              }
            />
            <LedgerView
              data={result.data}
              summary="cards"
              debitLabel="Charges"
              creditLabel="Receipts"
              emptyText="No transactions in this period."
            />
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Select Customer</ThemedText>
            <FlatList
              data={customers}
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setCustomerId(item.id)
                    setShowPicker(false)
                  }}
                >
                  <ThemedText type={item.id === customerId ? 'defaultSemiBold' : undefined}>
                    {item.name}
                  </ThemedText>
                  <ThemedText style={styles.partyBalance}>
                    Balance: {formatCurrency(Math.abs(item.currentBalance))}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1 },
  content: { paddingBottom: 48 },
  intro: { opacity: 0.6, fontSize: 13, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 12 },
  picker: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    marginTop: 4,
  },
  placeholder: { opacity: 0.5 },
  // Same chips as the other two report screens.
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#e5e7eb' },
  presetChipActive: { backgroundColor: '#007AFF' },
  presetText: { fontSize: 12, color: '#374151' },
  presetTextActive: { fontSize: 12, color: 'white', fontWeight: '600' },
  dateRow: { flexDirection: 'row', gap: 12 },
  dateCol: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#f5f5f5',
    marginTop: 4,
  },
  generateBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  generateBtnDisabled: { opacity: 0.5 },
  generateBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
  resultBlock: { marginTop: 24, gap: 14 },
  resultHeader: { gap: 2 },
  period: { fontSize: 13, opacity: 0.6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { maxHeight: '85%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  modalTitle: { marginBottom: 12 },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
    gap: 2,
  },
  partyBalance: { fontSize: 12, opacity: 0.6 },
  modalClose: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  modalCloseText: { color: '#FF3B30', fontSize: 16 },
})
