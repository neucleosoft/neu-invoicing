import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { schema, useDb } from '@/db'

type Item = typeof schema.item.$inferSelect

export default function ItemsScreen() {
  const db = useDb()
  const [items, setItems] = useState<Item[]>([])

  // Refetch whenever the screen comes into focus (e.g., after returning from the form).
  useFocusEffect(
    useCallback(() => {
      db.select().from(schema.item).then(setItems)
    }, [db])
  )

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Items</ThemedText>
        <Link href="/item/new" asChild>
          <Pressable style={styles.addButton}>
            <ThemedText style={styles.addButtonText}>+ Add</ThemedText>
          </Pressable>
        </Link>
      </View>

      <FlatList
        data={items}
        keyExtractor={(row) => row.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ThemedText>No items yet. Tap + Add to create one.</ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
              <ThemedText style={styles.subRow}>
                ₹{item.salePrice.toFixed(2)} / {item.unit} · {item.taxRate}% GST
              </ThemedText>
            </View>
            <ThemedText style={styles.typeBadge}>{item.type}</ThemedText>
          </View>
        )}
      />
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  addButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: { color: 'white', fontWeight: '600' },
  empty: { padding: 32, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#888',
    alignItems: 'center',
  },
  subRow: { fontSize: 13, opacity: 0.6, marginTop: 2 },
  typeBadge: { fontSize: 11, opacity: 0.6 },
})
