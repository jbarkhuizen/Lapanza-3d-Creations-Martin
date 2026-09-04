// Mirrors the CSS custom properties in admin/admin.css so the mobile app
// reads as the same product as the desktop admin portal.

export const lightColors = {
  bg: '#f3eee4',
  bgElevated: '#faf7f1',
  bgSoft: '#ebe4d7',
  panel: '#fffdf8',
  ink: '#1a1612',
  muted: '#6a5f54',
  line: 'rgba(26, 22, 18, 0.12)',
  brand: '#c24b28',
  brandSoft: 'rgba(194, 75, 40, 0.12)',
  accent: '#d9eb4d',
  ok: '#1f7a45',
  warn: '#a36b12',
  danger: '#b42318',
};

export const darkColors = {
  bg: '#12100e',
  bgElevated: '#1a1714',
  bgSoft: '#221e1a',
  panel: '#1e1a16',
  ink: '#f4efe6',
  muted: '#b0a497',
  line: 'rgba(244, 239, 230, 0.12)',
  brand: '#e06a45',
  brandSoft: 'rgba(224, 106, 69, 0.18)',
  accent: '#e4f35a',
  ok: '#4ade80',
  warn: '#fbbf24',
  danger: '#f87171',
};

export type ThemeColors = typeof lightColors;

export const radius = 14;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const fontFamily = {
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansBold: 'DMSans_700Bold',
  serif: 'Fraunces_600SemiBold',
};
