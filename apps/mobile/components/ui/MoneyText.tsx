import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { useColors } from '@/hooks/use-colors';
import { FontFamily } from '@/constants/tokens';
import { formatCurrency } from '@/utils/currency';

// Big, bold currency. Defaults to the primary ink color; pass `style` to resize
// or recolor (e.g. a hero amount). Keeps formatCurrency as the single money
// formatter so it matches everywhere.
export function MoneyText({
  value,
  style,
}: {
  value: number;
  style?: StyleProp<TextStyle>;
}) {
  const c = useColors();
  return <Text style={[styles.money, { color: c.text }, style]}>{formatCurrency(value)}</Text>;
}

const styles = StyleSheet.create({
  money: { fontSize: 24, fontFamily: FontFamily.extrabold },
});
