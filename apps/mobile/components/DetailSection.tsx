import { StyleSheet, View } from 'react-native'

import { ThemedText } from './themed-text'
import { ThemedView } from './themed-view'

// Vertical group of label/value rows under a title, used on detail screens.
// Provides the section heading and the themed card wrapper around the rows.
export function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <ThemedView lightColor="#f9fafb" darkColor="#1f2937" style={styles.sectionBody}>
        {children}
      </ThemedView>
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
  return (
    <View style={styles.row}>
      <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      {typeof value === 'string' ? (
        <ThemedText style={styles.rowValue} numberOfLines={4}>
          {value}
        </ThemedText>
      ) : (
        <View style={styles.rowValueWrap}>{value}</View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: { paddingHorizontal: 4 },
  sectionBody: { borderRadius: 12, paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 16,
  },
  rowLabel: { opacity: 0.6, flexShrink: 0 },
  rowValue: { fontWeight: '500', textAlign: 'right', flexShrink: 1, flex: 1 },
  rowValueWrap: { flexShrink: 1, alignItems: 'flex-end' },
})
