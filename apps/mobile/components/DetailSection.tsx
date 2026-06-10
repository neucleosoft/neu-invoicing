import { StyleSheet, View } from 'react-native'

import { useColors } from '@/hooks/use-colors'
import { Radius, Spacing } from '@/constants/tokens'
import { ThemedText } from './themed-text'

// Vertical group of label/value rows under a title, used on detail screens.
// Provides the section heading and the themed card wrapper around the rows.
export function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const c = useColors()
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <View
        style={[
          styles.sectionBody,
          { backgroundColor: c.surface, borderColor: c.border },
        ]}
      >
        {children}
      </View>
    </View>
  )
}

// One label/value pair inside a Section. Value can be a string (most common,
// rendered as ThemedText) or any React node (for inline chips, indicators, etc.).
export function Row({
  label,
  value,
}: {
  label: string
  value: string | React.ReactNode
}) {
  const c = useColors()
  return (
    <View style={styles.row}>
      <ThemedText style={[styles.rowLabel, { color: c.muted }]}>{label}</ThemedText>
      {typeof value === 'string' ? (
        <ThemedText
          style={[styles.rowValue, { color: c.text }]}
          numberOfLines={4}
        >
          {value}
        </ThemedText>
      ) : (
        <View style={styles.rowValueWrap}>{value}</View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  sectionTitle: { paddingHorizontal: Spacing.xs },
  sectionBody: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: Spacing.lg,
  },
  rowLabel: { flexShrink: 0 },
  rowValue: { fontWeight: '500', textAlign: 'right', flexShrink: 1, flex: 1 },
  rowValueWrap: { flexShrink: 1, alignItems: 'flex-end' },
})
