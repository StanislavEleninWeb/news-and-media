import { Platform, useColorScheme } from 'react-native';

/** Same tokens as the website (apps/web/styles/globals.css). */
const light = {
  paper: '#fbfaf7',
  raised: '#ffffff',
  ink: '#15171a',
  inkSoft: '#3d4148',
  muted: '#6b7079',
  rule: '#e4e1da',
  brand: '#13233a',
  accent: '#b42318',
  accentSoft: '#fdecea',
  link: '#13233a',
  chip: '#f1eee7',
};
const dark: typeof light = {
  paper: '#0f1115',
  raised: '#171a20',
  ink: '#eceae6',
  inkSoft: '#c9c7c2',
  muted: '#9a9ea6',
  rule: '#2a2e36',
  brand: '#eceae6',
  accent: '#ff6b5e',
  accentSoft: '#3a1714',
  link: '#b9cdf5',
  chip: '#22262e',
};
export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Serif headlines like the website; the platform serif covers Cyrillic. */
export const fonts = {
  serif: Platform.select({ ios: 'Georgia', default: 'serif' }),
};

export const space = { xs: 4, s: 8, m: 16, l: 24, xl: 32 };
export const radius = 10;
