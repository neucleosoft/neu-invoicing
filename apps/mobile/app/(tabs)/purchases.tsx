import { router } from 'expo-router'
import { type ComponentProps } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { IconSymbol } from '@/components/ui/icon-symbol'

// The purchase side of the app is its own little world (suppliers, their
// catalogs, and the bills you get from them). Rather than spend three more tab
// slots on it, this single "Purchases" tab is a hub that routes into each one.
type HubCard = {
  title: string
  subtitle: string
  icon: ComponentProps<typeof IconSymbol>['name']
  route: string
  // Cards light up phase by phase. A disabled card shows a "Soon" chip and
  // does nothing on press, so the hub stays stable while the rest is built.
  enabled: boolean
}

const CARDS: HubCard[] = [
  {
    title: 'Purchase Bills',
    subtitle: 'Record what you buy from suppliers',
    icon: 'doc.text.fill',
    route: '/purchase',
    enabled: true,
  },
  {
    title: 'Suppliers',
    subtitle: 'People and businesses you buy from',
    icon: 'person.fill',
    route: '/supplier',
    enabled: true,
  },
  {
    title: 'Supplier Items',
    subtitle: "Each supplier's catalog and prices",
    icon: 'cube.fill',
    route: '/supplierItem',
    enabled: true,
  },
]

export default function PurchasesHubScreen() {
  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Purchases</ThemedText>
      </View>
      <ScrollView contentContainerStyle={styles.listContent}>
        {CARDS.map((card) => (
          <HubRow key={card.title} card={card} />
        ))}
      </ScrollView>
    </ThemedView>
  )
}

function HubRow({ card }: { card: HubCard }) {
  return (
    <Pressable
      disabled={!card.enabled}
      onPress={() => router.push(card.route as never)}
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <ThemedView
        lightColor="#f9fafb"
        darkColor="#1f2937"
        style={[styles.card, !card.enabled && styles.cardDisabled]}
      >
        <View style={styles.iconWrap}>
          <IconSymbol name={card.icon} size={24} color="#0a7ea4" />
        </View>
        <View style={styles.cardText}>
          <ThemedText type="defaultSemiBold">{card.title}</ThemedText>
          <ThemedText style={styles.subtitle}>{card.subtitle}</ThemedText>
        </View>
        {card.enabled ? (
          <IconSymbol name="chevron.right" size={20} color="#9ca3af" />
        ) : (
          <View style={styles.soonChip}>
            <ThemedText style={styles.soonChipText}>Soon</ThemedText>
          </View>
        )}
      </ThemedView>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { marginBottom: 16 },
  listContent: { paddingBottom: 96, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 14,
  },
  cardPressed: { opacity: 0.7 },
  cardDisabled: { opacity: 0.55 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,126,164,0.12)',
  },
  cardText: { flex: 1, gap: 2 },
  subtitle: { fontSize: 12, opacity: 0.6 },
  soonChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
  },
  soonChipText: { fontSize: 11, fontWeight: '600', color: '#6b7280' },
})
