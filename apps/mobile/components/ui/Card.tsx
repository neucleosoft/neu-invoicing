import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useColors } from '@/hooks/use-colors';
import { Radius, Spacing } from '@/constants/tokens';

// A themed surface card. When `onPress` is given it becomes a pressable with a
// subtle press-dim. Replaces the ad-hoc `ThemedView lightColor #f9fafb` blocks.
export function Card({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: c.surface,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    style,
  ];

  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({ pressed: { opacity: 0.85 } });
