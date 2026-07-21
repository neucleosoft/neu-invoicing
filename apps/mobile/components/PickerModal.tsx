// Shared picker modal — the ONE implementation of the {key,label} picker that
// used to be copy-pasted as a local function in every document form screen.
// Long lists get a search box for free (PickerSearchList → the shared
// matching brain in @neu/shared); short ones (status, transport, payment
// mode) look exactly like before. `sublabel` renders a second line AND is
// searchable — pass a customer's phone or an item's HSN through it.

import { Modal, Pressable, StyleSheet, View } from 'react-native'

import { PickerSearchList } from '@/components/PickerSearchList'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'

export type PickerModalOption = { key: string; label: string; sublabel?: string }

export function PickerModal({
  visible,
  title,
  data,
  selectedKey,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  data: PickerModalOption[]
  selectedKey: string
  onSelect: (k: string) => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <ThemedView style={styles.modalContent}>
          <ThemedText type="title" style={styles.modalTitle}>{title}</ThemedText>
          <PickerSearchList
            data={data}
            getName={(o) => o.label}
            getExtra={(o) => [o.sublabel]}
            keyExtractor={(o: PickerModalOption) => o.key}
            ListEmptyComponent={<ThemedText style={styles.modalEmpty}>Nothing here yet.</ThemedText>}
            renderItem={({ item }) => (
              <Pressable style={styles.modalRow} onPress={() => { onSelect(item.key); onClose() }}>
                <ThemedText type={item.key === selectedKey ? 'defaultSemiBold' : undefined}>
                  {item.key === selectedKey ? `✓ ${item.label}` : item.label}
                </ThemedText>
                {item.sublabel ? (
                  <ThemedText style={styles.modalRowSub}>{item.sublabel}</ThemedText>
                ) : null}
              </Pressable>
            )}
          />
          <Pressable style={styles.modalClose} onPress={onClose}>
            <ThemedText style={styles.modalCloseText}>Cancel</ThemedText>
          </Pressable>
        </ThemedView>
      </View>
    </Modal>
  )
}

// Style names mirror the old local implementations.
const styles = StyleSheet.create({
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { maxHeight: '70%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  modalTitle: { marginBottom: 12 },
  modalEmpty: { textAlign: 'center', paddingVertical: 24, opacity: 0.6 },
  modalRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.25)' },
  modalRowSub: { fontSize: 13, opacity: 0.6, marginTop: 2 },
  modalClose: { paddingVertical: 14, alignItems: 'center' },
  modalCloseText: { fontWeight: '600', opacity: 0.7 },
})
