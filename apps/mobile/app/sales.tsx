import { router } from 'expo-router'
import { type ComponentProps } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { IconSymbol } from '@/components/ui/icon-symbol'

// Sales-documents hub. Invoices have their own tab; the sibling sales documents
// (quotations, proforma, challans, credit/debit notes, previous invoices) live
// here, reached from the Invoices tab's "Documents ▸" link. Same hub-card
// pattern as the Purchases tab. Cards light up as each feature is built.
type HubCard = {
  title: string
  subtitle: string
  icon: ComponentProps<typeof IconSymbol>['name']
  route: string
  enabled: boolean
}

const CARDS: HubCard[] = [
  { title: 'Quotations', subtitle: 'Price offers you can convert to invoices', icon: 'doc.text.fill', route: '/quotation', enabled: true },
  { title: 'Proforma Invoices', subtitle: 'Provisional invoices before the real one', icon: 'doc.text.fill', route: '/proforma', enabled: true },
  { title: 'Delivery Challans', subtitle: 'Goods-movement notes', icon: 'doc.text.fill', route: '/challan', enabled: true },
  { title: 'Credit / Debit Notes', subtitle: 'Adjustments against invoices', icon: 'doc.text.fill', route: '/creditNote', enabled: true },
  { title: 'Previous Invoices', subtitle: 'Archive of pre-app invoices', icon: 'doc.text.fill', route: '/previousInvoice', enabled: true },
]

export default function SalesHubScreen() {
  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={8}>
          <ThemedText style={styles.headerArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.headerTitle}>Sales Documents</ThemedText>
      </View>
      <ScrollView contentContainerStyle={styles.listContent}>
        {CARDS.map((card) => (
          <Pressable
            key={card.title}
            disabled={!card.enabled}
            onPress={() => router.push(card.route as never)}
            style={({ pressed }) => [pressed && styles.cardPressed]}
          >
            <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={[styles.card, !card.enabled && styles.cardDisabled]}>
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
                <View style={styles.soonChip}><ThemedText style={styles.soonChipText}>Soon</ThemedText></View>
              )}
            </ThemedView>
          </Pressable>
        ))}
      </ScrollView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  headerButton: { paddingVertical: 6, paddingHorizontal: 4 },
  headerArrow: { fontSize: 28, fontWeight: '500', lineHeight: 30 },
  headerTitle: { flex: 1 },
  listContent: { paddingBottom: 96, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, gap: 14 },
  cardPressed: { opacity: 0.7 },
  cardDisabled: { opacity: 0.55 },
  iconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,126,164,0.12)' },
  cardText: { flex: 1, gap: 2 },
  subtitle: { fontSize: 12, opacity: 0.6 },
  soonChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#e5e7eb' },
  soonChipText: { fontSize: 11, fontWeight: '600', color: '#6b7280' },
})
