import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'headline' | 'eyebrow' | 'sectionTitle' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'headline' && styles.headline,
        type === 'eyebrow' && styles.eyebrow,
        type === 'sectionTitle' && styles.sectionTitle,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: { fontSize: 13, lineHeight: 18, fontWeight: 500, fontFamily: Fonts.rounded },
  smallBold: { fontSize: 13, lineHeight: 18, fontWeight: 700, fontFamily: Fonts.rounded },
  default: { fontSize: 15, lineHeight: 22, fontWeight: 500, fontFamily: Fonts.rounded },
  title: { fontSize: 28, fontWeight: 700, lineHeight: 34, fontFamily: Fonts.rounded },
  headline: { fontSize: 18, fontWeight: 700, lineHeight: 24, fontFamily: Fonts.rounded },
  eyebrow: { fontSize: 11, fontWeight: 700, lineHeight: 16, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: Fonts.rounded },
  sectionTitle: { fontSize: 15, fontWeight: 600, lineHeight: 20, fontFamily: Fonts.rounded },
  subtitle: { fontSize: 20, lineHeight: 26, fontWeight: 700, fontFamily: Fonts.rounded },
  link: { lineHeight: 30, fontSize: 14, fontFamily: Fonts.rounded },
  linkPrimary: { lineHeight: 30, fontSize: 14, color: '#3B6FF0', fontFamily: Fonts.rounded },
  code: { fontFamily: Fonts.mono, fontWeight: Platform.select({ android: 700 }) ?? 500, fontSize: 12 },
});
