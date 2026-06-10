import { router, useFocusEffect } from 'expo-router'
import { type ComponentProps, useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import MetricCard from '@/components/MetricCard'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { Screen } from '@/components/ui/Screen'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { IconSymbol } from '@/components/ui/icon-symbol'
import { useAuth } from '@/auth'
import { Radius, Spacing, Type } from '@/constants/tokens'
import { useDb } from '@/db'
import { useColors } from '@/hooks/use-colors'
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
  const c = useColors()
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
    <Screen>
      <View style={styles.greeting}>
        <Text style={[Type.title, { color: c.text }]}>Hi {firstName}</Text>
        <Text style={[Type.caption, { color: c.muted }]}>
          {formatDate(new Date())}
        </Text>
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

      <Card>
        <SectionHeader
          title="Recent Invoices"
          action={
            <Pressable
              onPress={() => router.push('/(tabs)/invoices')}
              hitSlop={8}
            >
              <Text style={[Type.label, { color: c.accentDeep }]}>
                View all →
              </Text>
            </Pressable>
          }
        />
        {recent.length === 0 ? (
          <Text style={[Type.body, styles.emptyText, { color: c.muted }]}>
            No invoices yet.
          </Text>
        ) : (
          recent.map((inv, idx) => (
            <RecentInvoiceRow key={inv.id} row={inv} divider={idx > 0} />
          ))
        )}
      </Card>

      <View style={styles.section}>
        <Text style={[Type.subtitle, { color: c.text }]}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          <ActionTile
            iconName="doc.text.fill"
            label="New Invoice"
            onPress={() => router.push('/invoice/newInvoice')}
          />
          <ActionTile
            iconName="person.fill"
            label="New Customer"
            onPress={() => router.push('/customer/newCustomer')}
          />
          <ActionTile
            iconName="cube.fill"
            label="New Item"
            onPress={() => router.push('/item/newItem')}
          />
          <ActionTile
            iconName="chart.line.uptrend.xyaxis"
            label="Reports"
            onPress={() => router.push('/reports' as never)}
          />
        </View>
      </View>
    </Screen>
  )
}

function RecentInvoiceRow({
  row,
  divider,
}: {
  row: RecentInvoice
  divider: boolean
}) {
  const c = useColors()
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
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
        pressed && styles.pressedRow,
      ]}
    >
      <View style={styles.recentLeft}>
        <Text
          style={[Type.bodySemibold, { color: c.text }]}
          numberOfLines={1}
        >
          {row.invoiceNumber}
        </Text>
        <Text
          numberOfLines={1}
          style={[Type.caption, { color: c.muted }]}
        >
          {row.customerName ?? 'Unknown customer'}
        </Text>
      </View>
      <View style={styles.recentRight}>
        <Text style={[Type.bodySemibold, { color: c.text }]}>
          {formatCurrency(row.totalAmount)}
        </Text>
        <Chip
          bg={badge.bg}
          color={badge.text}
          label={formatInvoiceStatus(displayStatus)}
        />
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
  const c = useColors()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressedRow]}
    >
      <View
        style={[
          styles.tileInner,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
          },
        ]}
      >
        <View style={[styles.tileIcon, { backgroundColor: c.accent }]}>
          <IconSymbol name={iconName} size={22} color={c.accentInk} />
        </View>
        <Text style={[Type.label, { color: c.text }]}>{label}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  greeting: { gap: Spacing.xs },
  // Negative horizontal margin on the grid + positive padding on each col gives
  // a clean gutter between cards without padding the grid container itself.
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -Spacing.xs },
  metricCol: { width: '50%', paddingHorizontal: Spacing.xs, marginBottom: Spacing.md },
  section: { gap: Spacing.md },
  emptyText: { textAlign: 'center', paddingVertical: Spacing.xl },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  pressedRow: { opacity: 0.7 },
  recentLeft: { flex: 1, gap: Spacing.xs / 2 },
  recentRight: { alignItems: 'flex-end', gap: Spacing.xs },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -Spacing.xs },
  tile: { width: '50%', paddingHorizontal: Spacing.xs, marginBottom: Spacing.md },
  tileInner: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
