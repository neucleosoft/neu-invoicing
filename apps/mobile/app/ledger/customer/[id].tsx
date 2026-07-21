import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import LedgerView from '@/components/LedgerView'
import { PdfActions } from '@/components/PdfActions'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { buildCustomerLedger, type LedgerData } from '@/utils/ledger'
import { buildStatementPdfPayload } from '@/utils/statementPdf'

// Customer Ledger — the full running account for one customer (all-time, no date
// filter; the date-bounded variant is the Customer Statement). Mirrors desktop
// CustomerLedger.tsx: a Current Balance line + a table with an Opening row, one
// row per transaction, and a Total row. Reached from the customer detail screen's
// "View Ledger" action with the customer id.

type Customer = typeof schema.customer.$inferSelect

export default function CustomerLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [ledger, setLedger] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const rows = await db
          .select()
          .from(schema.customer)
          .where(eq(schema.customer.id, id))
          .limit(1)
        const c = rows[0] ?? null
        if (cancelled) return
        setCustomer(c)
        if (c) {
          const l = await buildCustomerLedger(db, c.id, c.openingBalance)
          if (!cancelled) setLedger(l)
        }
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, db])

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {customer?.name ?? 'Customer Ledger'}
          </ThemedText>
          <ThemedText style={styles.headerSubtitle}>Customer Ledger</ThemedText>
        </View>
      </View>

      {loading ? (
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      ) : error ? (
        <ThemedText style={[styles.centered, styles.errorText]}>Could not load the ledger.</ThemedText>
      ) : !customer ? (
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">No customer selected</ThemedText>
          <ThemedText style={styles.muted}>Open a ledger from a customer&apos;s detail screen.</ThemedText>
        </View>
      ) : ledger ? (
        <ScrollView contentContainerStyle={styles.content}>
          <PdfActions
            disabled={!ledger || !customer}
            buildPayload={async () =>
              ledger && customer
                ? buildStatementPdfPayload(db, {
                    ledger,
                    party: {
                      name: customer.name,
                      email: customer.email ?? undefined,
                      phone: customer.phone ?? undefined,
                      billingAddress: customer.billingAddress ?? undefined,
                      taxId: customer.taxId ?? undefined,
                    },
                    title: 'CUSTOMER LEDGER',
                  })
                : null
            }
          />
          <LedgerView
            data={ledger}
            summary="balance"
            debitLabel="Charges"
            creditLabel="Receipts"
            emptyText="No transactions yet for this customer."
          />
        </ScrollView>
      ) : null}
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitleWrap: { flex: 1 },
  headerSubtitle: { fontSize: 12, opacity: 0.6 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { textAlign: 'center', marginTop: 64 },
  errorText: { color: '#dc2626' },
  centeredBlock: { alignItems: 'center', marginTop: 64, gap: 8, paddingHorizontal: 32 },
  muted: { opacity: 0.6, textAlign: 'center' },
})
