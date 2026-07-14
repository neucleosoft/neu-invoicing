import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { shareTextFile } from '@/utils/exportShare'
import {
  getGSTR1,
  getGSTR2,
  getGSTR3B,
  getGSTR9,
  getHSNSummary,
  GSTR1_SECTION_NAMES,
  GSTR2_SECTION_NAMES,
  type Gstr1Data,
  type Gstr1SectionKey,
  type Gstr2Data,
  type Gstr2SectionKey,
  type Gstr3bData,
  type Gstr9Data,
  type GstRange,
  type HsnRow,
  type SectionTotals,
} from '@/utils/gstReport'

// GST Reports — GSTR-1 / GSTR-2 / GSTR-3B / GSTR-9 / HSN summary, on-screen. The
// user picks a period (presets or custom dates) then taps a report card. Mirrors
// desktop GSTReports.tsx; the GSTN/Excel/JSON export buttons are out of scope.

type Preset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisYear' | 'custom'
type ReportType = 'gstr1' | 'gstr2' | 'gstr3b' | 'gstr9' | 'hsn'

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'thisMonth', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'thisQuarter', label: 'This Quarter' },
  { id: 'lastQuarter', label: 'Last Quarter' },
  { id: 'thisYear', label: 'This FY' },
]

const REPORT_CARDS: { id: ReportType; label: string; hint: string }[] = [
  { id: 'gstr1', label: 'GSTR-1', hint: 'Outward supplies (sales)' },
  { id: 'gstr2', label: 'GSTR-2', hint: 'Inward supplies (purchases)' },
  { id: 'gstr3b', label: 'GSTR-3B', hint: 'Monthly summary' },
  { id: 'gstr9', label: 'GSTR-9', hint: 'Annual return' },
  { id: 'hsn', label: 'HSN Summary', hint: 'Rate-wise by HSN code' },
]

// Local-time yyyy-mm-dd (NOT toISOString — that shifts IST dates back a day).
function toIsoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function presetRange(preset: Preset): { start: string; end: string } | null {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (preset) {
    case 'thisMonth':
      return { start: toIsoLocal(new Date(y, m, 1)), end: toIsoLocal(new Date(y, m + 1, 0)) }
    case 'lastMonth':
      return { start: toIsoLocal(new Date(y, m - 1, 1)), end: toIsoLocal(new Date(y, m, 0)) }
    case 'thisQuarter': {
      const q = Math.floor(m / 3)
      return { start: toIsoLocal(new Date(y, q * 3, 1)), end: toIsoLocal(new Date(y, q * 3 + 3, 0)) }
    }
    case 'lastQuarter': {
      let q = Math.floor(m / 3) - 1
      let yy = y
      if (q < 0) {
        q = 3
        yy = y - 1
      }
      return { start: toIsoLocal(new Date(yy, q * 3, 1)), end: toIsoLocal(new Date(yy, q * 3 + 3, 0)) }
    }
    case 'thisYear': {
      // Indian financial year: April 1 → March 31.
      const fy = m >= 3 ? y : y - 1
      return { start: toIsoLocal(new Date(fy, 3, 1)), end: toIsoLocal(new Date(fy + 1, 2, 31)) }
    }
    default:
      return null
  }
}

