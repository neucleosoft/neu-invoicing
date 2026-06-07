import { eq } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { HiddenPdfWebView, type HiddenPdfWebViewHandle } from '@/components/HiddenPdfWebView'
import LedgerView from '@/components/LedgerView'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { buildSupplierLedger, type LedgerData } from '@/utils/ledger'
import { buildStatementPdfPayload } from '@/utils/statementPdf'
import { saveAndSharePdf } from '@/utils/pdfShare'

// Supplier Ledger — the full running account for one supplier (all-time). Twin of
// the customer ledger; the debit side is purchase bills and the credit side is
// payments made (no credit/debit notes on the supplier side). Mirrors desktop
// SupplierLedger.tsx. Reached from the supplier detail screen's "View Ledger".

type Supplier = typeof schema.supplier.$inferSelect

export default function SupplierLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [ledger, setLedger] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const pdfRef = useRef<HiddenPdfWebViewHandle>(null)
  const [sharing, setSharing] = useState(false)

  async function handleSharePdf() {
    if (!ledger || !supplier || sharing) return
    setSharing(true)
    try {
      const payload = await buildStatementPdfPayload(db, {
        ledger,
        // The statement builder reads the party from `customer` even for a
        // supplier — put the supplier's details there.
        party: {
          name: supplier.name,
          email: supplier.email ?? undefined,
          phone: supplier.phone ?? undefined,
          billingAddress: supplier.billingAddress ?? undefined,
          taxId: supplier.taxId ?? undefined,
        },
        title: 'SUPPLIER LEDGER',
      })
      const base64 = await pdfRef.current!.generate(payload.builder, payload.data)
      await saveAndSharePdf(base64, payload.filename)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate PDF'
      Alert.alert(
        'PDF failed',
        // The WebView + sharing are native modules — a fresh `npx expo run:android`
        // is required after adding them, or generation can't run.
        `${msg}\n\nIf this is the first run after adding PDF support, rebuild the app (expo run:android).`,
      )
    } finally {
      setSharing(false)
    }
  }

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
          .from(schema.supplier)
          .where(eq(schema.supplier.id, id))
          .limit(1)
        const s = rows[0] ?? null
        if (cancelled) return
        setSupplier(s)
        if (s) {
          const l = await buildSupplierLedger(db, s.id, s.openingBalance)
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
            {supplier?.name ?? 'Supplier Ledger'}
          </ThemedText>
          <ThemedText style={styles.headerSubtitle}>Supplier Ledger</ThemedText>
        </View>
      </View>

      {loading ? (
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      ) : error ? (
        <ThemedText style={[styles.centered, styles.errorText]}>Could not load the ledger.</ThemedText>
      ) : !supplier ? (
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">No supplier selected</ThemedText>
          <ThemedText style={styles.muted}>Open a ledger from a supplier&apos;s detail screen.</ThemedText>
        </View>
      ) : ledger ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            style={[styles.shareButton, sharing && styles.shareButtonDisabled]}
            onPress={handleSharePdf}
            disabled={sharing}
          >
            {sharing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.shareButtonText}>Share PDF</ThemedText>
            )}
          </Pressable>
          <LedgerView
            data={ledger}
            summary="balance"
            debitLabel="Bills"
            creditLabel="Paid"
            emptyText="No transactions yet for this supplier."
          />
        </ScrollView>
      ) : null}
      {/* Off-screen pdfmake host — boots in the background, generates on demand. */}
      <HiddenPdfWebView ref={pdfRef} />
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
  shareButton: {
    backgroundColor: '#0a7ea4',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginBottom: 16,
  },
  shareButtonDisabled: { opacity: 0.6 },
  shareButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
