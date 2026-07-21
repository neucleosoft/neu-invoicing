import { eq, sql } from 'drizzle-orm'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { PdfActions } from '@/components/PdfActions'
import { Row, Section } from '@/components/DetailSection'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { buildCreditNotePdfPayload } from '@/utils/creditNotePdf'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'

type Note = typeof schema.creditDebitNote.$inferSelect
type NoteItem = typeof schema.creditDebitNoteItem.$inferSelect

export default function CreditNoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const db = useDb()
  const onEdit = () => router.push({ pathname: '/creditNote/edit/[id]', params: { id } })

  const [note, setNote] = useState<Note | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [refInvoiceNumber, setRefInvoiceNumber] = useState<string | null>(null)
  const [lines, setLines] = useState<(NoteItem & { name: string })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    async function load() {
      const [n] = await db.select().from(schema.creditDebitNote).where(eq(schema.creditDebitNote.id, id)).limit(1)
      if (!n) {
        setLoading(false)
        return
      }
      setNote(n)
      const [c] = await db.select({ name: schema.customer.name }).from(schema.customer).where(eq(schema.customer.id, n.customerId)).limit(1)
      setCustomerName(c?.name ?? 'Unknown')
      if (n.referenceInvoiceId) {
        const [inv] = await db.select({ num: schema.salesInvoice.invoiceNumber }).from(schema.salesInvoice).where(eq(schema.salesInvoice.id, n.referenceInvoiceId)).limit(1)
        setRefInvoiceNumber(inv?.num ?? null)
      }
      const its = await db.select().from(schema.creditDebitNoteItem).where(eq(schema.creditDebitNoteItem.creditDebitNoteId, id))
      const items = await db.select().from(schema.item)
      const nameById = new Map(items.map((i) => [i.id, i.name]))
      setLines(its.map((it) => ({ ...it, name: nameById.get(it.itemId) ?? 'Item' })))
      setLoading(false)
    }
    load()
  }, [id, db])

  function handleCancel() {
    if (!id) return
    Alert.alert(
      'Cancel note',
      'This reverses its balance effect (on the customer, and any linked invoice) and marks the note Cancelled for your records. It cannot be undone.',
      [
        { text: 'Keep note', style: 'cancel' },
        {
          text: 'Cancel note',
          style: 'destructive',
          onPress: async () => {
            try {
              // CANCEL (Mode B), not delete. Reverse the balance effect this note
              // applied — same math the old delete did — then stamp cancelledAt so
              // the row + its items STAY on record, marked Cancelled, forever.
              // reverseSign is the OPPOSITE of create (create used -1 CREDIT / +1 DEBIT).
              await db.transaction(async (tx) => {
                const [existing] = await tx.select().from(schema.creditDebitNote).where(eq(schema.creditDebitNote.id, id)).limit(1)
                if (!existing) throw new Error('Note not found')
                if (existing.cancelledAt) return // already cancelled — never reverse the balance twice
                const reverseSign = existing.type === 'CREDIT_NOTE' ? 1 : -1
                await tx
                  .update(schema.customer)
                  .set({ currentBalance: sql`${schema.customer.currentBalance} + ${reverseSign * existing.totalAmount}` })
                  .where(eq(schema.customer.id, existing.customerId))
                if (existing.referenceInvoiceId) {
                  await tx
                    .update(schema.salesInvoice)
                    .set({ balanceDue: sql`${schema.salesInvoice.balanceDue} + ${reverseSign * existing.totalAmount}` })
                    .where(eq(schema.salesInvoice.id, existing.referenceInvoiceId))
                }
                await tx
                  .update(schema.creditDebitNote)
                  .set({ cancelledAt: new Date() })
                  .where(eq(schema.creditDebitNote.id, id))
              })
              router.back()
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to cancel')
            }
          },
        },
      ],
    )
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!!note} />
        <ThemedText style={styles.centered}>Loading…</ThemedText>
      </ThemedView>
    )
  }
  if (!note) {
    return (
      <ThemedView style={styles.container}>
        <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={false} />
        <View style={styles.centeredBlock}>
          <ThemedText type="subtitle">Note not found</ThemedText>
        </View>
      </ThemedView>
    )
  }

  const typeLabel = note.type === 'CREDIT_NOTE' ? 'Credit Note' : 'Debit Note'
  const isCancelled = !!note.cancelledAt

  return (
    <ThemedView style={styles.container}>
      <Header onBack={() => router.back()} onEdit={onEdit} editEnabled={!isCancelled} />
      <ScrollView contentContainerStyle={styles.content}>
        {isCancelled ? (
          <ThemedView style={styles.cancelledBanner}>
            <ThemedText style={styles.cancelledBannerText}>
              This note is cancelled — its balance effect was reversed and it&apos;s left out of reports. It can&apos;t be restored.
            </ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.hero}>
          <View style={styles.heroLeft}>
            <ThemedText type="title">{note.noteNumber}</ThemedText>
            <ThemedText style={styles.muted}>{customerName}</ThemedText>
            <ThemedText style={styles.muted}>{typeLabel}</ThemedText>
          </View>
          <View style={styles.heroRight}>
            <ThemedText type="defaultSemiBold" style={styles.heroTotal}>{formatCurrency(note.totalAmount)}</ThemedText>
          </View>
        </ThemedView>

        <PdfActions buildPayload={() => buildCreditNotePdfPayload(db, id)} />

        <Section title="Note">
          <Row label="Type" value={typeLabel} />
          <Row label="Date" value={formatDate(note.noteDate)} />
          <Row label="Status" value={isCancelled ? 'Cancelled' : note.status} />
          {refInvoiceNumber ? <Row label="Reference Invoice" value={refInvoiceNumber} /> : null}
          {note.reason ? <Row label="Reason" value={note.reason} /> : null}
        </Section>

        <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.itemsCard}>
          <ThemedText type="defaultSemiBold" style={styles.itemsTitle}>Items ({lines.length})</ThemedText>
          {lines.map((l, idx) => (
            <View key={l.id} style={[styles.itemRow, idx > 0 && styles.itemRowDivider]}>
              <View style={styles.itemLeft}>
                <ThemedText numberOfLines={2}>{l.name}</ThemedText>
                <ThemedText style={styles.itemMeta}>{l.quantity} × {formatCurrency(l.rate)}{l.discount ? ` − ${formatCurrency(l.discount)}` : ''} · {l.taxRate}% tax</ThemedText>
              </View>
              <ThemedText type="defaultSemiBold">{formatCurrency(l.total)}</ThemedText>
            </View>
          ))}
        </ThemedView>

        <Section title="Totals">
          <Row label="Subtotal" value={formatCurrency(note.subtotal)} />
          <Row label="Tax" value={formatCurrency(note.taxAmount)} />
          <Row label="Total" value={formatCurrency(note.totalAmount)} />
        </Section>

        {note.notes ? <Section title="Notes"><ThemedText style={styles.notesText}>{note.notes}</ThemedText></Section> : null}

        {isCancelled ? null : (
          <Pressable style={styles.deleteButton} onPress={handleCancel}>
            <ThemedText style={styles.deleteButtonText}>Cancel note</ThemedText>
          </Pressable>
        )}
      </ScrollView>
    </ThemedView>
  )
}

