import { asc, desc } from 'drizzle-orm'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'

import EmptyState from '@/components/EmptyState'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'
import { formatCurrency } from '@/utils/currency'
import { formatDate } from '@/utils/date'
import {
  createPayment,
  deletePayment,
  updatePayment,
  type PaymentInput,
} from '@/utils/paymentSave'

type Payment = typeof schema.paymentTransaction.$inferSelect
type Customer = typeof schema.customer.$inferSelect
type Supplier = typeof schema.supplier.$inferSelect

type Filter = 'ALL' | 'PAYMENT_IN' | 'PAYMENT_OUT'
const PAYMENT_MODES = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'UPI', 'OTHER'] as const

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function PaymentsScreen() {
  const db = useDb()
  const [payments, setPayments] = useState<Payment[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [filter, setFilter] = useState<Filter>('ALL')

  // Modal / form state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [type, setType] = useState<'PAYMENT_IN' | 'PAYMENT_OUT'>('PAYMENT_IN')
  const [counterPartyId, setCounterPartyId] = useState('')
  const [amount, setAmount] = useState('0')
  const [paymentMode, setPaymentMode] = useState<string>('CASH')
  const [paymentDate, setPaymentDate] = useState(todayStr())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [showPartyPicker, setShowPartyPicker] = useState(false)
  const [showModePicker, setShowModePicker] = useState(false)

  const reload = useCallback(() => {
    Promise.all([
      db.select().from(schema.paymentTransaction).orderBy(desc(schema.paymentTransaction.paymentDate)),
      db.select().from(schema.customer).orderBy(asc(schema.customer.name)),
      db.select().from(schema.supplier).orderBy(asc(schema.supplier.name)),
    ]).then(([p, c, s]) => {
      setPayments(p)
      setCustomers(c)
      setSuppliers(s)
    })
  }, [db])

  useFocusEffect(reload)

  // Name lookups so each row can show its party without an N+1 query.
  const partyName = useMemo(() => {
    const m = new Map<string, string>()
    customers.forEach((c) => m.set(c.id, c.name))
    suppliers.forEach((s) => m.set(s.id, s.name))
    return (p: Payment) => {
      const id = p.type === 'PAYMENT_IN' ? p.customerId : p.supplierId
      return (id && m.get(id)) || 'Unknown'
    }
  }, [customers, suppliers])

  const filtered = useMemo(
    () => (filter === 'ALL' ? payments : payments.filter((p) => p.type === filter)),
    [payments, filter],
  )

  // The party options depend on direction: customers for IN, suppliers for OUT.
  const partyOptions = type === 'PAYMENT_IN' ? customers : suppliers
  const selectedPartyName = partyOptions.find((p) => p.id === counterPartyId)?.name ?? ''

  function openCreate(t: 'PAYMENT_IN' | 'PAYMENT_OUT') {
    setEditingId(null)
    setType(t)
    setCounterPartyId('')
    setAmount('0')
    setPaymentMode('CASH')
    setPaymentDate(todayStr())
    setNotes('')
    setShowModal(true)
  }

  function openEdit(p: Payment) {
    setEditingId(p.id)
    setType(p.type as 'PAYMENT_IN' | 'PAYMENT_OUT')
    setCounterPartyId((p.type === 'PAYMENT_IN' ? p.customerId : p.supplierId) ?? '')
    setAmount(String(p.amount))
    setPaymentMode(p.paymentMode)
    setPaymentDate(new Date(p.paymentDate).toISOString().slice(0, 10))
    setNotes(p.notes ?? '')
    setShowModal(true)
  }

  async function handleSave() {
    if (!counterPartyId) {
      Alert.alert('Validation', `Please select a ${type === 'PAYMENT_IN' ? 'customer' : 'supplier'}`)
      return
    }
    const amt = parseFloat(amount) || 0
    if (amt <= 0) {
      Alert.alert('Validation', 'Amount must be greater than 0')
      return
    }
    setSaving(true)
    try {
      const parsedDate = new Date(paymentDate)
      const input: PaymentInput = {
        type,
        customerId: type === 'PAYMENT_IN' ? counterPartyId : null,
        supplierId: type === 'PAYMENT_OUT' ? counterPartyId : null,
        amount: amt,
        paymentMode,
        paymentDate: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
        notes: notes.trim() || null,
      }
      if (editingId) {
        await updatePayment(db, editingId, input)
      } else {
        await createPayment(db, input)
      }
      setShowModal(false)
      reload()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save payment')
    } finally {
      setSaving(false)
    }
  }

  function handleDelete(p: Payment) {
    Alert.alert(
      'Delete payment',
      'This reverses the party balance (and any linked invoice/bill). Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePayment(db, p.id)
              reload()
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete')
            }
          },
        },
      ],
    )
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Payments</ThemedText>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={[styles.addBtn, styles.addIn]} onPress={() => openCreate('PAYMENT_IN')}>
          <ThemedText style={styles.addInText}>+ Payment In</ThemedText>
        </Pressable>
        <Pressable style={[styles.addBtn, styles.addOut]} onPress={() => openCreate('PAYMENT_OUT')}>
          <ThemedText style={styles.addOutText}>+ Payment Out</ThemedText>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {(['ALL', 'PAYMENT_IN', 'PAYMENT_OUT'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
          >
            <ThemedText style={filter === f ? styles.filterChipTextActive : styles.filterChipText}>
              {f.replace('_', ' ')}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <EmptyState
            title="No payments yet"
            description="Record money received from customers or paid to suppliers."
          />
        }
        renderItem={({ item }) => {
          const isIn = item.type === 'PAYMENT_IN'
          return (
            <Pressable onPress={() => openEdit(item)} style={({ pressed }) => [pressed && styles.cardPressed]}>
              <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
                <View style={styles.cardLeft}>
                  <ThemedText type="defaultSemiBold" numberOfLines={1}>{partyName(item)}</ThemedText>
                  <ThemedText style={styles.metaText}>
                    {formatDate(item.paymentDate)} · {item.paymentMode.replace('_', ' ')}
                  </ThemedText>
                  {item.notes ? (
                    <ThemedText style={styles.notesText} numberOfLines={1}>{item.notes}</ThemedText>
                  ) : null}
                </View>
                <View style={styles.cardRight}>
                  <ThemedText type="defaultSemiBold" style={{ color: isIn ? '#16a34a' : '#dc2626' }}>
                    {isIn ? '+' : '−'}{formatCurrency(item.amount)}
                  </ThemedText>
                  <View style={[styles.typeBadge, { backgroundColor: isIn ? '#dcfce7' : '#fee2e2' }]}>
                    <ThemedText style={[styles.typeBadgeText, { color: isIn ? '#166534' : '#991b1b' }]}>
                      {isIn ? 'IN' : 'OUT'}
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => handleDelete(item)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.delChip, pressed && styles.delChipPressed]}
                  >
                    <ThemedText style={styles.delChipText}>Delete</ThemedText>
                  </Pressable>
                </View>
              </ThemedView>
            </Pressable>
          )
        }}
      />

      {/* Create / Edit modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              {editingId ? 'Edit' : 'Record'} {type === 'PAYMENT_IN' ? 'Payment In' : 'Payment Out'}
            </ThemedText>

            <ThemedText style={styles.label}>
              {type === 'PAYMENT_IN' ? 'Customer' : 'Supplier'} *
            </ThemedText>
            <Pressable
              style={[styles.picker, editingId && styles.pickerLocked]}
              onPress={() => !editingId && setShowPartyPicker(true)}
            >
              <ThemedText style={counterPartyId ? undefined : styles.placeholder}>
                {counterPartyId ? selectedPartyName : `Select ${type === 'PAYMENT_IN' ? 'customer' : 'supplier'}`}
              </ThemedText>
            </Pressable>

            <ThemedText style={styles.label}>Amount *</ThemedText>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholderTextColor="#999"
            />

            <ThemedText style={styles.label}>Payment Mode</ThemedText>
            <Pressable style={styles.picker} onPress={() => setShowModePicker(true)}>
              <ThemedText>{paymentMode.replace('_', ' ')}</ThemedText>
            </Pressable>

            <ThemedText style={styles.label}>Date (YYYY-MM-DD)</ThemedText>
            <TextInput
              style={styles.input}
              value={paymentDate}
              onChangeText={setPaymentDate}
              placeholder="2026-06-01"
              placeholderTextColor="#999"
            />

            <ThemedText style={styles.label}>Notes</ThemedText>
            <TextInput
              style={styles.input}
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional"
              placeholderTextColor="#999"
              multiline
            />

            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <ThemedText style={styles.cancelBtnText}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                <ThemedText style={styles.saveBtnText}>
                  {saving ? 'Saving…' : editingId ? 'Update' : 'Record'}
                </ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>

      {/* Party picker */}
      <Modal visible={showPartyPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              Select {type === 'PAYMENT_IN' ? 'Customer' : 'Supplier'}
            </ThemedText>
            <FlatList
              data={partyOptions}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setCounterPartyId(item.id)
                    setShowPartyPicker(false)
                  }}
                >
                  <ThemedText type={item.id === counterPartyId ? 'defaultSemiBold' : undefined}>
                    {item.name}
                  </ThemedText>
                  <ThemedText style={styles.partyBalance}>
                    Balance: {formatCurrency(Math.abs(item.currentBalance))}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowPartyPicker(false)}>
              <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>

      {/* Mode picker */}
      <Modal visible={showModePicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Payment Mode</ThemedText>
            <FlatList
              data={PAYMENT_MODES}
              keyExtractor={(m) => m}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    setPaymentMode(item)
                    setShowModePicker(false)
                  }}
                >
                  <ThemedText type={item === paymentMode ? 'defaultSemiBold' : undefined}>
                    {item === paymentMode ? `✓ ${item.replace('_', ' ')}` : item.replace('_', ' ')}
                  </ThemedText>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowModePicker(false)}>
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
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  addBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1 },
  addIn: { borderColor: '#16a34a' },
  addInText: { color: '#16a34a', fontWeight: '600' },
  addOut: { borderColor: '#dc2626' },
  addOutText: { color: '#dc2626', fontWeight: '600' },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
  },
  filterChipActive: { backgroundColor: '#007AFF' },
  filterChipText: { fontSize: 13, color: '#374151' },
  filterChipTextActive: { fontSize: 13, color: 'white', fontWeight: '600' },
  listContent: { paddingBottom: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    gap: 12,
  },
  cardPressed: { opacity: 0.7 },
  cardLeft: { flex: 1, gap: 3 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  metaText: { fontSize: 12, opacity: 0.6 },
  notesText: { fontSize: 12, opacity: 0.5 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadgeText: { fontSize: 10, fontWeight: '600' },
  delChip: { paddingHorizontal: 6, paddingVertical: 2 },
  delChipPressed: { opacity: 0.5 },
  delChipText: { fontSize: 12, fontWeight: '600', color: '#dc2626' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { maxHeight: '85%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  modalTitle: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 8 },
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
  pickerLocked: { borderColor: '#ccc', backgroundColor: '#f0f0f0' },
  placeholder: { opacity: 0.5 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  cancelBtnText: { fontSize: 16, fontWeight: '600' },
  saveBtn: {
    flex: 2,
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
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
