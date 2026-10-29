import { Linking, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/** Apple's legal attribution page for WeatherKit data sources (redirects to developer.apple.com). */
export const WEATHER_LEGAL_URL = 'https://weatherkit.apple.com/legal-attribution.html';

/**
 * WeatherKit attribution. Guideline 5.2.5 points to Apple's WeatherKit rules: show the
 *  Weather trademark plus a link to the data-sources page wherever Apple weather data appears.
 * `modified` adds the notice Apple requires for data we transform (e.g. Trip Alerts).
 */
export function WeatherAttribution({ modified, style }: { modified?: boolean; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();

  return (
    <View style={[styles.row, style]}>
      <ThemedText style={[styles.text, { color: theme.textSecondary }]}>
        {modified ? 'Based on  Weather data, adjusted by Tripseek' : ' Weather'}
      </ThemedText>
      <ThemedText style={[styles.text, { color: theme.textSecondary }]}>{'·'}</ThemedText>
      <Pressable
        onPress={(e) => { e.stopPropagation(); Linking.openURL(WEATHER_LEGAL_URL); }}
        hitSlop={8}
        accessibilityRole="link"
        accessibilityLabel="Weather data sources"
      >
        <ThemedText style={[styles.text, styles.link, { color: theme.textSecondary }]}>Data sources</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  text: { fontSize: 11, lineHeight: 15 },
  link: { textDecorationLine: 'underline' },
});
