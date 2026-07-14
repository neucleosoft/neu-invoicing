import { router } from 'expo-router'
import { useState } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'

import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { shareTextFile, toCsv } from '@/utils/exportShare'
import {
  getPayables,
  getReceivables,
  getSalesReport,
  getStockSummary,
  getTaxReport,
  type PartyBalanceReport,
  type SalesReport,
  type SalesStatus,
  type StockSummary,
  type TaxReport,
} from '@/utils/reports'

// Per-report CSV (mirrors desktop's export columns). Summary reports export as
// metric/value pairs; row reports export their rows plus a Total line.
function buildReportCsv(r: ResultData): { filename: string; csv: string } {
  const metricCols = [
    { key: 'metric', label: 'Metric' },
    { key: 'value', label: 'Value' },
  ]
  switch (r.kind) {
    case 'sales':
      return {
        filename: 'sales-report.csv',
        csv: toCsv(metricCols, [
          { metric: 'Total Sales', value: r.data.totalSales },
          { metric: 'Subtotal', value: r.data.subtotal },
          { metric: 'Discount', value: r.data.discount },
          { metric: 'Total Tax', value: r.data.totalTax },
          { metric: 'Amount Paid', value: r.data.amountPaid },
          { metric: 'Balance Due', value: r.data.balanceDue },
          { metric: 'Invoice Count', value: r.data.invoiceCount },
        ]),
      }
    case 'stock':
      return {
        filename: 'stock-summary.csv',
        csv: toCsv(
          [
            { key: 'name', label: 'Item' },
            { key: 'currentStock', label: 'Stock' },
            { key: 'unit', label: 'Unit' },
            { key: 'lowStockWarning', label: 'Low-stock Threshold' },
            { key: 'stockValue', label: 'Stock Value' },
            { key: 'status', label: 'Status' },
          ],
          [
            ...r.data.items.map((it) => ({ ...it })),
            { name: 'TOTAL', currentStock: '', unit: '', lowStockWarning: '', stockValue: r.data.totalStockValue, status: '' },
          ],
        ),
      }
    case 'receivables':
    case 'payables':
      return {
        filename: `${r.kind}.csv`,
        csv: toCsv(
          [
            { key: 'name', label: r.kind === 'receivables' ? 'Customer' : 'Supplier' },
            { key: 'currentBalance', label: 'Balance' },
          ],
          [
            ...r.data.parties.map((p) => ({ ...p })),
            { name: 'TOTAL', currentBalance: r.data.total },
          ],
        ),
      }
    case 'tax':
      return {
        filename: 'tax-report.csv',
        csv: toCsv(metricCols, [
          { metric: 'Tax Collected (Sales)', value: r.data.taxCollected },
          { metric: 'Tax Paid (Purchases)', value: r.data.taxPaid },
          { metric: 'Net Tax', value: r.data.netTax },
        ]),
      }
  }
}

// Business Reports — Sales / Stock / Receivables / Payables / Tax. Mirrors desktop
// Reports.tsx + report.ts. Filters (date range + status) apply to Sales; Tax uses
// dates only; the three balance reports ignore all filters (live party balances).

type ReportId = 'sales' | 'stock' | 'receivables' | 'payables' | 'tax'

const REPORTS: { id: ReportId; label: string }[] = [
  { id: 'sales', label: 'Sales' },
  { id: 'stock', label: 'Stock' },
  { id: 'receivables', label: 'Receivables' },
  { id: 'payables', label: 'Payables' },
  { id: 'tax', label: 'Tax' },
]

const STATUS_OPTIONS: { value: SalesStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'PAID', label: 'Paid' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'DRAFT', label: 'Unpaid' },
]

function parseStart(s: string): Date | null {
  if (!s.trim()) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d
}

// End date is inclusive of the whole day (desktop's lte-on-midnight would drop
// last-day invoices that carry a time component; we normalise to end-of-day).
function parseEnd(s: string): Date | null {
  if (!s.trim()) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  d.setHours(23, 59, 59, 999)
  return d
}

type ResultData =
  | { kind: 'sales'; data: SalesReport }
  | { kind: 'stock'; data: StockSummary }
  | { kind: 'receivables'; data: PartyBalanceReport }
  | { kind: 'payables'; data: PartyBalanceReport }
  | { kind: 'tax'; data: TaxReport }

