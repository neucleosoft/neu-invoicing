import { router, useFocusEffect } from 'expo-router'
import { type ComponentProps, useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import MetricCard from '@/components/MetricCard'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { IconSymbol } from '@/components/ui/icon-symbol'
import { useAuth } from '@/auth'
import { useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import {
  getFiscalYearStartMonth,
  getLowStockCount,
  getOverdueCount,
  getRecentInvoices,
  getTotalInvoicedThisFY,
  getTotalReceivables,
  type RecentInvoice,
} from '@/utils/dashboard'
import {
  deriveDisplayStatus,
  formatInvoiceStatus,
  STATUS_BADGE_COLORS,
} from '@/utils/invoiceStatus'

export default function DashboardScreen() {
  const { user } = useAuth()
  const db = useDb()
  const [receivables, setReceivables] = useState(0)
  const [invoicedFY, setInvoicedFY] = useState(0)
  const [overdueCount, setOverdueCount] = useState(0)
  const [lowStockCount, setLowStockCount] = useState(0)
  const [recent, setRecent] = useState<RecentInvoice[]>([])

  // Refetch every time the tab regains focus, e.g. after creating an invoice.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const fyMonth = await getFiscalYearStartMonth(db)
        const [r, i, o, l, rec] = await Promise.all([
          getTotalReceivables(db),
          getTotalInvoicedThisFY(db, fyMonth),
          getOverdueCount(db),
          getLowStockCount(db),
          getRecentInvoices(db, 5),
        ])
        setReceivables(r)
        setInvoicedFY(i)
        setOverdueCount(o)
        setLowStockCount(l)
        setRecent(rec)
      })()
    }, [db]),
  )

  const firstName = user?.name?.split(' ')[0] ?? 'there'

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.greeting}>
        <ThemedText type="title">Hi {firstName}</ThemedText>
        <ThemedText style={styles.dateText}>{formatDate(new Date())}</ThemedText>
      </View>

      <View style={styles.metricGrid}>
        <View style={styles.metricCol}>
          <MetricCard
            label="Receivables"
            value={formatCurrency(receivables)}
            tone="green"
            iconName="wallet.pass.fill"
            to="/(tabs)/invoices"
          />
        </View>
        <View style={styles.metricCol}>
          <MetricCard
            label="Invoiced (FY)"
            value={formatCurrency(invoicedFY)}
            tone="blue"
            iconName="chart.line.uptrend.xyaxis"
            to="/(tabs)/invoices"
          />
        </View>
        <View style={styles.metricCol}>
          <MetricCard
            label="Overdue"
            value={overdueCount}
            tone="rose"
            iconName="exclamationmark.triangle.fill"
            to="/(tabs)/invoices"
            hint={overdueCount ? 'Need follow-up' : 'Nothing overdue'}
          />
        </View>
        <View style={styles.metricCol}>
          <MetricCard
            label="Low Stock"
            value={lowStockCount}
            tone="orange"
            iconName="cube.fill"
            to="/(tabs)/items"
            hint={lowStockCount ? 'Below threshold' : 'All in stock'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle">Recent Invoices</ThemedText>
          <Pressable onPress={() => router.push('/(tabs)/invoices')}>
            <ThemedText style={styles.viewAll}>View all →</ThemedText>
          </Pressable>
        </View>
        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.sectionBody}>
          {recent.length === 0 ? (
            <ThemedText style={styles.emptyText}>No invoices yet.</ThemedText>
          ) : (
            recent.map((inv, idx) => (
              <RecentInvoiceRow key={inv.id} row={inv} divider={idx > 0} />
            ))
          )}
        </ThemedView>
      </View>

      <View style={styles.section}>
        <ThemedText type="subtitle">Quick Actions</ThemedText>
        <View style={styles.actionGrid}>
          <ActionTile
            iconName="doc.text.fill"
            label="New Invoice"
            onPress={() => router.push('/invoice/newInvoice')}
          />
          <ActionTile
            iconName="person.fill"
            label="New Customer"
            onPress={() => router.push('/customer/new')}
          />
          <ActionTile
            iconName="cube.fill"
            label="New Item"
            onPress={() => router.push('/item/newItem')}
          />
          <ActionTile
            iconName="cube.fill"
            label="All Items"
            onPress={() => router.push('/(tabs)/items')}
          />
        </View>
      </View>
    </ScrollView>
  )
}

function RecentInvoiceRow({
  row,
  divider,
}: {
  row: RecentInvoice
  divider: boolean
}) {
  const displayStatus = deriveDisplayStatus(
    row.status,
    row.dueDate,
    row.amountPaid,
    row.totalAmount,
  )
  const badge = STATUS_BADGE_COLORS[displayStatus] ?? STATUS_BADGE_COLORS.DRAFT

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/invoice/[id]', params: { id: row.id } })
      }
      style={({ pressed }) => [
        styles.recentRow,
        divider && styles.recentRowDivider,
        pressed && styles.pressedRow,
      ]}
    >
      <View style={styles.recentLeft}>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {row.invoiceNumber}
        </ThemedText>
        <ThemedText numberOfLines={1} style={styles.recentCustomer}>
          {row.customerName ?? 'Unknown customer'}
        </ThemedText>
      </View>
      <View style={styles.recentRight}>
        <ThemedText type="defaultSemiBold">
          {formatCurrency(row.totalAmount)}
        </ThemedText>
        <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
          <ThemedText style={[styles.statusBadgeText, { color: badge.text }]}>
            {formatInvoiceStatus(displayStatus)}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  )
}

function ActionTile({
  iconName,
  label,
  onPress,
}: {
  iconName: ComponentProps<typeof IconSymbol>['name']
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressedRow]}
    >
      <ThemedView lightColor="#f3f4f6" darkColor="#1f2937" style={styles.tileInner}>
        <IconSymbol name={iconName} size={24} color="#0a7ea4" />
        <ThemedText style={styles.tileLabel}>{label}</ThemedText>
      </ThemedView>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 60, paddingBottom: 32, gap: 20 },
  greeting: { gap: 4 },
  dateText: { opacity: 0.6, fontSize: 13 },
  // Negative horizontal margin on the grid + positive padding on each col gives
  // a clean 12px gutter between cards without padding the grid container itself.
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  metricCol: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
  section: { gap: 12 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewAll: { color: '#0a7ea4', fontWeight: '500' },
  sectionBody: { borderRadius: 12, paddingVertical: 4 },
  emptyText: { textAlign: 'center', paddingVertical: 20, opacity: 0.6 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 12,
  },
  recentRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d1d5db',
  },
  pressedRow: { opacity: 0.7 },
  recentLeft: { flex: 1, gap: 2 },
  recentRight: { alignItems: 'flex-end', gap: 4 },
  recentCustomer: { fontSize: 12, opacity: 0.6 },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: '600' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  tile: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
  tileInner: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  tileLabel: { fontSize: 13, fontWeight: '500' },
})
