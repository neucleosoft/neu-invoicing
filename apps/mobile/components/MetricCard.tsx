import { router } from 'expo-router'
import type { ComponentProps } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { IconSymbol } from './ui/icon-symbol'
import { ThemedText } from './themed-text'

// Mirrors apps/desktop/src/components/MetricCard.tsx. Same six tones with the
// same semantic intent (green = receivables/positive, red = payables, blue =
// invoiced, orange = warnings, indigo = bank, rose = overdue), but resolved
// to literal hex pairs because RN has no Tailwind. Desktop uses gradient
// backgrounds; mobile uses solid tints to avoid adding expo-linear-gradient
// as a dependency. Light-mode only for now — dark mode would need a parallel
// TONE_DARK map.

type Tone = 'green' | 'red' | 'blue' | 'orange' | 'indigo' | 'rose'

interface ToneColors {
  bg: string
  label: string
  value: string
  iconBg: string
  iconFg: string
}

const TONE: Record<Tone, ToneColors> = {
  green: { bg: '#f0fdf4', label: '#15803d', value: '#166534', iconBg: '#bbf7d0', iconFg: '#15803d' },
  red: { bg: '#fef2f2', label: '#b91c1c', value: '#991b1b', iconBg: '#fecaca', iconFg: '#b91c1c' },
  blue: { bg: '#eff6ff', label: '#1d4ed8', value: '#1e3a8a', iconBg: '#bfdbfe', iconFg: '#1d4ed8' },
  orange: { bg: '#fff7ed', label: '#c2410c', value: '#9a3412', iconBg: '#fed7aa', iconFg: '#c2410c' },
  indigo: { bg: '#eef2ff', label: '#4338ca', value: '#3730a3', iconBg: '#c7d2fe', iconFg: '#4338ca' },
  rose: { bg: '#fff1f2', label: '#be123c', value: '#9f1239', iconBg: '#fecdd3', iconFg: '#be123c' },
}

// Shrinks the value font when long currency strings (₹12,34,567.00) would
// overflow the card width. Mirrors desktop's valueSize() length-bucketed switch.
const valueFontSize = (value: string | number): number => {
  const len = String(value).length
  if (len >= 15) return 13
  if (len >= 13) return 15
  if (len >= 11) return 17
  return 20
}

interface MetricCardProps {
  label: string
  value: string | number
  tone: Tone
  iconName: ComponentProps<typeof IconSymbol>['name']
  to?: string
  hint?: string
}

export default function MetricCard({
  label,
  value,
  tone,
  iconName,
  to,
  hint,
}: MetricCardProps) {
  const t = TONE[tone]
  const inner = (
    <View style={[styles.card, { backgroundColor: t.bg }]}>
      <View style={[styles.iconWrap, { backgroundColor: t.iconBg }]}>
        <IconSymbol name={iconName} size={18} color={t.iconFg} />
      </View>
      <ThemedText style={[styles.label, { color: t.label }]} numberOfLines={2}>
        {label}
      </ThemedText>
      <ThemedText
        style={[styles.value, { color: t.value, fontSize: valueFontSize(value) }]}
        numberOfLines={1}
      >
        {value}
      </ThemedText>
      {hint ? (
        <ThemedText style={[styles.hint, { color: t.label }]} numberOfLines={1}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  )

  if (to) {
    return (
      <Pressable
        onPress={() => router.push(to as never)}
        style={({ pressed }) => [pressed && styles.cardPressed]}
      >
        {inner}
      </Pressable>
    )
  }
  return inner
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 12,
    minHeight: 110,
    justifyContent: 'flex-start',
  },
  cardPressed: { opacity: 0.7 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  value: {
    fontWeight: '700',
    marginTop: 2,
  },
  hint: {
    fontSize: 11,
    opacity: 0.8,
    marginTop: 2,
  },
})