export default function BusinessReportsScreen() {
  const db = useDb()
  const [active, setActive] = useState<ReportId>('sales')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState<SalesStatus>('')
  const [showStatusPicker, setShowStatusPicker] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ResultData | null>(null)

  // Filters only matter for Sales (all three) and Tax (dates). Hide them for the
  // three balance reports so the screen reflects what actually applies.
  const showDateFilter = active === 'sales' || active === 'tax'
  const showStatusFilter = active === 'sales'

  function selectReport(id: ReportId) {
    setActive(id)
    setResult(null)
  }

  async function handleGenerate() {
    const range = { startDate: parseStart(startDate), endDate: parseEnd(endDate) }
    setLoading(true)
    try {
      let r: ResultData
      switch (active) {
        case 'sales':
          r = { kind: 'sales', data: await getSalesReport(db, range, status) }
          break
        case 'stock':
          r = { kind: 'stock', data: await getStockSummary(db) }
          break
        case 'receivables':
          r = { kind: 'receivables', data: await getReceivables(db) }
          break
        case 'payables':
          r = { kind: 'payables', data: await getPayables(db) }
          break
        case 'tax':
          r = { kind: 'tax', data: await getTaxReport(db, range) }
          break
      }
      setResult(r)
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to generate report')
    } finally {
      setLoading(false)
    }
  }

  const statusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? 'All'

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Business Reports</ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Report type selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
          {REPORTS.map((rep) => (
            <Pressable
              key={rep.id}
              onPress={() => selectReport(rep.id)}
              style={[styles.tab, active === rep.id && styles.tabActive]}
            >
              <ThemedText style={active === rep.id ? styles.tabTextActive : styles.tabText}>
                {rep.label}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        {showDateFilter ? (
          <View style={styles.dateRow}>
            <View style={styles.dateCol}>
              <ThemedText style={styles.label}>Start Date</ThemedText>
              <TextInput
                style={styles.input}
                value={startDate}
                onChangeText={setStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#999"
              />
            </View>
            <View style={styles.dateCol}>
              <ThemedText style={styles.label}>End Date</ThemedText>
              <TextInput
                style={styles.input}
                value={endDate}
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#999"
              />
            </View>
          </View>
        ) : null}

        {showStatusFilter ? (
          <>
            <ThemedText style={styles.label}>Status</ThemedText>
            <Pressable style={styles.picker} onPress={() => setShowStatusPicker(true)}>
              <ThemedText>{statusLabel}</ThemedText>
            </Pressable>
          </>
        ) : null}

        {!showDateFilter && !showStatusFilter ? (
          <ThemedText style={styles.noFilterNote}>
            This report shows live balances and ignores date/status filters.
          </ThemedText>
        ) : null}

        <Pressable
          style={[styles.generateBtn, loading && styles.generateBtnDisabled]}
          onPress={handleGenerate}
          disabled={loading}
        >
          <ThemedText style={styles.generateBtnText}>
            {loading ? 'Generating…' : 'Generate Report'}
          </ThemedText>
        </Pressable>

        {result ? (
          <View style={styles.resultBlock}>
            <ResultView result={result} />
            <Pressable
              style={styles.exportBtn}
              onPress={async () => {
                try {
                  const { filename, csv } = buildReportCsv(result)
                  await shareTextFile(filename, csv, 'text/csv')
                } catch (e) {
                  Alert.alert('Export failed', e instanceof Error ? e.message : String(e))
                }
              }}
            >
              <ThemedText style={styles.exportBtnText}>Export CSV (opens in Excel)</ThemedText>
            </Pressable>
          </View>
        ) : (
          <ThemedText style={styles.emptyHint}>
            Pick a report and tap “Generate Report” to view it.
          </ThemedText>
        )}
      </ScrollView>

      {/* Status picker */}
      <Modal visible={showStatusPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Status</ThemedText>
            {STATUS_OPTIONS.map((o) => (
              <Pressable
                key={o.value || 'all'}
                style={styles.modalRow}
                onPress={() => {
                  setStatus(o.value)
                  setShowStatusPicker(false)
                }}
              >
                <ThemedText type={o.value === status ? 'defaultSemiBold' : undefined}>
                  {o.value === status ? `✓ ${o.label}` : o.label}
                </ThemedText>
              </Pressable>
            ))}
            <Pressable style={styles.modalClose} onPress={() => setShowStatusPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  )
}

function ResultView({ result }: { result: ResultData }) {
  switch (result.kind) {
    case 'sales': {
      const d = result.data
      return (
        <Section title="Sales Report">
          <Row label="Total Sales" value={formatCurrency(d.totalSales)} />
          <Row label="Total Tax" value={formatCurrency(d.totalTax)} />
          <Row label="Invoice Count" value={String(d.invoiceCount)} />
          <Row label="Subtotal" value={formatCurrency(d.subtotal)} />
          <Row label="Discount" value={formatCurrency(d.discount)} />
          <Row label="Amount Received" value={formatCurrency(d.amountPaid)} />
          <Row label="Balance Due" value={formatCurrency(d.balanceDue)} />
        </Section>
      )
    }
    case 'tax': {
      const d = result.data
      return (
        <Section title="Tax Report">
          <Row label="Tax Collected (Sales)" value={formatCurrency(d.taxCollected)} />
          <Row label="Tax Paid (Purchases)" value={formatCurrency(d.taxPaid)} />
          <Row label="Net Tax Payable" value={formatCurrency(d.netTax)} />
        </Section>
      )
    }
    case 'stock': {
      const d = result.data
      return (
        <View style={styles.tableWrap}>
          <View style={styles.tableHeaderRow}>
            <ThemedText style={[styles.th, styles.thName]}>Item</ThemedText>
            <ThemedText style={[styles.th, styles.thNum]}>Stock</ThemedText>
            <ThemedText style={[styles.th, styles.thNum]}>Value</ThemedText>
          </View>
          {d.items.length === 0 ? (
            <ThemedText style={styles.tableEmpty}>No stock-tracked items.</ThemedText>
          ) : (
            d.items.map((it) => (
              <View key={it.id} style={styles.tableRow}>
                <View style={styles.tdName}>
                  <ThemedText numberOfLines={1}>{it.name}</ThemedText>
                  <View style={[styles.stockBadge, it.status === 'Low Stock' ? styles.lowBadge : styles.okBadge]}>
                    <ThemedText style={[styles.stockBadgeText, it.status === 'Low Stock' ? styles.lowBadgeText : styles.okBadgeText]}>
                      {it.status}
                    </ThemedText>
                  </View>
                </View>
                <ThemedText style={styles.tdNum}>
                  {it.currentStock} {it.unit}
                </ThemedText>
                <ThemedText style={styles.tdNum}>{formatCurrency(it.stockValue)}</ThemedText>
              </View>
            ))
          )}
          <View style={styles.tableFooter}>
            <ThemedText type="defaultSemiBold">Total Stock Value</ThemedText>
            <ThemedText type="defaultSemiBold">{formatCurrency(d.totalStockValue)}</ThemedText>
          </View>
        </View>
      )
    }
    case 'receivables':
    case 'payables': {
      const d = result.data
      const isReceivable = result.kind === 'receivables'
      return (
        <View style={styles.tableWrap}>
          <View style={styles.tableHeaderRow}>
            <ThemedText style={[styles.th, styles.thName]}>
              {isReceivable ? 'Customer' : 'Supplier'}
            </ThemedText>
            <ThemedText style={[styles.th, styles.thNum]}>Balance</ThemedText>
          </View>
          {d.parties.length === 0 ? (
            <ThemedText style={styles.tableEmpty}>
              {isReceivable ? 'No outstanding receivables.' : 'No outstanding payables.'}
            </ThemedText>
          ) : (
            d.parties.map((p) => (
              <View key={p.id} style={styles.tableRow}>
                <ThemedText style={styles.tdName} numberOfLines={1}>{p.name}</ThemedText>
                <ThemedText style={styles.tdNum}>
                  {formatCurrency(Math.abs(p.currentBalance))}
                </ThemedText>
              </View>
            ))
          )}
          <View style={styles.tableFooter}>
            <ThemedText type="defaultSemiBold">
              {isReceivable ? 'Total Receivables' : 'Total Payables'}
            </ThemedText>
            <ThemedText type="defaultSemiBold">{formatCurrency(Math.abs(d.total))}</ThemedText>
          </View>
        </View>
      )
    }
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1 },
  content: { paddingBottom: 48 },
  tabRow: { gap: 8, paddingVertical: 4 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#e5e7eb' },
  tabActive: { backgroundColor: '#007AFF' },
  tabText: { fontSize: 13, color: '#374151' },
  tabTextActive: { fontSize: 13, color: 'white', fontWeight: '600' },
  label: { fontSize: 14, fontWeight: '600', marginTop: 12 },
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
  picker: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    marginTop: 4,
  },
  noFilterNote: { fontSize: 13, opacity: 0.6, marginTop: 12, fontStyle: 'italic' },
  generateBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  generateBtnDisabled: { opacity: 0.5 },
  generateBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
  resultBlock: { marginTop: 24 },
  exportBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
  },
  exportBtnText: { color: '#007AFF', fontWeight: '600' },
  emptyHint: { textAlign: 'center', opacity: 0.6, marginTop: 32 },
  tableWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f3f4f6',
    gap: 8,
  },
  th: { fontSize: 12, fontWeight: '700', opacity: 0.7 },
  thName: { flex: 1 },
  thNum: { width: 100, textAlign: 'right' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  tdName: { flex: 1, gap: 4, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  tdNum: { width: 100, textAlign: 'right', fontWeight: '500' },
  tableEmpty: { textAlign: 'center', paddingVertical: 20, opacity: 0.6 },
  tableFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f9fafb',
    borderTopWidth: 1,
    borderTopColor: '#d1d5db',
  },
  stockBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  okBadge: { backgroundColor: '#dcfce7' },
  lowBadge: { backgroundColor: '#fee2e2' },
  stockBadgeText: { fontSize: 9, fontWeight: '700' },
  okBadgeText: { color: '#166534' },
  lowBadgeText: { color: '#991b1b' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { maxHeight: '70%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
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