function toRange(startStr: string, endStr: string): GstRange | null {
  const start = new Date(startStr)
  const end = new Date(endStr)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

type ReportData =
  | { type: 'gstr1'; data: Gstr1Data }
  | { type: 'gstr2'; data: Gstr2Data }
  | { type: 'gstr3b'; data: Gstr3bData }
  | { type: 'gstr9'; data: Gstr9Data }
  | { type: 'hsn'; data: HsnRow[] }

export default function GstReportsScreen() {
  const db = useDb()
  const initial = presetRange('thisMonth')!
  const [preset, setPreset] = useState<Preset>('thisMonth')
  const [startDate, setStartDate] = useState(initial.start)
  const [endDate, setEndDate] = useState(initial.end)
  const [companyGstin, setCompanyGstin] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<ReportData | null>(null)

  useEffect(() => {
    db.select({ taxId: schema.company.taxId, stateName: schema.company.stateName })
      .from(schema.company)
      .limit(1)
      .then((rows) => setCompanyGstin(rows[0]?.taxId ?? null))
  }, [db])

  // Any date/preset change invalidates the open report (prevents showing stale
  // numbers under a new period). Mirrors desktop.
  function applyPreset(p: Preset) {
    setPreset(p)
    setReport(null)
    const r = presetRange(p)
    if (r) {
      setStartDate(r.start)
      setEndDate(r.end)
    }
  }
  function onStartChange(v: string) {
    setStartDate(v)
    setPreset('custom')
    setReport(null)
  }
  function onEndChange(v: string) {
    setEndDate(v)
    setPreset('custom')
    setReport(null)
  }

  async function generate(type: ReportType) {
    const range = toRange(startDate, endDate)
    if (!range) {
      Alert.alert('Validation', 'Please enter a valid date range (YYYY-MM-DD).')
      return
    }
    setLoading(true)
    try {
      let r: ReportData
      switch (type) {
        case 'gstr1':
          r = { type, data: await getGSTR1(db, range) }
          break
        case 'gstr2':
          r = { type, data: await getGSTR2(db, range) }
          break
        case 'gstr3b':
          r = { type, data: await getGSTR3B(db, range) }
          break
        case 'gstr9':
          r = { type, data: await getGSTR9(db, range) }
          break
        case 'hsn':
          r = { type, data: await getHSNSummary(db, range) }
          break
      }
      setReport(r)
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to generate report')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (report ? setReport(null) : router.back())}
          style={styles.headerButton}
          hitSlop={8}
        >
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <ThemedText type="title">GST Reports</ThemedText>
          {companyGstin ? (
            <ThemedText style={styles.gstinText}>GSTIN: {companyGstin}</ThemedText>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Period picker */}
        <ThemedText style={styles.label}>Period</ThemedText>
        <View style={styles.presetRow}>
          {PRESETS.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => applyPreset(p.id)}
              style={[styles.presetChip, preset === p.id && styles.presetChipActive]}
            >
              <ThemedText style={preset === p.id ? styles.presetTextActive : styles.presetText}>
                {p.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <ThemedText style={styles.label}>Start</ThemedText>
            <TextInput
              style={styles.input}
              value={startDate}
              onChangeText={onStartChange}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#999"
            />
          </View>
          <View style={styles.dateCol}>
            <ThemedText style={styles.label}>End</ThemedText>
            <TextInput
              style={styles.input}
              value={endDate}
              onChangeText={onEndChange}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#999"
            />
          </View>
        </View>

        {report ? (
          <View style={styles.reportBlock}>
            {loading ? <ThemedText style={styles.loadingText}>Generating…</ThemedText> : null}
            <ReportView report={report} />
            <Pressable
              style={styles.exportBtn}
              onPress={async () => {
                try {
                  // Same as desktop's generic JSON export: the report data,
                  // pretty-printed, for CA review/archiving (the GSTN portal
                  // file is a separate GSTR-1-only export).
                  await shareTextFile(
                    `${report.type.toUpperCase()}_${startDate}_${endDate}.json`,
                    JSON.stringify(report.data, null, 2),
                    'application/json',
                  )
                } catch (e) {
                  Alert.alert('Export failed', e instanceof Error ? e.message : String(e))
                }
              }}
            >
              <ThemedText style={styles.exportBtnText}>Share JSON</ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.cardsGrid}>
            {REPORT_CARDS.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => generate(c.id)}
                disabled={loading}
                style={({ pressed }) => [styles.reportCard, pressed && styles.cardPressed]}
              >
                <ThemedText type="defaultSemiBold">{c.label}</ThemedText>
                <ThemedText style={styles.cardHint}>{c.hint}</ThemedText>
              </Pressable>
            ))}
            {loading ? <ThemedText style={styles.loadingText}>Generating…</ThemedText> : null}
          </View>
        )}
      </ScrollView>
    </ThemedView>
  )
}

// ---- report views --------------------------------------------------------------

