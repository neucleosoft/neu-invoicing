import { Pressable, StyleSheet, Text } from 'react-native'

import { useColors } from '@/hooks/use-colors'
import { Spacing } from '@/constants/tokens'

interface FabProps {
  onPress: () => void
  /** Accessibility label — read by screen readers. Defaults to "Add". */
  label?: string
}

// Floating Action Button. Material-style circular button anchored bottom-right.
// No desktop equivalent — desktop uses inline header buttons because mouse
// targets work everywhere. On mobile a thumb-reachable FAB beats reaching for
// the top corner on every "create" action. Teal accent bg + white (accentInk)
// glyph so it reads as the one primary CTA in both themes.
export default function Fab({ onPress, label = 'Add' }: FabProps) {
  const c = useColors()

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: c.accent },
        pressed && { opacity: 0.85 },
      ]}
      // Ripple is clipped to the circle. `borderless` would let the ripple
      // bleed past the bounds, which looks weird on a FAB.
      android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false, radius: 28 }}
    >
      <Text style={[styles.icon, { color: c.accentInk }]}>+</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.xxl,
    bottom: Spacing.xxl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    // Android elevation — drops a real shadow rendered by the OS.
    elevation: 6,
    // iOS shadow — no elevation prop on iOS, so set the four shadow props manually.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  icon: {
    fontSize: 28,
    fontWeight: '300',
    // Without explicit lineHeight the "+" sits visually below center on Android.
    lineHeight: 32,
  },
})
