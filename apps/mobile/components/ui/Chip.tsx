import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/hooks/use-colors';
import { FontFamily, Radius } from '@/constants/tokens';

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning';

// A small status pill. Use a semantic `tone`, OR pass explicit `bg`/`color` for
// data-driven badges (e.g. STATUS_BADGE_COLORS / dueCountdown colors that are
// computed elsewhere and applied inline).
export function Chip({
  label,
  tone = 'neutral',
  bg,
  color,
}: {
  label: string;
  tone?: Tone;
  bg?: string;
  color?: string;
}) {
  const c = useColors();
  const tones: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: c.surfaceAlt, fg: c.muted },
    accent: { bg: c.accent, fg: c.accentInk },
    success: { bg: c.successBg, fg: c.success },
    danger: { bg: c.dangerBg, fg: c.danger },
    warning: { bg: c.warningBg, fg: c.warning },
  };
  const t = tones[tone];

  return (
    <View style={[styles.chip, { backgroundColor: bg ?? t.bg }]}>
      <Text style={[styles.text, { color: color ?? t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 11, fontFamily: FontFamily.bold },
});
