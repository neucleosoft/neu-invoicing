import { StyleSheet, View } from 'react-native'

import { ThemedText } from './themed-text'
import { ThemedView } from './themed-view'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import type { LedgerData, LedgerLine } from '@/utils/ledger'

// Shared presentation for a party ledger / statement.
//
// Two desktop pages feed this:
//   - Ledger pages (CustomerLedger/SupplierLedger): a single "Current Balance"
//     line + the table. No summary cards, no date filter. -> summary="balance".
//   - Statement page (CustomerStatement): four summary cards (Opening / Charges /
//     Receipts / Closing) + the table over a date range. -> summary="cards".
//
// The table is identical between them: an Opening Balance row pinned at top, one
// row per transaction (Dr/Cr amount + running balance), and a Total row at the
// bottom. Negative balances follow the desktop "(Advance)" rule — abs value with
// an "(Advance)" suffix, never a minus sign — via renderBalance().
//
// Phone-friendly: desktop's 6-column table becomes a two-line row (particulars +
// date on the left, the movement + running balance on the right) which carries
// the same Date / Particulars / Debit / Credit / Balance information.

// Negative running balance = the party is in credit (overpaid). Mirror desktop's
// renderBalance: show abs + " (Advance)", no minus sign.
function renderBalance(amount: number): string {
  if (amount < 0) return `${formatCurrency(Math.abs(amount))} (Advance)`
  return formatCurrency(amount)
}

const TYPE_LABEL: Record<LedgerLine['type'], string> = {
  INVOICE: 'Invoice',
  BILL: 'Bill',
  PAYMENT: 'Payment',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
}

interface LedgerViewProps {
  data: LedgerData
  // "cards" → 4-card summary (statement). "balance" → single Current Balance line (ledger).
  summary: 'cards' | 'balance'
  // Column wording differs by side: a customer's debits are "Charges" and credits
  // "Receipts"; a supplier's are "Bills" and "Paid".
  debitLabel: string
  creditLabel: string
  emptyText?: string
}

export default function LedgerView({
  data,
  summary,
  debitLabel,
  creditLabel,
  emptyText = 'No transactions yet.',
}: LedgerViewProps) {
  const { openingBalance, rows, totalDebit, totalCredit, closingBalance } = data

  return (
    <View style={styles.wrap}>
      {summary === 'cards' ? (
        <View style={styles.cardsGrid}>
          <SummaryCard label="Opening" value={renderBalance(openingBalance)} bg="#f3f4f6" color="#374151" />
          <SummaryCard label={debitLabel} value={formatCurrency(totalDebit)} bg="#fef2f2" color="#b91c1c" />
          <SummaryCard label={creditLabel} value={formatCurrency(totalCredit)} bg="#f0fdf4" color="#15803d" />
          <SummaryCard label="Closing" value={renderBalance(closingBalance)} bg="#eef2ff" color="#4338ca" />
        </View>
      ) : (
        <View style={styles.balanceLine}>
          <ThemedText style={styles.balanceLabel}>Current Balance</ThemedText>
          <ThemedText type="title" style={styles.balanceValue}>
            {renderBalance(closingBalance)}
          </ThemedText>
        </View>
      )}

      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.table}>
        {/* Opening-balance row, pinned at the top (always present). */}
        <View style={styles.openingRow}>
          <ThemedText style={styles.openingLabel}>Opening Balance</ThemedText>
          <ThemedText type="defaultSemiBold">{renderBalance(openingBalance)}</ThemedText>
        </View>

        {rows.length === 0 ? (
          <ThemedText style={styles.empty}>{emptyText}</ThemedText>
        ) : (
          rows.map((r, i) => <LedgerRow key={`${r.type}-${r.number}-${i}`} row={r} index={i} />)
        )}

        {/* Total row at the bottom (always present). */}
        <View style={styles.totalsRow}>
          <View style={styles.totalsLeft}>
            <ThemedText type="defaultSemiBold">Total</ThemedText>
            <ThemedText style={styles.totalsMeta}>
              {debitLabel} {formatCurrency(totalDebit)} · {creditLabel} {formatCurrency(totalCredit)}
            </ThemedText>
          </View>
          <ThemedText type="defaultSemiBold">{renderBalance(closingBalance)}</ThemedText>
        </View>
      </ThemedView>
    </View>
  )
}

function LedgerRow({ row, index }: { row: LedgerLine; index: number }) {
  const isDebit = row.debit > 0
  const amount = isDebit ? row.debit : row.credit

  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {row.particulars}
        </ThemedText>
        <ThemedText style={styles.metaText}>
          {index + 1}. {formatDate(row.date)} · {TYPE_LABEL[row.type]}
        </ThemedText>
      </View>
      <View style={styles.rowRight}>
        <ThemedText type="defaultSemiBold" style={{ color: isDebit ? '#b91c1c' : '#15803d' }}>
          {formatCurrency(amount)} {isDebit ? 'Dr' : 'Cr'}
        </ThemedText>
        <ThemedText style={styles.balanceText}>Bal {renderBalance(row.balance)}</ThemedText>
      </View>
    </View>
  )
}

function SummaryCard({
  label,
  value,
  bg,
  color,
}: {
  label: string
  value: string
  bg: string
  color: string
}) {
  return (
    <View style={styles.cardCol}>
      <View style={[styles.summaryCard, { backgroundColor: bg }]}>
        <ThemedText style={[styles.summaryLabel, { color }]} numberOfLines={1}>
          {label}
        </ThemedText>
        <ThemedText style={[styles.summaryValue, { color }]} numberOfLines={1}>
          {value}
        </ThemedText>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  cardCol: { width: '50%', paddingHorizontal: 5, marginBottom: 10 },
  summaryCard: { borderRadius: 12, padding: 12, gap: 2 },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryValue: { fontSize: 15, fontWeight: '700' },
  balanceLine: { alignItems: 'flex-end', gap: 2 },
  balanceLabel: { fontSize: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 },
  balanceValue: { fontSize: 24 },
  table: { borderRadius: 12, paddingVertical: 2 },
  openingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d5db',
  },
  openingLabel: { fontStyle: 'italic', opacity: 0.7 },
  empty: { textAlign: 'center', paddingVertical: 24, opacity: 0.6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  rowLeft: { flex: 1, gap: 3 },
  metaText: { fontSize: 12, opacity: 0.6 },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  balanceText: { fontSize: 12, opacity: 0.6 },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#d1d5db',
    gap: 12,
  },
  totalsLeft: { flex: 1, gap: 2 },
  totalsMeta: { fontSize: 11, opacity: 0.6 },
})
