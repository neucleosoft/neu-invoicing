import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

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

  const ramp: TextStyle =
    type === 'title' ? Type.title
    : type === 'subtitle' ? Type.subtitle
    : type === 'defaultSemiBold' ? Type.bodySemibold
    : Type.body;

  // lineHeight in RN is an absolute pixel value, so a caller overriding just
  // fontSize would otherwise keep the ramp's line box — 12px text floating in
  // 21px of line (bloated chips), or 22px text clipped by it. When fontSize is
  // overridden without lineHeight, scale the ramp's line height to match.
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const scaledLineHeight =
    flat?.fontSize != null && flat.lineHeight == null
      ? { lineHeight: Math.round(flat.fontSize * (ramp.lineHeight! / ramp.fontSize!)) }
      : undefined;

  return (
    <Text
      style={[
        { color },
        ramp,
        type === 'link' ? { color: linkColor } : undefined,
        style,
        scaledLineHeight,
      ]}
      {...rest}
    />
  );
}