function Header({ onBack, onEdit, editEnabled }: { onBack: () => void; onEdit: () => void; editEnabled: boolean }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.headerButton} hitSlop={8}><ThemedText style={styles.headerArrow}>←</ThemedText></Pressable>
      <ThemedText type="defaultSemiBold" style={styles.headerTitle}>Note</ThemedText>
      <Pressable onPress={onEdit} disabled={!editEnabled} style={[styles.headerButton, !editEnabled && styles.headerButtonDisabled]}>
        <ThemedText style={styles.headerButtonText}>Edit</ThemedText>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 10 },
  headerButtonDisabled: { opacity: 0.3 },
  headerButtonText: { fontSize: 16 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  centered: { textAlign: 'center', marginTop: 64 },
  centeredBlock: { alignItems: 'center', marginTop: 64, gap: 8, paddingHorizontal: 32 },
  hero: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, borderRadius: 12, gap: 12 },
  heroLeft: { flex: 1, gap: 4 },
  heroRight: { alignItems: 'flex-end' },
  heroTotal: { fontSize: 22 },
  muted: { opacity: 0.6, fontSize: 13 },
  itemsCard: { borderRadius: 12, padding: 14, gap: 4 },
  itemsTitle: { marginBottom: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: 12 },
  itemRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d1d5db' },
  itemLeft: { flex: 1, gap: 2 },
  itemMeta: { fontSize: 12, opacity: 0.6 },
  notesText: { fontSize: 14, lineHeight: 20, paddingVertical: 4 },
  deleteButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#FF3B30' },
  deleteButtonText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  cancelledBanner: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#fecaca' },
  cancelledBannerText: { color: '#991b1b', fontSize: 13, lineHeight: 18 },
})
