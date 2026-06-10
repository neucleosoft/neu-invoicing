import { Text, type TextProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';
import { Type } from '@/constants/tokens';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
};

// Themed text mapped onto the single Type ramp (constants/tokens) — so headings,
// body, and links all share one Inter-based scale. `link` recolors to the accent.
export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const linkColor = useThemeColor({}, 'accentDeep');

  return (
    <Text
      style={[
        { color },
        type === 'default' ? Type.body : undefined,
        type === 'defaultSemiBold' ? Type.bodySemibold : undefined,
        type === 'title' ? Type.title : undefined,
        type === 'subtitle' ? Type.subtitle : undefined,
        type === 'link' ? [Type.body, { color: linkColor }] : undefined,
        style,
      ]}
      {...rest}
    />
  );
}
