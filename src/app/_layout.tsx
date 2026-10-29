import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { InteractionManager, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { Component, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { isRunningInExpoGo } from 'expo';

import { ThemedText } from '@/components/themed-text';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { OfflineBanner } from '@/components/offline-banner';
import { Toast } from '@/components/toast';
import { AppPulseEvaluator } from '@/components/app-pulse-evaluator';
import { BookingPhotoPrefetcher } from '@/components/booking-photo-prefetcher';
import { MemoryTracker } from '@/components/memory-tracker';
import { AuthProvider, useAuth } from '@/context/auth';
import { AIConsentProvider } from '@/context/ai-consent';

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
import { isOnboardingComplete, resetAllData, loadLastUserId, saveLastUserId, clearLastUserId } from '@/services/storage';

// expo-observe's native code isn't included in Expo Go, so importing it there crashes on launch.
// Load it only in real builds; in Expo Go, performance metrics are skipped.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Observe: typeof import('expo-observe') | null = isRunningInExpoGo() ? null : require('expo-observe');
const useObserve = Observe?.useObserve ?? (() => ({ markInteractive: () => {} }));

SplashScreen.preventAutoHideAsync();

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <ThemedText style={errorStyles.title}>Something went wrong</ThemedText>
          <ThemedText style={errorStyles.message}>
            The app ran into an unexpected error. Please restart the app.
          </ThemedText>
          <Pressable
            style={errorStyles.button}
            onPress={() => this.setState({ hasError: false })}
          >
            <ThemedText style={errorStyles.buttonText}>Try Again</ThemedText>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#000' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 12 },
  message: { fontSize: 16, color: '#aaa', textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  button: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#000' },
});

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
    if (loading) return;
    if (!user) {
      // Signed out — wipe all account-specific state so next user starts fresh
      resetAllData();
      clearLastUserId();
      resetTrips();
      resetMemory();
      resetInbox();
      resetTripPulse();
      resetPulseHistory();
      resetProfile();
      resetBoards();
      resetBookings();
      return;
    }
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
  const [initialUrlChecked, setInitialUrlChecked] = useState(false);
  const hasNavigated = useRef(false);
  const pendingJoinCode = useRef<string | null>(null);
  const { markInteractive } = useObserve();

  // Phase 1: check onboarding state and show the Stack
  useEffect(() => {
    async function checkOnboarding() {
      setLoaded(true);
      await SplashScreen.hideAsync();
      markInteractive();
      // Load actual OS permission state (no prompt) so UI reflects reality immediately
      loadNotificationPermissionState();
    }
    checkOnboarding();
  }, []);

  // Phase 2: initial navigation only — fires once after load + auth + initial URL check resolve.
  // Waits for initialUrlChecked so Phase 4's getInitialURL has time to capture any join code.
  useEffect(() => {
    if (!loaded || authLoading || hasNavigated.current || !initialUrlChecked) return;
    hasNavigated.current = true;
    if (isRecovery) {
      router.replace('/reset-password');
    } else if (session) {
      router.replace('/(tabs)');
    } else {
      router.replace('/onboarding');
    }
    // Process any deep link that arrived before auth resolved
    if (pendingJoinCode.current) {
      const code = pendingJoinCode.current;
      pendingJoinCode.current = null;
      // Wait for the base navigation to fully settle before pushing the join screen
      InteractionManager.runAfterInteractions(() => {
        router.push({ pathname: '/join-trip' as any, params: { code } });
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authLoading, session, isRecovery, initialUrlChecked]);

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

  // Phase 4: handle deep links for join flow
  // - Cold start: getInitialURL captures the join code for Phase 2 to process
  // - Warm start Universal Links: handled by join/[code].tsx (file-based routing)
  // - Warm start custom scheme: handled by the URL listener below
  useEffect(() => {
    function extractJoinCode(url: string): string | null {
      const match = url.match(/(?:https?:\/\/)?tripseekapp\.com\/join\/([A-Z0-9-]+)|tripseek:\/\/join\?code=([A-Z0-9-]+)/i);
      return match ? (match[1] ?? match[2]).toUpperCase() : null;
    }
    // Listen for custom scheme URLs while app is running (tripseek://join?code=...)
    // Universal Links (tripseekapp.com/join/CODE) are handled by join/[code].tsx file routing
    const sub = Linking.addEventListener('url', ({ url }: { url: string }) => {
      if (url.startsWith('tripseek://')) {
        const code = extractJoinCode(url);
        if (code) router.push({ pathname: '/join-trip' as any, params: { code } });
      }
    });
    // Cold start: capture join code from initial URL before Phase 2 navigates
    Linking.getInitialURL().then((url) => {
      if (url) {
        const code = extractJoinCode(url);
        if (code) pendingJoinCode.current = code;
      }
    }).finally(() => {
      setInitialUrlChecked(true);
    });
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

function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <ToastProvider>
          <FabProvider>
          <AuthProvider>
            <AIConsentProvider>
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
            </AIConsentProvider>
          </AuthProvider>
          </FabProvider>
        </ToastProvider>
      </ThemeProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

export default Observe ? Observe.ObserveRoot.wrap(RootLayout) : RootLayout;
