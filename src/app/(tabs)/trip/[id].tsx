import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, TextInput, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown, useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { ActivityContextMenu, ReactionOption } from '@/components/activity-context-menu';
import { SwipeableActivityRow } from '@/components/swipeable-activity-row';
import { AskToveli, ToveliCommand, COMMANDS as AI_COMMANDS, parseTextToCommand } from '@/components/ask-toveli';
import { DatePickerModal, formatDisplayDate } from '@/components/date-picker-modal';
import { PulseAlertList } from '@/components/pulse-alert-list';
import { TimePickerButton, formatTimeDisplay, defaultTimeForType, HOURS_12, MINUTES_5, parseTime, formatTime } from '@/components/time-picker';
import { TransformationReveal, SmartReplacePicker } from '@/components/transformation-reveal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadow, Spacing } from '@/constants/theme';
import { Activity, PrepItem, Reservation, ReservationType, Trip, useTrips, setLastViewedTripId } from '@/context/trips';
import { useAuth } from '@/context/auth';
import { useProfile } from '@/context/profile';
import { useMemory, type MemoryEntryType, type MemoryCategory } from '@/context/memory';
import { useTheme } from '@/hooks/use-theme';
import { useActivityPhotos } from '@/hooks/use-activity-photos';
import { useDestinationPhoto } from '@/hooks/use-destination-photo';
import { checkConflicts, getTripDayCount, computeChangePreview, ChangePreview, timeToMinutes, suggestTimeForActivity, reflowFromTime, compareByTime } from '@/services/itinerary-engine';
import { getDrivingDistance, formatDrivingDistance } from '@/services/driving-distance';
import { transformTrip, findTopReplacements, TransformScope, validateLockedProtection, findSemanticDuplicates, detectNoChange } from '@/services/transformation-service';
import { getBookingLinks, getPrimaryBookingLink, getTripReadiness, openBookingLink, platformDisplayName, getPlaceBookingLinks } from '@/services/booking-links';
import { fetchExplorePlaces, searchExplorePlaces } from '@/services/explore-service';
import { getPlacePhoto, prefetchPhotos } from '@/services/free-photos';
import { categoryToActivityType, type NormalizedPlace } from '@/services/place-model';
import { hasDestinationData } from '@/services/alternatives-pool';
import { editTripAI, naturalSearchAI, NaturalSearchSuggestion, chatAI, TripAction, type ChatPlace, ParsedBooking, getParsedBookingsAI, dismissParsedBookingAI, markBookingImportedAI, getTripAlertsAI, TripAlertResult } from '@/services/ai';
import { AddBookingModal } from '@/components/add-booking-modal';
import { FlightsStrip } from '@/components/flights-strip';
import { ConfirmedBookingSheet } from '@/components/confirmed-booking-sheet';
import { UnbookedStaySheet } from '@/components/unbooked-stay-sheet';
import { TripBookingsTab } from '@/components/trip-bookings-tab';
import { ChatPlaceCard, placeStyles as chatPlaceStyles } from '@/components/chat-place-card';
import { ChatMarkdown } from '@/components/chat-markdown';
import { useGate } from '@/hooks/use-gate';
import { UpgradePrompt } from '@/components/upgrade-prompt';
import { useSubscription } from '@/context/subscription';
import { normalizeActivity, mergeDayScopedActivities, generateActivityId, validateGeneratedActivities, repairActivities } from '@/services/ai-utils';
import { runTripPulse, PulseAlert } from '@/services/trip-pulse';
import { loadDismissedPulse, saveDismissedPulse, loadSeenPulse, saveSeenPulse, loadBookingRemindersEnabled, loadDepartureReminderEnabled, loadDailyBriefingEnabled, loadTripEditChat, saveTripEditChat, loadTripEditThreads, saveTripEditThreads, loadTripExternalAlerts, saveTripExternalAlerts } from '@/services/storage';
import { mergeUserSettings, pullUserSettings, mergeTripChat, pullTripChats } from '@/services/sync';
import { makePulseDismissalKey, isPulseDismissed, formatDayLabel, computeDateForDay } from '@/services/trip-helpers';
import { usePulseHistory } from '@/context/pulse-history';
import { type StayBlock, type StaysData } from '@/components/stays-section';
import { StaysStrip } from '@/components/stays-strip';
import { useTripPulse } from '@/context/trip-pulse';
import { useToast } from '@/context/toast';
import { TripMap } from '@/components/trip-map';
import { scheduleBookingReminders, cancelBookingReminders, scheduleDepartureReminder, scheduleDailyBriefings } from '@/services/notifications';
import { exportTripPDF } from '@/services/trip-export';

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '\u20AC', GBP: '\u00A3', JPY: '\u00A5', AUD: 'A$', CAD: 'C$', CHF: 'CHF', CNY: '\u00A5', KRW: '\u20A9', THB: '\u0E3F', INR: '\u20B9', MXN: 'MX$', BRL: 'R$' };
function getCurrSymbol(cur: string) { return CURRENCY_SYMBOLS[cur] ?? cur + ' '; }

/** WMO weather code → SF Symbol name + label */
function weatherForCode(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: 'sun.max.fill', label: 'Clear' };
  if (code <= 3) return { icon: 'cloud.sun.fill', label: 'Partly cloudy' };
  if (code <= 48) return { icon: 'cloud.fog.fill', label: 'Foggy' };
  if (code <= 57) return { icon: 'cloud.drizzle.fill', label: 'Drizzle' };
  if (code <= 67) return { icon: 'cloud.rain.fill', label: 'Rain' };
  if (code <= 77) return { icon: 'cloud.snow.fill', label: 'Snow' };
  if (code <= 82) return { icon: 'cloud.heavyrain.fill', label: 'Showers' };
  if (code <= 86) return { icon: 'cloud.snow.fill', label: 'Snow showers' };
  return { icon: 'cloud.bolt.rain.fill', label: 'Thunderstorm' };
}

/** Friendly category label from raw category strings like "food/restaurant" → "Restaurant" */
function formatCategoryLabel(category?: string, type?: string): string {
  const raw = category || type || '';
  const last = raw.split('/').pop() || raw;
  if (!last) return '';
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/_/g, ' ');
}

/** Shows driving distance + duration between two activities, fetched from OSRM. */
function DistanceIndicator({ lat1, lng1, lat2, lng2, theme }: {
  lat1: number; lng1: number; lat2: number; lng2: number;
  theme: { textSecondary: string };
}) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDrivingDistance(lat1, lng1, lat2, lng2).then((r) => {
      if (!cancelled) setLabel(formatDrivingDistance(r));
    });
    return () => { cancelled = true; };
  }, [lat1, lng1, lat2, lng2]);
  if (!label) return null;
  return (
    <View style={styles.distanceIndicator}>
      <SymbolView name="car.fill" size={10} tintColor={theme.textSecondary} />
      <ThemedText style={[styles.distanceText, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
    </View>
  );
}

/** Async photo loader for activity confirmation popup. */
function ActivityConfirmPhoto({ place, theme }: { place: NormalizedPlace; theme: any }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    Keyboard.dismiss();
    let cancelled = false;
    const ref = place.photos?.[0]?.reference;
    if (!ref) return;
    getPlacePhoto({ cacheKey: place.placeId ?? place.name, photoRef: ref, name: place.name }).then((r) => {
      if (!cancelled && r) setPhotoUrl(r.url);
    });
    return () => { cancelled = true; };
  }, [place.placeId, place.name]);

  if (photoUrl) {
    return <ExpoImage source={{ uri: photoUrl }} style={{ width: '100%', height: 160 }} contentFit="cover" cachePolicy="memory-disk" />;
  }
  if (place.photos?.[0]?.reference) {
    return <View style={{ width: '100%', height: 160, backgroundColor: theme.backgroundElement }} />;
  }
  return null;
}

/** Confirmation popup for adding a place from search results. Loads photo async and dismisses keyboard. */
function StayConfirmPopup({ place, theme, onDismiss, onAdd, onViewDetails, addLabel, addIcon }: {
  place: NormalizedPlace; theme: any;
  onDismiss: () => void; onAdd: () => void; onViewDetails: () => void;
  addLabel?: string; addIcon?: string;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    Keyboard.dismiss();
    let cancelled = false;
    const ref = place.photos?.[0]?.reference;
    if (!ref) return;
    getPlacePhoto({ cacheKey: place.placeId ?? place.name, photoRef: ref, name: place.name }).then((r) => {
      if (!cancelled && r) setPhotoUrl(r.url);
    });
    return () => { cancelled = true; };
  }, [place.placeId, place.name]);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
    >
      <Pressable
        onPress={onDismiss}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ margin: 16, marginBottom: 24 }}>
          <Animated.View
            entering={SlideInDown.duration(250)}
            style={{
              backgroundColor: theme.background, borderRadius: 20, overflow: 'hidden',
              ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } }, android: { elevation: 8 } }),
            }}
          >
            {/* Photo banner */}
            {photoUrl ? (
              <ExpoImage source={{ uri: photoUrl }} style={{ width: '100%', height: 160 }} contentFit="cover" cachePolicy="memory-disk" />
            ) : place.photos?.[0]?.reference ? (
              <View style={{ width: '100%', height: 160, backgroundColor: theme.backgroundElement }} />
            ) : null}

            <View style={{ padding: 20 }}>
              {/* Place info */}
              <ThemedText style={{ fontSize: 19, fontWeight: '700' }} numberOfLines={2}>{place.name}</ThemedText>
              {place.rating != null && (
                <ThemedText style={{ fontSize: 14, color: theme.textSecondary, marginTop: 4 }}>
                  ★ {place.rating.toFixed(1)}{place.reviewCount ? ` (${place.reviewCount})` : ''}
                </ThemedText>
              )}
              {place.address && (
                <ThemedText style={{ fontSize: 14, color: theme.textSecondary, marginTop: 2 }} numberOfLines={2}>
                  {place.address}
                </ThemedText>
              )}

              {/* Add to Stays button */}
              <Pressable
                onPress={onAdd}
                style={({ pressed }) => [{
                  backgroundColor: theme.primary, borderRadius: 14,
                  paddingVertical: 14, alignItems: 'center',
                  marginTop: 18, opacity: pressed ? 0.85 : 1,
                }]}
                accessibilityRole="button"
                accessibilityLabel="Add to stays"
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <SymbolView name={addIcon ?? 'bed.double.fill'} size={18} tintColor={theme.primaryText} />
                  <ThemedText style={{ fontSize: 16, fontWeight: '700', color: theme.primaryText }}>{addLabel ?? 'Add to Stays'}</ThemedText>
                </View>
              </Pressable>

              {/* View Full Details link */}
              <Pressable
                onPress={onViewDetails}
                style={({ pressed }) => [{ marginTop: 10, paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="View full details"
              >
                <ThemedText style={{ fontSize: 15, color: theme.primary, fontWeight: '600' }}>View Full Details</ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

/** Search result row with async-loaded photo for stays search. */
function StaySearchResultRow({ place, theme, onPress }: { place: NormalizedPlace; theme: any; onPress: () => void }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoaded, setPhotoLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ref = place.photos?.[0]?.reference;
    if (!ref) { setPhotoLoaded(true); return; }
    getPlacePhoto({ cacheKey: place.placeId ?? place.name, photoRef: ref, name: place.name }).then((r) => {
      if (!cancelled) { if (r) setPhotoUrl(r.url); setPhotoLoaded(true); }
    }).catch(() => { if (!cancelled) setPhotoLoaded(true); });
    return () => { cancelled = true; };
  }, [place.placeId, place.name]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 10, paddingHorizontal: 4,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
        opacity: pressed ? 0.7 : 1,
      }]}
      accessibilityRole="button"
      accessibilityLabel={`Select ${place.name}`}
    >
      {(photoUrl || !photoLoaded) && (
        <View style={{
          width: 44, height: 44, borderRadius: 8, backgroundColor: theme.backgroundElement,
          overflow: 'hidden',
        }}>
          {photoUrl ? (
            <ExpoImage source={{ uri: photoUrl }} style={{ width: 44, height: 44 }} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <View style={{ width: 44, height: 44, backgroundColor: theme.backgroundElement }} />
          )}
        </View>
      )}
      <View style={{ flex: 1 }}>
        <ThemedText style={{ fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{place.name}</ThemedText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {place.rating != null && (
            <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
              ★ {place.rating.toFixed(1)}{place.reviewCount ? ` (${place.reviewCount})` : ''}
            </ThemedText>
          )}
          {place.address && (
            <ThemedText style={{ fontSize: 12, color: theme.textSecondary, flex: 1 }} numberOfLines={1}>
              {place.rating != null ? ' · ' : ''}{place.address}
            </ThemedText>
          )}
        </View>
      </View>
      <SymbolView name="chevron.right" size={12} tintColor={theme.textSecondary} />
    </Pressable>
  );
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** Wrapper that makes a timeline item draggable via long-press + pan. */
function DraggableActivityItem({
  children,
  isLocked,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  scrollRef,
  scrollOffsetRef,
}: {
  children: React.ReactNode;
  isLocked: boolean;
  onDragStart: () => void;
  onDragUpdate: (translationY: number) => void;
  onDragEnd: () => void;
  scrollRef: React.RefObject<ScrollView | null>;
  scrollOffsetRef: React.RefObject<number>;
}) {
  const fingerTranslateY = useSharedValue(0);
  const scrollDeltaY = useSharedValue(0);
  const active = useSharedValue(false);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollSpeedRef = useRef(0);
  const scrollDirRef = useRef<'up' | 'down'>('down');
  const dragStartScrollRef = useRef(0);
  const lastTranslationRef = useRef(0);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
    scrollSpeedRef.current = 0;
  }, []);

  const handleEdgeScroll = useCallback((absoluteY: number) => {
    const EDGE = 200;
    const screenH = Dimensions.get('window').height;
    const nearTop = absoluteY < EDGE;
    const nearBottom = absoluteY > screenH - EDGE;

    if (!nearTop && !nearBottom) {
      stopAutoScroll();
      return;
    }

    // Speed ramps up as finger gets closer to edge (3-14 px/frame)
    const speed = nearTop
      ? Math.max(3, Math.round(14 * (1 - absoluteY / EDGE)))
      : Math.max(3, Math.round(14 * (1 - (screenH - absoluteY) / EDGE)));

    scrollSpeedRef.current = speed;
    scrollDirRef.current = nearTop ? 'up' : 'down';

    if (autoScrollTimer.current) return; // timer already running, speed updates via ref
    autoScrollTimer.current = setInterval(() => {
      const current = scrollOffsetRef.current ?? 0;
      const delta = scrollDirRef.current === 'up' ? -scrollSpeedRef.current : scrollSpeedRef.current;
      const next = Math.max(0, current + delta);
      scrollRef.current?.scrollTo({ y: next, animated: false });
      // Keep item visually under the finger: compensate for scroll movement
      const newScrollDelta = next - dragStartScrollRef.current;
      scrollDeltaY.value = newScrollDelta;
      // Also update the drag target for the new scroll position
      onDragUpdate(lastTranslationRef.current);
    }, 16);
  }, [scrollRef, scrollOffsetRef, scrollDeltaY, stopAutoScroll, onDragUpdate]);

  const handleDragStartInternal = useCallback(() => {
    dragStartScrollRef.current = scrollOffsetRef.current ?? 0;
    lastTranslationRef.current = 0;
    onDragStart();
  }, [scrollOffsetRef, onDragStart]);

  const handleDragUpdateInternal = useCallback((translationY: number, absoluteY: number) => {
    lastTranslationRef.current = translationY;
    // Update scroll delta for visual tracking (in case scroll changed without auto-scroll)
    scrollDeltaY.value = (scrollOffsetRef.current ?? 0) - dragStartScrollRef.current;
    onDragUpdate(translationY);
    handleEdgeScroll(absoluteY);
  }, [scrollOffsetRef, scrollDeltaY, onDragUpdate, handleEdgeScroll]);

  const gesture = Gesture.Pan()
    .activateAfterLongPress(250)
    .failOffsetX([-15, 15])
    .enabled(!isLocked)
    .onStart(() => {
      'worklet';
      active.value = true;
      fingerTranslateY.value = 0;
      scrollDeltaY.value = 0;
      runOnJS(handleDragStartInternal)();
    })
    .onUpdate((e) => {
      'worklet';
      fingerTranslateY.value = e.translationY;
      runOnJS(handleDragUpdateInternal)(e.translationY, e.absoluteY);
    })
    .onEnd(() => {
      'worklet';
      active.value = false;
      fingerTranslateY.value = withTiming(0, { duration: 200 });
      scrollDeltaY.value = withTiming(0, { duration: 200 });
      runOnJS(stopAutoScroll)();
      runOnJS(onDragEnd)();
    })
    .onFinalize(() => {
      'worklet';
      if (active.value) {
        active.value = false;
        fingerTranslateY.value = withTiming(0, { duration: 200 });
        scrollDeltaY.value = withTiming(0, { duration: 200 });
        runOnJS(stopAutoScroll)();
        runOnJS(onDragEnd)();
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: fingerTranslateY.value + scrollDeltaY.value },
      { scale: withTiming(active.value ? 1.05 : 1, { duration: 180 }) },
      { rotate: withTiming(active.value ? '-1deg' : '0deg', { duration: 180 }) },
    ],
    zIndex: active.value ? 999 : 0,
    elevation: active.value ? 16 : 0,
    opacity: withTiming(active.value ? 1 : 1, { duration: 150 }),
    shadowOpacity: withTiming(active.value ? 0.35 : 0, { duration: 180 }),
    shadowOffset: { width: 0, height: active.value ? 12 : 0 },
    shadowRadius: active.value ? 24 : 0,
    shadowColor: '#000',
    borderRadius: active.value ? 12 : 0,
    borderWidth: withTiming(active.value ? 2 : 0, { duration: 150 }),
    borderColor: '#000',
    backgroundColor: active.value ? 'rgba(0, 0, 0, 0.03)' : 'transparent',
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={animatedStyle}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

function tripDuration(start: string, end: string) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const days = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
  return `${days} night${days !== 1 ? 's' : ''}`;
}

