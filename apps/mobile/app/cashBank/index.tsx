import { asc, eq, sql } from 'drizzle-orm'
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

type Account = typeof schema.bankAccount.$inferSelect

// Cash & Bank is a STANDALONE manual ledger — payments do NOT flow into it
// (mirrors desktop: paymentMode is just a label, balances only change via the
// Adjust action below). Two account types: CASH and BANK.
export default function CashBankScreen() {
  const db = useDb()
  const [accounts, setAccounts] = useState<Account[]>([])

  // Add/edit account modal
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<'CASH' | 'BANK'>('CASH')
  const [accountNumber, setAccountNumber] = useState('')
  const [bankName, setBankName] = useState('')
  const [ifscCode, setIfscCode] = useState('')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [saving, setSaving] = useState(false)

  // Adjust-balance modal
  const [adjustId, setAdjustId] = useState<string | null>(null)
  const [adjustAmount, setAdjustAmount] = useState('0')

  const reload = useCallback(() => {
    db.select().from(schema.bankAccount).orderBy(asc(schema.bankAccount.name)).then(setAccounts)
  }, [db])

  useFocusEffect(reload)

  const totals = useMemo(() => {
    let cash = 0
    let bank = 0
    for (const a of accounts) {
      if (a.type === 'CASH') cash += a.currentBalance
      else if (a.type === 'BANK') bank += a.currentBalance
    }
    return { cash, bank, total: cash + bank }
  }, [accounts])

  const adjustingAccount = accounts.find((a) => a.id === adjustId) ?? null

  function openCreate() {
    setEditingId(null)
    setName('')
    setType('CASH')
    setAccountNumber('')
    setBankName('')
    setIfscCode('')
    setOpeningBalance('0')
    setShowModal(true)
  }

  function openEdit(a: Account) {
    setEditingId(a.id)
    setName(a.name)
    setType(a.type === 'BANK' ? 'BANK' : 'CASH')
    setAccountNumber(a.accountNumber ?? '')
    setBankName(a.bankName ?? '')
    setIfscCode(a.ifscCode ?? '')
    setOpeningBalance(String(a.currentBalance))
    setShowModal(true)
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Validation', 'Account name is required')
      return
    }
    setSaving(true)
    try {
      const isBank = type === 'BANK'
      if (editingId) {
        // Edit does NOT touch currentBalance (mirrors desktop — balance is owned
        // by the Adjust action / opening balance only).
        await db
          .update(schema.bankAccount)
          .set({
            name: name.trim(),
            type,
            accountNumber: isBank ? accountNumber.trim() || null : null,
            bankName: isBank ? bankName.trim() || null : null,
            ifscCode: isBank ? ifscCode.trim() || null : null,
          })
          .where(eq(schema.bankAccount.id, editingId))
      } else {
        await db.insert(schema.bankAccount).values({
          name: name.trim(),
          type,
          accountNumber: isBank ? accountNumber.trim() || null : null,
          bankName: isBank ? bankName.trim() || null : null,
          ifscCode: isBank ? ifscCode.trim() || null : null,
          currentBalance: parseFloat(openingBalance) || 0,
        })
      }
      setShowModal(false)
      reload()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save account')
    } finally {
      setSaving(false)
    }
  }

  function handleDelete(a: Account) {
    Alert.alert('Delete account', `Delete "${a.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await db.delete(schema.bankAccount).where(eq(schema.bankAccount.id, a.id))
            reload()
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete')
          }
        },
      },
    ])
  }

  function openAdjust(a: Account) {
    setAdjustId(a.id)
    setAdjustAmount('0')
  }

  async function handleAdjust() {
    if (!adjustId) return
    const amt = parseFloat(adjustAmount) || 0
    if (amt === 0) {
      Alert.alert('Validation', 'Amount cannot be zero (use + to add, − to subtract)')
      return
    }
    try {
      // Signed increment — positive adds, negative subtracts. Mirrors desktop
      // cashBank:adjustBalance.
      await db
        .update(schema.bankAccount)
        .set({ currentBalance: sql`${schema.bankAccount.currentBalance} + ${amt}` })
        .where(eq(schema.bankAccount.id, adjustId))
      setAdjustId(null)
      reload()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to adjust')
    }
  }

  const previewBalance =
    adjustingAccount != null
      ? adjustingAccount.currentBalance + (parseFloat(adjustAmount) || 0)
      : 0

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Cash & Bank</ThemedText>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard label="Cash" value={totals.cash} color="#16a34a" bg="#dcfce7" />
        <SummaryCard label="Bank" value={totals.bank} color="#1e40af" bg="#dbeafe" />
        <SummaryCard label="Total" value={totals.total} color="#6b21a8" bg="#f3e8ff" />
      </View>

      <Pressable style={styles.addAccountBtn} onPress={openCreate}>
        <ThemedText style={styles.addAccountText}>+ Add Account</ThemedText>
      </Pressable>

      <FlatList
        data={accounts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <EmptyState
            title="No accounts yet"
            description="Add your cash box and bank accounts to track balances."
            action={{ label: 'Add Account', onPress: openCreate }}
          />
        }
        renderItem={({ item }) => (
          <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.card}>
            <View style={styles.cardLeft}>
              <View style={styles.cardTitleRow}>
                <ThemedText type="defaultSemiBold" numberOfLines={1}>{item.name}</ThemedText>
                <View style={[styles.typeBadge, { backgroundColor: item.type === 'CASH' ? '#dcfce7' : '#dbeafe' }]}>
                  <ThemedText style={[styles.typeBadgeText, { color: item.type === 'CASH' ? '#166534' : '#1e40af' }]}>
                    {item.type}
                  </ThemedText>
                </View>
              </View>
              {item.type === 'BANK' && (item.bankName || item.accountNumber) ? (
                <ThemedText style={styles.metaText} numberOfLines={1}>
                  {[item.bankName, item.accountNumber].filter(Boolean).join(' · ')}
                </ThemedText>
              ) : null}
              <ThemedText
                type="defaultSemiBold"
                style={{ color: item.currentBalance >= 0 ? '#16a34a' : '#dc2626' }}
              >
                {formatCurrency(Math.abs(item.currentBalance))}{item.currentBalance < 0 ? ' (−)' : ''}
              </ThemedText>
            </View>
            <View style={styles.cardActions}>
              <Pressable onPress={() => openAdjust(item)} hitSlop={6} style={styles.actionChip}>
                <ThemedText style={styles.adjustText}>Adjust</ThemedText>
              </Pressable>
              <Pressable onPress={() => openEdit(item)} hitSlop={6} style={styles.actionChip}>
                <ThemedText style={styles.editText}>Edit</ThemedText>
              </Pressable>
              <Pressable onPress={() => handleDelete(item)} hitSlop={6} style={styles.actionChip}>
                <ThemedText style={styles.delText}>Delete</ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        )}
      />

      {/* Add / Edit account modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              {editingId ? 'Edit' : 'Add'} Account
            </ThemedText>

            <ThemedText style={styles.label}>Account Name *</ThemedText>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Main Cash, HDFC Current"
              placeholderTextColor="#999"
            />

            <ThemedText style={styles.label}>Type</ThemedText>
            <View style={styles.segment}>
              {(['CASH', 'BANK'] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.segmentBtn, type === t && styles.segmentBtnActive]}
                  onPress={() => setType(t)}
                >
                  <ThemedText style={type === t ? styles.segmentTextActive : styles.segmentText}>{t}</ThemedText>
                </Pressable>
              ))}
            </View>

            {type === 'BANK' && (
              <>
                <ThemedText style={styles.label}>Account Number</ThemedText>
                <TextInput style={styles.input} value={accountNumber} onChangeText={setAccountNumber} placeholderTextColor="#999" />
                <ThemedText style={styles.label}>Bank Name</ThemedText>
                <TextInput style={styles.input} value={bankName} onChangeText={setBankName} placeholderTextColor="#999" />
                <ThemedText style={styles.label}>IFSC Code</ThemedText>
                <TextInput
                  style={styles.input}
                  value={ifscCode}
                  onChangeText={(t) => setIfscCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={11}
                  placeholderTextColor="#999"
                />
              </>
            )}

            {!editingId && (
              <>
                <ThemedText style={styles.label}>Opening Balance</ThemedText>
                <TextInput
                  style={styles.input}
                  value={openingBalance}
                  onChangeText={setOpeningBalance}
                  keyboardType="numeric"
                  placeholderTextColor="#999"
                />
              </>
            )}

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
                  {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
                </ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>

      {/* Adjust balance modal */}
      <Modal visible={adjustId != null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>Adjust Balance</ThemedText>
            {adjustingAccount ? (
              <>
                <ThemedText style={styles.adjustAccount}>{adjustingAccount.name}</ThemedText>
                <ThemedText style={styles.metaText}>
                  Current: {formatCurrency(Math.abs(adjustingAccount.currentBalance))}
                </ThemedText>
                <ThemedText style={styles.label}>Amount (+ add / − subtract)</ThemedText>
                <TextInput
                  style={styles.input}
                  value={adjustAmount}
                  onChangeText={setAdjustAmount}
                  keyboardType="numbers-and-punctuation"
                  placeholder="e.g. 5000 or -2000"
                  placeholderTextColor="#999"
                />
                {parseFloat(adjustAmount) ? (
                  <ThemedText style={styles.previewText}>
                    New balance: {formatCurrency(Math.abs(previewBalance))}{previewBalance < 0 ? ' (−)' : ''}
                  </ThemedText>
                ) : null}
              </>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setAdjustId(null)}>
                <ThemedText style={styles.cancelBtnText}>Cancel</ThemedText>
              </Pressable>
              <Pressable style={styles.saveBtn} onPress={handleAdjust}>
                <ThemedText style={styles.saveBtnText}>Adjust</ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  )
}

function SummaryCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <View style={[styles.summaryCard, { backgroundColor: bg }]}>
      <ThemedText style={[styles.summaryLabel, { color }]}>{label}</ThemedText>
      <ThemedText style={[styles.summaryValue, { color }]}>{formatCurrency(value)}</ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  summaryCard: { flex: 1, padding: 12, borderRadius: 12, gap: 4 },
  summaryLabel: { fontSize: 12, fontWeight: '600' },
  summaryValue: { fontSize: 16, fontWeight: '700' },
  addAccountBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
    marginBottom: 12,
  },
  addAccountText: { color: '#007AFF', fontWeight: '600' },
  listContent: { paddingBottom: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    gap: 12,
  },
  cardLeft: { flex: 1, gap: 3 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 12, opacity: 0.6 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadgeText: { fontSize: 10, fontWeight: '600' },
  cardActions: { alignItems: 'flex-end', gap: 6 },
  actionChip: { paddingHorizontal: 4, paddingVertical: 1 },
  adjustText: { fontSize: 13, fontWeight: '600', color: '#7c3aed' },
  editText: { fontSize: 13, fontWeight: '600', color: '#007AFF' },
  delText: { fontSize: 13, fontWeight: '600', color: '#dc2626' },
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
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 4,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: '#007AFF' },
  segmentText: { color: '#007AFF', fontSize: 14 },
  segmentTextActive: { color: 'white', fontSize: 14 },
  adjustAccount: { fontSize: 16, fontWeight: '600' },
  previewText: { fontSize: 13, opacity: 0.7, marginTop: 8 },
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
})
