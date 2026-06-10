// Non-color design tokens — the spacing, radius, and type scales the component
// kit and screens read so sizing stays consistent. Colors live in theme.ts
// (read via useColors()/useThemeColor so they flip with light/dark).

import type { TextStyle } from 'react-native';

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

// Inter weight families — the .ttf names registered by useFonts() in _layout.
// The family carries the weight, so styles set fontFamily and NOT fontWeight
// (RN on Android ignores fontWeight when a specific weighted family is set).
export const FontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

// The single type ramp. ThemedText maps onto this too, so the whole app shares
// one Inter-based scale.
export const Type = {
  display: { fontFamily: FontFamily.extrabold, fontSize: 30, lineHeight: 36 } as TextStyle,
  title: { fontFamily: FontFamily.bold, fontSize: 24, lineHeight: 30 } as TextStyle,
  subtitle: { fontFamily: FontFamily.bold, fontSize: 17, lineHeight: 22 } as TextStyle,
  body: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21 } as TextStyle,
  bodySemibold: { fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 21 } as TextStyle,
  label: { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 16 } as TextStyle,
  caption: { fontFamily: FontFamily.medium, fontSize: 12, lineHeight: 15 } as TextStyle,
} as const;

// Status-bar substitute used by full-screen roots (the app has no safe-area
// provider; every screen currently hardcodes paddingTop: 60).
export const SCREEN_TOP = 60;