export default function TripWorkspace() {
  const { id, openEdit, day: dayParam, addActivity: addActivityParam, applyCommand, applyDay, applySearch, applyStartAfter, openPulse: openPulseParam, fromStaySearch } = useLocalSearchParams<{ id: string; openEdit?: string; day?: string; addActivity?: string; applyCommand?: string; applyDay?: string; applySearch?: string; applyStartAfter?: string; openPulse?: string; fromStaySearch?: string }>();
  const { trips, getTrip, loaded: tripsLoaded, toggleLock, setTripActivities, addActivity, removeActivity, moveActivity, replaceActivity, updateActivity, updateTrip, updateTripPrepItems, updateTripBudget, updateTripExpenses, addReservation, attachReservation, updateReservation, removeReservation } = useTrips();
  const { profile } = useProfile();
  const { session, user } = useAuth();
  const { entries: memoryEntries, addEntry: addMemoryEntry } = useMemory();
  const theme = useTheme();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();

  const [askVisible, setAskVisible] = useState(false);
  const [aiEditLoading, setAiEditLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | undefined>();

  // Edit chat state
  interface EditChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    suggestions?: string[];
    actionResults?: { label: string; detail?: string }[];
    pendingActions?: TripAction[];
    places?: ChatPlace[];
    context?: string;
    failed?: boolean;
    timestamp: number;
  }
  interface EditChatThread {
    id: string;
    title: string;
    messages: EditChatMessage[];
    updatedAt: number;
    pinned?: boolean;
  }
  const [editChatMessages, setEditChatMessages] = useState<EditChatMessage[]>([]);
  const [editChatInput, setEditChatInput] = useState('');
  const [editChatTyping, setEditChatTyping] = useState(false);
  const [editChatTypingMessage, setEditChatTypingMessage] = useState('Working on it...');
  const [editChatKeyboardVisible, setEditChatKeyboardVisible] = useState(false);
  const [editChatSuggestions, setEditChatSuggestions] = useState<string[]>([]);
  const editChatLoadedRef = useRef<string | null>(null);
  const editChatSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Thread management
  const [editThreads, setEditThreads] = useState<EditChatThread[]>([]);
  const [editActiveThreadId, setEditActiveThreadId] = useState<string | null>(null);
  const [showEditThreadList, setShowEditThreadList] = useState(false);
  const [editThreadOptionsId, setEditThreadOptionsId] = useState<string | null>(null);
  const [editRenameThreadId, setEditRenameThreadId] = useState<string | null>(null);
  const [editRenameText, setEditRenameText] = useState('');
  const [viewMode, setViewMode] = useState<'itinerary' | 'ai' | 'map' | 'prep' | 'budget' | 'reservations' | 'alerts'>('itinerary');
  const [newPrepItem, setNewPrepItem] = useState('');
  const [editingPrepId, setEditingPrepId] = useState<string | null>(null);
  const [editPrepText, setEditPrepText] = useState('');
  const [showAddPrep, setShowAddPrep] = useState(false);
  const [newPrepCategory, setNewPrepCategory] = useState<PrepItem['category']>('other');
  const [collapsedPrepCats, setCollapsedPrepCats] = useState<Set<string>>(new Set());
  const [editBudgetTotal, setEditBudgetTotal] = useState(false);
  const [budgetTotalInput, setBudgetTotalInput] = useState('');
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [newExpenseLabel, setNewExpenseLabel] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  const [newExpenseCategory, setNewExpenseCategory] = useState('Other');
  const [newExpenseDay, setNewExpenseDay] = useState<string>('');
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editExpenseLabel, setEditExpenseLabel] = useState('');
  const [editExpenseAmount, setEditExpenseAmount] = useState('');
  const [editExpenseCategory, setEditExpenseCategory] = useState('Other');
  const [editExpenseDay, setEditExpenseDay] = useState<string>('');
  const [addingToDay, setAddingToDay] = useState<number | null>(null);
  const [actSearchQuery, setActSearchQuery] = useState('');
  const [actSearchResults, setActSearchResults] = useState<NormalizedPlace[]>([]);
  const [actSearchLoading, setActSearchLoading] = useState(false);
  const actSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actSearchReturnDay = useRef<number | null>(null);
  const [actSuggestions, setActSuggestions] = useState<NormalizedPlace[]>([]);
  const [actSuggestionsLoaded, setActSuggestionsLoaded] = useState(false);
  const [actSelectedPlace, setActSelectedPlace] = useState<NormalizedPlace | null>(null);
  const [actConfirmStep, setActConfirmStep] = useState<'preview' | 'time'>('preview');
  const [actConfirmTime, setActConfirmTime] = useState('10:00');
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('10:00');
  const [newType, setNewType] = useState<Activity['type']>('activity');
  const [newCost, setNewCost] = useState<string>('');
  const [newAddress, setNewAddress] = useState('');
  const [newActivityNotes, setNewActivityNotes] = useState('');
  const [newFixed, setNewFixed] = useState(false);

  // Day filter
  const [filterDay, setFilterDay] = useState<number | null>(null);
  const [activeDayCardIdx, setActiveDayCardIdx] = useState(0);

  // Quick action chips
  const [quickActionDay, setQuickActionDay] = useState<number | null>(null);

  // AI Add Activity sheet
  const [showAIAddSheet, setShowAIAddSheet] = useState(false);
  const [aiAddLoading, setAiAddLoading] = useState(false);
  const [aiAddSuggestions, setAiAddSuggestions] = useState<NaturalSearchSuggestion[]>([]);
  const [aiAddQuery, setAiAddQuery] = useState('');
  const [aiAddDay, setAiAddDay] = useState<number>(1);

  // Activity editing
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editType, setEditType] = useState<Activity['type']>('activity');

  const [transformResult, setTransformResult] = useState<{
    summary: string;
    changes: string[];
    whyFits?: string;
    memoryEntry?: {
      type: string;
      category: string;
      detail: string;
    };
  } | null>(null);
  // Alerts toggle (persisted via TripPulseProvider)
  const { enabled: alertsEnabled, loaded: alertsLoaded, setEnabled: setAlertsEnabled } = useTripPulse();
  // Internal pulse dismissed/seen state
  const [dismissedPulse, setDismissedPulse] = useState<Set<string>>(new Set());
  const [seenPulse, setSeenPulse] = useState<Set<string>>(new Set());
  const pulseHistory = usePulseHistory();
  // External trip alerts state
  const [tripAlerts, setTripAlerts] = useState<TripAlertResult[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const alertsFetchedForRef = useRef<string | null>(null);
  // Switch to alerts tab when navigated from a notification tap
  useEffect(() => {
    if (openPulseParam === '1') {
      setViewMode('alerts');
      handleAlertsOpen();
    }
  }, [openPulseParam]);

  // Load persisted dismissed/seen pulse state
  useEffect(() => {
    loadDismissedPulse().then((ids) => { if (ids.length > 0) setDismissedPulse(new Set(ids)); });
    loadSeenPulse().then((ids) => { if (ids.length > 0) setSeenPulse(new Set(ids)); });
  }, []);

  // Scroll to highlighted activity after navigating from an alert
  useEffect(() => {
    if (!highlightedActivityId) return;
    const timer = setTimeout(() => {
      const layout = itemLayoutsRef.current.get(highlightedActivityId);
      if (layout) {
        scrollRef.current?.scrollTo({ y: layout.y, animated: true });
      }
    }, 400);
    const clearTimer = setTimeout(() => {
      setHighlightedActivityId(null);
    }, 3000);
    return () => { clearTimeout(timer); clearTimeout(clearTimer); };
  }, [highlightedActivityId, filterDay]);


  // Trip editing
  const [showTripEdit, setShowTripEdit] = useState(false);
  const [editTripTitle, setEditTripTitle] = useState('');
  const [editDest, setEditDest] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTravelers, setEditTravelers] = useState('');
  const [editDepartureFrom, setEditDepartureFrom] = useState('');
  const [editBudget, setEditBudget] = useState<'$' | '$$' | '$$$' | '$$$$'>('$$');
  const [editPace, setEditPace] = useState<'relaxed' | 'moderate' | 'active'>('moderate');
  const [editTravelWith, setEditTravelWith] = useState<'solo' | 'partner' | 'family' | 'friends' | 'group'>('solo');
  const [editRestrictions, setEditRestrictions] = useState('');
  const [editTripInstructions, setEditTripInstructions] = useState('');
  const [showEditStartPicker, setShowEditStartPicker] = useState(false);
  const [showEditEndPicker, setShowEditEndPicker] = useState(false);

  // Stay search modal (search-to-add-stay)
  const [showStaySearchModal, setShowStaySearchModal] = useState(false);
  const [resSearchQuery, setResSearchQuery] = useState('');
  const [resSearchResults, setResSearchResults] = useState<NormalizedPlace[]>([]);
  const [resSearchLoading, setResSearchLoading] = useState(false);
  const resSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resSelectedPlace, setResSelectedPlace] = useState<NormalizedPlace | null>(null);

  // Booking modal (AddBookingModal — shared with My Bookings & stay-detail)
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingEditRes, setBookingEditRes] = useState<{ res: Reservation; tripId: string } | null>(null);
  const [bookingModalFixedType, setBookingModalFixedType] = useState<ReservationType | undefined>(undefined);

  // Confirmed booking bottom sheet (replaces /stay-detail navigation)
  const [bookingSheetData, setBookingSheetData] = useState<{ res: Reservation; trip: Trip; photoUrl?: string } | null>(null);
  const [unbookedStayData, setUnbookedStayData] = useState<{ activity: Activity; trip: Trip; photoUrl?: string } | null>(null);

  // Pending bookings from email
  const [pendingBookings, setPendingBookings] = useState<ParsedBooking[]>([]);
  const [pendingImportData, setPendingImportData] = useState<ParsedBooking | null>(null);

  // Members tab form

  // Move activity to different day/time
  const [movingActivity, setMovingActivity] = useState<Activity | null>(null);
  const [moveDay, setMoveDay] = useState(1);
  const [moveTime, setMoveTime] = useState('');

  // Smart Replace picker
  const [replaceTarget, setReplaceTarget] = useState<Activity | null>(null);
  const [replaceAlternatives, setReplaceAlternatives] = useState<{
    title: string; description: string; cost: string; crowdLevel: string; whyFits: string;
  }[]>([]);

  // Manual Replace modal
  const [manualReplaceTarget, setManualReplaceTarget] = useState<Activity | null>(null);
  const [manualReplaceName, setManualReplaceName] = useState('');
  const [manualReplaceTime, setManualReplaceTime] = useState('');

  // Hotel suggestions (stays strip)
  const [hotelSuggestions, setHotelSuggestions] = useState<NormalizedPlace[]>([]);
  const [hotelPhotoUrls, setHotelPhotoUrls] = useState<Map<string, string>>(new Map());

  // Activity-specific customization target
  const [customizeTarget, setCustomizeTarget] = useState<Activity | null>(null);
  // Context menu state (hold or "..." tap)
  const [contextMenuActivity, setContextMenuActivity] = useState<Activity | null>(null);
  const [droppedActivityId, setDroppedActivityId] = useState<string | null>(null);
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);

  const [scopePickerCommand, setScopePickerCommand] = useState<ToveliCommand | null>(null);
  const [scopePickerDays, setScopePickerDays] = useState<Set<number>>(new Set());
  const [scopePickerSearchTerms, setScopePickerSearchTerms] = useState<string | undefined>(undefined);
  const [scopePickerStartAfter, setScopePickerStartAfter] = useState<string | undefined>(undefined);

  // Store pending transformation for preview-before-apply
  const [pendingTransform, setPendingTransform] = useState<{
    activities: Activity[];
    summary: string;
    changes: string[];
    whyFits?: string;
    memoryEntry?: { type: MemoryEntryType; category: MemoryCategory; detail: string };
    preview?: ChangePreview;
    conflicts?: ReturnType<typeof checkConflicts>;
  } | null>(null);

  // Subscription gates
  const chatGate = useGate('chat');
  const editGate = useGate('edit_trip');
  const searchGate = useGate('natural_search');
  const exportGate = useGate('export_pdf');
  const { refresh: refreshSubscription } = useSubscription();
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<'edit_trip' | 'analyze_trip' | 'natural_search' | 'import_place' | 'chat' | 'export_pdf'>('edit_trip');
  const [showShareSheet, setShowShareSheet] = useState(false);

  const trip = trips.find((t) => t.id === id);

  useEffect(() => {
    if (trip) {
      navigation.setOptions({ headerShown: false });
    }
  }, [trip, navigation]);

  // Set filter to specific day when navigated with ?day=N
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (dayParam) {
      const d = parseInt(dayParam, 10);
      if (d > 0) setFilterDay(d);
    }
  }, [dayParam]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Reopen reservation modal in search mode when returning from place-detail
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (fromStaySearch === '1') {
      setShowStaySearchModal(true);
      router.setParams({ fromStaySearch: undefined as any });
    }
  }, [fromStaySearch]);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (actSearchReturnDay.current != null) {
        setAddingToDay(actSearchReturnDay.current);
        actSearchReturnDay.current = null;
      }
    });
    return unsub;
  }, [navigation]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Track last-viewed trip so the chat tab can use it as default context
  useEffect(() => {
    if (trip?.id) setLastViewedTripId(trip.id);
  }, [trip?.id]);

  // Open edit modal when navigated with ?openEdit=1
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (openEdit === '1' && trip) {
      setEditTripTitle(trip.title ?? trip.destination);
      setEditDest(trip.destination);
      setEditStartDate(trip.startDate);
      setEditEndDate(trip.endDate);
      setEditNotes(trip.notes || '');
      setShowTripEdit(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEdit, trip?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Open Add Activity modal when navigated with ?addActivity=1&day=N
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (addActivityParam === '1' && trip) {
      const d = dayParam ? parseInt(dayParam, 10) : 1;
      setAddingToDay(d > 0 ? d : 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addActivityParam, trip?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Fetch hotel suggestions when there are uncovered nights or no stays at all
  const tripHasHotel = trip?.activities.some((a) => a.type === 'hotel') ?? false;
  useEffect(() => {
    if (!trip || tripHasHotel) return;
    let cancelled = false;
    fetchExplorePlaces(
      { type: 'trip', tripId: trip.id, destination: trip.destination, label: trip.destination },
      'stays',
    ).then((places) => {
      if (cancelled) return;
      const top = places.slice(0, 3);
      setHotelSuggestions(top);
      // Batch-prefetch all photos at once (cache check + parallel Google fetches)
      const photoPlaces = top
        .filter((p) => p.photos?.[0]?.reference)
        .map((p) => ({ cacheKey: p.placeId ?? p.name, photoRef: p.photos![0].reference, name: p.name, category: p.category }));
      prefetchPhotos(photoPlaces);
      // Also fire individual requests to update state as each resolves
      top.forEach((place) => {
        const photoRef = place.photos?.[0]?.reference;
        if (!photoRef) return;
        getPlacePhoto({
          cacheKey: place.placeId ?? place.name,
          photoRef,
          name: place.name,
          category: place.category,
        }).then((result) => {
          if (!cancelled && result) {
            setHotelPhotoUrls((prev) => {
              const next = new Map(prev);
              next.set(place.placeId ?? place.name, result.url);
              return next;
            });
          }
        });
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, tripHasHotel]);

  // Fetch pending bookings from email (refresh when modal closes)
  useEffect(() => {
    getParsedBookingsAI()
      .then((res) => setPendingBookings(res.bookings.filter((b: ParsedBooking) => b.status === 'pending')))
      .catch(() => {});
  }, [showBookingModal]);

  // Fetch activity suggestions for "add activity" modal
  useEffect(() => {
    if (!trip || actSuggestionsLoaded) return;
    let cancelled = false;
    fetchExplorePlaces(
      { type: 'trip', tripId: trip.id, destination: trip.destination, label: trip.destination },
      'for_you',
    ).then((places) => {
      if (!cancelled) {
        // Filter out places already in the trip
        const existingPlaceIds = new Set(trip.activities.map((a) => a.placeId).filter(Boolean));
        const filtered = places.filter((p) => !p.placeId || !existingPlaceIds.has(p.placeId));
        const top = filtered.slice(0, 8);
        setActSuggestions(top);
        setActSuggestionsLoaded(true);
        // Batch-prefetch all photos at once so StaySearchResultRow gets instant cache hits
        const photoPlaces = top
          .filter((p) => p.photos?.[0]?.reference)
          .map((p) => ({ cacheKey: p.placeId ?? p.name, photoRef: p.photos![0].reference, name: p.name, category: p.category }));
        prefetchPhotos(photoPlaces);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, actSuggestionsLoaded]);

  // Destination photo — must be before early returns (hook ordering rule)
  const heroPhotoQuery = trip ? `${trip.destination}, ${trip.country}` : '';
  const heroPhoto = useDestinationPhoto(heroPhotoQuery);

  // Activity thumbnails — batch prefetch from shared cache
  const activityPlaceIds = useMemo(
    () => (trip?.activities ?? []).map((a) => a.placeId).filter((id): id is string => !!id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip?.id, trip?.activities.length],
  );
  const activityPhotoHints = useMemo(
    () => (trip?.activities ?? [])
      .filter((a): a is typeof a & { placeId: string } => !!a.placeId)
      .map((a) => ({ placeId: a.placeId, name: a.title, destination: trip?.destination })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip?.id, trip?.activities.length],
  );
  const activityNameHints = useMemo(
    () => (trip?.activities ?? [])
      .filter((a) => !a.placeId && !!a.title)
      .map((a) => ({ key: a.id, name: a.title, destination: trip?.destination })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip?.id, trip?.activities.length],
  );
  const { photos: activityPhotos } = useActivityPhotos(activityPlaceIds, activityPhotoHints, activityNameHints);

  // Weather forecast for weather-aware pulse alerts
  const [weatherForecast, setWeatherForecast] = useState<import('@/services/weather').TripWeatherForecast | null>(null);
  useEffect(() => {
    if (!trip) return;
    const actWithCoords = trip.activities.find((a) => a.lat != null && a.lng != null);
    if (!actWithCoords || actWithCoords.lat == null || actWithCoords.lng == null) return;
    let cancelled = false;
    import('@/services/weather').then((wx) => {
      wx.fetchWeatherForecast(actWithCoords.lat!, actWithCoords.lng!, trip.startDate, trip.endDate).then((forecast) => {
        if (!cancelled) setWeatherForecast(forecast);
      });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, trip?.startDate, trip?.endDate]);

  // Notification scheduling is handled centrally by AppPulseEvaluator — no local scheduling here.

  // Apply command from chat navigation — ref pattern keeps the hook before early returns
  // while the actual handler (defined later) is assigned after.
  const handleCommandRef = useRef<(cmd: string, day?: number, scope?: TransformScope, search?: string, sa?: string) => void>();
  const openSwipeRef = useRef<Swipeable | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const [dragState, setDragState] = useState<{ activityId: string; day: number; fromIdx: number; targetDay: number; targetIdx: number; previewTime: string } | null>(null);
  const dragTargetRef = useRef<{ day: number; idx: number }>({ day: -1, idx: -1 });
  const itemLayoutsRef = useRef<Map<string, { y: number; height: number }>>(new Map());
  const dayLayoutsRef = useRef<Map<number, { y: number; height: number }>>(new Map());
  const timelineOffsetsRef = useRef<Map<number, number>>(new Map());
  const dragStartScrollRef = useRef(0);
  const dragLayoutSnapshotRef = useRef<{ items: Map<string, { y: number; height: number }>; days: Map<number, { y: number; height: number }> }>({ items: new Map(), days: new Map() });
  useEffect(() => {
    if (applyCommand && trip && handleCommandRef.current) {
      const day = applyDay ? parseInt(applyDay, 10) : undefined;
      const search = applySearch ? decodeURIComponent(applySearch) : undefined;
      const sa = applyStartAfter ? decodeURIComponent(applyStartAfter) : undefined;
      const scope: TransformScope | undefined = day != null ? { type: 'day', day } : undefined;
      handleCommandRef.current(applyCommand, day, scope, search, sa);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyCommand, trip?.id]);

  // Schedule booking reminder notifications when trip/booking status changes
  const bookedCount = trip?.activities.filter((a) => a.bookingStatus === 'booked').length ?? 0;
  useEffect(() => {
    if (!trip) return;
    loadBookingRemindersEnabled().then((enabled) => {
      if (!enabled) { cancelBookingReminders(trip.id); return; }
      const unbookedCritical = trip.activities.filter(
        (a) => (a.type === 'hotel' || a.type === 'flight') && a.bookingStatus !== 'booked',
      );
      if (unbookedCritical.length > 0) {
        scheduleBookingReminders(trip.id, trip.destination, unbookedCritical.length, trip.startDate);
      } else {
        cancelBookingReminders(trip.id);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, bookedCount]);

  // Schedule departure reminder + daily briefings when trip is viewed
  useEffect(() => {
    if (!trip || trip.activities.length === 0) return;
    loadDepartureReminderEnabled().then((enabled) => {
      if (enabled) scheduleDepartureReminder(trip.id, trip.destination, trip.startDate);
    });
    loadDailyBriefingEnabled().then((enabled) => {
      if (!enabled) return;
      const byDay = new Map<number, string[]>();
      for (const a of trip.activities) {
        if (a.type === 'activity' || a.type === 'food') {
          const list = byDay.get(a.day) ?? [];
          list.push(a.title);
          byDay.set(a.day, list);
        }
      }
      scheduleDailyBriefings(trip.id, trip.destination, trip.startDate, trip.endDate, byDay);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, trip?.activities.length]);

  // Loading state while AsyncStorage hydrates
  if (!tripsLoaded) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>Loading trip...</ThemedText>
      </ThemedView>
    );
  }

  if (!trip) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ThemedText style={{ fontSize: 18 }}>Trip not found</ThemedText>
      </ThemedView>
    );
  }

  // Capture as non-null for closures
  const currentTrip = trip;
  const totalDays = getTripDayCount(currentTrip.startDate, currentTrip.endDate);

  // Stays data — compute night-by-night hotel coverage
  const staysData = useMemo((): StaysData => {
    const hotelActivities = currentTrip.activities
      .filter((a) => a.type === 'hotel')
      .sort((a, b) => a.day - b.day);
    const reservations = currentTrip.reservations ?? [];
    const blocks: StayBlock[] = [];

    for (let idx = 0; idx < hotelActivities.length; idx++) {
      const hotel = hotelActivities[idx];
      const linkedRes = hotel.reservationId
        ? reservations.find((r) => r.id === hotel.reservationId)
        : undefined;

      // Determine check-out day (exclusive)
      let checkOutDay = hotel.day + 1;
      // Prefer the structured checkOutDate field; fall back to legacy notes regex
      const rawCheckOut = linkedRes?.checkOutDate
        ?? linkedRes?.notes?.match(/Check-out:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
      if (rawCheckOut && currentTrip.datesKnown !== false) {
        const tripStart = new Date(currentTrip.startDate + 'T00:00:00');
        const coDate = new Date(rawCheckOut + 'T00:00:00');
        const diffDays = Math.round((coDate.getTime() - tripStart.getTime()) / 86400000) + 1;
        checkOutDay = Math.max(hotel.day + 1, Math.min(diffDays, totalDays + 1));
      }
      // Clamp to next hotel's check-in if overlapping
      const nextHotel = hotelActivities[idx + 1];
      if (nextHotel && checkOutDay > nextHotel.day) {
        checkOutDay = nextHotel.day;
      }

      const nights: number[] = [];
      for (let n = hotel.day; n < checkOutDay && n <= totalDays; n++) nights.push(n);

      blocks.push({ hotel, reservation: linkedRes, checkInDay: hotel.day, checkOutDay, nights });
    }

    // Uncovered nights
    const covered = new Set(blocks.flatMap((b) => b.nights));
    const uncovered: number[] = [];
    for (let n = 1; n <= totalDays; n++) if (!covered.has(n)) uncovered.push(n);

    // Group into contiguous ranges
    const uncoveredRanges: { start: number; end: number }[] = [];
    let rangeStart = -1;
    for (let i = 0; i < uncovered.length; i++) {
      if (rangeStart < 0) rangeStart = uncovered[i];
      if (i === uncovered.length - 1 || uncovered[i + 1] !== uncovered[i] + 1) {
        uncoveredRanges.push({ start: rangeStart, end: uncovered[i] });
        rangeStart = -1;
      }
    }

    return { blocks, uncoveredRanges, hasAnyStay: blocks.length > 0 };
  }, [currentTrip.activities, currentTrip.reservations, currentTrip.startDate, currentTrip.datesKnown, totalDays]);

  // ── Internal pulse alerts (conflicts, weather, flight timing, etc.) ──
  const itineraryRevision = currentTrip.itineraryRevision ?? 0;
  const allPulseAlerts = (alertsEnabled && alertsLoaded)
    ? runTripPulse(currentTrip, profile, memoryEntries, Infinity, weatherForecast)
    : [];
  const activePulseAlerts = allPulseAlerts.filter(
    (a) => !isPulseDismissed(dismissedPulse, currentTrip.id, a.id, itineraryRevision)
  );

  // ── Closure alerts — activity opening hours vs scheduled day ──
  const closureAlerts: TripAlertResult[] = useMemo(() => {
    if (!alertsEnabled || currentTrip.datesKnown === false || !currentTrip.startDate) return [];
    const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const results: TripAlertResult[] = [];
    const start = new Date(currentTrip.startDate + 'T00:00:00');
    for (const activity of currentTrip.activities) {
      if (!activity.openingHours || activity.openingHours.length === 0) continue;
      if (activity.type === 'flight' || activity.type === 'hotel') continue;
      const actDate = new Date(start);
      actDate.setDate(actDate.getDate() + activity.day - 1);
      const dow = actDate.getDay();
      const dayPeriod = activity.openingHours.find((p) => p.startsWith(DAY_ABBR[dow]));
      if (dayPeriod && dayPeriod.toLowerCase().includes('closed')) {
        results.push({
          id: `closure-${activity.id}`,
          type: 'closure',
          severity: 'urgent',
          title: `${activity.title} may be closed`,
          message: `"${activity.title}" appears to be closed on ${DAY_FULL[dow]}s. Consider rescheduling or confirming before your visit.`,
        });
      }
    }
    return results;
  }, [currentTrip.activities, currentTrip.startDate, currentTrip.datesKnown, alertsEnabled]);

  // ── Combined alert count for badge ──
  const makeSeenKey = (alertId: string) => `${currentTrip.id}:${alertId}`;
  const activeClosureAndExternal = [
    ...closureAlerts.filter((a) => !dismissedAlerts.has(a.id)),
    ...tripAlerts.filter((a) => !dismissedAlerts.has(a.id)),
  ];
  const newIssueCount = activePulseAlerts.length + activeClosureAndExternal.length;

  function syncPulseState(dismissed: Set<string>, seen: Set<string>) {
    if (pulseSyncTimerRef.current) clearTimeout(pulseSyncTimerRef.current);
    pulseSyncTimerRef.current = setTimeout(() => {
      saveDismissedPulse([...dismissed]);
      saveSeenPulse([...seen]);
    }, 500);
  }

  async function fetchTripAlerts() {
    if (!currentTrip.destination) return;
    setAlertsLoading(true);
    try {
      const result = await getTripAlertsAI({
        destination: currentTrip.destination,
        startDate: currentTrip.startDate && !currentTrip.startDate.startsWith('2099') ? currentTrip.startDate : undefined,
        endDate: currentTrip.endDate && !currentTrip.endDate.startsWith('2099') ? currentTrip.endDate : undefined,
      });
      const alerts = result.alerts ?? [];
      setTripAlerts(alerts);
      setDismissedAlerts(new Set());
      alertsFetchedForRef.current = currentTrip.id;
      // Persist to cache so next visit is instant
      saveTripExternalAlerts(currentTrip.id, alerts).catch(() => {});
    } catch {
      // silently fail
    } finally {
      setAlertsLoading(false);
    }
  }

  // Load cached external alerts on mount (instant — no spinner for first visit after trip creation)
  useEffect(() => {
    if (!currentTrip?.id || alertsFetchedForRef.current === currentTrip.id) return;
    loadTripExternalAlerts(currentTrip.id).then((cached) => {
      if (cached && cached.alerts.length > 0 && alertsFetchedForRef.current !== currentTrip.id) {
        setTripAlerts(cached.alerts);
        alertsFetchedForRef.current = currentTrip.id;
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrip?.id]);

  function handleAlertsOpen() {
    if (!alertsEnabled) return;
    // Mark pulse alerts as seen
    const newSeen = new Set(seenPulse);
    for (const a of activePulseAlerts) newSeen.add(makeSeenKey(a.id));
    setSeenPulse(newSeen);
    syncPulseState(dismissedPulse, newSeen);
    // Fetch external alerts if not yet loaded for this trip
    if (alertsFetchedForRef.current !== currentTrip.id) {
      fetchTripAlerts();
    }
  }

  function handlePulseDismiss(alertId: string) {
    const scopedKey = makePulseDismissalKey(currentTrip.id, alertId, itineraryRevision);
    const next = new Set(dismissedPulse).add(scopedKey);
    setDismissedPulse(next);
    syncPulseState(next, seenPulse);
    pulseHistory.resolveAlert(currentTrip.id, alertId);
  }

  function handleAlertDismiss(alertId: string) {
    // Route to the right dismiss handler
    if (allPulseAlerts.some((a) => a.id === alertId)) {
      handlePulseDismiss(alertId);
    } else {
      setDismissedAlerts((prev) => new Set([...prev, alertId]));
    }
  }

  // Activity reaction handler — saves memory signal + triggers smart replace
  function handleActivityReaction(activity: Activity, reaction: ReactionOption) {
    // Save to memory
    addMemoryEntry({
      type: 'activity_skipped',
      category: reaction.memoryCategory,
      detail: reaction.memoryDetail(activity),
      tripId: currentTrip.id,
      isGlobal: true,
      origin: `Reaction on "${activity.title}" in ${currentTrip.destination}`,
      destination: currentTrip.destination,
    });
    showToast('Preference saved', 'success');
    // Trigger smart replace to find an alternative
    handleSmartReplace(activity);
  }

  // Booking handler — opens affiliate/deep link in the in-app browser
  async function handleBookActivity(activity: Activity) {
    const link = getPrimaryBookingLink(
      activity,
      currentTrip.startDate,
      currentTrip.endDate,
      currentTrip.destination,
      currentTrip.travelers,
    );
    const url = link
      ? link.url
      : `https://www.google.com/search?q=${encodeURIComponent(`${activity.title} ${currentTrip.destination} book`)}`;

    // In-app browser resolves when user dismisses — no setTimeout needed
    await openBookingLink(url);

    Alert.alert(
      'Booking status',
      `Did you complete the booking for "${activity.title}"?`,
      [
        {
          text: 'Yes, booked!',
          onPress: () => {
            updateActivity(currentTrip.id, activity.id, { bookingStatus: 'booked' });
            // Auto-create a linked reservation
            const resType: import('@/context/trips').ReservationType =
              activity.type === 'food' ? 'restaurant'
              : activity.type === 'hotel' ? 'hotel'
              : activity.type === 'flight' ? 'flight'
              : 'activity';
            addReservation(currentTrip.id, {
              type: resType,
              title: activity.title,
              day: activity.day,
              time: activity.time,
              address: activity.address,
              bookingUrl: url,
            });
            showToast(`"${activity.title}" marked as booked`, 'success');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
        {
          text: 'Pending',
          onPress: () => {
            updateActivity(currentTrip.id, activity.id, { bookingStatus: 'pending' });
            showToast(`"${activity.title}" marked as pending`);
          },
        },
        { text: 'Not yet', style: 'cancel' },
      ],
    );
  }

  function getBookLabel(activity: Activity): string {
    const link = getPrimaryBookingLink(activity, currentTrip.startDate, currentTrip.endDate, currentTrip.destination);
    return link?.shortLabel ?? 'Book';
  }


  // Import a pending booking from email — auto-match hotels to activities in this trip
  function handleImportPendingBooking(booking: ParsedBooking) {
    const data = booking.booking_data;
    const resType = data.reservationType ?? 'other';

    if (resType === 'hotel' && data.name) {
      const nameLC = data.name.toLowerCase();
      const matchActivity = currentTrip.activities.find(
        (act) => act.type === 'hotel' && !act.reservationId &&
        (act.title.toLowerCase().includes(nameLC) || nameLC.includes(act.title.toLowerCase())),
      );

      if (matchActivity) {
        Alert.alert(
          'Existing Stay Found',
          `"${matchActivity.title}" is already in your trip. Link this booking to it?`,
          [
            {
              text: 'Link to Stay',
              onPress: async () => {
                attachReservation(currentTrip.id, matchActivity.id, {
                  type: 'hotel',
                  title: data.name!,
                  day: matchActivity.day,
                  confirmationNumber: data.confirmationNumber ?? undefined,
                  price: data.price ?? undefined,
                  currency: data.currency ?? undefined,
                  date: data.bookingDate ?? undefined,
                  checkOutDate: data.checkoutDate ?? undefined,
                  fixed: true,
                });
                await markBookingImportedAI(booking.id).catch(() => {});
                setPendingBookings((prev) => prev.filter((b) => b.id !== booking.id));
                showToast(`Linked to ${matchActivity.title}`, 'success');
              },
            },
            {
              text: 'Add as New',
              onPress: () => {
                setBookingEditRes(null);
                setPendingImportData(booking);
                setShowBookingModal(true);
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }
    }

    setBookingEditRes(null);
    setPendingImportData(booking);
    setShowBookingModal(true);
  }

  // Dismiss a pending email booking
  async function handleDismissPendingBooking(booking: ParsedBooking) {
    try {
      await dismissParsedBookingAI(booking.id);
      setPendingBookings((prev) => prev.filter((b) => b.id !== booking.id));
      showToast('Booking dismissed', 'success');
    } catch {
      showToast('Could not dismiss', 'error');
    }
  }

  // Copy confirmation number to clipboard
  async function handleCopyConfirmationNumber(text: string) {
    await Clipboard.setStringAsync(text);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showToast('Copied to clipboard', 'success');
  }

  // Group activities by day (exclude hotels — shown in Stays section)
  const dayMap = new Map<number, Activity[]>();
  for (const act of currentTrip.activities) {
    if (act.type === 'hotel') continue;
    const existing = dayMap.get(act.day) ?? [];
    existing.push(act);
    dayMap.set(act.day, existing);
  }

  // Include all days even empty ones
  const allDays: number[] = [];
  for (let d = 1; d <= totalDays; d++) {
    allDays.push(d);
  }

  // Day card carousel dimensions — slightly narrower so next card peeks in
  const screenWidth = Dimensions.get('window').width;
  const dayCardWidth = screenWidth - Spacing.four * 2 - 40;

  // Collect up to 3 photo URLs for a day's activities (for day card collage)
  const getDayPhotoUrls = useCallback((day: number): string[] => {
    const activities = (dayMap.get(day) ?? []).sort(compareByTime);
    const urls: string[] = [];
    for (const a of activities) {
      if (urls.length >= 3) break;
      const url = activityPhotos.get(a.placeId ?? a.id);
      if (url && !urls.includes(url)) urls.push(url);
    }
    return urls;
  }, [dayMap, activityPhotos]);

  // Navigate to place-detail for an activity
  function handleActivityTap(activity: Activity) {
    if (!activity.placeId && !activity.title) return;
    let url = `/place-detail?name=${encodeURIComponent(activity.title)}`;
    if (activity.placeId) url += `&placeId=${encodeURIComponent(activity.placeId)}`;
    if (activity.address) url += `&address=${encodeURIComponent(activity.address)}`;
    if (activity.lat != null) url += `&lat=${activity.lat}`;
    if (activity.lng != null) url += `&lng=${activity.lng}`;
    if (activity.rating != null) url += `&rating=${activity.rating}`;
    if (activity.reviewCount != null) url += `&reviewCount=${activity.reviewCount}`;
    if (activity.category) url += `&category=${encodeURIComponent(activity.category)}`;
    if (currentTrip.destination) url += `&destination=${encodeURIComponent(currentTrip.destination)}`;
    router.push(url as any);
  }

  // Context menu handlers
  function handleContextRemove(activity: Activity) {
    const isActivityProtected = !!(activity.locked || activity.fixed);
    Alert.alert(
      'Remove activity?',
      isActivityProtected
        ? `This activity is protected from automatic changes. Are you sure you want to manually remove "${activity.title}"?`
        : `Remove "${activity.title}" from Day ${activity.day}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setTripActivities(
              currentTrip.id,
              currentTrip.activities.filter((a) => a.id !== activity.id),
              `Removed "${activity.title}"`,
              isActivityProtected,
            );
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          },
        },
      ],
    );
  }

  function handleContextLock(activity: Activity) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleLock(currentTrip.id, activity.id);
  }


  function minutesToTime(mins: number): string {
    const clamped = Math.max(0, Math.min(1439, mins));
    return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
  }

  function computeInsertTime(targetDayActivities: Activity[], insertIdx: number, movedTime: string): string {
    const before = targetDayActivities[insertIdx - 1];
    const after = targetDayActivities[insertIdx];
    const GAP = 15; // minutes between activities

    if (before) {
      // Slot after the previous activity ends
      const [bh, bm] = before.time.split(':').map(Number);
      const beforeEnd = bh * 60 + bm + 60;
      return minutesToTime(beforeEnd + GAP);
    } else if (after) {
      // First position — take the first activity's time (pushing it to be "before" the existing first)
      const [ah, am] = after.time.split(':').map(Number);
      return minutesToTime(ah * 60 + am);
    }
    // Only item in the day or empty day — default to 9:00 AM
    return movedTime || '09:00';
  }

  function handleDragReorder(sourceDay: number, activityId: string, fromIdx: number, targetDay: number, toIdx: number) {
    const moved = currentTrip.activities.find((a) => a.id === activityId);
    if (!moved) return;

    // Build the target day's activity list WITH the moved item inserted at toIdx
    let targetDayActs: Activity[];
    if (sourceDay === targetDay) {
      if (fromIdx === toIdx) return;
      const sorted = (dayMap.get(sourceDay) ?? []).sort(compareByTime);
      const others = sorted.filter((_, i) => i !== fromIdx);
      const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
      const newTime = computeInsertTime(others, insertIdx, moved.time);
      others.splice(insertIdx, 0, { ...moved, time: newTime });
      targetDayActs = others;
    } else {
      const sorted = (dayMap.get(targetDay) ?? []).sort(compareByTime);
      const newTime = computeInsertTime(sorted, toIdx, moved.time);
      sorted.splice(toIdx, 0, { ...moved, day: targetDay, time: newTime });
      targetDayActs = sorted;
    }

    // Auto-push: walk forward from the inserted position and nudge overlapping unlocked activities
    const GAP = 15;
    const timeToMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const movedInsertIdx = targetDayActs.findIndex((a) => a.id === activityId);
    for (let i = movedInsertIdx + 1; i < targetDayActs.length; i++) {
      const prev = targetDayActs[i - 1];
      const curr = targetDayActs[i];
      if (curr.locked || curr.fixed) continue; // don't push locked activities
      const prevEnd = timeToMin(prev.time) + 60;
      const currStart = timeToMin(curr.time);
      if (currStart < prevEnd + GAP) {
        targetDayActs[i] = { ...curr, time: minutesToTime(prevEnd + GAP) };
      }
    }

    // Build the final activity list
    const targetDayIds = new Set(targetDayActs.map((a) => a.id));
    const updated = currentTrip.activities
      .filter((a) => !targetDayIds.has(a.id))
      .concat(targetDayActs);

    const desc = sourceDay === targetDay
      ? `Moved ${moved.title} on Day ${sourceDay}`
      : `Moved ${moved.title} from Day ${sourceDay} to Day ${targetDay}`;
    setTripActivities(currentTrip.id, updated, desc);
    setDroppedActivityId(activityId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleReplace(activityId: string) {
    const target = currentTrip.activities.find((a) => a.id === activityId);
    if (!target) return;

    // If locked, show message directing to Manual Replace
    if (target.locked || target.fixed) {
      Alert.alert(
        'Activity is locked',
        'This activity is locked. Unlock it first to use Smart Replace, or use Manual Replace to enter a custom replacement.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Manual Replace',
            onPress: () => {
              setManualReplaceTarget(target);
              setManualReplaceName('');
              setManualReplaceTime(target.time);
            },
          },
        ],
      );
      return;
    }

    // Show choice between Smart Replace and Manual Replace
    Alert.alert(
      'Replace activity',
      `How would you like to replace "${target.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Smart Replace',
          onPress: () => handleSmartReplace(target),
        },
        {
          text: 'Manual Replace',
          onPress: () => {
            setManualReplaceTarget(target);
            setManualReplaceName('');
          },
        },
      ],
    );
  }

  async function handleSmartReplace(target: Activity) {
    if (!editGate.allowed) {
      setUpgradeFeature('edit_trip');
      setShowUpgradePrompt(true);
      return;
    }
    setAiEditLoading(true);
    const instruction =
      `Replace "${target.title}" (Day ${target.day} at ${target.time}) with a better ` +
      `alternative that fits the traveler profile. Keep all other activities on Day ${target.day} unchanged.`;
    try {
      const aiResult = await editTripAI({ trip: currentTrip, instruction, day: target.day, profile });
      const normalized = (aiResult.activities ?? [])
        .map((a) => normalizeActivity(a as unknown as Record<string, unknown>, totalDays))
        .filter(Boolean) as (Omit<Activity, 'id'> & { id?: string })[];
      const withIds: Activity[] = normalized.map((a) =>
        a.id ? (a as Activity) : { ...a, id: generateActivityId() },
      );
      let finalActivities = mergeDayScopedActivities(currentTrip.activities, withIds, target.day);

      // Validate and repair
      const effectivePace = currentTrip.pace ?? profile.pace ?? 'moderate';
      const srIssues = validateGeneratedActivities(finalActivities, totalDays, effectivePace);
      if (srIssues.some((i) => i.severity === 'error')) {
        finalActivities = repairActivities(finalActivities, totalDays, effectivePace);
        const postRepair = validateGeneratedActivities(finalActivities, totalDays, effectivePace);
        if (postRepair.some((i) => i.severity === 'error')) {
          throw new Error('Smart replace could not be validated after repair');
        }
      }

      const preview = computeChangePreview(
        currentTrip.activities,
        finalActivities,
        `AI replaced "${target.title}"`,
      );
      const srConflicts = checkConflicts(finalActivities, totalDays);
      const srDupWarnings = findSemanticDuplicates(finalActivities);
      const srDupConflicts = srDupWarnings.map((w) => ({ type: 'duplicate' as const, description: w }));
      setPendingTransform({
        activities: finalActivities,
        summary: `AI replaced "${target.title}"`,
        changes: [`"${target.title}" replaced with AI suggestion`],
        preview,
        conflicts: [...srConflicts, ...srDupConflicts] as any,
      });
      setTransformResult({
        summary: `AI replaced "${target.title}"`,
        changes: [`"${target.title}" replaced with AI suggestion`],
      });
    } catch {
      // Fallback: local alternatives picker — only use when destination has real curated data
      const hasCurated = hasDestinationData(currentTrip.destination);
      const existingTitles = currentTrip.activities.filter((a) => a.day === target.day).map((a) => a.title);
      const alternatives = hasCurated ? findTopReplacements(currentTrip.destination, target, {
        interests: profile.interests,
        dislikes: profile.dislikes,
        budget: currentTrip.budget ?? profile.budget ?? '$$',
        existingTitles,
      }) : [];
      if (alternatives.length === 0) {
        setTransformResult({
          summary: 'No alternatives found',
          changes: ['AI is temporarily unavailable. Use Manual Replace to enter a custom alternative.'],
        });
      } else {
        setReplaceTarget(target);
        setReplaceAlternatives(alternatives.map((alt) => ({
          title: alt.title,
          description: alt.description ?? '',
          cost: alt.cost,
          crowdLevel: alt.crowdLevel ?? 'medium',
          whyFits: alt.tags.filter((t) => profile.interests.includes(t)).join(', ') || alt.tags[0] || 'Good fit',
        })));
      }
    } finally {
      setAiEditLoading(false);
    }
  }

  function handleManualReplace() {
    if (!manualReplaceTarget || !manualReplaceName.trim()) return;
    const target = manualReplaceTarget;
    const newName = manualReplaceName.trim();

    Alert.alert(
      'Replace activity?',
      `Replace "${target.title}" with "${newName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            const result = currentTrip.activities.map((a) =>
              a.id === target.id
                ? {
                    id: generateActivityId(),
                    title: newName,
                    type: target.type,
                    day: target.day,
                    time: manualReplaceTime || target.time,
                    category: target.category,
                    cost: target.cost,
                    description: '',
                  }
                : a
            );
            const isProtected = !!(target.locked || target.fixed);
            setTripActivities(currentTrip.id, result, `Replaced "${target.title}" with "${newName}"`, isProtected);
            setManualReplaceTarget(null);
            setManualReplaceName('');
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          },
        },
      ],
    );
  }

  function handlePickReplacement(index: number) {
    if (!replaceTarget) return;
    const picked = replaceAlternatives[index];
    if (!picked) return;

    // Show confirmation before applying
    const costLabel = picked.cost === 'free' ? 'Free' : picked.cost === 'budget' ? '$' : picked.cost === 'moderate' ? '$$' : '$$$';
    Alert.alert(
      'Replace activity?',
      `Replace "${replaceTarget.title}" with "${picked.title}"?\n\nTime: ${formatTimeDisplay(replaceTarget.time)}\nCost: ${costLabel}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => applyReplacement(picked),
        },
      ],
    );
  }

  function applyReplacement(picked: { title: string; description: string; cost: string }) {
    if (!replaceTarget) return;

    const result = currentTrip.activities.map((a) =>
      a.id === replaceTarget.id
        ? {
            id: generateActivityId(),
            title: picked.title,
            type: replaceTarget.type,
            day: replaceTarget.day,
            time: replaceTarget.time,
            category: replaceTarget.category,
            cost: picked.cost as Activity['cost'],
            description: picked.description,
          }
        : a
    );
    setTripActivities(currentTrip.id, result, `Replaced "${replaceTarget.title}" with "${picked.title}"`);

    // Save memory with context about what was chosen over what
    const rejected = replaceAlternatives
      .filter((_, i) => replaceAlternatives[i]?.title !== picked.title)
      .map((a) => a.title)
      .slice(0, 2);
    const overText = rejected.length > 0 ? ` over ${rejected.map((t) => `"${t}"`).join(' and ')}` : '';
    addMemoryEntry({
      type: 'activity_replaced',
      category: 'preference',
      detail: `Chose "${picked.title}"${overText} to replace "${replaceTarget.title}" in ${currentTrip.destination}`,
      tripId: currentTrip.id,
      isGlobal: true,
      origin: `Smart Replace in ${currentTrip.destination}`,
      destination: currentTrip.destination,
    });

    setReplaceTarget(null);
    setReplaceAlternatives([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function isValidTime(t: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  }

  function handleAddActivity(day: number) {
    if (!newTitle.trim()) return;
    const time = newTime.trim() || defaultTimeForType(newType);
    const finalTime = isValidTime(time) ? time : defaultTimeForType(newType);

    const doAdd = () => {
      addActivity(currentTrip.id, {
        title: newTitle.trim(),
        day,
        time: finalTime,
        type: newType,
        cost: (newCost || undefined) as Activity['cost'],
        description: [newAddress.trim(), newActivityNotes.trim()].filter(Boolean).join(' — ') || undefined,
        fixed: newFixed || undefined,
        locked: newFixed || undefined,
      });
      setNewTitle('');
      setNewTime(defaultTimeForType('activity'));
      setNewType('activity');
      setNewCost('');
      setNewAddress('');
      setNewActivityNotes('');
      setNewFixed(false);
      setAddingToDay(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    Alert.alert(
      'Add activity',
      `Add "${newTitle.trim()}" to Day ${day} at ${formatTimeDisplay(finalTime)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add', onPress: doAdd },
      ],
    );
  }

  function handleCommand(command: ToveliCommand, dayOverride?: number, scopeOverride?: TransformScope, searchTerms?: string, startAfter?: string) {
    if (command === 'add_activity') {
      const targetDay = dayOverride ?? selectedDay ?? filterDay ?? 1;
      setAiAddDay(targetDay);
      setAiAddSuggestions([]);
      setAiAddQuery('');
      setShowAIAddSheet(true);
      return;
    }

    // Build scope
    let scope: TransformScope;
    if (scopeOverride) {
      scope = scopeOverride;
    } else if (dayOverride != null) {
      scope = { type: 'day', day: dayOverride };
    } else if (selectedDay != null) {
      scope = { type: 'day', day: selectedDay };
    } else if (filterDay != null) {
      scope = { type: 'day', day: filterDay };
    } else {
      // No day context -- default to full trip
      scope = { type: 'full_trip' };
    }

    // For replace_activity and fix_my_day, try AI first
    const AI_COMMANDS = ['replace_activity', 'fix_my_day'];
    if (AI_COMMANDS.includes(command)) {
      if (!editGate.allowed) {
        setUpgradeFeature('edit_trip');
        setShowUpgradePrompt(true);
        return;
      }
      const dayScope = scope.type === 'day' ? scope.day
        : scope.type === 'activity' ? scope.day
        : undefined;
      const instructionMap: Record<string, string> = {
        replace_activity: 'Replace the selected activity with a better alternative that fits the traveler profile',
        fix_my_day: 'Fix scheduling issues: resolve overlapping times, add missing meals, remove excess activities, and re-space everything',
      };
      const instruction = instructionMap[command] ?? command;

      setAiEditLoading(true);
      editTripAI({ trip: currentTrip, instruction, day: dayScope, profile })
        .then((aiResult) => {
          const normalized = (aiResult.activities ?? [])
            .map((a) => normalizeActivity(a as unknown as Record<string, unknown>, totalDays))
            .filter(Boolean) as (Omit<Activity, 'id'> & { id?: string })[];

          const withIds: Activity[] = normalized.map((a) =>
            a.id ? (a as Activity) : { ...a, id: generateActivityId() },
          );

          // Preserve locked activities on scoped day
          let safeIds = withIds;
          if (dayScope != null) {
            const lockedOnDay = currentTrip.activities.filter(
              (a) => a.day === dayScope && (a.locked || a.fixed),
            );
            const lockedIdSet = new Set(lockedOnDay.map((a) => a.id));
            safeIds = [
              ...withIds.filter((a) => !lockedIdSet.has(a.id)),
              ...lockedOnDay,
            ];
          }

          let finalActivities = mergeDayScopedActivities(
            currentTrip.activities,
            safeIds,
            dayScope,
          );

          // Validate and repair
          const effectivePace = currentTrip.pace ?? profile.pace ?? 'moderate';
          const cmdIssues = validateGeneratedActivities(finalActivities, totalDays, effectivePace);
          const cmdCritical = cmdIssues.some(
            (i) => i.severity === 'error',
          );
          if (cmdCritical) {
            finalActivities = repairActivities(finalActivities, totalDays, effectivePace);
            // Re-validate after repair — reject if errors remain
            const postRepairIssues = validateGeneratedActivities(finalActivities, totalDays, effectivePace);
            const stillCritical = postRepairIssues.filter((i) => i.severity === 'error');
            if (stillCritical.length > 0) {
              throw new Error('AI result could not be validated after repair');
            }
          }

          const preview = computeChangePreview(
            currentTrip.activities,
            finalActivities,
            command === 'fix_my_day' ? 'AI fixed your day' : 'AI replaced activity',
          );
          const initialConflicts = checkConflicts(finalActivities, totalDays);
          setPendingTransform({
            activities: finalActivities,
            summary: command === 'fix_my_day' ? 'AI fixed your day' : 'AI replaced activity',
            changes: ['AI-powered changes applied'],
            preview,
            conflicts: initialConflicts,
          });
          setTransformResult({
            summary: command === 'fix_my_day' ? 'AI fixed your day' : 'AI replaced activity',
            changes: ['AI-powered changes applied'],
          });
        })
        .catch(() => {
          // Fallback to local transformation logic
          applyLocalTransform(command, scope, searchTerms, startAfter);
        })
        .finally(() => {
          setAiEditLoading(false);
        });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    applyLocalTransform(command, scope, searchTerms, startAfter);
  }

  // Keep ref current so the pre-early-return effect can call handleCommand
  handleCommandRef.current = handleCommand;

  async function handleAIAddSearch(query: string) {
    if (!query.trim()) return;
    if (!searchGate.allowed) {
      setUpgradeFeature('natural_search');
      setShowUpgradePrompt(true);
      return;
    }
    setAiAddLoading(true);
    try {
      const result = await naturalSearchAI({
        query: query + ' in ' + currentTrip.destination,
        destination: currentTrip.destination,
        profile,
      });
      setAiAddSuggestions(result.suggestions);
    } catch {
      showToast('Could not find suggestions. Try again.', 'error');
    } finally {
      setAiAddLoading(false);
    }
  }

  function handleAddSuggestion(suggestion: NaturalSearchSuggestion, day: number) {
    addActivity(currentTrip.id, {
      title: suggestion.title,
      day,
      time: defaultTimeForType(suggestion.type === 'food' ? 'food' : 'activity'),
      type: suggestion.type === 'food' ? 'food' : 'activity',
      description: suggestion.description,
      cost: suggestion.cost as Activity['cost'],
    });
    showToast(`"${suggestion.title}" added to Day ${day}`, 'success');
    setShowAIAddSheet(false);
    setAiAddSuggestions([]);
  }

  function applyLocalTransform(command: ToveliCommand, scope: TransformScope, searchTerms?: string, startAfter?: string) {
    const result = transformTrip(currentTrip, command, scope, profile, memoryEntries, undefined, searchTerms, startAfter);

    if (result.summary) {
      // Compute what's changing vs staying vs protected
      const preview = computeChangePreview(
        currentTrip.activities,
        result.activities,
        result.summary,
      );
      // Compute initial conflicts before showing the preview
      const initialConflicts = checkConflicts(result.activities, totalDays);
      // Show preview first -- don't apply yet
      setPendingTransform({
        activities: result.activities,
        summary: result.summary,
        changes: result.changes,
        whyFits: result.whyFits,
        memoryEntry: result.memoryEntry,
        preview,
        conflicts: initialConflicts,
      });
      setTransformResult({
        summary: result.summary,
        changes: result.changes,
        whyFits: result.whyFits,
        memoryEntry: result.memoryEntry,
      });
    }
  }

  function handleApplyTransform(memoryAction?: 'global' | 'trip_only'): boolean {
    if (!pendingTransform) return false;
    // Defensive: block apply if there are unresolved blocking conflicts
    const hasBlockingConflicts = (pendingTransform.conflicts ?? []).some(
      (c) => c.type === 'overlap' || c.type === 'locked_conflict',
    );
    if (hasBlockingConflicts) return false;
    // Pre-apply validation: verify locked activities weren't modified
    const lockedError = validateLockedProtection(currentTrip.activities, pendingTransform.activities);
    if (lockedError) {
      showToast(lockedError + '. The change was not applied.', 'error');
      return false;
    }
    // No-change detection
    if (detectNoChange(currentTrip.activities, pendingTransform.activities)) {
      showToast('The itinerary is already as requested.', 'info');
      setPendingTransform(null);
      setTransformResult(null);
      return false;
    }
    // Semantic duplicate detection (warn, don't block)
    const dupWarnings = findSemanticDuplicates(pendingTransform.activities);
    if (dupWarnings.length > 0) {
      // Non-blocking warning — logged to console; UI shows via conflict display
      console.warn('Semantic duplicates detected:', dupWarnings);
    }
    // Record in persistent history via changeDescription
    setTripActivities(currentTrip.id, pendingTransform.activities, pendingTransform.summary);
    // Save memory preference ONLY after successful apply
    if (memoryAction && pendingTransform.memoryEntry) {
      addMemoryEntry({
        type: pendingTransform.memoryEntry.type,
        category: pendingTransform.memoryEntry.category,
        detail: pendingTransform.memoryEntry.detail,
        tripId: currentTrip.id,
        isGlobal: memoryAction === 'global',
      });
    }
    setPendingTransform(null);
    setTransformResult(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return true;
  }

  async function handleAIEdit(instruction: string) {
    if (!currentTrip) return;
    if (!editGate.allowed) {
      setUpgradeFeature('edit_trip');
      setShowUpgradePrompt(true);
      return;
    }
    setAiEditLoading(true);
    try {
      const day = selectedDay ?? filterDay ?? undefined;
      const result = await editTripAI({ trip: currentTrip, instruction, day, profile });

      // Normalize AI-returned activities, preserving existing IDs
      const normalized = (result.activities ?? [])
        .map((a) => normalizeActivity(a as unknown as Record<string, unknown>, totalDays))
        .filter(Boolean) as (Omit<Activity, 'id'> & { id?: string })[];

      // Stamp IDs: keep AI-preserved IDs for existing activities, generate new for new ones
      const withIds: Activity[] = normalized.map((a) =>
        a.id ? (a as Activity) : { ...a, id: generateActivityId() },
      );

      // Ensure locked activities from the target day are preserved
      if (day != null) {
        const lockedOnDay = currentTrip.activities.filter(
          (a) => a.day === day && (a.locked || a.fixed),
        );
        // Remove any AI output that collides with locked IDs
        const lockedIds = new Set(lockedOnDay.map((a) => a.id));
        const safeAI = withIds.filter((a) => !lockedIds.has(a.id));
        // Re-add locked activities for this day
        withIds.length = 0;
        withIds.push(...safeAI, ...lockedOnDay);
      }

      // Day-scoped edit: merge AI result for this day with other days
      let finalActivities = mergeDayScopedActivities(currentTrip.activities, withIds, day);

      // Validate and repair
      const effectivePace = currentTrip.pace ?? profile.pace ?? 'moderate';
      const issues = validateGeneratedActivities(finalActivities, totalDays, effectivePace);
      const hasCritical = issues.some(
        (i) => i.severity === 'error',
      );
      if (hasCritical) {
        finalActivities = repairActivities(finalActivities, totalDays, effectivePace);
        // Re-validate after repair — reject if errors remain
        const postRepairIssues = validateGeneratedActivities(finalActivities, totalDays, effectivePace);
        const stillCritical = postRepairIssues.filter((i) => i.severity === 'error');
        if (stillCritical.length > 0) {
          throw new Error('AI edit could not be validated after repair');
        }
      }

      // Route through preview/approval — do NOT apply directly
      const preview = computeChangePreview(
        currentTrip.activities,
        finalActivities,
        'AI edit: ' + instruction,
      );
      const aiEditConflicts = checkConflicts(finalActivities, totalDays);
      setPendingTransform({
        activities: finalActivities,
        summary: 'AI edit: ' + instruction,
        changes: ['AI-powered changes applied'],
        preview,
        conflicts: aiEditConflicts,
      });
      setTransformResult({
        summary: 'AI edit: ' + instruction,
        changes: ['AI-powered changes applied'],
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      showToast('Could not apply the edit. Check your connection and try again.', 'error');
    } finally {
      setAiEditLoading(false);
    }
  }

  // ─── Edit Chat ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (viewMode === 'ai') {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [viewMode, editActiveThreadId]);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      setEditChatKeyboardVisible(true);
      if (viewMode === 'ai') {
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      }
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setEditChatKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, [viewMode]);

  function editGenerateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function formatEditThreadTitle(text: string): string {
    let t = text.trim().replace(/\n.*/s, '');
    t = t.replace(/^(hey|hi|hello|yo|ok|okay|so)\s*,?\s*/i, '');
    t = t.replace(/^(can you|could you|would you|please|i want to|i'd like to|i need to|i want|i need|make|add|remove|delete|swap|move|replace|fix|change|update)\s+/i, '');
    t = t.replace(/\b(some|the best|really good|good|great|nice|really|very)\b/gi, '');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (t.length > 30) {
      t = t.slice(0, 30).replace(/\s+\S*$/, '') + '\u2026';
    }
    return t || 'New edit';
  }

  function saveAndSyncThreads(tripId: string, updated: EditChatThread[]) {
    saveTripEditThreads(tripId, updated);
    if (!user?.id) return;
    const userId = user.id;
    if (editChatSyncTimerRef.current) clearTimeout(editChatSyncTimerRef.current);
    editChatSyncTimerRef.current = setTimeout(() => {
      mergeTripChat(userId, tripId, updated);
    }, 2000);
  }

  function saveEditCurrentThread() {
    if (!currentTrip?.id) return;
    const threadId = editActiveThreadId || editGenerateId();
    setEditThreads((prev) => {
      const existing = prev.find((t) => t.id === threadId);
      const firstUserMsg = editChatMessages.find((m) => m.role === 'user');
      const autoTitle = firstUserMsg ? formatEditThreadTitle(firstUserMsg.text) : 'New edit';
      const thread: EditChatThread = {
        id: threadId,
        title: autoTitle,
        messages: editChatMessages,
        updatedAt: Date.now(),
        pinned: existing?.pinned,
      };
      const filtered = prev.filter((t) => t.id !== threadId);
      const updated = [thread, ...filtered].slice(0, 50);
      saveAndSyncThreads(currentTrip!.id, updated);
      return updated;
    });
    if (!editActiveThreadId) setEditActiveThreadId(threadId);
  }

  function handleEditNewConversation() {
    if (editChatMessages.length > 0 && editActiveThreadId) {
      saveEditCurrentThread();
    }
    setEditChatMessages([]);
    setEditChatSuggestions([]);
    setEditActiveThreadId(null);
    setShowEditThreadList(false);
  }

  function loadEditThread(thread: EditChatThread) {
    if (editChatMessages.length > 0 && editActiveThreadId) {
      saveEditCurrentThread();
    }
    setEditChatMessages(thread.messages);
    setEditActiveThreadId(thread.id);
    setEditChatTyping(false);
    setEditChatSuggestions([]);
    setShowEditThreadList(false);
  }

  function deleteEditThread(threadId: string) {
    if (!currentTrip?.id) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setEditThreads((prev) => {
      const updated = prev.filter((t) => t.id !== threadId);
      saveAndSyncThreads(currentTrip!.id, updated);
      return updated;
    });
    if (editActiveThreadId === threadId) {
      setEditChatMessages([]);
      setEditActiveThreadId(null);
    }
    setEditThreadOptionsId(null);
  }

  function togglePinEditThread(threadId: string) {
    if (!currentTrip?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditThreads((prev) => {
      const updated = prev.map((t) => t.id === threadId ? { ...t, pinned: !t.pinned } : t);
      saveAndSyncThreads(currentTrip!.id, updated);
      return updated;
    });
    setEditThreadOptionsId(null);
  }

  function startRenameEditThread(threadId: string) {
    const thread = editThreads.find((t) => t.id === threadId);
    if (thread) {
      setEditRenameText(thread.title);
      setEditRenameThreadId(threadId);
      setEditThreadOptionsId(null);
    }
  }

  function confirmEditRename() {
    if (!editRenameThreadId || !editRenameText.trim() || !currentTrip?.id) return;
    const newTitle = editRenameText.trim();
    setEditThreads((prev) => {
      const updated = prev.map((t) => t.id === editRenameThreadId ? { ...t, title: newTitle } : t);
      saveAndSyncThreads(currentTrip!.id, updated);
      return updated;
    });
    setEditRenameThreadId(null);
    setEditRenameText('');
  }

  // Load threads on trip change (local first, then merge remote)
  useEffect(() => {
    if (!currentTrip?.id || editChatLoadedRef.current === currentTrip.id) return;
    const tripId = currentTrip.id;
    editChatLoadedRef.current = tripId;
    loadTripEditThreads<EditChatThread[]>(tripId, []).then((savedThreads) => {
      // Pull remote and merge by thread id
      const applyThreads = (threads: EditChatThread[]) => {
        setEditThreads(threads);
        if (threads.length > 0) {
          const mostRecent = threads[0];
          setEditChatMessages(mostRecent.messages);
          setEditActiveThreadId(mostRecent.id);
        } else {
          setEditChatMessages([]);
          setEditActiveThreadId(null);
        }
      };
      applyThreads(savedThreads);
      if (user?.id) {
        pullTripChats(user.id).then((remoteChats) => {
          const remoteThreads = (remoteChats?.[tripId] as EditChatThread[] | undefined) ?? [];
          if (remoteThreads.length === 0) return;
          setEditThreads((prev) => {
            const localIds = new Set(prev.map((t) => t.id));
            const newRemote = remoteThreads.filter((t) => !localIds.has(t.id));
            if (newRemote.length === 0) return prev;
            const merged = [...prev, ...newRemote].sort((a, b) => b.updatedAt - a.updatedAt);
            saveTripEditThreads(tripId, merged);
            return merged;
          });
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrip?.id]);

  // Auto-save thread after each message
  useEffect(() => {
    if (!currentTrip?.id || editChatMessages.length === 0) return;
    const threadId = editActiveThreadId || editGenerateId();
    if (!editActiveThreadId) setEditActiveThreadId(threadId);
    setEditThreads((prev) => {
      const existing = prev.find((t) => t.id === threadId);
      const firstUserMsg = editChatMessages.find((m) => m.role === 'user');
      const autoTitle = firstUserMsg ? formatEditThreadTitle(firstUserMsg.text) : 'New edit';
      const thread: EditChatThread = {
        id: threadId,
        title: autoTitle,
        messages: editChatMessages,
        updatedAt: Date.now(),
        pinned: existing?.pinned,
      };
      const filtered = prev.filter((t) => t.id !== threadId);
      const updated = [thread, ...filtered].slice(0, 50);
      saveAndSyncThreads(currentTrip!.id, updated);
      return updated;
    });
  }, [editChatMessages, currentTrip?.id]);

  function buildTripEditContext(): string {
    if (!currentTrip) return '';
    const lines: string[] = [];
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const pad2 = (n: number) => n.toString().padStart(2, '0');
    const hr = now.getHours(), mn = now.getMinutes();
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const hr12 = hr % 12 || 12;
    lines.push(`Current time: ${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())} ${hr12}:${pad2(mn)} ${ampm} (${days[now.getDay()]})`);

    // Profile
    const profileParts = [`pace=${profile.pace}`];
    if (profile.flexibility) profileParts.push(`flexibility=${profile.flexibility}`);
    if (profile.budget) profileParts.push(`budget=${profile.budget}`);
    lines.push(`\nTraveler profile: ${profileParts.join(', ')}`);
    if (profile.interests.length) lines.push(`Interests: ${profile.interests.join(', ')}`);
    if (profile.dislikes.length) lines.push(`Dislikes: ${profile.dislikes.join(', ')}`);
    if (profile.dietaryRestrictions?.length) lines.push(`Dietary: ${profile.dietaryRestrictions.join(', ')}`);
    if (profile.crowdTolerance) lines.push(`Crowd tolerance: ${profile.crowdTolerance}`);
    if (profile.absoluteRules?.length) lines.push(`Absolute rules: ${profile.absoluteRules.join(', ')}`);

    // Trip
    lines.push(`\n--- EDITING TRIP ---`);
    lines.push(`[tripId:${currentTrip.id}] "${currentTrip.title}" — ${currentTrip.destination}, ${currentTrip.country}`);
    lines.push(`Dates: ${currentTrip.startDate} to ${currentTrip.endDate} (${totalDays} days)`);
    if (currentTrip.notes) lines.push(`Notes: ${currentTrip.notes}`);

    // Activities
    if (currentTrip.activities.length === 0) {
      lines.push('  (no activities yet)');
    } else {
      const sorted = [...currentTrip.activities].sort((a, b) => a.day - b.day || compareByTime(a, b));
      for (const a of sorted) {
        const parts: string[] = [a.type];
        if (a.category) parts.push(a.category);
        if (a.cost) parts.push(a.cost);
        const meta = `[${parts.join(', ')}]`;
        const flags: string[] = [];
        if (a.locked) flags.push('LOCKED');
        if (a.fixed) flags.push('FIXED');
        const flagStr = flags.length ? ` [${flags.join(',')}]` : '';
        const rating = a.rating ? ` ★${a.rating.toFixed(1)}` : '';
        const addr = a.address ? ` @${a.address.split(',')[0].trim()}` : '';
        lines.push(`  [id:${a.id}] Day${a.day} ${a.time} — ${a.title} ${meta}${rating}${addr}${flagStr}`);
      }
    }

    // Reservations
    const res = ((currentTrip as any).reservations ?? []).filter((r: any) => !r.cancelled);
    if (res.length) {
      lines.push('  Reservations:');
      for (const r of res) {
        const when = r.day ? `Day${r.day}` : (r.date ?? '');
        const time = r.time ? ` ${r.time}` : '';
        const conf = r.confirmationNumber ? ` #${r.confirmationNumber}` : '';
        lines.push(`    [resId:${r.id}] ${r.type}: ${r.title}${when ? ' ' + when : ''}${time}${conf}`);
      }
    }

    return lines.join('\n');
  }

  function applyEditAction(action: TripAction): { ok: boolean; label: string; detail?: string } {
    if (!currentTrip) return { ok: false, label: 'No trip' };
    const tripId = currentTrip.id;

    // Normalize time helper
    const normTime = (t?: string) => {
      if (!t) return t;
      const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (m) {
        let h = parseInt(m[1], 10);
        if (m[3].toUpperCase() === 'PM' && h < 12) h += 12;
        if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
        return `${h.toString().padStart(2, '0')}:${m[2]}`;
      }
      return t;
    };

    switch (action.type) {
      case 'add_activity': {
        const act = { ...action.activity, time: normTime(action.activity.time) ?? '10:00' };
        addActivity(tripId, act);
        return { ok: true, label: 'Activity added', detail: `Day ${act.day}: ${act.title}` };
      }
      case 'remove_activity': {
        const existing = currentTrip.activities.find((a) => a.id === action.activityId);
        removeActivity(tripId, action.activityId, true);
        return { ok: true, label: 'Activity removed', detail: existing ? `${existing.title}` : undefined };
      }
      case 'update_activity': {
        const updates = { ...action.updates };
        if (updates.time) updates.time = normTime(updates.time);
        updateActivity(tripId, action.activityId, updates, true);
        const existing = currentTrip.activities.find((a) => a.id === action.activityId);
        return { ok: true, label: 'Activity updated', detail: existing?.title };
      }
      case 'move_activity': {
        moveActivity(tripId, action.activityId, action.newDay, normTime(action.newTime) ?? action.newTime, true);
        const existing = currentTrip.activities.find((a) => a.id === action.activityId);
        return { ok: true, label: 'Activity moved', detail: existing ? `${existing.title} → Day ${action.newDay}` : undefined };
      }
      case 'replace_activity': {
        const newAct = { ...action.newActivity, time: normTime(action.newActivity.time) ?? '10:00' };
        const old = currentTrip.activities.find((a) => a.id === action.oldActivityId);
        replaceActivity(tripId, action.oldActivityId, newAct, true);
        return { ok: true, label: 'Activity replaced', detail: old ? `${old.title} → ${newAct.title}` : newAct.title };
      }
      case 'swap_days': {
        const acts = currentTrip.activities.map((a) => {
          if (a.locked || a.fixed) return a;
          if (a.day === action.day1) return { ...a, day: action.day2 };
          if (a.day === action.day2) return { ...a, day: action.day1 };
          return a;
        });
        setTripActivities(tripId, acts, `Swapped Day ${action.day1} ↔ Day ${action.day2}`);
        return { ok: true, label: 'Days swapped', detail: `Day ${action.day1} ↔ Day ${action.day2}` };
      }
      case 'add_reservation': {
        addReservation(tripId, action.reservation as any);
        return { ok: true, label: 'Reservation added', detail: action.reservation.title };
      }
      case 'update_reservation': {
        updateReservation(tripId, { id: action.reservationId, ...action.updates } as any);
        return { ok: true, label: 'Reservation updated', detail: action.updates.title ?? undefined };
      }
      case 'remove_reservation': {
        removeReservation(tripId, action.reservationId);
        return { ok: true, label: 'Reservation removed' };
      }
      case 'toggle_lock': {
        toggleLock(tripId, action.activityId);
        const existing = currentTrip.activities.find((a) => a.id === action.activityId);
        return { ok: true, label: existing?.locked ? 'Activity unlocked' : 'Activity locked', detail: existing?.title };
      }
      default:
        return { ok: false, label: 'Unsupported action' };
    }
  }

  const DESTRUCTIVE_ACTIONS = new Set(['swap_days']);

  async function sendEditChatMessage(text: string) {
    if (!currentTrip || !text.trim()) return;

    // Gate check
    if (!chatGate.allowed) {
      setUpgradeFeature('chat');
      setShowUpgradePrompt(true);
      return;
    }

    const userMsg: EditChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    };
    setEditChatMessages((prev) => [...prev, userMsg]);
    setEditChatInput('');
    setEditChatSuggestions([]);
    const lower = text.toLowerCase();
    if (/add|suggest|recommend|find|where|what's good/i.test(lower)) setEditChatTypingMessage('Finding the best spots...');
    else if (/remove|scratch|delete|get rid/i.test(lower)) setEditChatTypingMessage('Removing that for you...');
    else if (/move|later|earlier|push|shift/i.test(lower)) setEditChatTypingMessage('Rearranging your schedule...');
    else if (/swap|switch|flip/i.test(lower)) setEditChatTypingMessage('Swapping things around...');
    else if (/replace|instead|better|cheaper|alternative/i.test(lower)) setEditChatTypingMessage('Looking for alternatives...');
    else if (/\?|what|how|when|why|tell me|explain/i.test(lower)) setEditChatTypingMessage('Looking into that...');
    else setEditChatTypingMessage('Working on it...');
    setEditChatTyping(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);

    try {
      // Build conversation history (last 10 messages)
      const history = editChatMessages.slice(-10).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.text,
      }));

      const context = buildTripEditContext();
      const result = await chatAI({
        message: text.trim(),
        history,
        tripContext: context,
        profile,
        activeTripId: currentTrip.id,
        activeTrip: currentTrip,
      });

      // Fix trip IDs — the AI may use fabricated IDs
      for (const action of result.actions) {
        if ('tripId' in action && (action as any).tripId !== currentTrip.id) {
          (action as any).tripId = currentTrip.id;
        }
      }

      // Separate safe vs destructive
      const safe = result.actions.filter((a) => !DESTRUCTIVE_ACTIONS.has(a.type));
      const destructive = result.actions.filter((a) => DESTRUCTIVE_ACTIONS.has(a.type));

      // Execute safe actions immediately (with validation)
      const actionResults: { label: string; detail?: string }[] = [];
      for (const action of safe) {
        // Validate add/replace actions have required fields
        if (action.type === 'add_activity' || action.type === 'replace_activity') {
          const a = (action as any).activity ?? (action as any).newActivity;
          if (!a?.day || !a?.time || !a?.title) continue;
        }
        const r = applyEditAction(action);
        if (r.ok) actionResults.push({ label: r.label, detail: r.detail });
      }

      const assistantMsg: EditChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: result.message,
        suggestions: result.suggestions,
        context: result.context ?? undefined,
        places: result.places && result.places.length > 0 ? result.places : undefined,
        actionResults: actionResults.length > 0 ? actionResults : undefined,
        pendingActions: destructive.length > 0 ? destructive : undefined,
        timestamp: Date.now(),
      };

      setEditChatMessages((prev) => [...prev, assistantMsg]);
      setEditChatSuggestions(result.suggestions ?? []);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);

      if (actionResults.length > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      const failMsg: EditChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: 'Something went wrong. Please try again.',
        failed: true,
        timestamp: Date.now(),
      };
      setEditChatMessages((prev) => [...prev, failMsg]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    } finally {
      setEditChatTyping(false);
    }
  }

  function handleEditConfirm(messageId: string) {
    setEditChatMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.pendingActions) return m;
        const results: { label: string; detail?: string }[] = [...(m.actionResults ?? [])];
        for (const action of m.pendingActions) {
          const r = applyEditAction(action);
          if (r.ok) results.push({ label: r.label, detail: r.detail });
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return { ...m, pendingActions: undefined, actionResults: results };
      }),
    );
  }

  function handleEditDismiss(messageId: string) {
    setEditChatMessages((prev) =>
      prev.map((m) => m.id === messageId ? { ...m, pendingActions: undefined } : m),
    );
  }

  // ─── End Edit Chat ─────────────────────────────────────────────────────────

  function handleStartEdit(activity: Activity) {
    setEditingActivity(activity);
    setEditTitle(activity.title);
    setEditTime(activity.time);
    setEditType(activity.type);
  }

  function handleSaveEdit() {
    if (!editingActivity || !editTitle.trim()) return;
    const time = editTime.trim() || editingActivity.time;
    const updates = {
      title: editTitle.trim(),
      time: isValidTime(time) ? time : editingActivity.time,
      type: editType,
    };

    // For locked/fixed activities, use setTripActivities with bypass to allow edit
    if (editingActivity.locked || editingActivity.fixed) {
      const updatedActivities = currentTrip.activities.map((a) =>
        a.id === editingActivity.id ? { ...a, ...updates } : a
      );
      setTripActivities(currentTrip.id, updatedActivities, `Edited "${editingActivity.title}"`, true);
    } else {
      updateActivity(currentTrip.id, editingActivity.id, updates);
    }
    setEditingActivity(null);
    setEditTitle('');
    setEditTime('');
  }

  function handleCancelEdit() {
    setEditingActivity(null);
    setEditTitle('');
    setEditTime('');
  }

  function handleDayAction(day: number) {
    setSelectedDay(day);
    setAskVisible(true);
  }

  function handleOpenTripEdit() {
    setEditTripTitle(currentTrip.title ?? currentTrip.destination);
    setEditDest(currentTrip.destination);
    setEditStartDate(currentTrip.startDate);
    setEditEndDate(currentTrip.endDate);
    setEditNotes(currentTrip.notes || '');
    setEditTravelers(currentTrip.travelers ? String(currentTrip.travelers) : '');
    setEditDepartureFrom(currentTrip.departurePoint || '');
    setEditBudget(currentTrip.budget || profile.budget || '$$');
    setEditPace(currentTrip.pace || profile.pace);
    setEditTravelWith(currentTrip.travelWith || profile.travelWith || 'solo');
    setEditRestrictions(currentTrip.restrictions || '');
    setEditTripInstructions(currentTrip.tripInstructions || '');
    setShowTripEdit(true);
  }

  function handleSaveTripEdit() {
    const newStart = editStartDate || currentTrip.startDate;
    let newEnd = editEndDate || currentTrip.endDate;
    if (newEnd < newStart) newEnd = newStart;

    const newTotalDays = getTripDayCount(newStart, newEnd);
    const outOfRange = currentTrip.activities.filter((a) => a.day > newTotalDays);

    const doSave = () => {
      updateTrip(currentTrip.id, {
        title: editTripTitle.trim() || currentTrip.title,
        destination: editDest.trim() || currentTrip.destination,
        startDate: newStart,
        endDate: newEnd,
        notes: editNotes.trim(),
        travelers: editTravelers ? parseInt(editTravelers, 10) || undefined : undefined,
        departurePoint: editDepartureFrom.trim() || undefined,
        budget: editBudget,
        pace: editPace,
        travelWith: editTravelWith,
        restrictions: editRestrictions.trim() || undefined,
        tripInstructions: editTripInstructions.trim() || undefined,
      });
      if (outOfRange.length > 0) {
        const keepActivities = currentTrip.activities.filter((a) => a.day <= newTotalDays);
        setTripActivities(currentTrip.id, keepActivities);
      }
      setShowTripEdit(false);
    };

    if (outOfRange.length > 0) {
      const affectedDays = [...new Set(outOfRange.map((a) => a.day))].sort((x, y) => x - y);
      const daysStr = affectedDays.map((d) => `Day ${d}`).join(', ');
      Alert.alert(
        'Activities will be removed',
        `Shortening this trip will permanently remove ${outOfRange.length} ${outOfRange.length === 1 ? 'activity' : 'activities'} on ${daysStr}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove and save', style: 'destructive', onPress: doSave },
        ],
      );
      return;
    }

    doSave();
  }

  function handleOpenMoveActivity(activity: Activity) {
    if (activity.locked || activity.fixed) return;
    setMovingActivity(activity);
    setMoveDay(activity.day);
    setMoveTime(activity.time);
  }

  function handleConfirmMove() {
    if (!movingActivity) return;
    const time = isValidTime(moveTime) ? moveTime : movingActivity.time;
    const updatedActivities = currentTrip.activities.map((a) =>
      a.id === movingActivity.id ? { ...a, day: moveDay, time } : a
    );
    setTripActivities(
      currentTrip.id,
      updatedActivities,
      `Moved "${movingActivity.title}" to Day ${moveDay}`,
    );
    setMovingActivity(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  // Active prep items — always read from trip (never mutate during render)
  const prepItems = currentTrip.prepItems ?? [];

  function togglePrepItem(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = prepItems.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
    updateTripPrepItems(currentTrip.id, updated);
  }

  function addPrepItem() {
    Keyboard.dismiss();
    const text = newPrepItem.trim();
    if (!text) return;
    // Deduplicate: don't add if item with same text already exists
    if (prepItems.some((i) => i.text.toLowerCase() === text.toLowerCase())) {
      setNewPrepItem('');
      return;
    }
    const newItem: PrepItem = {
      id: `prep-custom-${Date.now()}-${text.length}`,
      text,
      done: false,
      custom: true,
      category: newPrepCategory,
    };
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateTripPrepItems(currentTrip.id, [...prepItems, newItem]);
    setNewPrepItem('');
    setNewPrepCategory('other');
    setShowAddPrep(false);
  }

  function removePrepItem(id: string) {
    updateTripPrepItems(currentTrip.id, prepItems.filter((i) => i.id !== id));
  }

  function clearCompletedPrepItems() {
    const remaining = prepItems.filter((i) => !i.done);
    const clearedCount = prepItems.length - remaining.length;
    Alert.alert('Clear completed items', `Remove ${clearedCount} completed item${clearedCount === 1 ? '' : 's'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        updateTripPrepItems(currentTrip.id, remaining);
      }},
    ]);
  }

  async function createShareLink(permission: 'view' | 'edit') {
    const token = session?.access_token;
    if (!token) {
      // Fallback to text share for signed-out users
      let text = `${currentTrip.title ?? currentTrip.destination} — ${currentTrip.destination}\n`;
      text += `${formatDate(currentTrip.startDate)} to ${formatDate(currentTrip.endDate)} (${totalDays} days)\n\n`;
      for (let d = 1; d <= totalDays; d++) {
        const dayActivities = (dayMap.get(d) ?? []).sort(compareByTime);
        text += `${formatDayLabel(d, currentTrip.startDate, currentTrip.datesKnown)}\n`;
        if (dayActivities.length === 0) {
          text += '  (no activities planned)\n';
        } else {
          for (const a of dayActivities) {
            text += `  \u2022 ${formatTimeDisplay(a.time)} ${a.title}\n`;
          }
        }
        text += '\n';
      }
      text += 'Shared from Tripseek';
      Share.share({ message: text });
      return;
    }

    showToast('Creating share link…');
    try {
      const edgeFnUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/share-trip`;
      const tripData = {
        title: currentTrip.title ?? currentTrip.destination,
        destination: currentTrip.destination,
        country: currentTrip.country,
        emoji: currentTrip.emoji,
        startDate: currentTrip.startDate,
        endDate: currentTrip.endDate,
        datesKnown: currentTrip.datesKnown,
        notes: currentTrip.notes,
        budget: currentTrip.budget,
        budgetTotal: currentTrip.budgetTotal,
        budgetCurrency: currentTrip.budgetCurrency,
        travelers: currentTrip.travelers,
        travelWith: currentTrip.travelWith,
        activities: currentTrip.activities,
        reservations: (currentTrip.reservations ?? []).filter((r) => !r.cancelled),
        prepItems: currentTrip.prepItems ?? [],
        expenses: currentTrip.expenses ?? [],
      };

      const res = await fetch(edgeFnUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tripId: currentTrip.id, permission, tripData }),
      });

      if (!res.ok) throw new Error('Failed to create link');
      const { url } = await res.json();

      Share.share({
        message: `Check out my trip to ${currentTrip.destination}!\n${url}`,
      });
    } catch {
      showToast('Could not create link — sharing as text');
      // Fallback to text
      let text = `${currentTrip.title ?? currentTrip.destination} — ${currentTrip.destination}\n`;
      for (let d = 1; d <= totalDays; d++) {
        const dayActivities = (dayMap.get(d) ?? []).sort(compareByTime);
        text += `${formatDayLabel(d, currentTrip.startDate, currentTrip.datesKnown)}\n`;
        for (const a of dayActivities) {
          text += `  \u2022 ${formatTimeDisplay(a.time)} ${a.title}\n`;
        }
        text += '\n';
      }
      text += 'Shared from Tripseek';
      Share.share({ message: text });
    }
  }

  function handleShareItinerary() {
    setShowShareSheet(true);
  }

  async function handleExportPDF() {
    setShowShareSheet(false);
    if (!exportGate.allowed) {
      setUpgradeFeature('export_pdf');
      setShowUpgradePrompt(true);
      return;
    }
    try {
      showToast('Generating PDF…');
      await exportTripPDF(currentTrip);
    } catch {
      showToast('Could not generate PDF', 'error');
    }
  }

  const QUICK_ACTIONS: { label: string; command: ToveliCommand }[] = [
    { label: 'More relaxed', command: 'make_relaxed' },
    { label: 'More adventurous', command: 'make_adventurous' },
    { label: 'Start later', command: 'reflow_day' },
    { label: 'Cheaper', command: 'reduce_cost' },
    { label: 'Avoid crowds', command: 'avoid_crowds' },
    { label: 'Surprise me', command: 'surprise_me' },
  ];

  // Filter days based on day selector
  const visibleDays = filterDay ? allDays.filter((d) => d === filterDay) : allDays;

  return (
    <ThemedView style={styles.container}>
      {viewMode === 'map' ? (
        <View style={{ flex: 1 }}>
          <TripMap
            activities={currentTrip.activities}
            destination={currentTrip.destination}
            totalDays={totalDays}
            topInset={insets.top}
          />
          {/* Back button to return to itinerary */}
          <Pressable
            onPress={() => setViewMode('itinerary')}
            style={[styles.mapBackBtn, { top: insets.top + 8, backgroundColor: theme.background }]}
            accessibilityRole="button"
            accessibilityLabel="Back to itinerary"
          >
            <SymbolView name="chevron.left" size={16} tintColor={theme.text} />
          </Pressable>
        </View>
      ) : (
      <>
      {/* Minimal header when in AI mode — fixed above ScrollView */}
      {viewMode === 'ai' && (
        <View style={[styles.editChatHeader, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => { setViewMode('itinerary'); setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 50); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to itinerary">
            <SymbolView name="chevron.left" size={20} tintColor={theme.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <ThemedText style={styles.editChatHeaderTitle} numberOfLines={1}>{trip?.title ?? 'Edit with AI'}</ThemedText>
          </View>
          <View style={{ width: 20 }} />
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: viewMode === 'ai' ? 0 : insets.bottom + 80 }}
        automaticallyAdjustKeyboardInsets={viewMode === 'ai' || viewMode === 'budget' || viewMode === 'prep'}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        delaysContentTouches={false}
        onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
      >
        {/* Hero — photo background with gradient overlay */}
        {viewMode !== 'ai' && <View style={[styles.hero, { height: 260 + insets.top }]}>
          {/* Photo or gradient fallback */}
          {heroPhoto ? (
            <ExpoImage
              source={{ uri: heroPhoto }}
              style={[StyleSheet.absoluteFill, styles.heroBgImage]}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundElement }]} />
          )}
          {/* Dark gradient so text is always readable */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.82)']}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />

          {/* Top bar — actions float over photo */}
          <View style={[styles.heroTopBar, { paddingTop: insets.top + 8 }]}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={styles.heroBackBtn}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <SymbolView name="chevron.left" size={18} tintColor="#fff" />
            </Pressable>
            <View style={styles.heroTopRight}>
              <Pressable
                onPress={handleOpenTripEdit}
                hitSlop={8}
                style={styles.heroIconBtn}
                accessibilityRole="button"
                accessibilityLabel="Edit trip details"
              >
                <SymbolView name="pencil" size={18} tintColor="#fff" weight="thin" />
              </Pressable>
              <Pressable
                onPress={() => router.push(`/trip-members?id=${currentTrip.id}` as any)}
                hitSlop={8}
                style={styles.heroIconBtn}
                accessibilityRole="button"
                accessibilityLabel="Trip members"
              >
                <SymbolView name="person.2" size={18} tintColor="#fff" />
              </Pressable>
            </View>
          </View>

          {/* Bottom text — title + compact meta */}
          <View style={styles.heroBottom}>
            <ThemedText style={styles.heroTitle} numberOfLines={2}>
              {currentTrip.title ?? currentTrip.destination}
            </ThemedText>
            <View style={styles.heroMetaRow}>
              {currentTrip.country && currentTrip.country !== 'Unknown' && currentTrip.country !== currentTrip.destination && (
                <>
                  <ThemedText style={styles.heroMetaText}>{currentTrip.country}</ThemedText>
                  <ThemedText style={styles.heroMetaDot}>{'\u00B7'}</ThemedText>
                </>
              )}
              {currentTrip.datesKnown !== false ? (
                <>
                  <ThemedText style={styles.heroMetaText}>
                    {tripDuration(currentTrip.startDate, currentTrip.endDate)}
                  </ThemedText>
                  <ThemedText style={styles.heroMetaDot}>{'\u00B7'}</ThemedText>
                  <ThemedText style={styles.heroMetaText}>
                    {new Date(currentTrip.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' \u2013 '}
                    {new Date(currentTrip.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </ThemedText>
                </>
              ) : (
                <ThemedText style={styles.heroMetaText}>Dates TBD</ThemedText>
              )}
            </View>
            {currentTrip.notes ? (
              <ThemedText style={styles.heroNotesText} numberOfLines={1}>
                {currentTrip.notes}
              </ThemedText>
            ) : null}
          </View>
        </View>}

        {/* View toggle — underline segment */}
        {viewMode !== 'ai' && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 0 }}>
          <View style={[styles.toggleRow, { borderBottomColor: theme.border }]}>
            {(['itinerary', 'alerts', 'reservations', 'map', 'budget', 'prep'] as const).map((mode, modeIdx) => {
              const readiness = mode === 'reservations' ? getTripReadiness(currentTrip.activities) : null;
              const showBadge = readiness && readiness.total > 0;
              const alertBadge = mode === 'alerts' && newIssueCount > 0;
              const tabLabel = mode === 'itinerary' ? 'Itinerary' : mode === 'prep' ? 'Prep' : mode === 'budget' ? 'Budget' : mode === 'reservations' ? 'Bookings' : mode === 'alerts' ? 'Alerts' : 'Map';
              return (
                <Fragment key={mode}>
                  <Pressable onPress={() => { setViewMode(mode); if (mode === 'alerts') handleAlertsOpen(); }} style={styles.toggleItem} accessibilityRole="button" accessibilityLabel={`${tabLabel} tab`}>
                    <View style={styles.toggleTabContent}>
                      <ThemedText style={[styles.toggleText, { color: viewMode === mode ? theme.primary : theme.textSecondary }]}>
                        {tabLabel}
                      </ThemedText>
                      {showBadge && (
                        <View style={[styles.toggleBadge, { backgroundColor: readiness.percentage === 100 ? '#10B981' : theme.primary + '20' }]}>
                          <ThemedText style={[styles.toggleBadgeText, { color: readiness.percentage === 100 ? '#fff' : theme.primary }]}>
                            {readiness.booked}/{readiness.total}
                          </ThemedText>
                        </View>
                      )}
                      {alertBadge && (
                        <View style={[styles.toggleBadge, { backgroundColor: theme.primary + '20' }]}>
                          <ThemedText style={[styles.toggleBadgeText, { color: theme.primary }]}>
                            {newIssueCount}
                          </ThemedText>
                        </View>
                      )}
                    </View>
                    {viewMode === mode && <View style={[styles.toggleIndicator, { backgroundColor: theme.primary }]} />}
                  </Pressable>
                  {modeIdx === 0 && (
                    <Pressable
                      onPress={() => setViewMode('ai')}
                      style={styles.toggleItem}
                      accessibilityRole="button"
                      accessibilityLabel="Edit with AI"
                    >
                      <View style={styles.toggleTabContent}>
                        <ThemedText style={[styles.toggleText, { color: viewMode === 'ai' ? theme.primary : theme.textSecondary }]}>Edit with AI</ThemedText>
                      </View>
                      {viewMode === 'ai' && <View style={[styles.toggleIndicator, { backgroundColor: theme.primary }]} />}
                    </Pressable>
                  )}
                </Fragment>
              );
            })}
          </View>
        </ScrollView>}


        {viewMode === 'itinerary' ? (
          <View style={styles.itinerary}>
            {/* Overview mode — day cards carousel */}
            {filterDay === null && (
              <Animated.View entering={FadeInDown.duration(300)} style={styles.dayCardsCarousel}>
                {/* Days section header */}
                <View style={styles.dayHeader}>
                  <View style={styles.dayHeaderLeft}>
                    <ThemedText style={styles.dayLabel}>Days</ThemedText>
                    <ThemedText style={[styles.dayHeaderMeta, { color: theme.textSecondary }]}>
                      · {totalDays} {totalDays === 1 ? 'day' : 'days'}
                    </ThemedText>
                  </View>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  snapToInterval={dayCardWidth + 12}
                  contentContainerStyle={{ gap: 12 }}
                  onScroll={(e) => {
                    const idx = Math.round(e.nativeEvent.contentOffset.x / (dayCardWidth + 12));
                    setActiveDayCardIdx(idx);
                  }}
                  scrollEventThrottle={16}
                >
                  {allDays.map((day) => {
                    const dayActivities = (dayMap.get(day) ?? []).sort(compareByTime);
                    const photoUrls = getDayPhotoUrls(day);
                    return (
                      <Pressable
                        key={day}
                        onPress={() => setFilterDay(day)}
                        style={({ pressed }) => [
                          styles.dayCard,
                          { width: dayCardWidth, opacity: pressed ? 0.93 : 1 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${formatDayLabel(day, currentTrip.startDate, currentTrip.datesKnown)}, ${dayActivities.length} activities`}
                      >
                        {/* Image collage */}
                        <View style={styles.dayCardImages}>
                          {photoUrls.length === 0 ? (
                            <LinearGradient
                              colors={[theme.primary + '30', theme.primary + '10']}
                              style={[StyleSheet.absoluteFill, styles.dayCardEmptyImage]}
                            >
                              <SymbolView name="map.fill" size={32} tintColor={theme.textSecondary} />
                            </LinearGradient>
                          ) : photoUrls.length === 1 ? (
                            <ExpoImage source={{ uri: photoUrls[0] }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                          ) : photoUrls.length === 2 ? (
                            <View style={styles.dayCardCoverRow}>
                              <ExpoImage source={{ uri: photoUrls[0] }} style={{ flex: 1 }} contentFit="cover" cachePolicy="memory-disk" />
                              <ExpoImage source={{ uri: photoUrls[1] }} style={{ flex: 1 }} contentFit="cover" cachePolicy="memory-disk" />
                            </View>
                          ) : (
                            <View style={styles.dayCardCoverPinterest}>
                              <ExpoImage source={{ uri: photoUrls[0] }} style={{ flex: 2 }} contentFit="cover" cachePolicy="memory-disk" />
                              <View style={styles.dayCardCoverStack}>
                                <ExpoImage source={{ uri: photoUrls[1] }} style={{ flex: 1 }} contentFit="cover" cachePolicy="memory-disk" />
                                <ExpoImage source={{ uri: photoUrls[2] }} style={{ flex: 1 }} contentFit="cover" cachePolicy="memory-disk" />
                              </View>
                            </View>
                          )}
                          {/* Gradient overlay for text legibility */}
                          <LinearGradient
                            colors={['transparent', 'rgba(0,0,0,0.55)']}
                            locations={[0.35, 1]}
                            style={StyleSheet.absoluteFill}
                          />
                        </View>
                        {/* Text overlay */}
                        <View style={styles.dayCardOverlay}>
                          <ThemedText style={styles.dayCardLabel}>
                            {formatDayLabel(day, currentTrip.startDate, currentTrip.datesKnown)}
                          </ThemedText>
                          <ThemedText style={styles.dayCardCount}>
                            {dayActivities.length === 0 ? 'Tap to plan this day' : `${dayActivities.length} ${dayActivities.length === 1 ? 'activity' : 'activities'}`}
                          </ThemedText>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {allDays.length > 1 && (
                  <View style={styles.dayCardDots}>
                    {allDays.map((_, i) => (
                      <View
                        key={i}
                        style={[
                          styles.dayCardDot,
                          { backgroundColor: i === activeDayCardIdx ? theme.primary : theme.border },
                        ]}
                      />
                    ))}
                  </View>
                )}
              </Animated.View>
            )}

            {/* Day detail mode */}
            {filterDay !== null && visibleDays.map((day) => {
              const dayActivities = (dayMap.get(day) ?? []).sort(compareByTime);

              return (
                <Animated.View
                  key={day}
                  entering={FadeInDown.delay(day * 60).springify()}
                  style={styles.daySection}
                  onLayout={(e) => {
                    dayLayoutsRef.current.set(day, {
                      y: e.nativeEvent.layout.y,
                      height: e.nativeEvent.layout.height,
                    });
                  }}
                >
                  {/* Day detail header — back + title + add */}
                  <View style={styles.dayDetailHeader}>
                    <Pressable
                      onPress={() => setFilterDay(null)}
                      style={styles.dayDetailBackBtn}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Back to all days"
                    >
                      <SymbolView name="chevron.left" size={16} tintColor={theme.text} />
                    </Pressable>
                    <Pressable
                      onPress={() => setQuickActionDay(quickActionDay === day ? null : day)}
                      style={styles.dayDetailCenter}
                      accessibilityRole="button"
                      accessibilityLabel={`Day ${day} actions`}
                    >
                      <ThemedText style={styles.dayLabel}>{formatDayLabel(day, currentTrip.startDate, currentTrip.datesKnown)}</ThemedText>
                      <SymbolView
                        name={quickActionDay === day ? 'chevron.up' : 'chevron.down'}
                        size={10}
                        tintColor={theme.textSecondary}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => setAddingToDay(day)}
                      hitSlop={8}
                      style={styles.dayDetailAddBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Add activity to Day ${day}`}
                    >
                      <SymbolView name="plus" size={16} tintColor={theme.text} />
                    </Pressable>
                  </View>

                  {/* Day info panel — expand on day header tap */}
                  {quickActionDay === day && (() => {
                    const sorted = dayActivities;
                    const firstTime = sorted.length > 0 ? sorted[0].time : null;
                    const lastActivity = sorted.length > 0 ? sorted[sorted.length - 1] : null;
                    const lastTime = lastActivity ? lastActivity.time : null;
                    // Compute end time of last activity
                    const lastEndTime = lastActivity && lastTime
                      ? (() => {
                          const [h, m] = lastTime.split(':').map(Number);
                          const endMin = h * 60 + m + 60;
                          return `${Math.floor(endMin / 60).toString().padStart(2, '0')}:${(endMin % 60).toString().padStart(2, '0')}`;
                        })()
                      : null;

                    // Count by type
                    const typeCounts = new Map<string, number>();
                    for (const a of sorted) {
                      const label = formatCategoryLabel(a.category, a.type);
                      if (label) typeCounts.set(label, (typeCounts.get(label) ?? 0) + 1);
                    }
                    const typeLabels = Array.from(typeCounts.entries())
                      .map(([label, count]) => `${count} ${label}${count > 1 ? 's' : ''}`)
                      .join(' · ');

                    // Weather for this day
                    const dayWeather = (() => {
                      if (!weatherForecast) return null;
                      const start = new Date(currentTrip.startDate + 'T00:00:00');
                      const target = new Date(start);
                      target.setDate(target.getDate() + day - 1);
                      const targetStr = target.toISOString().split('T')[0];
                      return weatherForecast.days.find((d) => d.date === targetStr) ?? null;
                    })();
                    const wx = dayWeather ? weatherForCode(dayWeather.weatherCode) : null;

                    return (
                      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
                        <View style={[styles.dayInfoPanel, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                          {/* Time span */}
                          {firstTime && lastEndTime && (
                            <View style={styles.dayInfoRow}>
                              <SymbolView name="clock" size={14} tintColor={theme.textSecondary} />
                              <ThemedText style={[styles.dayInfoText, { color: theme.text }]}>
                                {formatTimeDisplay(firstTime)} → {formatTimeDisplay(lastEndTime)}
                              </ThemedText>
                            </View>
                          )}

                          {/* Activity breakdown */}
                          {typeLabels.length > 0 && (
                            <View style={styles.dayInfoRow}>
                              <SymbolView name="list.bullet" size={14} tintColor={theme.textSecondary} />
                              <ThemedText style={[styles.dayInfoText, { color: theme.text }]} numberOfLines={1}>
                                {typeLabels}
                              </ThemedText>
                            </View>
                          )}

                          {/* Weather */}
                          {wx && dayWeather && (
                            <View style={styles.dayInfoRow}>
                              <SymbolView name={wx.icon} size={14} tintColor={theme.textSecondary} />
                              <ThemedText style={[styles.dayInfoText, { color: theme.text }]}>
                                {wx.label} · {Math.round(dayWeather.temperatureMax)}° / {Math.round(dayWeather.temperatureMin)}°
                                {dayWeather.precipitationProbability > 0 ? ` · ${dayWeather.precipitationProbability}% rain` : ''}
                              </ThemedText>
                            </View>
                          )}

                          {/* Empty state */}
                          {sorted.length === 0 && (
                            <View style={styles.dayInfoRow}>
                              <SymbolView name="plus" size={12} tintColor={theme.textSecondary} />
                              <ThemedText style={[styles.dayInfoText, { color: theme.textSecondary }]}>
                                Tap to plan this day
                              </ThemedText>
                            </View>
                          )}
                        </View>
                      </Animated.View>
                    );
                  })()}

                  {dayActivities.length === 0 ? (
                    <View>
                      {dragState && dragState.targetDay === day && (
                        <Animated.View entering={FadeIn.duration(150)} style={styles.insertionLine}>
                          <View style={[styles.insertionTimeBadge, { backgroundColor: theme.live }]}>
                            <ThemedText style={styles.insertionTimeText}>{formatTimeDisplay(dragState.previewTime)}</ThemedText>
                          </View>
                          <View style={[styles.insertionDot, { backgroundColor: theme.live }]} />
                          <View style={[styles.insertionBar, { backgroundColor: theme.live }]} />
                        </Animated.View>
                      )}
                      <Pressable
                        onPress={() => setAddingToDay(day)}
                        style={[styles.emptyDayTap, { borderColor: theme.border }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Add activity to Day ${day}`}
                      >
                        <SymbolView name="plus" size={14} tintColor={theme.textSecondary} />
                        <ThemedText style={[styles.emptyDayText, { color: theme.textSecondary }]}>Tap to add an activity</ThemedText>
                      </Pressable>
                    </View>
                  ) : (
                    <View
                      style={styles.timeline}
                      onLayout={(e) => { timelineOffsetsRef.current.set(day, e.nativeEvent.layout.y); }}
                    >
                      {dayActivities.map((activity, idx) => {
                        const isSameDay = dragState?.day === day && dragState?.targetDay === day;
                        const isSameDayNoOp = isSameDay && (dragState.targetIdx === dragState.fromIdx || dragState.targetIdx === dragState.fromIdx + 1);
                        const isCrossDayTarget = dragState && dragState.targetDay === day && dragState.day !== day;
                        const showInsertBefore = (isCrossDayTarget || (isSameDay && !isSameDayNoOp)) && dragState?.targetDay === day && dragState.targetIdx === idx;
                        const showInsertAfter = (isCrossDayTarget || (isSameDay && !isSameDayNoOp)) && idx === dayActivities.length - 1 && dragState?.targetDay === day && dragState.targetIdx === dayActivities.length;

                        return (
                          <View key={activity.id}>
                            {/* Insertion indicator — before this item */}
                            {showInsertBefore && dragState && (
                              <Animated.View entering={FadeIn.duration(150)} style={styles.insertionLine}>
                                <View style={[styles.insertionTimeBadge, { backgroundColor: theme.live }]}>
                                  <ThemedText style={styles.insertionTimeText}>{formatTimeDisplay(dragState.previewTime)}</ThemedText>
                                </View>
                                <View style={[styles.insertionDot, { backgroundColor: theme.live }]} />
                                <View style={[styles.insertionBar, { backgroundColor: theme.live }]} />
                              </Animated.View>
                            )}

                            <DraggableActivityItem
                              isLocked={!!(activity.locked || activity.fixed)}
                              scrollRef={scrollRef}
                              scrollOffsetRef={scrollOffsetRef}
                              onDragStart={() => {
                                if (openSwipeRef.current) {
                                  openSwipeRef.current.close();
                                  openSwipeRef.current = null;
                                }
                                setDroppedActivityId(null);
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                dragTargetRef.current = { day, idx };
                                dragStartScrollRef.current = scrollOffsetRef.current ?? 0;
                                // Snapshot absolute positions (in scroll content) for all items and days
                                const daySnap = new Map<number, { y: number; height: number }>();
                                const itemSnap = new Map<string, { y: number; height: number }>();
                                for (const d of visibleDays) {
                                  const dl = dayLayoutsRef.current.get(d);
                                  if (dl) daySnap.set(d, { ...dl });
                                  const timelineOffset = timelineOffsetsRef.current.get(d) ?? 0;
                                  const dayTop = (dl?.y ?? 0) + timelineOffset;
                                  const acts = (dayMap.get(d) ?? []).sort(compareByTime);
                                  let cumY = 0;
                                  for (const a of acts) {
                                    const h = itemLayoutsRef.current.get(a.id)?.height ?? 70;
                                    // Store absolute y in scroll content
                                    itemSnap.set(a.id, { y: dayTop + cumY, height: h });
                                    cumY += h;
                                  }
                                }
                                dragLayoutSnapshotRef.current = { items: itemSnap, days: daySnap };
                                setDragState({ activityId: activity.id, day, fromIdx: idx, targetDay: day, targetIdx: idx, previewTime: activity.time });
                              }}
                              onDragUpdate={(translationY) => {
                                const { items: itemSnap, days: daySnap } = dragLayoutSnapshotRef.current;
                                const myLayout = itemSnap.get(activity.id);
                                if (!myLayout) return;

                                // myLayout.y is absolute in scroll content
                                const scrollDelta = (scrollOffsetRef.current ?? 0) - dragStartScrollRef.current;
                                const totalDisplacement = translationY + scrollDelta;
                                const absY = myLayout.y + myLayout.height / 2 + totalDisplacement;

                                // Determine which day the dragged item is over
                                let targetDay = day;
                                for (const d of visibleDays) {
                                  const dl = daySnap.get(d);
                                  if (!dl) continue;
                                  if (absY >= dl.y && absY < dl.y + dl.height) {
                                    targetDay = d;
                                    break;
                                  }
                                }
                                // Clamp to first/last visible day
                                if (visibleDays.length > 0) {
                                  const lastDay = visibleDays[visibleDays.length - 1];
                                  const lastDl = daySnap.get(lastDay);
                                  if (lastDl && absY >= lastDl.y + lastDl.height) targetDay = lastDay;
                                  const firstDay = visibleDays[0];
                                  const firstDl = daySnap.get(firstDay);
                                  if (firstDl && absY < firstDl.y) targetDay = firstDay;
                                }

                                // Determine target index within the target day
                                const targetDayActs = (dayMap.get(targetDay) ?? []).sort(compareByTime);
                                let newTargetIdx = 0;
                                if (targetDayActs.length > 0) {
                                  for (let i = 0; i < targetDayActs.length; i++) {
                                    if (targetDay === day && i === idx) continue; // skip self in same day
                                    const l = itemSnap.get(targetDayActs[i].id);
                                    if (!l) continue;
                                    // l.y is absolute — compare directly
                                    if (absY > l.y + l.height / 2) {
                                      newTargetIdx = i + 1;
                                    }
                                  }
                                  newTargetIdx = Math.max(0, Math.min(targetDayActs.length, newTargetIdx));
                                }

                                const prev = dragTargetRef.current;
                                if (prev.day !== targetDay || prev.idx !== newTargetIdx) {
                                  dragTargetRef.current = { day: targetDay, idx: newTargetIdx };
                                  Haptics.selectionAsync();
                                  // Compute preview time for the insertion indicator
                                  const neighbors = targetDay === day
                                    ? targetDayActs.filter((_, i) => i !== idx)
                                    : targetDayActs;
                                  const insertAt = targetDay === day && newTargetIdx > idx ? newTargetIdx - 1 : newTargetIdx;
                                  const previewTime = computeInsertTime(neighbors, insertAt, activity.time);
                                  setDragState((s) => s ? { ...s, targetDay, targetIdx: newTargetIdx, previewTime } : s);
                                }
                              }}
                              onDragEnd={() => {
                                const { day: targetDay, idx: targetIdx } = dragTargetRef.current;
                                setDragState(null);
                                // Same-day no-op check
                                if (targetDay === day && (targetIdx === idx || targetIdx === idx + 1)) return;
                                // Cross-day always moves
                                handleDragReorder(day, activity.id, idx, targetDay, targetIdx);
                              }}
                            >
                          <SwipeableActivityRow
                            activity={activity}
                            onReplace={(a) => {
                              const msg = `Suggest a replacement for "${a.title}" (${a.category || a.type}, Day ${a.day})`;
                              setEditChatInput(msg);
                              setViewMode('ai');
                              setTimeout(() => {
                                sendEditChatMessage(msg);
                              }, 600);
                            }}
                            onRemove={handleContextRemove}
                            onBook={handleBookActivity}
                            onSwipeOpen={(ref) => {
                              if (openSwipeRef.current && openSwipeRef.current !== ref) {
                                openSwipeRef.current.close();
                              }
                              openSwipeRef.current = ref;
                            }}
                          >
                            <View
                              onLayout={(e) => {
                                itemLayoutsRef.current.set(activity.id, {
                                  y: e.nativeEvent.layout.y,
                                  height: e.nativeEvent.layout.height,
                                });
                              }}
                            >
                              {/* Visual activity card — full-bleed style */}
                              <Pressable
                                onPress={() => handleActivityTap(activity)}
                                style={({ pressed }) => [
                                  styles.visualActivityCard,
                                  pressed && { opacity: 0.85 },
                                  highlightedActivityId === activity.id && { borderWidth: 2, borderColor: theme.primary },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`${activity.title}, ${formatTimeDisplay(activity.time)}`}
                              >
                                {(() => {
                                  const photoUrl = activityPhotos.get(activity.placeId ?? activity.id);
                                  return photoUrl ? (
                                    <ExpoImage
                                      source={{ uri: photoUrl }}
                                      style={StyleSheet.absoluteFill}
                                      contentFit="cover"
                                      cachePolicy="memory-disk"
                                    />
                                  ) : (
                                    <LinearGradient
                                      colors={[theme.primary + '30', theme.primary + '10']}
                                      style={[StyleSheet.absoluteFill, styles.visualActivityPhotoPlaceholder]}
                                    >
                                      <SymbolView name="mappin.circle.fill" size={32} tintColor={theme.textSecondary} />
                                    </LinearGradient>
                                  );
                                })()}

                                {/* Gradient overlay for text legibility */}
                                <LinearGradient
                                  colors={['transparent', 'rgba(0,0,0,0.6)']}
                                  locations={[0.3, 1]}
                                  style={StyleSheet.absoluteFill}
                                />

                                {/* Top row — booking badge + menu button */}
                                <View style={styles.activityCardTopRow}>
                                  {activity.bookingStatus ? (
                                    <View style={[styles.activityStatusBadge, { backgroundColor: (activity.bookingStatus === 'booked' ? '#10B981' : '#F59E0B') + '30' }]}>
                                      <View style={[styles.activityStatusDot, { backgroundColor: activity.bookingStatus === 'booked' ? '#10B981' : '#F59E0B' }]} />
                                      <ThemedText style={[styles.activityStatusLabel, { color: activity.bookingStatus === 'booked' ? '#10B981' : '#F59E0B' }]}>
                                        {activity.bookingStatus === 'booked' ? 'Booked' : 'Pending'}
                                      </ThemedText>
                                    </View>
                                  ) : <View />}
                                  <Pressable
                                    onPress={() => {
                                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                      setContextMenuActivity(activity);
                                    }}
                                    hitSlop={8}
                                    style={styles.activityMenuBtn}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Options for ${activity.title}`}
                                  >
                                    <SymbolView name="ellipsis" size={16} tintColor="#fff" />
                                  </Pressable>
                                </View>

                                {/* Text overlay — bottom */}
                                <View style={styles.visualActivityOverlay}>
                                  <ThemedText style={styles.visualActivityTime}>
                                    {formatTimeDisplay(activity.time)}
                                  </ThemedText>
                                  <ThemedText style={styles.visualActivityTitle} numberOfLines={1}>
                                    {activity.title}
                                  </ThemedText>
                                  <ThemedText style={styles.visualActivityMeta}>
                                    {formatCategoryLabel(activity.category, activity.type)}
                                  </ThemedText>
                                </View>
                              </Pressable>

                              {/* Post-drop time picker — tap to set exact time */}
                              {droppedActivityId === activity.id && (
                                <Animated.View entering={FadeIn.duration(200)} style={[styles.dropTimePicker, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                                  <ThemedText style={[styles.dropTimeLabel, { color: theme.textSecondary }]}>Set time:</ThemedText>
                                  <TimePickerButton
                                    value={activity.time}
                                    onChange={(newTime) => {
                                      const updated = currentTrip.activities.map((a) =>
                                        a.id === activity.id ? { ...a, time: newTime } : a,
                                      );
                                      setTripActivities(currentTrip.id, updated);
                                    }}
                                  />
                                  <Pressable
                                    onPress={() => setDroppedActivityId(null)}
                                    style={[styles.dropTimeDone, { backgroundColor: theme.primary }]}
                                    accessibilityLabel="Confirm time"
                                  >
                                    <ThemedText style={[styles.dropTimeDoneText, { color: theme.background }]}>Done</ThemedText>
                                  </Pressable>
                                </Animated.View>
                              )}

                              {/* Distance indicator — driving distance between activities */}
                              {idx < dayActivities.length - 1 && (() => {
                                const next = dayActivities[idx + 1];
                                if (next && activity.lat != null && activity.lng != null && next.lat != null && next.lng != null) {
                                  return (
                                    <DistanceIndicator
                                      lat1={activity.lat} lng1={activity.lng}
                                      lat2={next.lat} lng2={next.lng}
                                      theme={theme}
                                    />
                                  );
                                }
                                return null;
                              })()}

                              {/* Inline edit form */}
                              {editingActivity?.id === activity.id && (
                                <Animated.View entering={FadeIn.duration(200)} style={[styles.addForm, { backgroundColor: theme.backgroundElement }]}
                                  ref={(ref) => {
                                    if (!ref) return;
                                    setTimeout(() => {
                                      (ref as any).measureInWindow?.((_x: number, winY: number, _w: number, _h: number) => {
                                        const scrollTo = (scrollOffsetRef.current ?? 0) + winY - 160;
                                        scrollRef.current?.scrollTo({ y: Math.max(0, scrollTo), animated: true });
                                      });
                                    }, 100);
                                  }}>
                                  <ThemedText style={styles.editFormTitle}>Edit Activity</ThemedText>
                                  <TextInput
                                    style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                                    value={editTitle}
                                    onChangeText={setEditTitle}
                                    placeholder="Activity name"
                                    placeholderTextColor={theme.textSecondary}
                                    accessibilityLabel="Activity name"
                                  />
                                  <View style={styles.addRow}>
                                    <TimePickerButton
                                      value={editTime}
                                      onChange={setEditTime}
                                    />
                                    <View style={styles.typeRow}>
                                      {(['activity', 'food', 'hotel', 'flight'] as const).map((t) => (
                                        <Pressable
                                          key={t}
                                          onPress={() => setEditType(t)}
                                          style={[
                                            styles.typeChip,
                                            { backgroundColor: editType === t ? theme.primary : 'transparent' },
                                          ]}
                                          accessibilityRole="button"
                                          accessibilityLabel={`Select ${t} type`}
                                        >
                                          <ThemedText style={[styles.typeText, editType === t && { color: theme.primaryText }]}>
                                            {t}
                                          </ThemedText>
                                        </Pressable>
                                      ))}
                                    </View>
                                  </View>
                                  <View style={styles.editBtnRow}>
                                    <Pressable onPress={handleCancelEdit} style={styles.editCancelBtn} accessibilityRole="button" accessibilityLabel="Cancel edit">
                                      <ThemedText style={styles.editCancelText}>Cancel</ThemedText>
                                    </Pressable>
                                    <Pressable
                                      onPress={handleSaveEdit}
                                      style={[styles.addSaveBtn, styles.editSaveBtn, { backgroundColor: theme.primary, opacity: editTitle.trim() ? 1 : 0.4 }]}
                                      disabled={!editTitle.trim()}
                                      accessibilityRole="button"
                                      accessibilityLabel="Save activity"
                                    >
                                      <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>Save</ThemedText>
                                    </Pressable>
                                  </View>
                                </Animated.View>
                              )}
                            </View>
                          </SwipeableActivityRow>
                        </DraggableActivityItem>

                            {/* Insertion indicator — after last item */}
                            {showInsertAfter && dragState && (
                              <Animated.View entering={FadeIn.duration(150)} style={styles.insertionLine}>
                                <View style={[styles.insertionTimeBadge, { backgroundColor: theme.live }]}>
                                  <ThemedText style={styles.insertionTimeText}>{formatTimeDisplay(dragState.previewTime)}</ThemedText>
                                </View>
                                <View style={[styles.insertionDot, { backgroundColor: theme.live }]} />
                                <View style={[styles.insertionBar, { backgroundColor: theme.live }]} />
                              </Animated.View>
                            )}
                          </View>
                        );
                      })}

                      {/* End spacer */}
                      <View style={{ height: 4 }} />
                    </View>
                  )}

                </Animated.View>
              );
            })}

            {/* Stays + Flights side by side */}
            {totalDays >= 1 && filterDay === null && (staysData.hasAnyStay || (currentTrip.reservations ?? []).some((r) => r.type === 'flight')) && (
              <View style={[styles.sectionDivider, { backgroundColor: theme.border }]} />
            )}
            {totalDays >= 1 && filterDay === null && (
              <View style={styles.staysFlightsRow}>
                <View style={styles.staysFlightsCol}>
                  <StaysStrip
                    trip={currentTrip}
                    staysData={staysData}
                    totalDays={totalDays}
                    hotelSuggestions={hotelSuggestions}
                    hotelPhotoUrls={hotelPhotoUrls}
                    activityPhotos={activityPhotos}
                    onAddStay={() => setShowStaySearchModal(true)}
                    onViewStay={(activity, reservation) => {
                      if (reservation) {
                        setBookingSheetData({
                          res: reservation,
                          trip: currentTrip,
                          photoUrl: activityPhotos.get(activity.placeId ?? activity.id),
                        });
                      } else {
                        setUnbookedStayData({
                          activity,
                          trip: currentTrip,
                          photoUrl: activityPhotos.get(activity.placeId ?? activity.id),
                        });
                      }
                    }}
                    onBookSuggestion={(hotel) => {
                      let url = `/place-detail?name=${encodeURIComponent(hotel.name)}&destination=${encodeURIComponent(currentTrip.destination)}&tripId=${currentTrip.id}&category=${encodeURIComponent(hotel.category ?? 'stay/hotel')}&fromStaySearch=1`;
                      if (hotel.placeId) url += `&placeId=${encodeURIComponent(hotel.placeId)}`;
                      if (hotel.address) url += `&address=${encodeURIComponent(hotel.address)}`;
                      if (hotel.lat != null) url += `&lat=${hotel.lat}`;
                      if (hotel.lng != null) url += `&lng=${hotel.lng}`;
                      if (hotel.rating != null) url += `&rating=${hotel.rating}`;
                      if (hotel.reviewCount != null) url += `&reviewCount=${hotel.reviewCount}`;
                      if (hotel.photos?.[0]?.reference) url += `&photoRef=${encodeURIComponent(hotel.photos[0].reference)}`;
                      router.push(url as any);
                    }}
                    onBrowseMore={() => setShowStaySearchModal(true)}
                  />
                </View>
                <View style={styles.staysFlightsCol}>
                  <FlightsStrip
                    trip={currentTrip}
                    reservations={(currentTrip.reservations ?? []).filter((r) => r.type === 'flight')}
                    departureCity={currentTrip.departurePoint}
                    onAddFlight={() => {
                      setBookingModalFixedType('flight');
                      setBookingEditRes(null);
                      setPendingImportData(null);
                      setShowBookingModal(true);
                    }}
                    onViewFlight={(res) => {
                      setBookingSheetData({ res, trip: currentTrip, photoUrl: undefined });
                    }}
                  />
                </View>
              </View>
            )}
          </View>
        ) : viewMode === 'ai' ? (
          <View style={styles.editChatContainer}>
            <View style={styles.editChatList}>
              {/* Welcome message */}
              <View style={[styles.editChatBubble, styles.editChatBubbleAssistant, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <ThemedText style={styles.editChatBubbleText}>{"\uD83D\uDC4B Hey! I\u2019m your trip assistant. I can:"}</ThemedText>
                <View style={styles.editChatWelcomeList}>
                  {[
                    ['\uD83D\uDDFA\uFE0F', 'Add, remove, or swap activities'],
                    ['\uD83D\uDCA1', 'Recommend places and personalized picks'],
                    ['\uD83D\uDCB0', 'Help budget your trip'],
                    ['\uD83D\uDD50', 'Fix conflicts and spot issues in your itinerary'],
                    ['\uD83D\uDCCB', 'Manage reservations'],
                    ['\u271A', 'And so much more'],
                  ].map(([emoji, label], i) => (
                    <View key={i} style={styles.editChatWelcomeRow}>
                      <ThemedText style={styles.editChatWelcomeEmoji}>{emoji}</ThemedText>
                      <ThemedText style={styles.editChatWelcomeLabel}>{label}</ThemedText>
                    </View>
                  ))}
                </View>
                <ThemedText style={styles.editChatBubbleText}>{`Just tell me what you\u2019d like \u2014 or tap a suggestion below to get started!`}</ThemedText>
              </View>

              {/* Messages */}
              {editChatMessages.map((msg) => {
                const isCompactMsg = msg.role === 'assistant' && msg.actionResults && msg.actionResults.length > 0 && msg.text.length < 60;
                return (
                <Animated.View key={msg.id} entering={FadeInDown.duration(200)} style={{ width: '100%' }}>
                  {msg.role === 'assistant' && msg.context && (
                    <View style={styles.editChatContextTag}>
                      <SymbolView name="sparkles" size={11} tintColor={theme.textSecondary} />
                      <ThemedText style={[styles.editChatContextText, { color: theme.textSecondary }]}>
                        {msg.context}
                      </ThemedText>
                    </View>
                  )}
                  <View style={msg.role === 'user' ? styles.editChatRowUser : styles.editChatRowAssistant}>
                    {msg.role === 'assistant' && (
                      <View style={[styles.editChatAvatar, { backgroundColor: theme.text }]}>
                        <ThemedText style={[styles.editChatAvatarLabel, { color: theme.background }]}>TS</ThemedText>
                      </View>
                    )}
                    <View style={[
                      styles.editChatBubble,
                      msg.role === 'user'
                        ? [styles.editChatBubbleUser, { backgroundColor: theme.primary }]
                        : [styles.editChatBubbleAssistant, { backgroundColor: theme.backgroundElement, borderColor: theme.border }],
                      isCompactMsg && styles.editChatBubbleCompact,
                    ]}>
                      {msg.role === 'user' ? (
                        <ThemedText style={[styles.editChatBubbleText, { color: '#fff' }]}>{msg.text}</ThemedText>
                      ) : (
                        <ChatMarkdown text={msg.text} />
                      )}
                    </View>
                    {msg.role === 'user' && (
                      <View style={[styles.editChatAvatar, { backgroundColor: theme.primaryMuted }]}>
                        <ThemedText style={[styles.editChatAvatarLabel, { color: theme.primary }]}>
                          {((user?.user_metadata?.full_name as string | undefined)?.[0] ?? user?.email?.[0] ?? 'U').toUpperCase()}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                  {msg.timestamp && (
                    <ThemedText style={[styles.editChatTime, { color: theme.textSecondary }, msg.role === 'user' && styles.editChatTimeUser]}>
                      {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </ThemedText>
                  )}

                  {/* Place cards */}
                  {msg.places && msg.places.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={chatPlaceStyles.cardsContainer}
                      style={chatPlaceStyles.cardsScroll}
                    >
                      {msg.places.slice(0, 5).map((place, i) => (
                        <ChatPlaceCard
                          key={place.placeId || `p${i}`}
                          place={place}
                          isPrimary={i === 0}
                          onAddToTrip={() => {
                            let url = `/place-detail?name=${encodeURIComponent(place.name)}`;
                            if (place.placeId) url += `&placeId=${encodeURIComponent(place.placeId)}`;
                            if (place.address) url += `&address=${encodeURIComponent(place.address)}`;
                            if (place.rating != null) url += `&rating=${place.rating}`;
                            if (place.ratingCount != null) url += `&reviewCount=${place.ratingCount}`;
                            if (place.lat != null) url += `&lat=${place.lat}`;
                            if (place.lng != null) url += `&lng=${place.lng}`;
                            router.push(url as any);
                          }}
                          onSaveToBoard={() => {
                            let url = `/place-detail?name=${encodeURIComponent(place.name)}`;
                            if (place.placeId) url += `&placeId=${encodeURIComponent(place.placeId)}`;
                            if (place.address) url += `&address=${encodeURIComponent(place.address)}`;
                            if (place.rating != null) url += `&rating=${place.rating}`;
                            if (place.lat != null) url += `&lat=${place.lat}`;
                            if (place.lng != null) url += `&lng=${place.lng}`;
                            router.push(url as any);
                          }}
                        />
                      ))}
                    </ScrollView>
                  )}

                  {/* Action results */}
                  {msg.actionResults && msg.actionResults.length > 0 && (
                    <View style={styles.editChatActionsContainer}>
                      {msg.actionResults.map((ar, arIdx) => (
                        <View key={arIdx} style={[styles.editChatActionResult, { backgroundColor: theme.backgroundElement }]}>
                          <SymbolView name="checkmark.circle.fill" size={16} tintColor="#10B981" />
                          <View style={{ flex: 1 }}>
                            <ThemedText style={styles.editChatActionLabel}>{ar.label}</ThemedText>
                            {ar.detail && <ThemedText style={[styles.editChatActionDetail, { color: theme.textSecondary }]}>{ar.detail}</ThemedText>}
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Confirmation card for destructive actions */}
                  {msg.pendingActions && msg.pendingActions.length > 0 && (
                    <View style={[styles.editChatConfirmCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                      <View style={styles.editChatConfirmHeader}>
                        <SymbolView name="exclamationmark.triangle.fill" size={16} tintColor="#F59E0B" />
                        <ThemedText style={styles.editChatConfirmTitle}>Confirm changes</ThemedText>
                      </View>
                      {msg.pendingActions.map((pa, paIdx) => (
                        <ThemedText key={paIdx} style={[styles.editChatConfirmAction, { color: theme.textSecondary }]}>
                          {pa.type === 'swap_days' ? `Swap Day ${(pa as any).day1} \u2194 Day ${(pa as any).day2}` : pa.type.replace(/_/g, ' ')}
                        </ThemedText>
                      ))}
                      <View style={styles.editChatConfirmBtns}>
                        <Pressable
                          onPress={() => handleEditDismiss(msg.id)}
                          style={[styles.editChatConfirmBtn, { borderColor: theme.border }]}
                        >
                          <ThemedText style={{ fontSize: 14, fontWeight: '600' as const, color: theme.textSecondary }}>Cancel</ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() => handleEditConfirm(msg.id)}
                          style={[styles.editChatConfirmBtn, { backgroundColor: theme.primary }]}
                        >
                          <ThemedText style={{ fontSize: 14, fontWeight: '600' as const, color: theme.primaryText }}>Confirm</ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {/* Failed retry */}
                  {msg.failed && (
                    <Pressable
                      onPress={() => {
                        const userMsg = editChatMessages[editChatMessages.indexOf(msg) - 1];
                        if (userMsg?.role === 'user') {
                          setEditChatMessages((p) => p.filter((m) => m.id !== msg.id));
                          sendEditChatMessage(userMsg.text);
                        }
                      }}
                      style={styles.editChatRetryBtn}
                    >
                      <SymbolView name="arrow.clockwise" size={12} tintColor={theme.danger} />
                      <ThemedText style={{ fontSize: 12, color: theme.danger }}>Try again</ThemedText>
                    </Pressable>
                  )}
                </Animated.View>
              );})}

              {/* Typing indicator */}
              {editChatTyping && (
                <Animated.View entering={FadeIn.duration(200)} style={[styles.editChatTyping, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <ThemedText style={[styles.editChatTypingText, { color: theme.textSecondary }]}>{editChatTypingMessage}</ThemedText>
                </Animated.View>
              )}
            </View>

          </View>
        ) : viewMode === 'prep' ? (
          <View style={styles.itinerary}>
            {(() => {
              const doneCount = prepItems.filter((i) => i.done).length;
              const PREP_CATEGORIES: { key: PrepItem['category']; label: string }[] = [
                { key: 'documents', label: 'Documents' },
                { key: 'transport', label: 'Transport' },
                { key: 'accommodation', label: 'Accommodation' },
                { key: 'packing', label: 'Packing' },
                { key: 'health', label: 'Health' },
                { key: 'other', label: 'Other' },
              ];
              return (
                <>
                  {/* Header row with + Add */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText type="sectionTitle" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                      Prep
                    </ThemedText>
                    {!showAddPrep && prepItems.length > 0 && (
                      <Pressable
                        onPress={() => setShowAddPrep(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Add prep item"
                      >
                        <ThemedText style={{ color: theme.primary, fontSize: 14, fontWeight: '500' }}>+ Add</ThemedText>
                      </Pressable>
                    )}
                  </View>

                  {/* Add prep form */}
                  {showAddPrep && (
                    <Animated.View entering={FadeIn.duration(200)} style={[styles.addExpenseForm, { backgroundColor: theme.backgroundElement }]}>
                      <TextInput
                        style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                        value={newPrepItem}
                        onChangeText={setNewPrepItem}
                        placeholder="What do you need to prepare?"
                        placeholderTextColor={theme.textSecondary}
                        returnKeyType="done"
                        autoFocus
                        onSubmitEditing={addPrepItem}
                        accessibilityLabel="Prep item text"
                      />
                      <View style={styles.expenseCategoryRow}>
                        {PREP_CATEGORIES.map((cat) => (
                          <Pressable
                            key={cat.key}
                            onPress={() => setNewPrepCategory(cat.key)}
                            style={[styles.typeChip, { backgroundColor: newPrepCategory === cat.key ? theme.primary : 'transparent', borderWidth: 1, borderColor: newPrepCategory === cat.key ? theme.primary : theme.border }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Select ${cat.label} category`}
                          >
                            <ThemedText style={[styles.typeText, newPrepCategory === cat.key && { color: theme.primaryText }]}>{cat.label}</ThemedText>
                          </Pressable>
                        ))}
                      </View>
                      <View style={styles.editBtnRow}>
                        <Pressable
                          onPress={() => { Keyboard.dismiss(); setShowAddPrep(false); setNewPrepItem(''); setNewPrepCategory('other'); }}
                          style={styles.editCancelBtn}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel add prep item"
                        >
                          <ThemedText style={styles.editCancelText}>Cancel</ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={addPrepItem}
                          style={[styles.addSaveBtn, styles.editSaveBtn, { backgroundColor: theme.primary, opacity: newPrepItem.trim() ? 1 : 0.4 }]}
                          disabled={!newPrepItem.trim()}
                          accessibilityRole="button"
                          accessibilityLabel="Add prep item"
                        >
                          <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>Add</ThemedText>
                        </Pressable>
                      </View>
                    </Animated.View>
                  )}

                  {/* Empty state */}
                  {prepItems.length === 0 && !showAddPrep && (
                    <Animated.View entering={FadeIn.duration(200)} style={styles.prepEmptyCard}>
                      <ExpoImage
                        source={require('@/assets/images/prep-image.png')}
                        style={{ width: 180, height: 180, marginBottom: 8 }}
                        contentFit="contain"
                      />
                      <ThemedText style={{ fontSize: 17, fontWeight: '700' }}>Trip Prep Checklist</ThemedText>
                      <ThemedText style={{ fontSize: 14, color: theme.textSecondary, textAlign: 'center', marginTop: 4, lineHeight: 20 }}>
                        Track documents, bookings, packing, and everything you need before your trip.
                      </ThemedText>
                      <Pressable
                        onPress={() => setShowAddPrep(true)}
                        style={[styles.addSaveBtn, { backgroundColor: theme.primary, paddingHorizontal: 24, marginTop: 16 }]}
                        accessibilityRole="button"
                        accessibilityLabel="Add a task"
                      >
                        <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>Add a Task</ThemedText>
                      </Pressable>
                    </Animated.View>
                  )}

                  {/* Progress bar + Clear completed */}
                  {prepItems.length > 0 && (
                    <>
                      <ThemedText style={styles.prepProgress}>
                        {doneCount} of {prepItems.length} complete
                      </ThemedText>
                      <View style={[styles.prepProgressBar, { backgroundColor: theme.backgroundElement }]}>
                        <View style={[styles.prepProgressFill, { width: `${(doneCount / prepItems.length) * 100}%`, backgroundColor: theme.primary }]} />
                      </View>
                      {doneCount > 0 && (
                        <Pressable onPress={clearCompletedPrepItems} style={{ alignSelf: 'flex-end', marginBottom: 8, marginTop: -8 }}>
                          <ThemedText style={{ fontSize: 13, color: theme.primary, fontWeight: '500' }}>Clear completed</ThemedText>
                        </Pressable>
                      )}
                    </>
                  )}

                  {/* Collapsible category sections */}
                  {PREP_CATEGORIES.map((cat) => {
                    const catItems = prepItems.filter((i) => (i.category ?? 'other') === cat.key);
                    if (catItems.length === 0) return null;
                    const catDone = catItems.filter((i) => i.done).length;
                    const allDone = catDone === catItems.length;
                    const isCollapsed = allDone
                      ? !collapsedPrepCats.has(`${cat.key}-expanded`)
                      : collapsedPrepCats.has(cat.key!);
                    return (
                      <View key={cat.key}>
                        <Pressable
                          onPress={() => {
                            setCollapsedPrepCats((prev) => {
                              const next = new Set(prev);
                              if (allDone) {
                                if (next.has(`${cat.key}-expanded`)) next.delete(`${cat.key}-expanded`);
                                else next.add(`${cat.key}-expanded`);
                              } else {
                                if (next.has(cat.key!)) next.delete(cat.key!);
                                else next.add(cat.key!);
                              }
                              return next;
                            });
                          }}
                          style={styles.prepCategoryHeaderRow}
                          accessibilityRole="button"
                          accessibilityLabel={`${isCollapsed ? 'Expand' : 'Collapse'} ${cat.label}`}
                        >
                          <ThemedText style={[styles.prepCategoryHeader, { color: theme.textSecondary, marginTop: 0, marginBottom: 0 }]}>
                            {cat.label} {catDone}/{catItems.length}
                          </ThemedText>
                          <SymbolView name={isCollapsed ? ("chevron.right" as any) : ("chevron.down" as any)} size={12} tintColor={theme.textSecondary} />
                        </Pressable>
                        {!isCollapsed && catItems.map((item) => (
                          <View key={item.id}>
                            {editingPrepId === item.id ? (
                              <View style={[styles.prepItem, { backgroundColor: theme.backgroundElement }]}>
                                <SymbolView name="checkmark.circle.fill" size={18} tintColor={item.done ? '#22C55E' : undefined} />
                                <TextInput
                                  style={[styles.prepEditInput, { color: theme.text }]}
                                  value={editPrepText}
                                  onChangeText={setEditPrepText}
                                  accessibilityLabel="Edit prep item"
                                  autoFocus
                                  onBlur={() => {
                                    if (editPrepText.trim()) {
                                      const updated = prepItems.map((i) => i.id === item.id ? { ...i, text: editPrepText.trim() } : i);
                                      updateTripPrepItems(currentTrip.id, updated);
                                    }
                                    setEditingPrepId(null);
                                  }}
                                  onSubmitEditing={() => {
                                    if (editPrepText.trim()) {
                                      const updated = prepItems.map((i) => i.id === item.id ? { ...i, text: editPrepText.trim() } : i);
                                      updateTripPrepItems(currentTrip.id, updated);
                                    }
                                    setEditingPrepId(null);
                                  }}
                                  returnKeyType="done"
                                />
                              </View>
                            ) : (
                              <View style={[styles.prepItem, { backgroundColor: theme.backgroundElement }]}>
                                <Pressable
                                  onPress={() => togglePrepItem(item.id)}
                                  style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Toggle prep item: ${item.text}`}
                                >
                                  <SymbolView name={item.done ? 'checkmark.circle.fill' : 'circle'} size={18} tintColor={item.done ? '#22C55E' : undefined} />
                                  <ThemedText style={[styles.prepItemText, item.done && styles.prepItemDone]}>{item.text}</ThemedText>
                                </Pressable>
                                <Pressable
                                  onPress={() => { setEditingPrepId(item.id); setEditPrepText(item.text); }}
                                  hitSlop={8}
                                  style={styles.expenseDeleteBtn}
                                  accessibilityRole="button"
                                  accessibilityLabel="Edit prep item"
                                >
                                  <SymbolView name="pencil" size={14} tintColor={theme.primary} />
                                </Pressable>
                                <Pressable
                                  onPress={() => {
                                    Keyboard.dismiss();
                                    Alert.alert('Delete prep item?', `Remove "${item.text}"?`, [
                                      { text: 'Cancel', style: 'cancel' },
                                      { text: 'Delete', style: 'destructive', onPress: () => removePrepItem(item.id) },
                                    ]);
                                  }}
                                  hitSlop={8}
                                  style={styles.expenseDeleteBtn}
                                  accessibilityRole="button"
                                  accessibilityLabel="Delete prep item"
                                >
                                  <SymbolView name="xmark" size={14} tintColor={theme.textSecondary} />
                                </Pressable>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    );
                  })}
                </>
              );
            })()}
          </View>
        ) : viewMode === 'budget' ? (
          <View style={styles.itinerary}>
            {(() => {
              const ACTIVITY_COST_MID: Record<string, number> = { free: 0, budget: 15, moderate: 40, premium: 100 };
              const estimatedActivityCost = currentTrip.activities.reduce(
                (sum, a) => sum + (ACTIVITY_COST_MID[a.cost ?? 'free'] ?? 0), 0,
              );
              const expenses = currentTrip.expenses ?? [];
              const manualExpensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
              const budgetCurrency = currentTrip.budgetCurrency ?? 'USD';
              const currencySymbol = getCurrSymbol(budgetCurrency);
              const activeReservations = (currentTrip.reservations ?? []).filter((r) => !r.cancelled && r.price != null && r.price > 0);
              const sameCurrencyRes = activeReservations.filter((r) => !r.currency || r.currency === budgetCurrency);
              const otherCurrencyRes = activeReservations.filter((r) => r.currency && r.currency !== budgetCurrency);
              const reservationCost = sameCurrencyRes.reduce((sum, r) => sum + (r.price ?? 0), 0);
              const confirmedSpent = reservationCost + manualExpensesTotal;
              const budgetTotal = currentTrip.budgetTotal ?? 0;
              const remainingConfirmed = budgetTotal - confirmedSpent;
              const EXPENSE_CATEGORIES = ['Food', 'Transport', 'Activity', 'Accommodation', 'Other'];

              // Category spending aggregation
              const RES_TYPE_TO_CATEGORY: Record<string, string> = {
                hotel: 'Accommodation', flight: 'Transport', train: 'Transport',
                restaurant: 'Food', activity: 'Activity', other: 'Other',
              };
              const categorySpending: Record<string, number> = { Food: 0, Transport: 0, Activity: 0, Accommodation: 0, Other: 0 };
              for (const r of sameCurrencyRes) categorySpending[RES_TYPE_TO_CATEGORY[r.type] ?? 'Other'] += r.price ?? 0;
              for (const e of expenses) categorySpending[e.category] = (categorySpending[e.category] ?? 0) + e.amount;

              // Budget progress
              const totalSpent = confirmedSpent;
              const spentPercent = budgetTotal > 0 ? (totalSpent / budgetTotal) * 100 : 0;

              // Daily budget metrics
              const dailyBudgetTarget = budgetTotal > 0 && totalDays > 0 ? budgetTotal / totalDays : 0;
              const dailyAverage = totalSpent > 0 && totalDays > 0 ? totalSpent / totalDays : 0;

              // ── SPLASH STATE — no budget set yet ──
              if (budgetTotal === 0 && !editBudgetTotal) {
                return (
                  <View style={styles.budgetSplash}>
                    <ExpoImage
                      source={require('@/assets/images/budget-image.png')}
                      style={styles.budgetSplashImage}
                      contentFit="contain"
                    />
                    <ThemedText style={styles.budgetSplashTitle}>Plan your spend</ThemedText>
                    <ThemedText style={[styles.budgetSplashDesc, { color: theme.textSecondary }]}>
                      Set a total budget and we'll track your spending across bookings and expenses automatically.
                    </ThemedText>
                    <Pressable
                      onPress={() => { setEditBudgetTotal(true); setBudgetTotalInput(''); }}
                      style={[styles.budgetSplashCTA, { backgroundColor: theme.text }]}
                      accessibilityRole="button"
                      accessibilityLabel="Set budget"
                    >
                      <ThemedText style={[styles.budgetSplashCTAText, { color: theme.background }]}>Set Budget</ThemedText>
                    </Pressable>
                  </View>
                );
              }

              // ── BUDGET INPUT — shown inline when no budget yet ──
              if (editBudgetTotal && budgetTotal === 0) {
                return (
                  <View style={styles.budgetSplash}>
                    <ExpoImage
                      source={require('@/assets/images/budget-image.png')}
                      style={styles.budgetSplashImage}
                      contentFit="contain"
                    />
                    <ThemedText style={styles.budgetSplashTitle}>Set your budget</ThemedText>
                    <Animated.View entering={FadeIn.duration(200)} style={[styles.budgetEditRow, { borderColor: theme.border, marginTop: 8 }]}>
                      <TextInput
                        style={[styles.budgetInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                        value={budgetTotalInput}
                        onChangeText={setBudgetTotalInput}
                        placeholder="Enter budget amount"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="number-pad"
                        autoFocus
                        accessibilityLabel="Budget amount"
                      />
                      <Pressable
                        onPress={() => {
                          Keyboard.dismiss();
                          const val = parseInt(budgetTotalInput, 10);
                          if (val > 0) updateTripBudget(currentTrip.id, val);
                          setEditBudgetTotal(false);
                        }}
                        style={[styles.budgetSaveBtn, { backgroundColor: theme.primary }]}
                        accessibilityRole="button"
                        accessibilityLabel="Save budget"
                      >
                        <ThemedText style={[styles.budgetSaveBtnText, { color: theme.primaryText }]}>Save</ThemedText>
                      </Pressable>
                    </Animated.View>
                    <Pressable onPress={() => setEditBudgetTotal(false)} style={{ marginTop: 12 }}>
                      <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary }]}>Cancel</ThemedText>
                    </Pressable>
                  </View>
                );
              }

              return (
                <>
                  {/* Currency selector */}
                  <View style={styles.budgetCurrencyRow}>
                    <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Currency</ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 4 }}>
                      {Object.keys(CURRENCY_SYMBOLS).map((cur) => (
                        <Pressable
                          key={cur}
                          onPress={() => updateTrip(currentTrip.id, { budgetCurrency: cur })}
                          style={[
                            styles.typeChip,
                            { backgroundColor: budgetCurrency === cur ? theme.primary : 'transparent', borderWidth: 1, borderColor: budgetCurrency === cur ? theme.primary : theme.border },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Select ${cur} currency`}
                        >
                          <ThemedText style={[styles.typeText, budgetCurrency === cur && { color: theme.primaryText }]}>
                            {cur}
                          </ThemedText>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>

                  {/* Hero budget card — with data */}
                  {(
                    /* Hero budget card — with data */
                    <Pressable
                      onPress={() => { setEditBudgetTotal(true); setBudgetTotalInput(budgetTotal ? String(budgetTotal) : ''); }}
                      style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}
                      accessibilityRole="button"
                      accessibilityLabel="Edit total budget"
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Total budget</ThemedText>
                        {budgetTotal > 0 && (
                          <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>
                            {spentPercent.toFixed(0)}% spent
                          </ThemedText>
                        )}
                      </View>
                      <ThemedText style={styles.budgetAmount}>
                        {budgetTotal > 0 ? `${currencySymbol}${budgetTotal.toLocaleString()}` : `${currencySymbol}${totalSpent.toLocaleString()} spent`}
                      </ThemedText>

                      {/* Progress bar */}
                      {budgetTotal > 0 && (
                        <View style={[styles.budgetProgressTrack, { backgroundColor: theme.border }]}>
                          <View style={[
                            styles.budgetProgressFill,
                            {
                              width: `${Math.min(spentPercent, 100)}%`,
                              backgroundColor: spentPercent > 100 ? '#DC2626' : spentPercent > 80 ? '#F59E0B' : '#16A34A',
                            },
                          ]} />
                        </View>
                      )}

                      {/* Spent / Remaining */}
                      {budgetTotal > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                          <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                            {currencySymbol}{totalSpent.toLocaleString()} spent
                          </ThemedText>
                          <ThemedText style={{ fontSize: 12, fontWeight: '600', color: remainingConfirmed >= 0 ? '#16A34A' : '#DC2626' }}>
                            {remainingConfirmed >= 0 ? `${currencySymbol}${remainingConfirmed.toLocaleString()} remaining` : `-${currencySymbol}${Math.abs(remainingConfirmed).toLocaleString()} over`}
                          </ThemedText>
                        </View>
                      )}

                      {/* Daily average */}
                      {totalDays > 0 && totalSpent > 0 && (
                        <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary, marginTop: 2 }]}>
                          Averaging {currencySymbol}{Math.round(dailyAverage).toLocaleString()}/day{dailyBudgetTarget > 0 ? ` \u00B7 ${currencySymbol}${Math.round(dailyBudgetTarget).toLocaleString()}/day target` : ''}
                        </ThemedText>
                      )}
                    </Pressable>
                  )}

                  {/* Budget edit row */}
                  {editBudgetTotal && (
                    <Animated.View entering={FadeIn.duration(200)} style={[styles.budgetEditRow, { borderColor: theme.border }]}>
                      <TextInput
                        style={[styles.budgetInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                        value={budgetTotalInput}
                        onChangeText={setBudgetTotalInput}
                        placeholder="Enter budget amount"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="number-pad"
                        autoFocus
                        accessibilityLabel="Budget amount"
                      />
                      <Pressable
                        onPress={() => {
                          Keyboard.dismiss();
                          const val = parseInt(budgetTotalInput, 10);
                          if (val > 0) updateTripBudget(currentTrip.id, val);
                          setEditBudgetTotal(false);
                        }}
                        style={[styles.budgetSaveBtn, { backgroundColor: theme.primary }]}
                        accessibilityRole="button"
                        accessibilityLabel="Save budget"
                      >
                        <ThemedText style={[styles.budgetSaveBtnText, { color: theme.primaryText }]}>Save</ThemedText>
                      </Pressable>
                    </Animated.View>
                  )}

                  {/* Category spending breakdown */}
                  {totalSpent > 0 && (
                    <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary, marginBottom: 8 }]}>Spending by category</ThemedText>
                      {EXPENSE_CATEGORIES.map((cat) => {
                        const catAmount = categorySpending[cat] ?? 0;
                        const barPercent = totalSpent > 0 ? (catAmount / totalSpent) * 100 : 0;
                        return (
                          <View key={cat} style={{ marginBottom: 8 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                              <ThemedText style={{ fontSize: 13, fontWeight: '500' }}>{cat}</ThemedText>
                              <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>{currencySymbol}{catAmount.toLocaleString()}</ThemedText>
                            </View>
                            <View style={[styles.budgetProgressTrack, { backgroundColor: theme.border, height: 6, marginTop: 0 }]}>
                              <View style={[styles.budgetProgressFill, { width: `${barPercent}%`, backgroundColor: theme.primary, height: 6 }]} />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Bookings — itemized */}
                  {sameCurrencyRes.length > 0 && (
                    <>
                      <ThemedText type="sectionTitle" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                        Bookings
                      </ThemedText>
                      {sameCurrencyRes.map((r) => (
                        <View key={r.id} style={[styles.budgetBookingRow, { borderBottomColor: theme.border }]}>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={styles.expenseLabel}>{r.title}</ThemedText>
                            <ThemedText style={[styles.expenseMeta, { color: theme.textSecondary }]}>
                              {RES_TYPE_TO_CATEGORY[r.type] ?? 'Other'}{r.day != null ? ` \u00B7 Day ${r.day}` : ''}
                            </ThemedText>
                          </View>
                          <ThemedText style={styles.expenseAmount}>{currencySymbol}{(r.price ?? 0).toLocaleString()}</ThemedText>
                        </View>
                      ))}
                    </>
                  )}

                  {/* Other currency bookings */}
                  {otherCurrencyRes.length > 0 && (
                    <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement, marginTop: sameCurrencyRes.length > 0 ? 8 : 0 }]}>
                      <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Other currencies</ThemedText>
                      {otherCurrencyRes.map((r) => (
                        <View key={r.id} style={[styles.budgetBookingRow, { borderBottomColor: theme.border }]}>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={styles.expenseLabel}>{r.title}</ThemedText>
                            <ThemedText style={[styles.expenseMeta, { color: theme.textSecondary }]}>{RES_TYPE_TO_CATEGORY[r.type] ?? 'Other'} \u00B7 {r.currency}</ThemedText>
                          </View>
                          <ThemedText style={styles.expenseAmount}>{getCurrSymbol(r.currency!)}{(r.price ?? 0).toLocaleString()}</ThemedText>
                        </View>
                      ))}
                      <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary, marginTop: 6 }]}>
                        Not included in totals (different currency)
                      </ThemedText>
                    </View>
                  )}

                  {/* Activity estimates — demoted to a single line */}
                  {estimatedActivityCost > 0 && (
                    <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary, marginTop: 8, marginBottom: 4 }]}>
                      Activity estimates: ~{currencySymbol}{estimatedActivityCost.toLocaleString()} (based on cost tiers, not actual spending)
                    </ThemedText>
                  )}

                  {/* Expenses */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText type="sectionTitle" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                      Expenses
                    </ThemedText>
                    {!showAddExpense && (
                      <Pressable
                        onPress={() => setShowAddExpense(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Add expense"
                      >
                        <ThemedText style={{ color: theme.primary, fontSize: 14, fontWeight: '500' }}>+ Add</ThemedText>
                      </Pressable>
                    )}
                  </View>

                  {/* Add expense form */}
                  {showAddExpense && (
                    <Animated.View entering={FadeIn.duration(200)} style={[styles.addExpenseForm, { backgroundColor: theme.backgroundElement }]}>
                      <TextInput
                        style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                        value={newExpenseLabel}
                        onChangeText={setNewExpenseLabel}
                        placeholder="Expense label (e.g. Hotel night 1)"
                        placeholderTextColor={theme.textSecondary}
                        returnKeyType="next"
                        autoFocus
                        accessibilityLabel="Expense label"
                      />
                      <TextInput
                        style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                        value={newExpenseAmount}
                        onChangeText={setNewExpenseAmount}
                        placeholder="Amount"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        accessibilityLabel="Expense amount"
                      />
                      <View style={styles.expenseCategoryRow}>
                        {EXPENSE_CATEGORIES.map((cat) => (
                          <Pressable
                            key={cat}
                            onPress={() => setNewExpenseCategory(cat)}
                            style={[styles.typeChip, { backgroundColor: newExpenseCategory === cat ? theme.primary : 'transparent', borderWidth: 1, borderColor: newExpenseCategory === cat ? theme.primary : theme.border }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Select ${cat} category`}
                          >
                            <ThemedText style={[styles.typeText, newExpenseCategory === cat && { color: theme.primaryText }]}>{cat}</ThemedText>
                          </Pressable>
                        ))}
                      </View>
                      <ThemedText style={[styles.modalLabel, { marginTop: 4 }]}>Day (optional)</ThemedText>
                      <TextInput
                        style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                        value={newExpenseDay}
                        onChangeText={setNewExpenseDay}
                        placeholder="General"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="number-pad"
                        accessibilityLabel="Expense day"
                      />
                      <View style={styles.editBtnRow}>
                        <Pressable
                          onPress={() => { Keyboard.dismiss(); setShowAddExpense(false); setNewExpenseLabel(''); setNewExpenseAmount(''); setNewExpenseCategory('Other'); setNewExpenseDay(''); }}
                          style={styles.editCancelBtn}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel expense"
                        >
                          <ThemedText style={styles.editCancelText}>Cancel</ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            Keyboard.dismiss();
                            const label = newExpenseLabel.trim();
                            const amount = parseFloat(newExpenseAmount);
                            if (!label || isNaN(amount) || amount <= 0) return;
                            const dayNum = newExpenseDay ? parseInt(newExpenseDay, 10) : undefined;
                            const newExpense = {
                              id: String(Date.now()) + String(Math.floor(Math.random() * 1000)),
                              label,
                              amount,
                              category: newExpenseCategory,
                              day: dayNum && !isNaN(dayNum) ? dayNum : undefined,
                            };
                            updateTripExpenses(currentTrip.id, [...expenses, newExpense]);
                            setShowAddExpense(false);
                            setNewExpenseLabel('');
                            setNewExpenseAmount('');
                            setNewExpenseCategory('Other');
                            setNewExpenseDay('');
                          }}
                          style={[styles.addSaveBtn, styles.editSaveBtn, { backgroundColor: theme.primary, opacity: newExpenseLabel.trim() && newExpenseAmount.trim() ? 1 : 0.4 }]}
                          disabled={!newExpenseLabel.trim() || !newExpenseAmount.trim()}
                          accessibilityRole="button"
                          accessibilityLabel="Save expense"
                        >
                          <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>Save</ThemedText>
                        </Pressable>
                      </View>
                    </Animated.View>
                  )}

                  {expenses.map((expense) => (
                    <View key={expense.id}>
                      <View style={[styles.expenseCard, { backgroundColor: theme.backgroundElement }]}>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.expenseLabel}>{expense.label}</ThemedText>
                          <ThemedText style={[styles.expenseMeta, { color: theme.textSecondary }]}>
                            {expense.category}{expense.day != null ? ` \u00B7 Day ${expense.day}` : ''}
                          </ThemedText>
                        </View>
                        <ThemedText style={styles.expenseAmount}>{currencySymbol}{expense.amount.toLocaleString()}</ThemedText>
                        <Pressable
                          onPress={() => {
                            Keyboard.dismiss();
                            setEditingExpenseId(expense.id);
                            setEditExpenseLabel(expense.label);
                            setEditExpenseAmount(String(expense.amount));
                            setEditExpenseCategory(expense.category);
                            setEditExpenseDay(expense.day != null ? String(expense.day) : '');
                          }}
                          hitSlop={8}
                          style={styles.expenseDeleteBtn}
                          accessibilityRole="button"
                          accessibilityLabel="Edit expense"
                        >
                          <SymbolView name="pencil" size={14} tintColor={theme.primary} />
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            Keyboard.dismiss();
                            Alert.alert('Delete expense?', `Remove "${expense.label}"?`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: () => updateTripExpenses(currentTrip.id, expenses.filter((e) => e.id !== expense.id)) },
                            ]);
                          }}
                          hitSlop={8}
                          style={styles.expenseDeleteBtn}
                          accessibilityRole="button"
                          accessibilityLabel="Delete expense"
                        >
                          <SymbolView name="xmark" size={14} tintColor={theme.textSecondary} />
                        </Pressable>
                      </View>
                      {editingExpenseId === expense.id && (
                        <Animated.View entering={FadeIn.duration(200)} style={[styles.addExpenseForm, { backgroundColor: theme.backgroundElement }]}>
                          <TextInput
                            style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                            value={editExpenseLabel}
                            onChangeText={setEditExpenseLabel}
                            placeholder="Expense label"
                            placeholderTextColor={theme.textSecondary}
                            accessibilityLabel="Expense label"
                          />
                          <TextInput
                            style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                            value={editExpenseAmount}
                            onChangeText={setEditExpenseAmount}
                            placeholder="Amount"
                            placeholderTextColor={theme.textSecondary}
                            keyboardType="decimal-pad"
                            accessibilityLabel="Expense amount"
                          />
                          <View style={styles.expenseCategoryRow}>
                            {EXPENSE_CATEGORIES.map((cat) => (
                              <Pressable
                                key={cat}
                                onPress={() => setEditExpenseCategory(cat)}
                                style={[styles.typeChip, { backgroundColor: editExpenseCategory === cat ? theme.primary : 'transparent', borderWidth: 1, borderColor: editExpenseCategory === cat ? theme.primary : theme.border }]}
                                accessibilityRole="button"
                                accessibilityLabel={`Select ${cat} category`}
                              >
                                <ThemedText style={[styles.typeText, editExpenseCategory === cat && { color: theme.primaryText }]}>{cat}</ThemedText>
                              </Pressable>
                            ))}
                          </View>
                          <ThemedText style={[styles.modalLabel, { marginTop: 4 }]}>Day (optional)</ThemedText>
                          <TextInput
                            style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                            value={editExpenseDay}
                            onChangeText={setEditExpenseDay}
                            placeholder="General"
                            placeholderTextColor={theme.textSecondary}
                            keyboardType="number-pad"
                            accessibilityLabel="Expense day"
                          />
                          <View style={styles.editBtnRow}>
                            <Pressable onPress={() => { Keyboard.dismiss(); setEditingExpenseId(null); }} style={styles.editCancelBtn} accessibilityRole="button" accessibilityLabel="Cancel edit">
                              <ThemedText style={styles.editCancelText}>Cancel</ThemedText>
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                Keyboard.dismiss();
                                const label = editExpenseLabel.trim();
                                const amount = parseFloat(editExpenseAmount);
                                if (!label || isNaN(amount) || amount <= 0) return;
                                const dayNum = editExpenseDay ? parseInt(editExpenseDay, 10) : undefined;
                                const updated = expenses.map((e) =>
                                  e.id === expense.id
                                    ? { ...e, label, amount, category: editExpenseCategory, day: dayNum && !isNaN(dayNum) ? dayNum : undefined }
                                    : e,
                                );
                                updateTripExpenses(currentTrip.id, updated);
                                setEditingExpenseId(null);
                              }}
                              style={[styles.addSaveBtn, styles.editSaveBtn, { backgroundColor: theme.primary, opacity: editExpenseLabel.trim() && editExpenseAmount.trim() ? 1 : 0.4 }]}
                              disabled={!editExpenseLabel.trim() || !editExpenseAmount.trim()}
                              accessibilityRole="button"
                              accessibilityLabel="Save expense"
                            >
                              <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>Save</ThemedText>
                            </Pressable>
                          </View>
                        </Animated.View>
                      )}
                    </View>
                  ))}

                  {expenses.length === 0 && !showAddExpense && (
                    <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary }]}>
                      No expenses yet. Track meals, transport, tickets, and other costs.
                    </ThemedText>
                  )}

                  {/* Per-day summary */}
                  <ThemedText type="sectionTitle" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                    Per-day summary
                  </ThemedText>
                  {(() => {
                    let hasAnyDaySpending = false;
                    const rows = allDays.map((d) => {
                      const dayExp = expenses.filter((e) => e.day === d);
                      const dayExpTotal = dayExp.reduce((s, e) => s + e.amount, 0);
                      const dayRes = (currentTrip.reservations ?? [])
                        .filter((r) => !r.cancelled && r.day === d && (!r.currency || r.currency === budgetCurrency) && r.price != null && r.price > 0);
                      const dayResTotal = dayRes.reduce((s, r) => s + (r.price ?? 0), 0);
                      const dayCost = dayExpTotal + dayResTotal;
                      const dayItemCount = dayExp.length + dayRes.length;
                      if (dayCost === 0 && dayItemCount === 0) return null;
                      hasAnyDaySpending = true;
                      return (
                        <View key={d} style={[styles.budgetDayRow, { borderBottomColor: theme.border }]}>
                          <ThemedText style={styles.budgetDayLabel}>Day {d}</ThemedText>
                          <ThemedText style={styles.budgetDayAmount}>{currencySymbol}{dayCost.toLocaleString()}</ThemedText>
                          <ThemedText style={[styles.budgetDayCount, { color: theme.textSecondary }]}>
                            {dayItemCount} {dayItemCount === 1 ? 'item' : 'items'}
                          </ThemedText>
                        </View>
                      );
                    });
                    if (!hasAnyDaySpending) {
                      return (
                        <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary }]}>
                          Assign expenses and bookings to days to see a per-day breakdown.
                        </ThemedText>
                      );
                    }
                    return rows;
                  })()}
                </>
              );
            })()}
          </View>
        ) : viewMode === 'reservations' ? (
          <TripBookingsTab
            trip={currentTrip}
            onReservationPress={(res, photoUrl) =>
              setBookingSheetData({ res, trip: currentTrip, photoUrl })
            }
          />
        ) : viewMode === 'alerts' ? (
          <View style={styles.itinerary}>
            {/* Toggle row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16 }}>
              <ThemedText style={{ fontSize: 14, color: theme.textSecondary }}>Trip alerts</ThemedText>
              <Switch
                value={alertsEnabled}
                onValueChange={(val) => {
                  setAlertsEnabled(val);
                  if (val && alertsFetchedForRef.current !== currentTrip.id) {
                    fetchTripAlerts();
                  }
                }}
                trackColor={{ false: theme.border, true: theme.primary }}
              />
            </View>

            {!alertsEnabled ? (
              <View style={styles.alertsEmptyState}>
                <ExpoImage
                  source={require('@/assets/images/alerts-image.png')}
                  style={styles.alertsEmptyImage}
                  contentFit="contain"
                />
                <ThemedText style={styles.alertsEmptyTitle}>Stay in the know</ThemedText>
                <ThemedText style={[styles.alertsEmptyDesc, { color: theme.textSecondary }]}>
                  Turn on alerts to monitor schedule conflicts, weather, venue closures, travel advisories, and more.
                </ThemedText>
              </View>
            ) : (activePulseAlerts.length + activeClosureAndExternal.length) === 0 && !alertsLoading ? (
              <View style={styles.alertsEmptyState}>
                <ExpoImage
                  source={require('@/assets/images/alerts-image.png')}
                  style={styles.alertsEmptyImage}
                  contentFit="contain"
                />
                <ThemedText style={styles.alertsEmptyTitle}>All clear</ThemedText>
                <ThemedText style={[styles.alertsEmptyDesc, { color: theme.textSecondary }]}>
                  No issues detected for {currentTrip.destination}. We'll notify you if anything comes up.
                </ThemedText>
              </View>
            ) : (
              <>
                {/* Internal pulse alerts */}
                {activePulseAlerts.length > 0 && (
                  <PulseAlertList
                    alerts={activePulseAlerts}
                    onAction={() => {}}
                    onDismiss={handleAlertDismiss}
                  />
                )}
                {/* Closure + external alerts */}
                {activeClosureAndExternal.length > 0 && (
                  <PulseAlertList
                    alerts={activeClosureAndExternal.map((a) => ({ ...a, actionLabel: '' })) as any}
                    onAction={() => {}}
                    onDismiss={handleAlertDismiss}
                  />
                )}
              </>
            )}
          </View>
        ) : (
          <TripMap
            activities={currentTrip.activities}
            destination={currentTrip.destination}
            totalDays={totalDays}
            topInset={insets.top}
          />
        )}
      </ScrollView>
      </>
      )}

      {/* Edit with AI — fixed input bar at bottom */}
      {viewMode === 'ai' && (
        <KeyboardAvoidingView style={styles.editChatBottomBar} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
          <View>
            {/* Suggestion chips — hide while AI is responding */}
            {!editChatTyping && (() => {
              const defaultChips = ['Add activity', 'Remove activity', 'Replace activity', 'Move activity', 'Swap days', 'Suggest places'];
              const chips = editChatSuggestions.length > 0
                ? editChatSuggestions
                : defaultChips;
              if (chips.length === 0) return null;
              return (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editChatSugRow} keyboardShouldPersistTaps="handled">
                  {chips.map((sug, sugIdx) => (
                    <Pressable key={sugIdx} onPress={() => sendEditChatMessage(sug)} style={({ pressed }) => [styles.editChatSugChip, { borderColor: theme.border, backgroundColor: '#fff', opacity: pressed ? 0.7 : 1 }]}>
                      <ThemedText style={[styles.editChatSugText, { color: theme.primary }]}>{sug}</ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
              );
            })()}
            {/* Input bar */}
            <View style={[styles.editChatInputBar, { borderTopColor: theme.border, backgroundColor: '#fff', paddingBottom: 12, ...Shadow.sm }]}>
              <Pressable
                onPress={() => setShowEditThreadList(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Chat history"
                style={styles.editChatBarBtn}
              >
                <SymbolView name="line.3.horizontal" size={20} tintColor={theme.primary} />
              </Pressable>
              <Pressable
                onPress={handleEditNewConversation}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="New conversation"
                style={styles.editChatBarBtn}
              >
                <SymbolView name="square.and.pencil" size={20} tintColor={theme.primary} />
              </Pressable>
              <TextInput style={[styles.editChatTextInput, { color: theme.text, backgroundColor: theme.backgroundElement }]} value={editChatInput} onChangeText={setEditChatInput} placeholder="Ask AI to edit your trip..." placeholderTextColor={theme.textSecondary} onSubmitEditing={() => { if (editChatInput.trim() && !editChatTyping) sendEditChatMessage(editChatInput); }} returnKeyType="send" multiline />
              <Pressable onPress={() => { if (editChatInput.trim() && !editChatTyping) sendEditChatMessage(editChatInput); }} disabled={!editChatInput.trim() || editChatTyping} style={[styles.editChatSendBtn, { backgroundColor: editChatInput.trim() && !editChatTyping ? theme.primary : theme.border }]}>
                <SymbolView name="arrow.up" size={16} tintColor={editChatInput.trim() && !editChatTyping ? theme.primaryText : theme.textSecondary} />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Edit chat history modal */}
      <Modal visible={showEditThreadList} transparent animationType="fade" onRequestClose={() => setShowEditThreadList(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.editThreadBackdrop} onPress={() => setShowEditThreadList(false)} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Pressable
            style={[styles.editThreadSheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 }]}
            onPress={(e) => e.stopPropagation()}
            accessibilityRole="button"
            accessibilityLabel="Edit chat history"
          >
            <View style={[styles.editThreadHandle, { backgroundColor: theme.border }]} />
            <ThemedText type="subtitle" style={styles.editThreadSheetTitle}>Edit history</ThemedText>

            <Pressable
              onPress={handleEditNewConversation}
              style={({ pressed }) => [styles.editThreadNewBtn, { backgroundColor: theme.primaryMuted, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
            >
              <SymbolView name="plus" size={16} tintColor={theme.primary} />
              <ThemedText style={[styles.editThreadNewBtnText, { color: theme.primary }]}>New edit</ThemedText>
            </Pressable>

            <ScrollView style={styles.editThreadList} showsVerticalScrollIndicator={false}>
              {editThreads.length === 0 && (
                <ThemedText style={[styles.editThreadEmpty, { color: theme.textSecondary }]}>No previous edits</ThemedText>
              )}
              {[...editThreads].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).map((thread) => {
                const isExpanded = editThreadOptionsId === thread.id;
                const isRenaming = editRenameThreadId === thread.id;
                return (
                <View
                  key={thread.id}
                  style={[
                    styles.editThreadCard,
                    { backgroundColor: editActiveThreadId === thread.id ? theme.primaryMuted : theme.backgroundElement, borderColor: theme.border },
                  ]}
                >
                  <View style={styles.editThreadRow}>
                    <Pressable
                      onPress={() => loadEditThread(thread)}
                      style={({ pressed }) => [styles.editThreadRowContent, { opacity: pressed ? 0.7 : 1 }]}
                      accessibilityRole="button"
                      accessibilityLabel={thread.title}
                    >
                      <SymbolView name={thread.pinned ? 'pin.fill' : 'bubble.left'} size={16} tintColor={thread.pinned ? theme.primary : theme.textSecondary} />
                      <View style={styles.editThreadRowText}>
                        <ThemedText style={styles.editThreadTitle} numberOfLines={1}>{thread.title}</ThemedText>
                        <ThemedText style={[styles.editThreadDate, { color: theme.textSecondary }]}>
                          {new Date(thread.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </ThemedText>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => setEditThreadOptionsId(isExpanded ? null : thread.id)}
                      style={styles.editThreadDotsBtn}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Options"
                    >
                      <SymbolView name="ellipsis" size={18} tintColor={theme.textSecondary} />
                    </Pressable>
                  </View>

                  {isExpanded && (
                    <Animated.View entering={FadeIn.duration(150)}>
                      <View style={[styles.editThreadOptionDivider, { backgroundColor: theme.border }]} />
                      <Pressable
                        onPress={() => startRenameEditThread(thread.id)}
                        style={({ pressed }) => [styles.editThreadOptionBtn, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                      >
                        <SymbolView name="pencil" size={15} tintColor={theme.text} />
                        <ThemedText style={styles.editThreadOptionText}>Rename</ThemedText>
                      </Pressable>
                      <View style={[styles.editThreadOptionDivider, { backgroundColor: theme.border }]} />
                      <Pressable
                        onPress={() => togglePinEditThread(thread.id)}
                        style={({ pressed }) => [styles.editThreadOptionBtn, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                      >
                        <SymbolView name={thread.pinned ? 'pin.slash' : 'pin'} size={15} tintColor={theme.text} />
                        <ThemedText style={styles.editThreadOptionText}>{thread.pinned ? 'Unpin' : 'Pin'}</ThemedText>
                      </Pressable>
                      <View style={[styles.editThreadOptionDivider, { backgroundColor: theme.border }]} />
                      <Pressable
                        onPress={() => {
                          Alert.alert('Delete edit?', `"\u200B${thread.title}"`, [
                            { text: 'Cancel', style: 'cancel', onPress: () => setEditThreadOptionsId(null) },
                            { text: 'Delete', style: 'destructive', onPress: () => deleteEditThread(thread.id) },
                          ]);
                        }}
                        style={({ pressed }) => [styles.editThreadOptionBtn, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                      >
                        <SymbolView name="trash" size={15} tintColor="#E53935" />
                        <ThemedText style={[styles.editThreadOptionText, { color: '#E53935' }]}>Delete</ThemedText>
                      </Pressable>
                    </Animated.View>
                  )}

                  {isRenaming && (
                    <Animated.View entering={FadeIn.duration(150)}>
                      <View style={[styles.editThreadOptionDivider, { backgroundColor: theme.border }]} />
                      <View style={styles.editThreadRenameRow}>
                        <TextInput
                          value={editRenameText}
                          onChangeText={setEditRenameText}
                          style={[styles.editThreadRenameInput, { color: theme.text }]}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={confirmEditRename}
                          selectTextOnFocus
                        />
                        <Pressable onPress={confirmEditRename} disabled={!editRenameText.trim()} accessibilityRole="button">
                          <SymbolView name="checkmark.circle.fill" size={26} tintColor={editRenameText.trim() ? theme.primary : theme.border} />
                        </Pressable>
                        <Pressable onPress={() => { setEditRenameThreadId(null); setEditRenameText(''); }} accessibilityRole="button">
                          <SymbolView name="xmark.circle.fill" size={26} tintColor={theme.textSecondary} />
                        </Pressable>
                      </View>
                    </Animated.View>
                  )}
                </View>
              );})}
            </ScrollView>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>


      {aiEditLoading && (
        <Animated.View entering={FadeIn.duration(200)} style={[styles.aiEditOverlay, { backgroundColor: theme.background }]}>
          <SymbolView name="sparkles" size={32} tintColor={theme.primary} />
          <ThemedText type="headline">AI is editing your trip...</ThemedText>
          <ThemedText style={{ color: theme.textSecondary, fontSize: 14, marginTop: 4 }}>This may take a moment</ThemedText>
        </Animated.View>
      )}

      {/* Activity context menu — shown on hold or "..." tap */}
      <ActivityContextMenu
        activity={contextMenuActivity}
        visible={!!contextMenuActivity}
        onClose={() => setContextMenuActivity(null)}
        onBook={handleBookActivity}
        bookLabel={contextMenuActivity ? getBookLabel(contextMenuActivity) : undefined}
        onReplace={(a) => {
          const msg = `Suggest a replacement for "${a.title}" (${a.category || a.type}, Day ${a.day})`;
          setEditChatInput(msg);
          setViewMode('ai');
          setTimeout(() => {
            sendEditChatMessage(msg);
          }, 600);
        }}
        onMove={(a) => handleOpenMoveActivity(a)}
        onEdit={(a) => handleStartEdit(a)}
        onRemove={handleContextRemove}
        onReaction={handleActivityReaction}
      />

      <AskToveli
        visible={askVisible}
        onClose={() => { setAskVisible(false); setCustomizeTarget(null); }}
        onFreeTextEdit={handleAIEdit}
        onCommand={(command, extractedDay, searchTerms, startAfter) => {
          // Activity-specific scope: apply command to just the target activity
          if (customizeTarget) {
            const scope: TransformScope = { type: 'activity', activityId: customizeTarget.id, day: customizeTarget.day };
            handleCommand(command, customizeTarget.day, scope, searchTerms, startAfter);
            setCustomizeTarget(null);
            return;
          }
          if (command === 'add_activity') {
            handleCommand(command, extractedDay ?? selectedDay);
            return;
          }
          // If the text parser extracted a day number, use it
          if (extractedDay != null) {
            handleCommand(command, undefined, { type: 'day', day: extractedDay }, searchTerms, startAfter);
            return;
          }
          // Show scope picker for transformation commands
          if (selectedDay != null) {
            Alert.alert(
              'Apply to...',
              undefined,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: `Day ${selectedDay} only`,
                  onPress: () => handleCommand(command, undefined, { type: 'day', day: selectedDay }, searchTerms, startAfter),
                },
                {
                  text: 'Select days...',
                  onPress: () => {
                    setScopePickerCommand(command);
                    setScopePickerDays(new Set([selectedDay]));
                    setScopePickerSearchTerms(searchTerms);
                    setScopePickerStartAfter(startAfter);
                  },
                },
                {
                  text: 'Full trip',
                  onPress: () => handleCommand(command, undefined, { type: 'full_trip' }, searchTerms, startAfter),
                },
              ],
            );
          } else {
            // No day context — offer full trip or select days
            Alert.alert(
              'Apply to...',
              undefined,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Select days...',
                  onPress: () => {
                    setScopePickerCommand(command);
                    setScopePickerDays(new Set());
                    setScopePickerSearchTerms(searchTerms);
                    setScopePickerStartAfter(startAfter);
                  },
                },
                {
                  text: 'Full trip',
                  onPress: () => handleCommand(command, undefined, { type: 'full_trip' }, searchTerms, startAfter),
                },
              ],
            );
          }
        }}
        currentDay={selectedDay}
        totalDays={totalDays}
        tripDestination={currentTrip.title ?? currentTrip.destination}
        activityCount={currentTrip.activities.length}
      />

      {transformResult && (
        <TransformationReveal
          visible={!!transformResult}
          preview={pendingTransform?.preview ?? null}
          summary={transformResult.summary}
          changes={transformResult.changes}
          whyFits={transformResult.whyFits}
          hasConflicts={(pendingTransform?.conflicts ?? []).some(
            (c) => c.type === 'overlap' || c.type === 'locked_conflict',
          )}
          onApply={() => {
            // Apply the pending transformation (no memory action)
            handleApplyTransform();
          }}
          onModifyTime={(activityId, newTime) => {
            if (!pendingTransform) return;
            const updatedActivities = pendingTransform.activities.map((a) =>
              a.id === activityId ? { ...a, time: newTime } : a,
            );
            const updatedPreview = computeChangePreview(currentTrip.activities, updatedActivities, pendingTransform.summary);
            const updatedConflicts = checkConflicts(updatedActivities, totalDays);
            setPendingTransform({ ...pendingTransform, activities: updatedActivities, preview: updatedPreview, conflicts: updatedConflicts });
          }}
          onDismiss={() => {
            // Discard the pending transformation — do NOT dismiss the pulse alert
            setPendingTransform(null);
            setTransformResult(null);
            setPendingPulseAlertId(null);
            setSelectedDay(undefined);
          }}
          memoryEntry={transformResult.memoryEntry}
          onRememberPreference={transformResult.memoryEntry ? () => {
            handleApplyTransform('global');
          } : undefined}
          onRememberTripOnly={transformResult.memoryEntry ? () => {
            handleApplyTransform('trip_only');
          } : undefined}
        />
      )}

      <SmartReplacePicker
        visible={!!replaceTarget && replaceAlternatives.length > 0}
        alternatives={replaceAlternatives}
        onPick={handlePickReplacement}
        onDismiss={() => { setReplaceTarget(null); setReplaceAlternatives([]); }}
      />

      {/* Manual Replace Modal */}
      <Modal
        visible={!!manualReplaceTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setManualReplaceTarget(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setManualReplaceTarget(null)} accessibilityRole="button" accessibilityLabel="Close">
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()} accessibilityRole="button" accessibilityLabel="Manual replace dialog">
            <ThemedText type="subtitle" style={styles.modalTitle}>Manual Replace</ThemedText>
            {manualReplaceTarget && (
              <ThemedText style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                Replacing: {manualReplaceTarget.title}
              </ThemedText>
            )}
            <ThemedText style={styles.modalLabel}>New activity name</ThemedText>
            <TextInput
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={manualReplaceName}
              onChangeText={setManualReplaceName}
              placeholder="Type the replacement name..."
              placeholderTextColor={theme.textSecondary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleManualReplace}
              accessibilityLabel="Replacement activity name"
            />
            <ThemedText style={styles.modalLabel}>Time</ThemedText>
            <TimePickerButton
              value={manualReplaceTime}
              onChange={setManualReplaceTime}
            />
            {manualReplaceName.trim() ? (
              <View style={[styles.replacePreview, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <ThemedText style={{ fontSize: 12, fontWeight: '700', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Preview</ThemedText>
                <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>{manualReplaceName.trim()}</ThemedText>
                <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>
                  Day {manualReplaceTarget?.day} at {formatTimeDisplay(manualReplaceTime)}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.modalBtnRow}>
              <Pressable onPress={() => setManualReplaceTarget(null)} style={[styles.modalBtnSecondary, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="Cancel replace">
                <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={handleManualReplace}
                style={[styles.modalBtnPrimary, { backgroundColor: theme.primary, opacity: manualReplaceName.trim() ? 1 : 0.4 }]}
                disabled={!manualReplaceName.trim()}
                accessibilityRole="button"
                accessibilityLabel="Confirm replace"
              >
                <ThemedText style={{ color: theme.primaryText, fontSize: 15, fontWeight: '600' }}>Replace</ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Multi-day Scope Picker Modal */}
      <Modal
        visible={!!scopePickerCommand}
        transparent
        animationType="fade"
        onRequestClose={() => setScopePickerCommand(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setScopePickerCommand(null)} accessibilityRole="button" accessibilityLabel="Close scope picker">
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()} accessibilityRole="button" accessibilityLabel="Select days dialog">
            <ThemedText type="subtitle" style={styles.modalTitle}>Select Days</ThemedText>
            <ThemedText style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
              Tap days to include in this transformation
            </ThemedText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 }}>
              {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => {
                const selected = scopePickerDays.has(d);
                return (
                  <Pressable
                    key={d}
                    onPress={() => {
                      const next = new Set(scopePickerDays);
                      if (next.has(d)) next.delete(d);
                      else next.add(d);
                      setScopePickerDays(next);
                    }}
                    style={[
                      styles.dayChip,
                      { borderColor: theme.border, backgroundColor: selected ? theme.primary : theme.backgroundElement },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Day ${d}${selected ? ', selected' : ''}`}
                  >
                    <ThemedText style={{ color: selected ? theme.primaryText : theme.text, fontWeight: '600', fontSize: 14 }}>
                      Day {d}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.modalBtnRow}>
              <Pressable onPress={() => setScopePickerCommand(null)} style={[styles.modalBtnSecondary, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="Cancel">
                <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (scopePickerCommand && scopePickerDays.size > 0) {
                    const days = [...scopePickerDays].sort((a, b) => a - b);
                    if (days.length === 1) {
                      handleCommand(scopePickerCommand, undefined, { type: 'day', day: days[0] }, scopePickerSearchTerms, scopePickerStartAfter);
                    } else {
                      handleCommand(scopePickerCommand, undefined, { type: 'days', days }, scopePickerSearchTerms, scopePickerStartAfter);
                    }
                  }
                  setScopePickerCommand(null);
                  setScopePickerSearchTerms(undefined);
                  setScopePickerStartAfter(undefined);
                }}
                style={[styles.modalBtnPrimary, { backgroundColor: theme.primary, opacity: scopePickerDays.size > 0 ? 1 : 0.4 }]}
                disabled={scopePickerDays.size === 0}
                accessibilityRole="button"
                accessibilityLabel="Apply to selected days"
              >
                <ThemedText style={{ color: theme.primaryText, fontSize: 15, fontWeight: '600' }}>
                  Apply ({scopePickerDays.size} {scopePickerDays.size === 1 ? 'day' : 'days'})
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Trip Edit Modal — full-screen form sheet */}
      <Modal visible={showTripEdit} animationType="slide" presentationStyle="formSheet" onRequestClose={() => {
        const hasChanges = editTripTitle !== (currentTrip.title ?? currentTrip.destination)
          || editDest !== currentTrip.destination
          || editStartDate !== currentTrip.startDate
          || editEndDate !== currentTrip.endDate
          || editNotes !== (currentTrip.notes || '');
        if (hasChanges) {
          Alert.alert('Discard changes?', 'You have unsaved changes.', [
            { text: 'Keep editing', style: 'cancel' },
            { text: 'Discard', style: 'destructive', onPress: () => setShowTripEdit(false) },
          ]);
        } else {
          setShowTripEdit(false);
        }
      }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.addModal, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={[styles.addModalHeader, { borderBottomColor: theme.border }]}>
              <Pressable onPress={() => {
                Keyboard.dismiss();
                const hasChanges = editTripTitle !== (currentTrip.title ?? currentTrip.destination)
                  || editDest !== currentTrip.destination
                  || editStartDate !== currentTrip.startDate
                  || editEndDate !== currentTrip.endDate
                  || editNotes !== (currentTrip.notes || '');
                if (hasChanges) {
                  Alert.alert('Discard changes?', 'You have unsaved changes.', [
                    { text: 'Keep editing', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: () => setShowTripEdit(false) },
                  ]);
                } else {
                  setShowTripEdit(false);
                }
              }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
                <ThemedText style={{ fontSize: 15, color: theme.textSecondary }}>Cancel</ThemedText>
              </Pressable>
              <ThemedText style={styles.addModalTitle}>Edit Trip</ThemedText>
              <Pressable onPress={() => { Keyboard.dismiss(); handleSaveTripEdit(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save trip details">
                <ThemedText style={{ fontSize: 15, fontWeight: '700', color: theme.primary }}>Save</ThemedText>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {(() => {
                const isAITrip = !!currentTrip.generatedAt;
                if (isAITrip) {
                  // AI-generated trip: survey fields only
                  return (
                    <>
                      {/* ─── Destination & Dates ─── */}
                      <ThemedText type="eyebrow" style={{ color: theme.textSecondary, marginBottom: 12 }}>Trip Details</ThemedText>

                      <ThemedText style={styles.modalLabel}>Trip name</ThemedText>
                      <TextInput
                        style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                        value={editTripTitle}
                        onChangeText={setEditTripTitle}
                        placeholder="Trip name"
                        placeholderTextColor={theme.textSecondary}
                        autoCapitalize="words"
                        returnKeyType="next"
                        accessibilityLabel="Trip name"
                      />

                      <ThemedText style={styles.modalLabel}>Destination</ThemedText>
                      <TextInput
                        style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                        value={editDest}
                        onChangeText={setEditDest}
                        placeholder="Destination"
                        placeholderTextColor={theme.textSecondary}
                        returnKeyType="done"
                        blurOnSubmit
                        accessibilityLabel="Destination"
                      />

                      <View style={styles.modalDateRow}>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.modalLabel}>Start date</ThemedText>
                          <Pressable
                            onPress={() => setShowEditStartPicker(true)}
                            style={[styles.modalDateBtn, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                            accessibilityRole="button"
                            accessibilityLabel="Set start date"
                          >
                            <ThemedText style={[styles.modalDateBtnText, { color: editStartDate ? theme.text : theme.textSecondary }]}>
                              {editStartDate ? formatDisplayDate(editStartDate) : 'Tap to set'}
                            </ThemedText>
                          </Pressable>
                        </View>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.modalLabel}>End date</ThemedText>
                          <Pressable
                            onPress={() => setShowEditEndPicker(true)}
                            style={[styles.modalDateBtn, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                            accessibilityRole="button"
                            accessibilityLabel="Set end date"
                          >
                            <ThemedText style={[styles.modalDateBtnText, { color: editEndDate ? theme.text : theme.textSecondary }]}>
                              {editEndDate ? formatDisplayDate(editEndDate) : 'Tap to set'}
                            </ThemedText>
                          </Pressable>
                        </View>
                      </View>

                      {/* ─── Travel Preferences ─── */}
                      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginVertical: 24 }} />
                      <ThemedText type="eyebrow" style={{ color: theme.textSecondary, marginBottom: 12 }}>Travel Preferences</ThemedText>

                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.modalLabel}>Travelers</ThemedText>
                          <TextInput
                            style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                            value={editTravelers}
                            onChangeText={(text) => {
                              const num = text.replace(/[^0-9]/g, '');
                              const val = parseInt(num, 10);
                              if (num === '' || (val >= 1 && val <= 20)) setEditTravelers(num);
                            }}
                            placeholder="#"
                            placeholderTextColor={theme.textSecondary}
                            keyboardType="number-pad"
                            accessibilityLabel="Number of travelers"
                          />
                        </View>
                        <View style={{ flex: 2 }}>
                          <ThemedText style={styles.modalLabel}>Departing from</ThemedText>
                          <TextInput
                            style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                            value={editDepartureFrom}
                            onChangeText={setEditDepartureFrom}
                            placeholder="e.g. New York"
                            placeholderTextColor={theme.textSecondary}
                            accessibilityLabel="Departing from"
                          />
                        </View>
                      </View>

                      <ThemedText style={styles.modalLabel}>Budget</ThemedText>
                      <View style={styles.editChipRow}>
                        {(['$', '$$', '$$$', '$$$$'] as const).map((v) => (
                          <Pressable
                            key={v}
                            onPress={() => setEditBudget(v)}
                            style={[styles.editChip, { backgroundColor: editBudget === v ? theme.primary : theme.backgroundElement, borderColor: editBudget === v ? theme.primary : theme.border }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Select ${v} budget`}
                          >
                            <ThemedText style={[styles.editChipText, editBudget === v && { color: theme.primaryText }]}>{v}</ThemedText>
                          </Pressable>
                        ))}
                      </View>

                    </>
                  );
                } else {
                  // Manual trip: basic info fields
                  return (
                    <>
                      {/* ─── Trip Info ─── */}
                      <ThemedText type="eyebrow" style={{ color: theme.textSecondary, marginBottom: 12 }}>Trip Info</ThemedText>

                      <ThemedText style={styles.modalLabel}>Trip name</ThemedText>
                      <TextInput
                        style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                        value={editTripTitle}
                        onChangeText={setEditTripTitle}
                        placeholder="Trip name"
                        placeholderTextColor={theme.textSecondary}
                        autoCapitalize="words"
                        returnKeyType="next"
                        accessibilityLabel="Trip name"
                      />

                      <ThemedText style={styles.modalLabel}>Destination</ThemedText>
                      <TextInput
                        style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                        value={editDest}
                        onChangeText={setEditDest}
                        placeholder="Destination"
                        placeholderTextColor={theme.textSecondary}
                        returnKeyType="done"
                        blurOnSubmit
                        accessibilityLabel="Destination"
                      />

                      <View style={styles.modalDateRow}>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.modalLabel}>Start date</ThemedText>
                          <Pressable
                            onPress={() => setShowEditStartPicker(true)}
                            style={[styles.modalDateBtn, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                            accessibilityRole="button"
                            accessibilityLabel="Set start date"
                          >
                            <ThemedText style={[styles.modalDateBtnText, { color: editStartDate ? theme.text : theme.textSecondary }]}>
                              {editStartDate ? formatDisplayDate(editStartDate) : 'Tap to set'}
                            </ThemedText>
                          </Pressable>
                        </View>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.modalLabel}>End date</ThemedText>
                          <Pressable
                            onPress={() => setShowEditEndPicker(true)}
                            style={[styles.modalDateBtn, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                            accessibilityRole="button"
                            accessibilityLabel="Set end date"
                          >
                            <ThemedText style={[styles.modalDateBtnText, { color: editEndDate ? theme.text : theme.textSecondary }]}>
                              {editEndDate ? formatDisplayDate(editEndDate) : 'Tap to set'}
                            </ThemedText>
                          </Pressable>
                        </View>
                      </View>

                      {/* ─── Notes ─── */}
                      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginVertical: 24 }} />
                      <ThemedText type="eyebrow" style={{ color: theme.textSecondary, marginBottom: 12 }}>Notes</ThemedText>

                      <ThemedText style={styles.modalLabel}>Trip notes</ThemedText>
                      <TextInput
                        style={[styles.modalInput, styles.modalInputMulti, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                        value={editNotes}
                        onChangeText={setEditNotes}
                        placeholder="Trip notes..."
                        placeholderTextColor={theme.textSecondary}
                        multiline
                        textAlignVertical="top"
                        returnKeyType="done"
                        blurOnSubmit
                        accessibilityLabel="Trip notes"
                      />
                    </>
                  );
                }
              })()}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
        <DatePickerModal
          visible={showEditStartPicker}
          label="Start date"
          value={editStartDate}
          onSelect={(date) => {
            setEditStartDate(date);
            if (date && editEndDate && editEndDate < date) setEditEndDate('');
          }}
          onClose={() => setShowEditStartPicker(false)}
        />
        <DatePickerModal
          visible={showEditEndPicker}
          label="End date"
          value={editEndDate || editStartDate}
          onSelect={setEditEndDate}
          onClose={() => setShowEditEndPicker(false)}
          minDate={editStartDate || undefined}
        />
      </Modal>

      {/* Move Activity Modal — bottom sheet with inline time picker (same as add-activity) */}
      {!!movingActivity && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
        >
          <Pressable
            onPress={() => setMovingActivity(null)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          >
            <Pressable onPress={(e) => e.stopPropagation()} style={{ marginHorizontal: 16, marginBottom: insets.bottom + 16 }}>
              <Animated.View
                entering={SlideInDown.duration(250)}
                style={{
                  backgroundColor: theme.background, borderRadius: 20,
                  ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } }, android: { elevation: 8 } }),
                }}
              >
                <View style={{ padding: 20, paddingBottom: 24 }}>
                  <ThemedText style={{ fontSize: 19, fontWeight: '700', textAlign: 'center' }}>Move activity</ThemedText>
                  <ThemedText style={{ fontSize: 14, color: theme.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 12 }}>{movingActivity.title}</ThemedText>

                  {/* Day picker */}
                  <ThemedText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary, marginBottom: 6, letterSpacing: 0.5 }}>DAY</ThemedText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                    {allDays.map((d) => (
                      <Pressable key={d} onPress={() => setMoveDay(d)}
                        style={{ minWidth: 38, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
                          backgroundColor: moveDay === d ? theme.primary : theme.backgroundElement }}>
                        <ThemedText style={{ fontSize: 13, fontWeight: '600', color: moveDay === d ? theme.primaryText : theme.text }}>{formatDayLabel(d, currentTrip.startDate, currentTrip.datesKnown)}</ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>

                  {/* Inline time picker — same as add-activity */}
                  {(() => {
                    const parsed = parseTime(moveTime);
                    const snappedMin = Math.round(parsed.minute / 5) * 5;
                    const chipStyle = (active: boolean) => ({
                      minWidth: 38, height: 36, borderRadius: 18,
                      alignItems: 'center' as const, justifyContent: 'center' as const,
                      paddingHorizontal: 8,
                      backgroundColor: active ? theme.primary : theme.backgroundElement,
                    });
                    const chipText = (active: boolean) => ({
                      fontSize: 13, fontWeight: '600' as const,
                      color: active ? theme.primaryText : theme.text,
                    });
                    return (
                      <>
                        <ThemedText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary, marginTop: 16, marginBottom: 6, letterSpacing: 0.5 }}>HOUR</ThemedText>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                          {HOURS_12.map((h) => (
                            <Pressable key={h} onPress={() => setMoveTime(formatTime(h, snappedMin, parsed.period))} style={chipStyle(parsed.hour12 === h)}>
                              <ThemedText style={chipText(parsed.hour12 === h)}>{h}</ThemedText>
                            </Pressable>
                          ))}
                        </ScrollView>

                        <ThemedText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary, marginTop: 12, marginBottom: 6, letterSpacing: 0.5 }}>MINUTE</ThemedText>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                          {MINUTES_5.map((m) => (
                            <Pressable key={m} onPress={() => setMoveTime(formatTime(parsed.hour12, m, parsed.period))} style={chipStyle(snappedMin === m)}>
                              <ThemedText style={chipText(snappedMin === m)}>{String(m).padStart(2, '0')}</ThemedText>
                            </Pressable>
                          ))}
                        </ScrollView>

                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                          {(['AM', 'PM'] as const).map((p) => (
                            <Pressable key={p} onPress={() => setMoveTime(formatTime(parsed.hour12, snappedMin, p))}
                              style={{ paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10,
                                backgroundColor: parsed.period === p ? theme.primary : theme.backgroundElement }}>
                              <ThemedText style={{ fontSize: 14, fontWeight: '700', color: parsed.period === p ? theme.primaryText : theme.text }}>{p}</ThemedText>
                            </Pressable>
                          ))}
                        </View>

                        <ThemedText style={{ textAlign: 'center', fontSize: 18, fontWeight: '700', marginTop: 14, color: theme.text }}>
                          {formatTimeDisplay(moveTime)}
                        </ThemedText>
                      </>
                    );
                  })()}

                  {/* Action buttons */}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                    <Pressable onPress={() => setMovingActivity(null)}
                      style={({ pressed }) => [{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center', opacity: pressed ? 0.7 : 1 }]}>
                      <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
                    </Pressable>
                    <Pressable onPress={handleConfirmMove}
                      style={({ pressed }) => [{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.primary, alignItems: 'center', opacity: pressed ? 0.85 : 1 }]}>
                      <ThemedText style={{ fontSize: 15, fontWeight: '700', color: theme.primaryText }}>Move</ThemedText>
                    </Pressable>
                  </View>
                </View>
              </Animated.View>
            </Pressable>
          </Pressable>
        </Animated.View>
      )}

      {/* Add Activity Modal — search-based */}
      <Modal
        visible={addingToDay !== null}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => { setAddingToDay(null); setActSearchQuery(''); setActSearchResults([]); setActSelectedPlace(null); }}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.addModal, { backgroundColor: theme.background }]}>
            <View style={[styles.addModalHeader, { borderBottomColor: theme.border }]}>
              <ThemedText style={styles.addModalTitle}>Add to Day {addingToDay}</ThemedText>
              <Pressable onPress={() => { setAddingToDay(null); setActSearchQuery(''); setActSearchResults([]); setActSelectedPlace(null); }} hitSlop={8} style={styles.addModalClose} accessibilityRole="button" accessibilityLabel="Close">
                <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
              </Pressable>
            </View>
            <View style={{ padding: 16, paddingBottom: 8 }}>
              <TextInput
                style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                value={actSearchQuery}
                onChangeText={(text) => {
                  setActSearchQuery(text);
                  if (actSearchTimer.current) clearTimeout(actSearchTimer.current);
                  if (text.trim().length < 2) {
                    setActSearchResults([]);
                    setActSearchLoading(false);
                    return;
                  }
                  setActSearchLoading(true);
                  const q = text.trim();
                  actSearchTimer.current = setTimeout(async () => {
                    if (!trip) return;
                    try {
                      const results = await searchExplorePlaces(q, {
                        type: 'trip',
                        tripId: trip.id,
                        destination: trip.destination,
                        label: trip.destination,
                      });
                      setActSearchResults(results.slice(0, 15));
                    } catch {
                      setActSearchResults([]);
                    } finally {
                      setActSearchLoading(false);
                    }
                  }, 400);
                }}
                placeholder="Search for a place..."
                placeholderTextColor={theme.textSecondary}
                autoFocus
                returnKeyType="search"
                accessibilityLabel="Search for a place"
              />
            </View>
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              {actSearchQuery.trim().length < 2 && addingToDay != null && trip && (
                <Pressable
                  onPress={() => {
                    const day = addingToDay;
                    setAddingToDay(null);
                    setActSearchQuery('');
                    setActSearchResults([]);
                    setActSelectedPlace(null);
                    router.push({ pathname: '/(tabs)/explore', params: { tripId: trip.id, day: String(day) } } as any);
                  }}
                  style={({ pressed }) => [styles.browseExploreRow, { borderColor: theme.border, backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Browse places in ${trip.destination}`}
                >
                  <SymbolView name="map" size={18} tintColor={theme.primary} />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.browseExploreTitle}>Browse {trip.destination}</ThemedText>
                    <ThemedText style={[styles.browseExploreSub, { color: theme.textSecondary }]}>
                      Explore restaurants, sights and stays on a map
                    </ThemedText>
                  </View>
                  <SymbolView name="chevron.right" size={12} tintColor={theme.textSecondary} />
                </Pressable>
              )}
              {actSearchLoading && (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={theme.primary} />
                  <ThemedText style={{ color: theme.textSecondary, fontSize: 13, marginTop: 8 }}>
                    Searching...
                  </ThemedText>
                </View>
              )}
              {!actSearchLoading && actSearchQuery.trim().length >= 2 && actSearchResults.length === 0 && (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <ThemedText style={{ color: theme.textSecondary, fontSize: 14 }}>
                    No results found
                  </ThemedText>
                </View>
              )}
              {actSearchResults.map((place) => (
                <StaySearchResultRow key={place.placeId ?? place.name} place={place} theme={theme} onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const t = categoryToActivityType(place.category);
                  setActConfirmTime(addingToDay ? suggestTimeForActivity(currentTrip.activities, addingToDay, t) : defaultTimeForType(t));
                  setActConfirmStep('preview');
                  setActSelectedPlace(place);
                }} />
              ))}
              {!actSearchLoading && actSearchQuery.trim().length < 2 && (
                <>
                  {actSuggestions.length > 0 && (
                    <View style={{ marginTop: 8 }}>
                      <ThemedText style={{ fontSize: 14, fontWeight: '600', marginBottom: 10, color: theme.textSecondary }}>
                        Recommended in {currentTrip.destination}
                      </ThemedText>
                      {actSuggestions.map((place) => (
                        <StaySearchResultRow key={place.placeId ?? place.name} place={place} theme={theme} onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          const t = categoryToActivityType(place.category);
                          setActConfirmTime(addingToDay ? suggestTimeForActivity(currentTrip.activities, addingToDay, t) : defaultTimeForType(t));
                          setActConfirmStep('preview');
                          setActSelectedPlace(place);
                        }} />
                      ))}
                    </View>
                  )}
                  {actSuggestions.length === 0 && (
                    <View style={{ padding: 20, alignItems: 'center' }}>
                      <SymbolView name="magnifyingglass" size={28} tintColor={theme.border} />
                      <ThemedText style={{ color: theme.textSecondary, fontSize: 14, marginTop: 10, textAlign: 'center' }}>
                        Search for restaurants, attractions, cafes, and more
                      </ThemedText>
                    </View>
                  )}
                </>
              )}
            </ScrollView>

            {/* Activity confirmation popup — two-stage: preview → time picker */}
            {actSelectedPlace && (() => {
              const place = actSelectedPlace;
              return (
                <Animated.View
                  entering={FadeIn.duration(200)}
                  exiting={FadeOut.duration(150)}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
                >
                  <Pressable
                    onPress={() => { setActSelectedPlace(null); setActConfirmStep('preview'); }}
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
                  >
                    <Pressable onPress={(e) => e.stopPropagation()} style={{ marginHorizontal: 16, marginBottom: 24, maxHeight: Dimensions.get('window').height * 0.75 }}>
                      <Animated.View
                        entering={SlideInDown.duration(250)}
                        style={{
                          backgroundColor: theme.background, borderRadius: 20,
                          overflow: 'hidden', flex: 1,
                          ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } }, android: { elevation: 8 } }),
                        }}
                      >
                        <ScrollView bounces={false}>
                        {/* Photo banner — only in preview step */}
                        {actConfirmStep === 'preview' && (
                          <ActivityConfirmPhoto place={place} theme={theme} />
                        )}

                        <View style={{ padding: 20, paddingBottom: 24 }}>
                          {/* Place info */}
                          <ThemedText style={{ fontSize: actConfirmStep === 'time' ? 17 : 19, fontWeight: '700' }} numberOfLines={2}>{place.name}</ThemedText>
                          {actConfirmStep === 'preview' && place.rating != null && (
                            <ThemedText style={{ fontSize: 14, color: theme.textSecondary, marginTop: 4 }}>
                              ★ {place.rating.toFixed(1)}{place.reviewCount ? ` (${place.reviewCount})` : ''}
                            </ThemedText>
                          )}
                          {actConfirmStep === 'preview' && place.address && (
                            <ThemedText style={{ fontSize: 14, color: theme.textSecondary, marginTop: 2 }} numberOfLines={2}>
                              {place.address}
                            </ThemedText>
                          )}

                          {/* Stage 1: Preview with Add + View Details */}
                          {actConfirmStep === 'preview' && (
                            <>
                              <Pressable
                                onPress={() => {
                                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                  const isDuplicate = currentTrip.activities.some(
                                    (a) => a.placeId && a.placeId === place.placeId
                                  );
                                  if (isDuplicate) {
                                    showToast('This place is already in your itinerary', 'info');
                                    setActSelectedPlace(null);
                                    return;
                                  }
                                  setActConfirmStep('time');
                                }}
                                style={({ pressed }) => [{
                                  backgroundColor: theme.primary, borderRadius: 14,
                                  paddingVertical: 14, alignItems: 'center',
                                  marginTop: 18, opacity: pressed ? 0.85 : 1,
                                }]}
                                accessibilityRole="button"
                                accessibilityLabel={`Add to Day ${addingToDay}`}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <SymbolView name="plus.circle.fill" size={18} tintColor={theme.primaryText} />
                                  <ThemedText style={{ fontSize: 16, fontWeight: '700', color: theme.primaryText }}>Add to Day {addingToDay}</ThemedText>
                                </View>
                              </Pressable>

                              <Pressable
                                onPress={() => {
                                  const p = place;
                                  actSearchReturnDay.current = addingToDay;
                                  setActSelectedPlace(null);
                                  setActConfirmStep('preview');
                                  setAddingToDay(null);
                                  let url = `/place-detail?name=${encodeURIComponent(p.name)}&destination=${encodeURIComponent(currentTrip.destination)}&tripId=${currentTrip.id}&category=${encodeURIComponent(p.primaryTypeLabel || p.category || 'activity')}`;
                                  if (p.placeId) url += `&placeId=${encodeURIComponent(p.placeId)}`;
                                  if (p.address) url += `&address=${encodeURIComponent(p.address)}`;
                                  if (p.lat != null) url += `&lat=${p.lat}`;
                                  if (p.lng != null) url += `&lng=${p.lng}`;
                                  if (p.rating != null) url += `&rating=${p.rating}`;
                                  if (p.reviewCount != null) url += `&reviewCount=${p.reviewCount}`;
                                  if (p.photos?.[0]?.reference) url += `&photoRef=${encodeURIComponent(p.photos[0].reference)}`;
                                  router.push(url as any);
                                }}
                                style={({ pressed }) => [{ marginTop: 10, paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 }]}
                                accessibilityRole="button"
                                accessibilityLabel="View full details"
                              >
                                <ThemedText style={{ fontSize: 15, color: theme.primary, fontWeight: '600' }}>View Full Details</ThemedText>
                              </Pressable>
                            </>
                          )}

                          {/* Stage 2: Inline time & duration picker */}
                          {actConfirmStep === 'time' && (() => {
                            const parsed = parseTime(actConfirmTime);
                            const snappedMin = Math.round(parsed.minute / 5) * 5;
                            const chipStyle = (active: boolean) => ({
                              minWidth: 38, height: 36, borderRadius: 18,
                              alignItems: 'center' as const, justifyContent: 'center' as const,
                              paddingHorizontal: 8,
                              backgroundColor: active ? theme.primary : theme.backgroundElement,
                            });
                            const chipText = (active: boolean) => ({
                              fontSize: 13, fontWeight: '600' as const,
                              color: active ? theme.primaryText : theme.text,
                            });
                            return (
                            <Animated.View entering={FadeIn.duration(200)}>
                              {/* Hour */}
                              <ThemedText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary, marginTop: 16, marginBottom: 6, letterSpacing: 0.5 }}>HOUR</ThemedText>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                                {HOURS_12.map((h) => (
                                  <Pressable key={h} onPress={() => setActConfirmTime(formatTime(h, snappedMin, parsed.period))} style={chipStyle(parsed.hour12 === h)}>
                                    <ThemedText style={chipText(parsed.hour12 === h)}>{h}</ThemedText>
                                  </Pressable>
                                ))}
                              </ScrollView>

                              {/* Minute */}
                              <ThemedText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary, marginTop: 12, marginBottom: 6, letterSpacing: 0.5 }}>MINUTE</ThemedText>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                                {MINUTES_5.map((m) => (
                                  <Pressable key={m} onPress={() => setActConfirmTime(formatTime(parsed.hour12, m, parsed.period))} style={chipStyle(snappedMin === m)}>
                                    <ThemedText style={chipText(snappedMin === m)}>{String(m).padStart(2, '0')}</ThemedText>
                                  </Pressable>
                                ))}
                              </ScrollView>

                              {/* AM / PM */}
                              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                                {(['AM', 'PM'] as const).map((p) => (
                                  <Pressable key={p} onPress={() => setActConfirmTime(formatTime(parsed.hour12, snappedMin, p))}
                                    style={{ paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10,
                                      backgroundColor: parsed.period === p ? theme.primary : theme.backgroundElement }}>
                                    <ThemedText style={{ fontSize: 14, fontWeight: '700', color: parsed.period === p ? theme.primaryText : theme.text }}>{p}</ThemedText>
                                  </Pressable>
                                ))}
                              </View>

                              {/* Preview */}
                              <ThemedText style={{ textAlign: 'center', fontSize: 18, fontWeight: '700', marginTop: 14, color: theme.text }}>
                                {formatTimeDisplay(actConfirmTime)}
                              </ThemedText>

                              <Pressable
                                onPress={() => {
                                  if (addingToDay === null) return;
                                  const actType = categoryToActivityType(place.category);

                                  addActivity(currentTrip.id, {
                                    title: place.name,
                                    day: addingToDay,
                                    time: actConfirmTime,
                                    type: actType,
                                    category: place.primaryTypeLabel || place.category,
                                    placeId: place.placeId,
                                    address: place.address,
                                    lat: place.lat,
                                    lng: place.lng,
                                    rating: place.rating,
                                    reviewCount: place.reviewCount,
                                  });

                                  showToast(`"${place.name}" added to Day ${addingToDay}`, 'success');
                                  setActSelectedPlace(null);
                                  setActConfirmStep('preview');
                                  setAddingToDay(null);
                                  setActSearchQuery('');
                                  setActSearchResults([]);
                                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                }}
                                style={({ pressed }) => [{
                                  backgroundColor: theme.primary, borderRadius: 14,
                                  paddingVertical: 14, alignItems: 'center',
                                  marginTop: 16, opacity: pressed ? 0.85 : 1,
                                }]}
                                accessibilityRole="button"
                                accessibilityLabel="Confirm"
                              >
                                <ThemedText style={{ fontSize: 16, fontWeight: '700', color: theme.primaryText }}>Confirm</ThemedText>
                              </Pressable>
                            </Animated.View>
                            );
                          })()}
                        </View>
                        </ScrollView>
                      </Animated.View>
                    </Pressable>
                  </Pressable>
                </Animated.View>
              );
            })()}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* AI Add Activity Sheet */}
      <Modal visible={showAIAddSheet} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowAIAddSheet(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.addModal, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={[styles.addModalHeader, { borderBottomColor: theme.border }]}>
              <ThemedText style={styles.addModalTitle}>Find an Activity</ThemedText>
              <Pressable onPress={() => { setShowAIAddSheet(false); setAiAddSuggestions([]); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {/* Day selector */}
              <ThemedText style={styles.modalLabel}>Add to day</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moveDayRow}>
                {allDays.map((d) => (
                  <Pressable key={d} onPress={() => setAiAddDay(d)}
                    style={[styles.moveDayChip, { backgroundColor: aiAddDay === d ? theme.primary : theme.backgroundElement }]}
                    accessibilityRole="button" accessibilityLabel={`Day ${d}`}>
                    <ThemedText style={[styles.moveDayText, aiAddDay === d && { color: theme.primaryText }]}>
                      {formatDayLabel(d, currentTrip.startDate, currentTrip.datesKnown)}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Search input */}
              <ThemedText style={styles.modalLabel}>What are you looking for?</ThemedText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.addInput, { flex: 1, color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={aiAddQuery}
                  onChangeText={setAiAddQuery}
                  placeholder="e.g. sunset viewpoint, local street food market..."
                  placeholderTextColor={theme.textSecondary}
                  onSubmitEditing={() => handleAIAddSearch(aiAddQuery)}
                  returnKeyType="search"
                  accessibilityLabel="Search for activities"
                />
                <Pressable onPress={() => handleAIAddSearch(aiAddQuery)}
                  style={[styles.addSaveBtn, { backgroundColor: theme.primary, paddingHorizontal: 16, borderRadius: Radius.sm }]}
                  accessibilityRole="button" accessibilityLabel="Search">
                  <ThemedText style={{ color: theme.primaryText, fontWeight: '600' }}>Search</ThemedText>
                </Pressable>
              </View>

              {/* Quick suggestion chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row' }}>
                {['Local food', 'Must-see sights', 'Outdoor activity', 'Cultural experience', 'Hidden gem'].map((q) => (
                  <Pressable key={q} onPress={() => { setAiAddQuery(q); handleAIAddSearch(q); }}
                    style={[styles.typeChip, { borderWidth: 1, borderColor: theme.border }]}
                    accessibilityRole="button" accessibilityLabel={q}>
                    <ThemedText style={styles.typeText}>{q}</ThemedText>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Loading */}
              {aiAddLoading && (
                <View style={{ alignItems: 'center', padding: 24 }}>
                  <ThemedText style={{ color: theme.textSecondary }}>Finding activities in {currentTrip.destination}...</ThemedText>
                </View>
              )}

              {/* Suggestions */}
              {!aiAddLoading && aiAddSuggestions.length > 0 && (
                <>
                  <ThemedText style={[styles.modalLabel, { marginTop: 4 }]}>
                    Suggestions for {currentTrip.destination}
                  </ThemedText>
                  {aiAddSuggestions.map((s, i) => (
                    <Pressable key={i} onPress={() => handleAddSuggestion(s, aiAddDay)}
                      style={[{ borderRadius: Radius.sm, padding: 14, gap: 4, borderWidth: 1 }, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                      accessibilityRole="button" accessibilityLabel={`Add ${s.title}`}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <ThemedText style={{ fontSize: 15, fontWeight: '600', flex: 1 }}>{s.title}</ThemedText>
                        <ThemedText style={{ fontSize: 12, color: theme.primary, fontWeight: '600', marginLeft: 8 }}>+ Add</ThemedText>
                      </View>
                      {s.description ? <ThemedText style={{ fontSize: 13, color: theme.textSecondary, lineHeight: 18 }}>{s.description}</ThemedText> : null}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                        <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>{s.category}</ThemedText>
                        {s.cost && s.cost !== 'free' && <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>{s.cost}</ThemedText>}
                      </View>
                    </Pressable>
                  ))}
                </>
              )}

              {/* Manual fallback */}
              <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border, paddingTop: 16, marginTop: 8 }}>
                <ThemedText style={[styles.modalLabel, { marginBottom: 8 }]}>Or add manually</ThemedText>
                <Pressable onPress={() => { setShowAIAddSheet(false); setAddingToDay(aiAddDay); }}
                  style={[styles.typeChip, { borderWidth: 1, borderColor: theme.border, padding: 12 }]}
                  accessibilityRole="button" accessibilityLabel="Add manually">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <ThemedText style={styles.typeText}>Enter activity details manually</ThemedText>
                    <SymbolView name="chevron.right" size={12} tintColor={theme.text} />
                  </View>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add Stay Search Modal */}
      <Modal
        visible={showStaySearchModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => { setShowStaySearchModal(false); setResSelectedPlace(null); }}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.addModal, { backgroundColor: theme.background }]}>
            <View style={[styles.addModalHeader, { borderBottomColor: theme.border }]}>
              <ThemedText style={styles.addModalTitle}>Add Stay</ThemedText>
              <Pressable onPress={() => { setShowStaySearchModal(false); setResSelectedPlace(null); }} hitSlop={8} style={styles.addModalClose} accessibilityRole="button" accessibilityLabel="Close">
                <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
              </Pressable>
            </View>

            {/* Search by name */}
            {(
              <View style={{ flex: 1 }}>
                <View style={{ padding: 16, paddingBottom: 8 }}>
                  <TextInput
                    style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                    value={resSearchQuery}
                    onChangeText={(text) => {
                      setResSearchQuery(text);
                      if (resSearchTimer.current) clearTimeout(resSearchTimer.current);
                      if (text.trim().length < 2) {
                        setResSearchResults([]);
                        setResSearchLoading(false);
                        return;
                      }
                      setResSearchLoading(true);
                      const q = text.trim();
                      resSearchTimer.current = setTimeout(async () => {
                        if (!trip) return;
                        try {
                          const results = await searchExplorePlaces(q, {
                            type: 'trip',
                            tripId: trip.id,
                            destination: trip.destination,
                            label: trip.destination,
                          });
                          const hotels = results.filter((p) =>
                            p.category?.startsWith('stay/') ||
                            p.googleTypes?.some((t) => /hotel|lodging|resort|motel|hostel|inn|guest_house/i.test(t))
                          );
                          setResSearchResults(hotels.length > 0 ? hotels.slice(0, 10) : results.slice(0, 10));
                        } catch {
                          setResSearchResults([]);
                        } finally {
                          setResSearchLoading(false);
                        }
                      }, 400);
                    }}
                    placeholder="Hotel name..."
                    placeholderTextColor={theme.textSecondary}
                    autoFocus
                    returnKeyType="search"
                  />
                </View>
                <ScrollView
                  contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {resSearchLoading && (
                    <View style={{ padding: 20, alignItems: 'center' }}>
                      <ActivityIndicator size="small" color={theme.primary} />
                      <ThemedText style={{ color: theme.textSecondary, fontSize: 13, marginTop: 8 }}>
                        Searching...
                      </ThemedText>
                    </View>
                  )}
                  {!resSearchLoading && resSearchQuery.trim().length >= 2 && resSearchResults.length === 0 && (
                    <View style={{ padding: 20, alignItems: 'center' }}>
                      <ThemedText style={{ color: theme.textSecondary, fontSize: 14 }}>
                        No results found
                      </ThemedText>
                    </View>
                  )}
                  {resSearchResults.map((place) => (
                    <StaySearchResultRow key={place.placeId ?? place.name} place={place} theme={theme} onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setResSelectedPlace(place);
                    }} />
                  ))}
                </ScrollView>

                {/* Confirmation popup overlay */}
                {resSelectedPlace && (
                  <StayConfirmPopup
                    place={resSelectedPlace}
                    theme={theme}
                    onDismiss={() => setResSelectedPlace(null)}
                    onAdd={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      const isDuplicate = currentTrip.activities.some(
                        (a) => a.type === 'hotel' && a.placeId && a.placeId === resSelectedPlace.placeId
                      );
                      if (isDuplicate) {
                        showToast('This hotel is already in your stays', 'info');
                        setResSelectedPlace(null);
                        return;
                      }
                      addActivity(currentTrip.id, {
                        title: resSelectedPlace.name,
                        day: 1,
                        time: '15:00',
                        type: 'hotel',
                        category: resSelectedPlace.category ?? 'stay/hotel',
                        cost: resSelectedPlace.priceLevel as any,
                        description: '',
                        placeId: resSelectedPlace.placeId,
                        address: resSelectedPlace.address,
                        lat: resSelectedPlace.lat,
                        lng: resSelectedPlace.lng,
                        rating: resSelectedPlace.rating,
                        fixed: true,
                      });
                      showToast(`"${resSelectedPlace.name}" added to stays`, 'success');
                      setResSelectedPlace(null);
                      setShowStaySearchModal(false);
                    }}
                    onViewDetails={() => {
                      const p = resSelectedPlace;
                      setResSelectedPlace(null);
                      setShowStaySearchModal(false);
                      let url = `/place-detail?name=${encodeURIComponent(p.name)}&destination=${encodeURIComponent(currentTrip.destination)}&tripId=${currentTrip.id}&category=${encodeURIComponent(p.category ?? 'stay/hotel')}&fromStaySearch=1`;
                      if (p.placeId) url += `&placeId=${encodeURIComponent(p.placeId)}`;
                      if (p.address) url += `&address=${encodeURIComponent(p.address)}`;
                      if (p.lat != null) url += `&lat=${p.lat}`;
                      if (p.lng != null) url += `&lng=${p.lng}`;
                      if (p.rating != null) url += `&rating=${p.rating}`;
                      if (p.reviewCount != null) url += `&reviewCount=${p.reviewCount}`;
                      if (p.photos?.[0]?.reference) url += `&photoRef=${encodeURIComponent(p.photos[0].reference)}`;
                      router.push(url as any);
                    }}
                  />
                )}
              </View>
            )}

          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Unbooked Stay Sheet */}
      <UnbookedStaySheet
        data={unbookedStayData}
        onClose={() => setUnbookedStayData(null)}
      />

      {/* Confirmed Booking Sheet */}
      <ConfirmedBookingSheet
        data={bookingSheetData}
        onClose={() => setBookingSheetData(null)}
        onEdit={(res, tripId) => {
          setBookingEditRes({ res, tripId });
          setShowBookingModal(true);
        }}
        onDelete={(res, tripId) => {
          removeReservation(tripId, res.id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          showToast('Booking removed', 'success');
        }}
      />

      {/* Booking Modal (shared AddBookingModal) */}
      <Modal
        visible={showBookingModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowBookingModal(false)}
      >
        {showBookingModal && (
          <AddBookingModal
            visible={showBookingModal}
            onClose={() => { setShowBookingModal(false); setBookingEditRes(null); setPendingImportData(null); setBookingModalFixedType(undefined); }}
            editRes={bookingEditRes}
            pendingImport={pendingImportData}
            trips={trips}
            fixedTripId={currentTrip.id}
            fixedType={bookingModalFixedType}
            onAdd={addReservation}
            onUpdate={updateReservation}
            onDelete={(res, tripId) => {
              Alert.alert('Remove booking?', `Remove "${res.title}"?`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => {
                    removeReservation(tripId, res.id);
                    setShowBookingModal(false);
                    setBookingEditRes(null);
                  },
                },
              ]);
            }}
            onMarkImported={async (id) => {
              try { await markBookingImportedAI(id); } catch { /* ignore */ }
              setPendingBookings((prev) => prev.filter((b) => b.id !== id));
              setPendingImportData(null);
            }}
          />
        )}
      </Modal>

      <UpgradePrompt
        visible={showUpgradePrompt}
        feature={upgradeFeature}
        title={
          upgradeFeature === 'edit_trip' ? 'AI trip editing' :
          upgradeFeature === 'analyze_trip' ? 'Trip analysis' :
          upgradeFeature === 'natural_search' ? 'AI search' :
          upgradeFeature === 'export_pdf' ? 'Export your itinerary' :
          'More imports'
        }
        description={
          upgradeFeature === 'edit_trip' ? 'Unlock unlimited AI-powered trip edits with Tripseek+.' :
          upgradeFeature === 'analyze_trip' ? 'Get deep AI analysis of your trips with Tripseek+.' :
          upgradeFeature === 'natural_search' ? 'Search and discover places with AI using Tripseek+.' :
          upgradeFeature === 'export_pdf' ? 'Save or print your trip as a PDF with Tripseek+.' :
          'Import places from links, text, and screenshots with Tripseek+.'
        }
        icon={
          upgradeFeature === 'edit_trip' ? 'wand.and.stars' :
          upgradeFeature === 'analyze_trip' ? 'chart.bar' :
          upgradeFeature === 'natural_search' ? 'magnifyingglass' :
          upgradeFeature === 'export_pdf' ? 'doc.text' :
          'link'
        }
        onClose={() => setShowUpgradePrompt(false)}
      />

      {/* Share / Export sheet */}
      <Modal visible={showShareSheet} transparent animationType="fade" onRequestClose={() => setShowShareSheet(false)}>
        <Pressable style={shareSheetStyles.backdrop} onPress={() => setShowShareSheet(false)}>
          <Pressable style={[shareSheetStyles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <View style={[shareSheetStyles.handle, { backgroundColor: theme.border }]} />
            <ThemedText style={shareSheetStyles.title}>Share itinerary</ThemedText>
            <Pressable
              onPress={() => { setShowShareSheet(false); createShareLink('view'); }}
              style={({ pressed }) => [shareSheetStyles.option, pressed && { opacity: 0.7 }]}
            >
              <View style={[shareSheetStyles.optionIcon, { backgroundColor: theme.primaryMuted }]}>
                <SymbolView name="link" size={18} tintColor={theme.primary} />
              </View>
              <View style={shareSheetStyles.optionText}>
                <ThemedText style={shareSheetStyles.optionLabel}>Share link</ThemedText>
                <ThemedText style={[shareSheetStyles.optionDesc, { color: theme.textSecondary }]}>Anyone with the link can view your trip</ThemedText>
              </View>
            </Pressable>
            <View style={[shareSheetStyles.separator, { backgroundColor: theme.border }]} />
            <Pressable
              onPress={handleExportPDF}
              style={({ pressed }) => [shareSheetStyles.option, pressed && { opacity: 0.7 }]}
            >
              <View style={[shareSheetStyles.optionIcon, { backgroundColor: exportGate.allowed ? theme.primaryMuted : theme.backgroundElement }]}>
                <SymbolView name="doc.text" size={18} tintColor={exportGate.allowed ? theme.primary : theme.textSecondary} />
              </View>
              <View style={shareSheetStyles.optionText}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ThemedText style={shareSheetStyles.optionLabel}>Export as PDF</ThemedText>
                  {!exportGate.allowed && (
                    <View style={[shareSheetStyles.plusBadge, { backgroundColor: theme.primary }]}>
                      <ThemedText style={shareSheetStyles.plusBadgeText}>Plus</ThemedText>
                    </View>
                  )}
                </View>
                <ThemedText style={[shareSheetStyles.optionDesc, { color: theme.textSecondary }]}>Save or print a formatted itinerary PDF</ThemedText>
              </View>
            </Pressable>
            <Pressable onPress={() => setShowShareSheet(false)} style={[shareSheetStyles.cancel, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={{ fontSize: 16, fontWeight: '600' }}>Cancel</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const shareSheetStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingHorizontal: 20 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 14 },
  optionIcon: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 16, fontWeight: '600' },
  optionDesc: { fontSize: 13 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: 4 },
  plusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  plusBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cancel: { marginTop: 12, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 4 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Hero — photo background
  hero: {
    height: 260,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  heroBgImage: { width: '100%', height: '100%' },
  heroTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  heroBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTopRight: { flexDirection: 'row', gap: 8 },
  heroIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBottom: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    gap: 4,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 32,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  heroMetaText: { fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  heroMetaDot: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  heroNotesText: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' as const },

  // View toggle — underline segment
  toggleRow: {
    flexDirection: 'row',
    gap: 24,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleItem: {
    paddingVertical: 12,
    position: 'relative',
  },
  toggleTabContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '600',
  },
  toggleBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
  },
  toggleBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  toggleIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
  },

  // Day selector
  daySelectorScroll: {
    marginTop: Spacing.two,
  },
  daySelectorRow: {
    paddingHorizontal: Spacing.four,
    gap: 8,
  },
  daySelectorPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.md,
    alignItems: 'center' as const,
  },
  daySelectorText: {
    fontSize: 13,
    fontWeight: '600',
  },
  daySelectorTextActive: {
  },
  // Itinerary
  itinerary: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three },

  // Section divider
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: Spacing.three,
    marginBottom: Spacing.four + 8,
  },

  // Stays + Flights side-by-side row
  staysFlightsRow: {
    flexDirection: 'column',
    gap: 12,
  },
  staysFlightsCol: {},


  // Day section
  daySection: { marginBottom: Spacing.four },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dayLabel: { fontSize: 17, fontWeight: '700' },
  dayHeaderLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  dayHeaderMeta: {
    fontSize: 13,
    fontWeight: '500' as const,
  },
  dayDate: { fontSize: 13, marginTop: 2 },
  dayAction: { fontSize: 13, fontWeight: '600' },

  // Day cards carousel (overview mode)
  dayCardsCarousel: {
    marginBottom: Spacing.four,
  },
  dayCard: {
    height: 200,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.medium,
    shadowColor: '#000000',
  },
  dayCardImages: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dayCardEmptyImage: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  dayCardCoverRow: {
    flex: 1,
    flexDirection: 'row' as const,
    gap: 2,
  },
  dayCardCoverPinterest: {
    flex: 1,
    flexDirection: 'row' as const,
    gap: 2,
  },
  dayCardCoverStack: {
    flex: 1,
    gap: 2,
  },
  dayCardOverlay: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  dayCardLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  dayCardCount: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  dayCardDots: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: 6,
    marginTop: 10,
  },
  dayCardDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Day detail header
  dayDetailHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 18,
  },
  dayDetailBackBtn: {
    width: 30,
    alignItems: 'flex-start' as const,
    justifyContent: 'center' as const,
  },
  dayDetailAddBtn: {
    width: 30,
    alignItems: 'flex-end' as const,
    justifyContent: 'center' as const,
  },
  dayDetailCenter: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
  },

  // Visual activity cards (day detail mode) — full-bleed style
  visualActivityCard: {
    borderRadius: Radius.sm,
    height: 160,
    overflow: 'hidden' as const,
    marginBottom: 10,
  },
  visualActivityPhotoPlaceholder: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  visualActivityOverlay: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
  },
  visualActivityTime: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
  },
  visualActivityTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  visualActivityMeta: {
    fontSize: 13,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  activityCardTopRow: {
    position: 'absolute' as const,
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  activityMenuBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  activityStatusBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  activityStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  activityStatusLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
  },

  // Day info panel
  dayInfoPanel: {
    borderRadius: Radius.sm,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  dayInfoRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  dayInfoText: {
    fontSize: 13,
    fontWeight: '500' as const,
    flex: 1,
  },

  // Timeline
  timeline: {},
  timelineItem: {
    flexDirection: 'row',
    minHeight: 60,
  },
  timeCol: {
    width: 48,
    alignItems: 'flex-end',
    paddingRight: 12,
    paddingTop: 2,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  dotCol: {
    width: 20,
    alignItems: 'center',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  timelineConnector: {
    width: 2,
    flex: 1,
    marginTop: 4,
  },
  insertionLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  insertionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  insertionBar: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    marginLeft: -1,
  },
  dropTimePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 52,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  dropTimeLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  dropTimeDone: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  dropTimeDoneText: {
    fontSize: 13,
    fontWeight: '700',
  },
  insertionTimeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 6,
  },
  insertionTimeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  timelineEndRow: {
    flexDirection: 'row',
    height: 20,
  },
  timelineEndDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    marginTop: 4,
  },

  // Empty day
  emptyDayTap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.sm,
  },
  emptyDayText: { fontSize: 14 },

  // Add activity link
  addLink: { paddingVertical: 8 },
  addLinkText: { fontSize: 14, fontWeight: '500' },

  // Add / edit form
  addForm: {
    padding: 14,
    borderRadius: Radius.md,
    gap: 10,
    marginTop: 4,
  },
  addInput: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInputSmall: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    width: 80,
  },
  typeRow: { flexDirection: 'row', gap: 4, flex: 1, flexWrap: 'wrap' },
  typeChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.sm },
  typeText: { fontSize: 12, fontWeight: '500' },
  addSaveBtn: {
    paddingVertical: 10,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  addSaveText: { fontSize: 15, fontWeight: '600' },

  browseExploreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: Radius.md,
    marginTop: 4,
    marginBottom: 8,
  },
  browseExploreTitle: { fontSize: 15, fontWeight: '600' },
  browseExploreSub: { fontSize: 13, marginTop: 2 },

  // Discover a place (Issue 2)
  discoverBtn: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  discoverBtnText: { fontSize: 13, fontWeight: '600' },

  // Fix timing button (Issue 5)
  fixTimingBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.xs,
    marginTop: 6,
  },
  fixTimingBtnText: { fontSize: 12, fontWeight: '700' },

  // Map placeholder
  mapPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: 12,
  },
  mapText: { fontSize: 20, fontWeight: '600' },
  mapSubtext: { fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  aiEditOverlay: {
    position: 'absolute' as const,
    inset: 0,
    zIndex: 200,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 12,
  },

  // Edit form
  editFormTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  editBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  editCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    alignItems: 'center',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  editCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  editSaveBtn: {
    flex: 1,
  },
  loadingText: {
    fontSize: 15,
  },

  // Modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalSheet: {
    borderRadius: Radius.lg,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: { textAlign: 'center', marginBottom: 4 },
  modalSubtitle: { textAlign: 'center', fontSize: 14, marginBottom: 16 },
  modalLabel: { fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  modalInput: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  modalInputMulti: { minHeight: 80, paddingTop: 12 },
  modalDateRow: { flexDirection: 'row', gap: 10 },
  modalDateBtn: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  modalDateBtnText: { fontSize: 14 },
  replacePreview: { padding: 12, borderRadius: Radius.sm, borderWidth: 1, gap: 4, marginTop: 12 },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalBtnSecondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalBtnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  dayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.lg, borderWidth: 1 },
  // Trip Prep
  prepProgress: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  prepProgressBar: { height: 4, borderRadius: 2, marginBottom: 16 },
  prepProgressFill: { height: 4, borderRadius: 2 },
  prepItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: Radius.sm, marginBottom: 8, gap: 10 },
  prepItemText: { fontSize: 14, fontWeight: '500', flex: 1 },
  prepItemDone: { textDecorationLine: 'line-through', opacity: 0.5 },
  prepEmptyCard: { alignItems: 'center', padding: 32, borderRadius: Radius.sm, marginTop: 8 },
  prepCategoryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 6, paddingVertical: 4 },

  // Budget
  budgetCard: { padding: 16, borderRadius: Radius.sm, marginBottom: 12, gap: 6 },
  budgetLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  budgetAmount: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  budgetEstNote: { fontSize: 11, fontStyle: 'italic', marginTop: 4 },
  budgetWarning: { fontSize: 12, color: '#DC2626', fontWeight: '600', marginTop: 4 },
  budgetEditRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  budgetInput: { flex: 1, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  budgetSaveBtn: { paddingHorizontal: 20, borderRadius: Radius.sm, justifyContent: 'center' },
  budgetSaveBtnText: { fontSize: 14, fontWeight: '600' },
  budgetSectionTitle: { marginTop: 8, marginBottom: 12 },
  budgetDayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  budgetDayLabel: { fontSize: 14, fontWeight: '600', width: 50 },
  budgetDayAmount: { fontSize: 14, fontWeight: '700', width: 60 },
  budgetDayCount: { fontSize: 12, flex: 1 },
  budgetProgressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 8 },
  budgetProgressFill: { height: '100%', borderRadius: 4 },
  budgetBookingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },

  // Expense cards
  expenseCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: Radius.sm, marginBottom: 8, gap: 8 },
  expenseLabel: { fontSize: 14, fontWeight: '600' },
  expenseMeta: { fontSize: 12, marginTop: 2 },
  expenseAmount: { fontSize: 16, fontWeight: '700' },
  expenseDeleteBtn: { padding: 6 },
  expenseDeleteText: { fontSize: 14 },
  addExpenseForm: { borderRadius: Radius.sm, padding: 14, marginBottom: 12, gap: 8 },
  expenseCategoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },

  editChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  editChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.lg, borderWidth: 1 },
  editChipText: { fontSize: 13, fontWeight: '500' },
  moveDayRow: { gap: 8, paddingVertical: 4 },
  moveDayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.md },
  moveDayText: { fontSize: 13, fontWeight: '600' },

  // Add Activity / Invite / Reservation modal
  addModal: {
    flex: 1,
  },
  addModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addModalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  addModalClose: {
    padding: 4,
  },

  // Bookings view
  bookingSummary: {
    borderRadius: Radius.md,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  bookingSummaryRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  bookingSummaryTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  bookingSummaryPct: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  bookingSummaryTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden' as const,
  },
  bookingSummaryFill: {
    height: '100%' as const,
    borderRadius: 3,
  },
  bookingSummaryMeta: {
    fontSize: 12,
  },
  viewAllBookingsBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    marginBottom: 16,
  },
  viewAllBookingsText: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  bookingSection: {
    marginBottom: 20,
  },
  bookingSectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  bookingSectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    flex: 1,
  },
  bookingSectionCount: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  bookingItemCard: {
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 8,
  },
  bookingItemRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  bookingStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bookingItemInfo: {
    flex: 1,
  },
  bookingItemTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  bookingItemMeta: {
    fontSize: 12,
    marginTop: 1,
  },
  bookingItemNotes: {
    fontSize: 12,
    fontStyle: 'italic' as const,
    marginTop: 2,
  },
  bookingItemActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 2,
  },
  bookingItemPlatforms: {
    flexDirection: 'row' as const,
    gap: 4,
    flexWrap: 'wrap' as const,
    justifyContent: 'flex-end' as const,
  },
  bookingItemBookBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  bookingItemBookText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  reservationsEmpty: {
    paddingVertical: 48,
    alignItems: 'center' as const,
    paddingHorizontal: 24,
  },
  reservationsEmptyText: {
    fontSize: 15,
    textAlign: 'center' as const,
    lineHeight: 22,
  },
  reservationActionBtn: {
    padding: 6,
  },
  addResBtn: {
    paddingVertical: 14,
    borderRadius: Radius.sm,
    alignItems: 'center' as const,
    marginTop: 8,
  },
  addResBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
  },

  // Email forwarding hero
  bookingEmailHero: {
    padding: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: 16,
    gap: 12,
  },
  bookingEmailHeroContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  bookingEmailHeroTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  bookingEmailHeroSub: {
    fontSize: 13,
    lineHeight: 18,
  },
  bookingEmailBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  bookingEmailText: {
    fontSize: 15,
    fontWeight: '700' as const,
    flex: 1,
  },
  bookingEmailLoading: {
    fontSize: 13,
    paddingLeft: 40,
  },

  // Pending bookings from email
  bookingPendingSection: {
    marginBottom: 16,
    gap: 8,
  },
  bookingPendingCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden' as const,
  },
  bookingPendingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 12,
    gap: 12,
  },
  bookingPendingIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.xs,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  bookingPendingName: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  bookingPendingMeta: {
    fontSize: 13,
  },
  bookingPendingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  bookingPendingBadgeText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },

  // Expandable booked card
  bookedCardContainer: {
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden' as const,
    marginBottom: 8,
  },
  bookedCardCompact: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 12,
    gap: 12,
  },
  bookedCardPhoto: {
    width: 52,
    height: 52,
    borderRadius: Radius.xs,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
  },
  bookedCardPhotoImg: {
    width: 52,
    height: 52,
  },
  bookedCardInfo: {
    flex: 1,
    gap: 3,
  },
  bookedCardTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  bookedCardMeta: {
    fontSize: 13,
    fontWeight: '500' as const,
  },
  bookedCardConfirmedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  bookedCardExpanded: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 10,
  },
  bookedCardExpandedPhoto: {
    width: '100%' as any,
    height: 160,
    borderRadius: Radius.xs,
  },
  bookedCardTypeBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.xs,
    alignSelf: 'flex-start' as const,
  },
  bookedCardTypeText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  bookedCardDivider: {
    height: 1,
    marginVertical: 2,
  },
  bookedCardDetailRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 2,
  },
  bookedCardDetailLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    width: 90,
  },
  bookedCardDetailValue: {
    fontSize: 14,
    fontWeight: '500' as const,
  },
  bookedCardActions: {
    flexDirection: 'row' as const,
    gap: 10,
    marginTop: 2,
  },
  bookedCardActionBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  bookedCardActionText: {
    fontSize: 14,
    fontWeight: '600' as const,
  },

  // Unbooked nudge text
  bookingUnbookedNudge: {
    fontSize: 12,
    fontStyle: 'italic' as const,
    marginTop: 4,
  },

  // Manual entry fallback
  manualEntryLink: {
    alignItems: 'center' as const,
    paddingVertical: 12,
    marginTop: 4,
  },
  manualEntryText: {
    fontSize: 14,
    fontWeight: '500' as const,
    textDecorationLine: 'underline' as const,
  },


  // Reservation modal extras
  resProtectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  resProtectedLabel: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  // Budget currency row
  alertsEmptyState: {
    alignItems: 'center' as const,
    paddingVertical: 32,
    paddingHorizontal: 32,
    gap: 12,
  },
  alertsEmptyImage: {
    width: 180,
    height: 180,
    marginBottom: 8,
  },
  alertsEmptyTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
  },
  alertsEmptyDesc: {
    fontSize: 14,
    textAlign: 'center' as const,
    lineHeight: 21,
  },
  budgetSplash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
    gap: 12,
  },
  budgetSplashImage: {
    width: 180,
    height: 180,
    marginBottom: 8,
    transform: [{ rotate: '12deg' }],
  },
  budgetSplashTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  budgetSplashDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
  },
  budgetSplashCTA: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
  },
  budgetSplashCTAText: {
    fontSize: 16,
    fontWeight: '700',
  },
  budgetCurrencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },

  // Prep category headers
  prepCategoryHeader: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 6,
  },
  prepEditInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    paddingVertical: 2,
  },

  dayHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  distanceIndicator: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    paddingVertical: 6,
  },
  distanceText: {
    fontSize: 11,
    fontWeight: '500' as const,
  },

  // Edit with AI chat
  editChatHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  editChatHeaderTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
  },
  editChatContainer: {
    flex: 1,
  },
  editChatBottomBar: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
  },
  editChatList: {
    padding: Spacing.four,
    paddingBottom: 120,
  },
  editChatRowAssistant: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 8,
  },
  editChatRowUser: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    justifyContent: 'flex-end' as const,
    gap: 8,
  },
  editChatAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexShrink: 0,
  },
  editChatAvatarLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  editChatBubble: {
    maxWidth: '75%' as any,
    borderRadius: Radius.md,
    padding: 14,
    marginBottom: 10,
  },
  editChatBubbleUser: {
    borderBottomRightRadius: 4,
  },
  editChatBubbleCompact: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  editChatContextTag: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginBottom: 4,
    paddingLeft: 4,
  },
  editChatContextText: {
    fontSize: 12,
    fontWeight: '500' as const,
    fontStyle: 'italic' as const,
  },
  editChatBubbleAssistant: {
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  editChatWelcomeList: {
    gap: 10,
    marginTop: 8,
    marginBottom: 8,
  },
  editChatWelcomeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  editChatWelcomeEmoji: {
    fontSize: 16,
    width: 22,
    textAlign: 'center' as const,
  },
  editChatWelcomeLabel: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  editChatAssistantLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    opacity: 0.5,
  },
  editChatBubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  editChatTime: {
    fontSize: 10,
    marginTop: 3,
    marginBottom: 4,
    alignSelf: 'flex-start' as const,
    marginLeft: 4,
  },
  editChatTimeUser: {
    alignSelf: 'flex-end' as const,
    marginLeft: 0,
    marginRight: 4,
  },
  editChatActionsContainer: {
    gap: 6,
    marginBottom: 10,
    maxWidth: '82%' as any,
  },
  editChatActionResult: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    padding: 10,
    borderRadius: Radius.sm,
  },
  editChatActionLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  editChatActionDetail: {
    fontSize: 12,
    marginTop: 1,
  },
  editChatConfirmCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    maxWidth: '82%' as any,
    gap: 8,
  },
  editChatConfirmHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  editChatConfirmTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  editChatConfirmAction: {
    fontSize: 13,
    paddingLeft: 24,
  },
  editChatConfirmBtns: {
    flexDirection: 'row' as const,
    gap: 10,
    marginTop: 4,
  },
  editChatConfirmBtn: {
    flex: 1,
    alignItems: 'center' as const,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  editChatRetryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginBottom: 10,
  },
  editChatTyping: {
    alignSelf: 'flex-start' as const,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
  },
  editChatTypingText: {
    fontSize: 14,
    fontWeight: '500' as const,
    fontStyle: 'italic' as const,
  },
  editChatSugRow: {
    paddingHorizontal: Spacing.four,
    paddingVertical: 8,
    gap: 8,
  },
  editChatSugChip: {
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  editChatSugText: {
    fontSize: 13,
    fontWeight: '500' as const,
  },
  editChatInputBar: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    paddingHorizontal: Spacing.four,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  editChatTextInput: {
    flex: 1,
    fontSize: 15,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    maxHeight: 100,
  },
  editChatSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  editChatBarBtn: {
    width: 40,
    height: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },

  // Edit thread list
  editThreadBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end' as const,
  },
  editThreadSheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: 12,
    paddingHorizontal: Spacing.four,
    maxHeight: '70%' as any,
  },
  editThreadHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center' as const,
    marginBottom: 16,
  },
  editThreadSheetTitle: {
    textAlign: 'center' as const,
    marginBottom: 16,
  },
  editThreadNewBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    borderRadius: Radius.md,
    marginBottom: 12,
  },
  editThreadNewBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  editThreadList: {
    maxHeight: 400,
  },
  editThreadCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden' as const,
  },
  editThreadRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  editThreadRowContent: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 4,
  },
  editThreadDotsBtn: {
    padding: 12,
  },
  editThreadRowText: {
    flex: 1,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  editThreadTitle: {
    fontSize: 15,
    fontWeight: '500' as const,
    flex: 1,
    marginRight: 8,
  },
  editThreadDate: {
    fontSize: 12,
  },
  editThreadEmpty: {
    textAlign: 'center' as const,
    paddingVertical: 24,
    fontSize: 14,
  },
  editThreadOptionBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  editThreadOptionText: {
    fontSize: 14,
    fontWeight: '500' as const,
  },
  editThreadOptionDivider: {
    height: StyleSheet.hairlineWidth,
  },
  editThreadRenameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  editThreadRenameInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 4,
  },

  // Floating chat bar
  bookingProgressBar: {
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
    marginBottom: 12,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  bookingProgressInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  bookingProgressText: {
    fontSize: 13,
    fontWeight: '600' as const,
    flex: 1,
  },
  bookingProgressAction: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  bookingProgressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  bookingProgressFill: {
    height: '100%' as const,
    borderRadius: 2,
  },
  bookingNudgeBanner: {
    marginHorizontal: Spacing.four,
    marginBottom: 8,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  bookingNudgeContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    flex: 1,
  },
  bookingNudgeText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: '#92400E',
    flex: 1,
  },
  bookingNudgeAction: {
    fontSize: 13,
    fontWeight: '700' as const,
    marginLeft: 8,
  },
  hotelSuggestSection: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  hotelSuggestHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 10,
  },
  hotelSuggestTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  hotelCard: {
    width: 200,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden' as const,
  },
  hotelCardPhoto: {
    width: 200,
    height: 90,
  },
  hotelCardInfo: {
    padding: 8,
    gap: 3,
  },
  hotelCardName: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  hotelBookBtn: {
    marginTop: 4,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  mapBackBtn: {
    position: 'absolute' as const,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 10,
  },
  floatingChatPill: {
    position: 'absolute' as const,
    left: 16,
    right: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  floatingAIPlaceholder: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500' as const,
  },
});

const bStyles = StyleSheet.create({
  emailStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  emailStripLabel: { fontSize: 12, fontWeight: '600' },
  emailStripAddress: { fontSize: 12, fontWeight: '700', flex: 1 },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  sortChipText: { fontSize: 13, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCard: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: '#1a1e28',
  },
  cardPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
  },
  cardName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  cardMeta: { fontSize: 11, fontWeight: '500', color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  cardTypeIcon: { position: 'absolute', top: 10, right: 10 },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
});
