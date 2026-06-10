import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useColors } from '@/hooks/use-colors';
import { SCREEN_TOP, Spacing } from '@/constants/tokens';

// The themed full-screen root. Replaces the per-screen `paddingTop: 60` +
// ad-hoc background. `scroll` (default) wraps content in a ScrollView; pass
// scroll={false} for screens that own their own list/scroller.
export function Screen({
  children,
  scroll = true,
  padded = true,
  contentStyle,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const pad = padded
    ? { paddingHorizontal: Spacing.lg, paddingTop: SCREEN_TOP, paddingBottom: Spacing.xxxl }
    : { paddingTop: SCREEN_TOP };

  if (scroll) {
    return (
      <ScrollView
        style={[styles.flex, { backgroundColor: c.background }, style]}
        contentContainerStyle={[pad, { gap: Spacing.xl }, contentStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <View style={[styles.flex, { backgroundColor: c.background }, pad, style]}>{children}</View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
