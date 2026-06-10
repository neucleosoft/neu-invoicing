import { router } from 'expo-router'
import type { ComponentProps } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { useColors } from '@/hooks/use-colors'
import { Radius, Spacing } from '@/constants/tokens'
import { IconSymbol } from './ui/icon-symbol'
import { ThemedText } from './themed-text'

// Mirrors apps/desktop/src/components/MetricCard.tsx. Same six tones with the
// same semantic intent (green = receivables/positive, red = payables, blue =
// invoiced, orange = warnings, indigo = bank, rose = overdue). Resolved to
// theme tokens via useColors() so it is dark-mode safe: every card shares the
// neutral surface bg + border, and each tone only drives the icon tile + value
// accent colour (accent/success/danger/warning/accentDeep). Desktop uses
// gradient backgrounds; mobile keeps a calm single-surface card.

type Tone = 'green' | 'red' | 'blue' | 'orange' | 'indigo' | 'rose'

// Maps each tone key to a token accent. The card surface/border come from the
// shared neutral tokens (so the card stays calm in both themes); the accent
// here tints the icon tile and the value text only.
function toneAccent(c: ReturnType<typeof useColors>): Record<Tone, string> {
  return {
    green: c.success,
    red: c.danger,
    blue: c.accent,
    orange: c.warning,
    indigo: c.accentDeep,
    rose: c.danger,
  }
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
  const c = useColors()
  const accent = toneAccent(c)[tone]

  const inner = (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {/* Icon tile carries the tone accent on a faint surfaceAlt backing so it
          reads in both themes without a coloured fill behind the whole card. */}
      <View style={[styles.iconWrap, { backgroundColor: c.surfaceAlt }]}>
        <IconSymbol name={iconName} size={18} color={accent} />
      </View>
      <ThemedText style={[styles.label, { color: c.muted }]} numberOfLines={2}>
        {label}
      </ThemedText>
      <ThemedText
        style={[styles.value, { color: accent, fontSize: valueFontSize(value) }]}
        numberOfLines={1}
      >
        {value}
      </ThemedText>
      {hint ? (
        <ThemedText style={[styles.hint, { color: c.muted }]} numberOfLines={1}>
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
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    minHeight: 110,
    justifyContent: 'flex-start',
  },
  cardPressed: { opacity: 0.7 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
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
