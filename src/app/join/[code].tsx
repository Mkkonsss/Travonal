import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

/**
 * Route handler for Universal Links: tripseekapp.com/join/CODE
 *
 * On warm start, Expo Router pushes this screen. We use router.replace
 * (in a useEffect, NOT a <Redirect> component) to swap it for the
 * join-trip screen — this avoids a render-time race with _layout.tsx
 * Phase 2's router.replace('/(tabs)') on cold start.
 *
 * On cold start, _layout.tsx Phase 4 captures the code from the initial
 * URL and Phase 2 handles the navigation after auth resolves.
 */
export default function JoinRedirect() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();

  useEffect(() => {
    if (code) {
      router.replace({ pathname: '/join-trip' as any, params: { code: code.toUpperCase() } });
    }
  }, [code, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
