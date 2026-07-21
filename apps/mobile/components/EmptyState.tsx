import { Pressable, StyleSheet, View } from 'react-native'

import { useColors } from '@/hooks/use-colors'
import { Radius, Spacing } from '@/constants/tokens'
import { ThemedText } from './themed-text'

interface EmptyStateProps {
  title: string
  description?: string
  action?: {
    label: string
    onPress: () => void
  }
  /** Optional secondary action — rendered quieter, below the primary */
  secondaryAction?: {
    label: string
    onPress: () => void
  }
}

// Mirrors apps/desktop/src/components/EmptyState.tsx — same prop names,
// same action-object shape (with onPress instead of onClick for RN). The
// decorative gradient/blur orbs from desktop don't translate cleanly to RN
// without expo-linear-gradient, so the icon area is a simple tinted circle
// for now; swap to a real illustration component when one exists.
export default function EmptyState({
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  const c = useColors()

  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: c.accent }]} />
      <ThemedText type="subtitle" style={styles.title}>
        {title}
      </ThemedText>
      {description ? (
        <ThemedText style={[styles.description, { color: c.muted }]}>
          {description}
        </ThemedText>
      ) : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          style={[styles.actionButton, { backgroundColor: c.accent }]}
        >
          <ThemedText style={[styles.actionButtonText, { color: c.accentInk }]}>
            {action.label}
          </ThemedText>
        </Pressable>
      ) : null}
      {secondaryAction ? (
        <Pressable onPress={secondaryAction.onPress} style={styles.secondaryButton}>
          <ThemedText style={[styles.secondaryButtonText, { color: c.muted }]}>
            {secondaryAction.label}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: Spacing.xxxl,
    gap: Spacing.md,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: Spacing.sm,
    opacity: 0.15,
  },
  title: { textAlign: 'center' },
  description: { textAlign: 'center' },
  actionButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  actionButtonText: { fontWeight: '600' },
  secondaryButton: {
    paddingHorizontal: Spacing.xxl,
    paddingVertical: 10,
  },
  secondaryButtonText: {},
})
