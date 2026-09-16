import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { OfflineBanner } from '@/components/offline-banner';
import { Toast } from '@/components/toast';
import { AppPulseEvaluator } from '@/components/app-pulse-evaluator';
import { AuthProvider, useAuth } from '@/context/auth';

import { FabProvider } from '@/context/fab';
import { BoardsProvider } from '@/context/boards';
import { InboxProvider } from '@/context/inbox';
import { MemoryProvider } from '@/context/memory';
import { ProfileProvider } from '@/context/profile';
import { PulseHistoryProvider } from '@/context/pulse-history';

import { ToastProvider } from '@/context/toast';
import { TripPulseProvider } from '@/context/trip-pulse';
import { SubscriptionProvider } from '@/context/subscription';
import { TripsProvider } from '@/context/trips';
import { loadNotificationPermissionState, onNotificationTap } from '@/services/notifications';
import { isOnboardingComplete } from '@/services/storage';

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // Phase 1: check onboarding state and show the Stack
  useEffect(() => {
    async function checkOnboarding() {
      const complete = await isOnboardingComplete();
      setNeedsOnboarding(!complete);
      setLoaded(true);
      await SplashScreen.hideAsync();
      // Load actual OS permission state (no prompt) so UI reflects reality immediately
      loadNotificationPermissionState();
    }
    checkOnboarding();
  }, []);

  // Phase 2: navigate AFTER Stack is mounted and auth is resolved
  useEffect(() => {
    if (!loaded || authLoading) return;
    if (session) {
      // Authenticated — go straight to the app (auth also covers onboarding)
      router.replace('/(tabs)');
    } else if (needsOnboarding) {
      router.replace('/onboarding');
    }
    // No session + onboarding done → stay on home (local-only mode)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authLoading, session, needsOnboarding]);

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
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="chat" options={{ animation: 'fade' }} />
        <Stack.Screen name="place-detail" options={{ animation: 'none' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <ToastProvider>
          <FabProvider>
          <AuthProvider>
            <ProfileProvider>
              <SubscriptionProvider>
              <TripsProvider>
                <MemoryProvider>
                  <TripPulseProvider>
                    <PulseHistoryProvider>
                      <InboxProvider>
                        <BoardsProvider>
                          <AppPulseEvaluator />
                          <RootLayoutNav />
                          <OfflineBanner />
                          <Toast />
                        </BoardsProvider>
                      </InboxProvider>
                    </PulseHistoryProvider>
                  </TripPulseProvider>
                </MemoryProvider>
              </TripsProvider>
              </SubscriptionProvider>
            </ProfileProvider>
          </AuthProvider>
          </FabProvider>
        </ToastProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
