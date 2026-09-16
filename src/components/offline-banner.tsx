import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { useIsOnline } from '@/hooks/use-network';
import { useTheme } from '@/hooks/use-theme';

/** Subtle banner shown when the device is offline. Non-blocking. */
export function OfflineBanner() {
  const online = useIsOnline();
  const theme = useTheme();

  if (online) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={[styles.banner, { backgroundColor: theme.textSecondary }]}
    >
      <ThemedText style={styles.text}>No internet connection</ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: 4,
    alignItems: 'center',
    zIndex: 999,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
