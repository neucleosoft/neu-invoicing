import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useColors } from '@/hooks/use-colors';
import { FontFamily, Radius } from '@/constants/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

// The one button. primary = lime accent (dark ink), secondary = soft surface,
// ghost = outlined, danger = red. Handles loading + disabled uniformly.
export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const palette: Record<Variant, { bg: string; fg: string }> = {
    primary: { bg: c.accent, fg: c.accentInk },
    secondary: { bg: c.surfaceAlt, fg: c.text },
    ghost: { bg: 'transparent', fg: c.accentDeep },
    danger: { bg: c.danger, fg: '#FFFFFF' },
  };
  const p = palette[variant];
  const blocked = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: p.bg, opacity: blocked ? 0.5 : pressed ? 0.9 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: c.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <Text style={[styles.text, { color: p.fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: Radius.md,
    paddingVertical: 14,
    paddingHorizontal: 18,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 16, fontFamily: FontFamily.bold },
});
