import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { useEffect, useState } from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppPulseEvaluator } from '@/components/app-pulse-evaluator';
import { InboxProvider } from '@/context/inbox';
import { MemoryProvider } from '@/context/memory';
import { ProfileProvider } from '@/context/profile';
import { PulseHistoryProvider } from '@/context/pulse-history';
import { SavedPlacesProvider } from '@/context/saved-places';
import { TripPulseProvider } from '@/context/trip-pulse';
import { TripsProvider } from '@/context/trips';
import { requestNotificationPermission, onNotificationTap } from '@/services/notifications';
import { isOnboardingComplete } from '@/services/storage';

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // Phase 1: check onboarding state and show the Stack
  useEffect(() => {
    async function checkOnboarding() {
      const complete = await isOnboardingComplete();
      setNeedsOnboarding(!complete);
      setLoaded(true);
      await SplashScreen.hideAsync();
      requestNotificationPermission();
    }
    checkOnboarding();
  }, []);

  // Phase 2: navigate AFTER Stack is mounted
  useEffect(() => {
    if (loaded && needsOnboarding) {
      router.replace('/onboarding');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, needsOnboarding]);

  // Phase 3: handle notification taps — navigate to the relevant trip
  useEffect(() => {
    return onNotificationTap((data) => {
      const tripId = data.tripId as string | undefined;
      if (tripId) {
        router.push(`/trip/${tripId}` as any);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <ProfileProvider>
        <TripsProvider>
          <MemoryProvider>
            <TripPulseProvider>
              <PulseHistoryProvider>
                <InboxProvider>
                  <SavedPlacesProvider>
                    <AppPulseEvaluator />
                    <RootLayoutNav />
                  </SavedPlacesProvider>
                </InboxProvider>
              </PulseHistoryProvider>
            </TripPulseProvider>
          </MemoryProvider>
        </TripsProvider>
      </ProfileProvider>
    </ThemeProvider>
  );
}