function ReportView({ report }: { report: ReportData }) {
  switch (report.type) {
    case 'gstr1':
      return <Gstr1View data={report.data} />
    case 'gstr2':
      return <Gstr2View data={report.data} />
    case 'gstr3b':
      return <Gstr3bView data={report.data} />
    case 'gstr9':
      return <Gstr9View data={report.data} />
    case 'hsn':
      return <HsnView rows={report.data} />
  }
}

// A compact 4-number row used in section/HSN tables.
function TaxRow({
  label,
  count,
  totals,
}: {
  label: string
  count?: number
  totals: SectionTotals
}) {
  return (
    <View style={styles.taxRow}>
      <View style={styles.taxRowLeft}>
        <ThemedText type="defaultSemiBold" numberOfLines={2}>{label}</ThemedText>
        {count != null ? <ThemedText style={styles.taxRowMeta}>{count} doc(s)</ThemedText> : null}
        <ThemedText style={styles.taxRowMeta}>Taxable {formatCurrency(totals.taxableValue)}</ThemedText>
      </View>
      <View style={styles.taxRowRight}>
        <ThemedText style={styles.taxCell}>IGST {formatCurrency(totals.igst)}</ThemedText>
        <ThemedText style={styles.taxCell}>
          CGST {formatCurrency(totals.cgst)} · SGST {formatCurrency(totals.sgst)}
        </ThemedText>
      </View>
    </View>
  )
}

function Gstr1View({ data }: { data: Gstr1Data }) {
  const d = data.docSummary
  const sectionKeys = Object.keys(GSTR1_SECTION_NAMES) as Gstr1SectionKey[]
  return (
    <View style={styles.viewWrap}>
      <Section title="GSTR-1 Summary">
        <Row label="Total Invoices" value={String(d.totalInvoices)} />
        <Row label="Taxable Value" value={formatCurrency(d.totalTaxableValue)} />
        <Row label="IGST" value={formatCurrency(d.totalIgst)} />
        <Row label="CGST" value={formatCurrency(d.totalCgst)} />
        <Row label="SGST" value={formatCurrency(d.totalSgst)} />
        <Row label="Cess" value={formatCurrency(d.totalCess)} />
        <Row label="Total Tax" value={formatCurrency(d.totalTax)} />
        <Row label="Total Value" value={formatCurrency(d.totalValue)} />
      </Section>

      <ThemedText type="subtitle" style={styles.sectionHeading}>Section-wise Breakup</ThemedText>
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.tableCard}>
        {sectionKeys.map((k) => (
          <TaxRow
            key={k}
            label={GSTR1_SECTION_NAMES[k]}
            count={data.sections[k].count}
            totals={data.sections[k]}
          />
        ))}
      </ThemedView>

      <HsnView rows={data.hsnSummary} heading="HSN Summary" />
    </View>
  )
}

function Gstr2View({ data }: { data: Gstr2Data }) {
  const d = data.docSummary
  const sectionKeys = Object.keys(GSTR2_SECTION_NAMES) as Gstr2SectionKey[]
  return (
    <View style={styles.viewWrap}>
      <Section title="GSTR-2 Summary">
        <Row label="Total Bills" value={String(d.totalBills)} />
        <Row label="Taxable Value" value={formatCurrency(d.totalTaxableValue)} />
        <Row label="Total Tax" value={formatCurrency(d.totalTax)} />
        <Row label="Total Value" value={formatCurrency(d.totalValue)} />
      </Section>

      <ThemedText type="subtitle" style={styles.sectionHeading}>Section-wise Breakup</ThemedText>
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.tableCard}>
        {sectionKeys.map((k) => (
          <TaxRow
            key={k}
            label={GSTR2_SECTION_NAMES[k]}
            count={data.sections[k].count}
            totals={data.sections[k]}
          />
        ))}
      </ThemedView>

      <Section title="Input Tax Credit (ITC)">
        <Row label="Eligible IGST" value={formatCurrency(data.eligibleITC.igst)} />
        <Row label="Eligible CGST" value={formatCurrency(data.eligibleITC.cgst)} />
        <Row label="Eligible SGST" value={formatCurrency(data.eligibleITC.sgst)} />
        <Row label="Ineligible IGST" value={formatCurrency(data.ineligibleITC.igst)} />
        <Row label="Ineligible CGST" value={formatCurrency(data.ineligibleITC.cgst)} />
        <Row label="Ineligible SGST" value={formatCurrency(data.ineligibleITC.sgst)} />
      </Section>
    </View>
  )
}

