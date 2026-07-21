/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

// Accent is the app's existing teal (#0a7ea4); white text/icons sit on it.
// accentDeep is a slightly darker teal for active tabs / links / emphasis. The
// rest are semantic surface/text/status tokens read via useColors()/useThemeColor
// so light & dark stay automatic. Additive — all original keys kept. To rebrand,
// change accentLight (and the dark `accent`/`tint`) here; everything follows.
const accentLight = '#0a7ea4';
const accentDeepLight = '#0A6E8E';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#FFFFFF',
    tint: accentLight,
    icon: '#687076',
    tabIconDefault: '#9AA0A6',
    tabIconSelected: accentLight,
    // — added semantic tokens —
    accent: accentLight,
    accentInk: '#FFFFFF',
    accentDeep: accentDeepLight,
    surface: '#F5F6F8',
    surfaceAlt: '#EBEEF2',
    border: '#E3E6EB',
    muted: '#6B7280',
    focal: '#0E2A33',
    focalInk: '#EAF6FA',
    success: '#16A34A',
    successBg: '#E7F6EC',
    danger: '#DC2626',
    dangerBg: '#FCEBEB',
    warning: '#D97706',
    warningBg: '#FCF1E2',
  },
  dark: {
    text: '#ECEDEE',
    background: '#0C0E10',
    tint: '#3BB6D6',
    icon: '#9BA1A6',
    tabIconDefault: '#7A8086',
    tabIconSelected: '#3BB6D6',
    // — added semantic tokens —
    accent: '#1693B8',
    accentInk: '#FFFFFF',
    accentDeep: '#3BB6D6',
    surface: '#17191C',
    surfaceAlt: '#202327',
    border: '#2A2D31',
    muted: '#9BA1A6',
    focal: '#13242B',
    focalInk: '#EAF6FA',
    success: '#22C55E',
    successBg: '#152B1D',
    danger: '#F87171',
    dangerBg: '#33191A',
    warning: '#FBBF24',
    warningBg: '#332717',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
