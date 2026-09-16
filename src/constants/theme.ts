/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#111827',
    background: '#FFFFFF',
    backgroundElement: '#F4F5FA',
    backgroundSelected: '#E8EAF6',
    textSecondary: '#6B7280',
    primary: '#111827',
    primaryMuted: '#F4F5FA',
    border: '#E8E9F2',
    live: '#10B981',
    danger: '#EF4444',
  },
  dark: {
    text: '#F9FAFB',
    background: '#09090F',
    backgroundElement: '#131320',
    backgroundSelected: '#1C1C30',
    textSecondary: '#9CA3AF',
    primary: '#F9FAFB',
    primaryMuted: '#1C1C30',
    border: '#1F1F35',
    live: '#34D399',
    danger: '#F87171',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

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
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Consistent border-radius scale used across the entire app. */
export const Radius = {
  /** Tags, small badges */
  xs: 8,
  /** Inputs, chips, small interactive elements */
  sm: 12,
  /** Cards, buttons — the universal default */
  md: 16,
  /** Large cards, trip photo cards */
  lg: 20,
  /** Pills, FAB, fully rounded elements */
  xl: 28,
  /** Bottom sheet top corners */
  sheet: 24,
} as const;

/** Three-level shadow scale. Use tinted shadows where possible. */
export const Shadow = {
  subtle: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  medium: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  strong: {
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
/** Extra bottom padding on scrollable screens to clear the floating Ask Travonal button */
export const FAB_CLEARANCE = 80;