function Gstr3bView({ data }: { data: Gstr3bData }) {
  return (
    <View style={styles.viewWrap}>
      <Section title="3.1 Outward Supplies">
        <Row label="Taxable Value" value={formatCurrency(data.outward.total.taxableValue)} />
        <Row label="IGST (Inter-state)" value={formatCurrency(data.outward.interState.igst)} />
        <Row label="CGST (Intra-state)" value={formatCurrency(data.outward.intraState.cgst)} />
        <Row label="SGST (Intra-state)" value={formatCurrency(data.outward.intraState.sgst)} />
      </Section>

      <Section title="3.2 Inward (Reverse Charge)">
        <Row label="Taxable Value" value={formatCurrency(data.inwardRCM.taxableValue)} />
        <Row label="IGST" value={formatCurrency(data.inwardRCM.igst)} />
        <Row label="CGST" value={formatCurrency(data.inwardRCM.cgst)} />
        <Row label="SGST" value={formatCurrency(data.inwardRCM.sgst)} />
        <Row label="Cess" value={formatCurrency(data.inwardRCM.cess)} />
      </Section>

      <Section title="4 Eligible ITC">
        <Row label="ITC Available (IGST)" value={formatCurrency(data.itc.eligible.igst)} />
        <Row label="ITC Available (CGST)" value={formatCurrency(data.itc.eligible.cgst)} />
        <Row label="ITC Available (SGST)" value={formatCurrency(data.itc.eligible.sgst)} />
        <Row label="Net ITC (IGST)" value={formatCurrency(data.itc.net.igst)} />
        <Row label="Net ITC (CGST)" value={formatCurrency(data.itc.net.cgst)} />
        <Row label="Net ITC (SGST)" value={formatCurrency(data.itc.net.sgst)} />
      </Section>

      <Section title="6 Tax Payable (after ITC)">
        <Row label="IGST" value={formatCurrency(data.taxLiability.netPayable.igst)} />
        <Row label="CGST" value={formatCurrency(data.taxLiability.netPayable.cgst)} />
        <Row label="SGST" value={formatCurrency(data.taxLiability.netPayable.sgst)} />
        <Row label="Cess" value={formatCurrency(data.taxLiability.netPayable.cess)} />
      </Section>

      <View style={styles.payableBanner}>
        <ThemedText style={styles.payableLabel}>Total Tax Payable</ThemedText>
        <ThemedText style={styles.payableValue}>
          {formatCurrency(data.taxLiability.totalPayable)}
        </ThemedText>
      </View>
    </View>
  )
}

function Gstr9View({ data }: { data: Gstr9Data }) {
  const fmtBucket = (b: { taxableValue: number; igst: number; cgst: number; sgst: number }) =>
    `${formatCurrency(b.taxableValue)} · IGST ${formatCurrency(b.igst)}`
  return (
    <View style={styles.viewWrap}>
      <Section title="Part II — Outward Supplies">
        <Row label="B2B" value={fmtBucket(data.outward.b2b)} />
        <Row label="B2C" value={fmtBucket(data.outward.b2c)} />
        <Row label="Exports" value={fmtBucket(data.outward.exports)} />
        <Row label="Total" value={fmtBucket(data.outward.total)} />
      </Section>

      <Section title="Part III — Inward Supplies">
        <Row label="From Registered" value={fmtBucket(data.inward.fromRegistered)} />
        <Row label="From Unregistered" value={fmtBucket(data.inward.fromUnregistered)} />
        <Row label="Total" value={fmtBucket(data.inward.total)} />
      </Section>

      <Section title="Part IV — ITC Claimed">
        <Row label="IGST" value={formatCurrency(data.itcClaimed.igst)} />
        <Row label="CGST" value={formatCurrency(data.itcClaimed.cgst)} />
        <Row label="SGST" value={formatCurrency(data.itcClaimed.sgst)} />
        <Row label="Cess" value={formatCurrency(data.itcClaimed.cess)} />
      </Section>
    </View>
  )
}

