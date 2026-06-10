import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// The full active color palette (light or dark). Convenience over useThemeColor
// for components that read several tokens at once — same source of truth, same
// light/dark switching.
export type AppColors = typeof Colors.light;

export function useColors(): AppColors {
  const scheme = useColorScheme() ?? 'light';
  return Colors[scheme];
}
