import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { useColorScheme } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { OfflineBanner } from '@/components/offline-banner';
import { Toast } from '@/components/toast';
import { AppPulseEvaluator } from '@/components/app-pulse-evaluator';
import { BookingPhotoPrefetcher } from '@/components/booking-photo-prefetcher';
import { MemoryTracker } from '@/components/memory-tracker';
import { AuthProvider, useAuth } from '@/context/auth';

import { FabProvider } from '@/context/fab';
import { BoardsProvider, useBoards } from '@/context/boards';
import { InboxProvider, useInbox } from '@/context/inbox';
import { MemoryProvider, useMemory } from '@/context/memory';
import { ProfileProvider, useProfile } from '@/context/profile';
import { PulseHistoryProvider, usePulseHistory } from '@/context/pulse-history';

import { ToastProvider } from '@/context/toast';
import { TripPulseProvider, useTripPulse } from '@/context/trip-pulse';
import { SubscriptionProvider } from '@/context/subscription';
import { TripsProvider, useTrips } from '@/context/trips';
import { BookingsProvider, useBookings } from '@/context/bookings';
import { loadNotificationPermissionState, onNotificationTap } from '@/services/notifications';
import { isOnboardingComplete, resetAllData, loadLastUserId, saveLastUserId } from '@/services/storage';

SplashScreen.preventAutoHideAsync();

// Clears all data when a different user signs in.
// Same user signing back in keeps their data intact.
// Guest data (no account) is also preserved when signing up for the first time.
function UserSwitchHandler() {
  const { user, loading } = useAuth();
  const { resetAll: resetTrips } = useTrips();
  const { resetAll: resetMemory } = useMemory();
  const { resetAll: resetInbox } = useInbox();
  const { resetAll: resetTripPulse } = useTripPulse();
  const { resetAll: resetPulseHistory } = usePulseHistory();
  const { resetProfile } = useProfile();
  const { resetAll: resetBoards } = useBoards();
  const { resetAll: resetBookings } = useBookings();

  useEffect(() => {
    if (loading || !user) return;
    loadLastUserId().then((lastId) => {
      if (lastId && lastId !== user.id) {
        // Different user — wipe everything
        resetAllData();
        resetTrips();
        resetMemory();
        resetInbox();
        resetTripPulse();
        resetPulseHistory();
        resetProfile();
        resetBoards();
        resetBookings();
      }
      saveLastUserId(user.id);
    });
  }, [user?.id, loading]);

  return null;
}

function RootLayoutNav() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const screenBg = colorScheme === 'dark' ? '#0A0A0A' : '#FFFFFF';
  const { session, loading: authLoading, isRecovery } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const hasNavigated = useRef(false);

  // Phase 1: check onboarding state and show the Stack
  useEffect(() => {
    async function checkOnboarding() {
      setLoaded(true);
      await SplashScreen.hideAsync();
      // Load actual OS permission state (no prompt) so UI reflects reality immediately
      loadNotificationPermissionState();
    }
    checkOnboarding();
  }, []);

  // Phase 2: initial navigation only — fires once after load + auth resolve.
  // After this, each screen (sign-in, sign-up, onboarding) handles its own navigation.
  useEffect(() => {
    if (!loaded || authLoading || hasNavigated.current) return;
    hasNavigated.current = true;
    if (isRecovery) {
      router.replace('/reset-password');
    } else if (session) {
      router.replace('/(tabs)');
    } else {
      router.replace('/onboarding');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authLoading, session, isRecovery]);

  // Phase 3: handle notification taps — navigate to the relevant trip
  useEffect(() => {
    return onNotificationTap((data) => {
      const tripId = data.tripId as string | undefined;
      if (tripId) {
        const params: Record<string, string> = {};
        if (data.openPulse === 'true') params.openPulse = '1';
        router.push({ pathname: `/trip/${tripId}` as any, params });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 4: handle Universal Links — tripseekapp.com/join/CODE → join-trip screen
  useEffect(() => {
    function handleUrl({ url }: { url: string }) {
      const match = url.match(/(?:tripseekapp\.com\/join\/|tripseek:\/\/join\?code=)([A-Z0-9-]+)/i);
      if (match) {
        router.push({ pathname: '/join-trip' as any, params: { code: match[1].toUpperCase() } });
      }
    }
    const sub = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => { if (url) handleUrl({ url }); });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: screenBg } }}>
        <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: screenBg } }} />
        <Stack.Screen name="bookings" options={{ contentStyle: { backgroundColor: screenBg } }} />
        <Stack.Screen name="stay-detail" options={{ contentStyle: { backgroundColor: screenBg } }} />
        <Stack.Screen name="inbox" options={{ contentStyle: { backgroundColor: screenBg } }} />
        <Stack.Screen name="board-detail" options={{ contentStyle: { backgroundColor: screenBg } }} />
        <Stack.Screen name="add-trip" options={{ contentStyle: { backgroundColor: screenBg } }} />
        <Stack.Screen name="chat" options={{ animation: 'fade', contentStyle: { backgroundColor: screenBg } }} />
        <Stack.Screen name="place-detail" options={{ animation: 'none', contentStyle: { backgroundColor: screenBg } }} />
        <Stack.Screen name="reset-password" options={{ contentStyle: { backgroundColor: screenBg } }} />
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
                <BookingsProvider>
                <MemoryProvider>
                  <TripPulseProvider>
                    <PulseHistoryProvider>
                      <InboxProvider>
                        <BoardsProvider>
                          <UserSwitchHandler />
                          <AppPulseEvaluator />
                          <BookingPhotoPrefetcher />
                          <MemoryTracker />
                          <RootLayoutNav />
                          <OfflineBanner />
                          <Toast />
                        </BoardsProvider>
                      </InboxProvider>
                    </PulseHistoryProvider>
                  </TripPulseProvider>
                </MemoryProvider>
                </BookingsProvider>
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
