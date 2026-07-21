import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/hooks/use-colors';
import { Spacing, Type } from '@/constants/tokens';

// A section title row with an optional right-aligned action (e.g. "View all ›").
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Text style={[Type.subtitle, { color: c.text }]}>{title}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
});
