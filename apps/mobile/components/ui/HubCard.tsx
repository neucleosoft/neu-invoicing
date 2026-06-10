import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useColors } from '@/hooks/use-colors';
import { Radius, Spacing, Type } from '@/constants/tokens';

type IconName = ComponentProps<typeof IconSymbol>['name'];

// A navigable hub row: lime icon tile + title + subtitle + chevron. The reusable
// version of the cards on the old Purchases/Sales/Reports hubs — used by the
// new Menu hub.
export function HubCard({
  title,
  subtitle,
  icon,
  onPress,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: c.accent }]}>
        <IconSymbol name={icon} size={20} color={c.accentInk} />
      </View>
      <View style={styles.textWrap}>
        <Text style={[Type.bodySemibold, { color: c.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[Type.caption, { color: c.muted, marginTop: 2 }]}>{subtitle}</Text>
        ) : null}
      </View>
      <IconSymbol name="chevron.right" size={16} color={c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
});