function HsnView({ rows, heading }: { rows: HsnRow[]; heading?: string }) {
  const footer = rows.reduce(
    (acc, r) => ({
      taxableValue: acc.taxableValue + r.taxableValue,
      igst: acc.igst + r.igstAmount,
      cgst: acc.cgst + r.cgstAmount,
      sgst: acc.sgst + r.sgstAmount,
      total: acc.total + r.totalValue,
    }),
    { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, total: 0 },
  )
  return (
    <View style={styles.viewWrap}>
      {heading ? <ThemedText type="subtitle" style={styles.sectionHeading}>{heading}</ThemedText> : null}
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.tableCard}>
        {rows.length === 0 ? (
          <ThemedText style={styles.tableEmpty}>No HSN data in this period.</ThemedText>
        ) : (
          rows.map((r, i) => (
            <View key={`${r.hsnCode}-${i}`} style={styles.hsnRow}>
              <View style={styles.hsnLeft}>
                <ThemedText type="defaultSemiBold">{r.hsnCode}</ThemedText>
                <ThemedText style={styles.taxRowMeta} numberOfLines={1}>
                  {r.description || '—'} · {r.totalQuantity} {r.uqc}
                </ThemedText>
              </View>
              <View style={styles.hsnRight}>
                <ThemedText style={styles.taxCell}>Taxable {formatCurrency(r.taxableValue)}</ThemedText>
                <ThemedText style={styles.taxCell}>
                  IGST {formatCurrency(r.igstAmount)} · C {formatCurrency(r.cgstAmount)} · S {formatCurrency(r.sgstAmount)}
                </ThemedText>
              </View>
            </View>
          ))
        )}
        {rows.length > 0 ? (
          <View style={styles.hsnFooter}>
            <ThemedText type="defaultSemiBold">Totals</ThemedText>
            <ThemedText style={styles.taxCell}>
              Taxable {formatCurrency(footer.taxableValue)} · IGST {formatCurrency(footer.igst)}
            </ThemedText>
          </View>
        ) : null}
      </ThemedView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitleWrap: { flex: 1 },
  gstinText: { fontSize: 12, opacity: 0.6 },
  content: { paddingBottom: 48 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 12 },
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
  cardsGrid: { marginTop: 20, gap: 10 },
  reportCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0a7ea4',
    gap: 2,
  },
  cardPressed: { opacity: 0.6 },
  cardHint: { fontSize: 12, opacity: 0.6 },
  loadingText: { textAlign: 'center', opacity: 0.6, marginTop: 12 },
  reportBlock: { marginTop: 16 },
  exportBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
  },
  exportBtnText: { color: '#007AFF', fontWeight: '600' },
  viewWrap: { gap: 16 },
  sectionHeading: { paddingHorizontal: 4 },
  tableCard: { borderRadius: 12, paddingVertical: 2 },
  taxRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  taxRowLeft: { flex: 1, gap: 2 },
  taxRowRight: { alignItems: 'flex-end', gap: 2 },
  taxRowMeta: { fontSize: 11, opacity: 0.6 },
  taxCell: { fontSize: 12, opacity: 0.85, textAlign: 'right' },
  hsnRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  hsnLeft: { flex: 1, gap: 2 },
  hsnRight: { alignItems: 'flex-end', gap: 2, flexShrink: 1 },
  hsnFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#d1d5db',
    gap: 8,
  },
  tableEmpty: { textAlign: 'center', paddingVertical: 20, opacity: 0.6 },
  payableBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 16,
  },
  payableLabel: { fontSize: 14, fontWeight: '700', color: '#991b1b' },
  payableValue: { fontSize: 18, fontWeight: '700', color: '#991b1b' },
})
