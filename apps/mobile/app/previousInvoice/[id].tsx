import { eq } from 'drizzle-orm'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'

type PreviousInvoice = typeof schema.previousInvoice.$inferSelect

export default function PreviousInvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()

  const [invoice, setInvoice] = useState<PreviousInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  // Data URI of the archived file, built once from the stored blob.
  const [fileUri, setFileUri] = useState<string | null>(null)
  const [showFile, setShowFile] = useState(false)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    async function load() {
      const [inv] = await db
        .select()
        .from(schema.previousInvoice)
        .where(eq(schema.previousInvoice.id, id))
        .limit(1)
      if (!inv) {
        setLoading(false)
        return
      }
      setInvoice(inv)

      // The blob comes back as a Buffer (via the global polyfill); turn it into
      // a data URI so expo-image can render it. fileData is NOT NULL so it's
      // always present, but guard on the mime type to be safe.
      if (inv.fileData && inv.fileMimeType) {
        const buf = inv.fileData as unknown as { toString: (enc: string) => string }
        const base64 = buf.toString('base64')
        setFileUri(`data:${inv.fileMimeType};base64,${base64}`)
      }
      setLoading(false)
    }
    load()
  }, [id, db])

  function handleDelete() {
    if (!id) return
    Alert.alert(
      'Delete previous invoice',
      'This removes the archived record and its uploaded file. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Items cascade-delete via the FK; clear them explicitly too to be safe.
              await db.delete(schema.previousInvoiceItem).where(eq(schema.previousInvoiceItem.previousInvoiceId, id))
              await db.delete(schema.previousInvoice).where(eq(schema.previousInvoice.id, id))
              router.back()
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete')
            }
          },
        },
      ],
    )
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }

  if (!invoice) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Previous invoice not found</ThemedText>
          <ThemedText style={styles.muted}>This record may have been deleted.</ThemedText>
        </View>
      </ThemedView>
    )
  }

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title">{invoice.invoiceNumber}</ThemedText>
            <ThemedText style={styles.muted}>{invoice.partyName}</ThemedText>
            {invoice.serialNumber != null ? (
              <ThemedText style={styles.muted}>Archive #{invoice.serialNumber}</ThemedText>
            ) : null}
          </View>
          <View style={styles.heroRight}>
            <ThemedText type="defaultSemiBold" style={styles.heroTotal}>
              {formatCurrency(invoice.totalAmount)}
            </ThemedText>
          </View>
        </ThemedView>

        <Section title="Invoice">
          <Row label="Date" value={formatDate(invoice.invoiceDate)} />
          <Row label="Party" value={invoice.partyName} />
          {invoice.partyGstin ? <Row label="Party GSTIN" value={invoice.partyGstin} /> : null}
          <Row label="Total" value={formatCurrency(invoice.totalAmount)} />
        </Section>

        <Section title="File">
          <Row label="Name" value={invoice.fileName} />
          <Row label="Type" value={invoice.fileMimeType} />
        </Section>

        {invoice.notes ? (
          <Section title="Notes">
            <ThemedText style={styles.notesText}>{invoice.notes}</ThemedText>
          </Section>
        ) : null}

        {fileUri ? (
          <Pressable style={styles.fileButton} onPress={() => setShowFile(true)}>
            <ThemedText style={styles.fileButtonText}>View attached file</ThemedText>
          </Pressable>
        ) : null}

        <Pressable style={styles.deleteButton} onPress={handleDelete}>
          <ThemedText style={styles.deleteButtonText}>Delete previous invoice</ThemedText>
        </Pressable>
      </ScrollView>

      {fileUri ? (
        <Modal visible={showFile} transparent animationType="fade">
          <Pressable style={styles.fileOverlay} onPress={() => setShowFile(false)}>
            <Image source={{ uri: fileUri }} style={styles.fileFull} contentFit="contain" />
            <ThemedText style={styles.fileCloseHint}>Tap anywhere to close</ThemedText>
          </Pressable>
        </Modal>
      ) : null}
    </ThemedView>
  )
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerButton} hitSlop={8}>
        <ThemedText style={styles.headerArrow}>←</ThemedText>
      </Pressable>
      <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
        Previous Invoice
      </ThemedText>
      <View style={styles.headerButton} />
    </View>
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
  headerButton: { paddingVertical: 6, paddingHorizontal: 10 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  centered: { textAlign: 'center', marginTop: 64 },
  centeredBlock: { alignItems: 'center', marginTop: 64, gap: 8, paddingHorizontal: 32 },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  heroLeft: { flex: 1, gap: 4 },
  heroRight: { alignItems: 'flex-end' },
  heroTotal: { fontSize: 22 },
  muted: { opacity: 0.6, fontSize: 13 },
  notesText: { fontSize: 14, lineHeight: 20, paddingVertical: 4 },
  fileButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  fileButtonText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
  deleteButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  deleteButtonText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  fileOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  fileFull: { width: '100%', height: '85%' },
  fileCloseHint: { color: 'white', opacity: 0.7, marginTop: 12, fontSize: 13 },
})
