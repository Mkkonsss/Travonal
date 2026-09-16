import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, TextInput, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown, useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { ActivityContextMenu, ReactionOption } from '@/components/activity-context-menu';
import { SwipeableActivityRow } from '@/components/swipeable-activity-row';
import { LiveDayView } from '@/components/live-day-view';
import { AskTravonal, TravonalCommand, COMMANDS as AI_COMMANDS, parseTextToCommand } from '@/components/ask-travonal';
import { DatePickerModal, formatDisplayDate } from '@/components/date-picker-modal';
import { PostVisitFeedback, FeedbackRating, WhyOption } from '@/components/post-visit-feedback';
import { PulseBanner } from '@/components/pulse-banner';
import { TimePickerButton, formatTimeDisplay, defaultTimeForType, defaultDurationForType } from '@/components/time-picker';
import { TransformationReveal, SmartReplacePicker } from '@/components/transformation-reveal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { Activity, Invitation, PrepItem, Reservation, ReservationType, TripMember, useTrips } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useMemory } from '@/context/memory';
import { useTheme } from '@/hooks/use-theme';
import { useActivityPhotos } from '@/hooks/use-activity-photos';
import { useDestinationPhoto } from '@/hooks/use-destination-photo';
import { usePulseSolutions } from '@/hooks/use-pulse-solutions';
import { checkConflicts, getTripDayCount, computeChangePreview, ChangePreview, timeToMinutes, suggestTimeForActivity, reflowFromTime, compareByTime } from '@/services/itinerary-engine';
import { getDrivingDistance, formatDrivingDistance } from '@/services/driving-distance';
import { transformTrip, findTopReplacements, TransformScope, validateLockedProtection, findSemanticDuplicates, detectNoChange } from '@/services/transformation-service';
import { getBookingLinks, getPrimaryBookingLink, getTripReadiness, isBookableActivity, openBookingLink, platformDisplayName, getPlaceBookingLinks } from '@/services/booking-links';
import { fetchExplorePlaces } from '@/services/explore-service';
import { getPlacePhoto } from '@/services/free-photos';
import type { NormalizedPlace } from '@/services/place-model';
import { hasDestinationData } from '@/services/alternatives-pool';
import { editTripAI, naturalSearchAI, NaturalSearchSuggestion, importPlaceAI, analyzeTripAI, TripAnalysisResult, TripAnalysisCategory } from '@/services/ai';
import { useGate } from '@/hooks/use-gate';
import { UpgradePrompt } from '@/components/upgrade-prompt';
import { useSubscription } from '@/context/subscription';
import { normalizeActivity, mergeDayScopedActivities, generateActivityId, validateGeneratedActivities, repairActivities } from '@/services/ai-utils';
import { runTripPulse, PulseAlert } from '@/services/trip-pulse';
import { isTripActive, getTripDayNumber, getDestinationNow } from '@/services/trip-status';
import { useTripPulse, shouldRunTripPulse } from '@/context/trip-pulse';
import { loadDismissedPulse, saveDismissedPulse, loadSeenPulse, saveSeenPulse } from '@/services/storage';
import { makePulseDismissalKey, isPulseDismissed, formatDayLabel } from '@/services/trip-helpers';
import { usePulseHistory } from '@/context/pulse-history';
import { useToast } from '@/context/toast';
import { TripMap } from '@/components/trip-map';
import { scheduleBookingReminders, cancelBookingReminders } from '@/services/notifications';

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '\u20AC', GBP: '\u00A3', JPY: '\u00A5', AUD: 'A$', CAD: 'C$', CHF: 'CHF', CNY: '\u00A5', KRW: '\u20A9', THB: '\u0E3F', INR: '\u20B9', MXN: 'MX$', BRL: 'R$' };
function getCurrSymbol(cur: string) { return CURRENCY_SYMBOLS[cur] ?? cur + ' '; }

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
      <ThemedText style={[styles.distanceText, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
    </View>
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
  const { id, openEdit, day: dayParam, addActivity: addActivityParam, applyCommand, applyDay, applySearch, applyStartAfter } = useLocalSearchParams<{ id: string; openEdit?: string; day?: string; addActivity?: string; applyCommand?: string; applyDay?: string; applySearch?: string; applyStartAfter?: string }>();
  const { getTrip, loaded: tripsLoaded, toggleLock, setTripActivities, addActivity, updateActivity, updateTrip, undoChange, getUndoableChange, updateTripPrepItems, updateTripBudget, updateTripExpenses, addReservation, updateReservation, removeReservation, addInvitation, removeMember } = useTrips();
  const { profile } = useProfile();
  const { entries: memoryEntries, addEntry: addMemoryEntry } = useMemory();
  const theme = useTheme();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();

  const [askVisible, setAskVisible] = useState(false);
  const [aiEditLoading, setAiEditLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | undefined>();
  const [aiViewQuery, setAiViewQuery] = useState('');
  const [aiViewError, setAiViewError] = useState('');
  const [tripAnalysis, setTripAnalysis] = useState<TripAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisExpanded, setAnalysisExpanded] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'itinerary' | 'ai' | 'map' | 'prep' | 'budget' | 'reservations' | 'members'>('itinerary');
  const [newPrepItem, setNewPrepItem] = useState('');
  const [editingPrepId, setEditingPrepId] = useState<string | null>(null);
  const [editPrepText, setEditPrepText] = useState('');
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
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('10:00');
  const [newType, setNewType] = useState<Activity['type']>('activity');
  const [newDuration, setNewDuration] = useState(60);
  const [newCost, setNewCost] = useState<string>('');
  const [newAddress, setNewAddress] = useState('');
  const [newActivityNotes, setNewActivityNotes] = useState('');
  const [newFixed, setNewFixed] = useState(false);

  // Day filter
  const [filterDay, setFilterDay] = useState<number | null>(null);

  // Live mode — active trips auto-switch to today's schedule
  const [liveMode, setLiveMode] = useState<boolean | null>(null); // null = not yet initialized

  // Undo: tracks the last persisted ChangeRecord id so we can auto-show/dismiss the banner
  const [undoDismissedId, setUndoDismissedId] = useState<string | null>(null);
  const [autoHideUndoId, setAutoHideUndoId] = useState<string | null>(null);

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
  const [editDuration, setEditDuration] = useState(60);

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
  // Trip Pulse dismissed state — persisted with trip-scoped keys (tripId:alertId)
  const [dismissedPulse, setDismissedPulse] = useState<Set<string>>(new Set());
  const { enabled: tripPulseEnabled, loaded: tripPulseLoaded } = useTripPulse();
  const pulseHistory = usePulseHistory();
  // Track which pulse alert is pending so we dismiss only on apply, not cancel
  const [pendingPulseAlertId, setPendingPulseAlertId] = useState<string | null>(null);
  // Track which pulse alerts the user has already seen (for new-issue badge)
  const [seenPulse, setSeenPulse] = useState<Set<string>>(new Set());
  // Show pulse modal from outside
  const [showPulseModal, setShowPulseModal] = useState(false);

  // Post-visit feedback
  const [feedbackDay, setFeedbackDay] = useState<number | null>(null);

  useEffect(() => {
    loadDismissedPulse().then((ids) => {
      if (ids.length > 0) setDismissedPulse(new Set(ids));
    });
    loadSeenPulse().then((ids) => {
      if (ids.length > 0) setSeenPulse(new Set(ids));
    });
  }, []);

  // Trip editing
  const [showTripEdit, setShowTripEdit] = useState(false);
  const [editTripTitle, setEditTripTitle] = useState('');
  const [editDest, setEditDest] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTravelers, setEditTravelers] = useState('');
  const [editDepartureFrom, setEditDepartureFrom] = useState('');
  const [editBudget, setEditBudget] = useState<'budget' | 'moderate' | 'premium'>('moderate');
  const [editPace, setEditPace] = useState<'relaxed' | 'moderate' | 'active'>('moderate');
  const [editTravelWith, setEditTravelWith] = useState<'solo' | 'partner' | 'family' | 'friends' | 'group'>('solo');
  const [editRestrictions, setEditRestrictions] = useState('');
  const [editTripInstructions, setEditTripInstructions] = useState('');
  const [showEditStartPicker, setShowEditStartPicker] = useState(false);
  const [showEditEndPicker, setShowEditEndPicker] = useState(false);

  // Reservations
  const [showAddReservationModal, setShowAddReservationModal] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [resType, setResType] = useState<ReservationType>('restaurant');
  const [resTitle, setResTitle] = useState('');
  const [resDay, setResDay] = useState<string>('');
  const [resTime, setResTime] = useState('');
  const [resConfirmation, setResConfirmation] = useState('');
  const [resBookingUrl, setResBookingUrl] = useState('');
  const [resPrice, setResPrice] = useState('');
  const [resNotes, setResNotes] = useState('');
  const [resAddress, setResAddress] = useState('');
  const [resCurrency, setResCurrency] = useState('USD');
  const [resDate, setResDate] = useState('');
  // Entry mode for creating a new reservation
  const [resEntryMode, setResEntryMode] = useState<'choose' | 'link' | 'manual'>('choose');
  const [resLinkUrl, setResLinkUrl] = useState('');
  const [resLinkLoading, setResLinkLoading] = useState(false);
  const [resLinkError, setResLinkError] = useState('');
  const [resCheckoutDate, setResCheckoutDate] = useState('');

  // Members tab form
  const [inviteName, setInviteName] = useState('');
  const [inviteContact, setInviteContact] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'viewer'>('member');
  const [lastInviteCode, setLastInviteCode] = useState('');

  // Move activity to different day/time
  const [movingActivity, setMovingActivity] = useState<Activity | null>(null);
  const [moveDay, setMoveDay] = useState(1);
  const [moveTime, setMoveTime] = useState('');

  // Smart Replace picker
  const [replaceTarget, setReplaceTarget] = useState<Activity | null>(null);
  const [replaceAlternatives, setReplaceAlternatives] = useState<{
    title: string; description: string; cost: string; crowdLevel: string; duration: number; whyFits: string;
  }[]>([]);

  // Manual Replace modal
  const [manualReplaceTarget, setManualReplaceTarget] = useState<Activity | null>(null);
  const [manualReplaceName, setManualReplaceName] = useState('');
  const [manualReplaceTime, setManualReplaceTime] = useState('');
  const [manualReplaceDuration, setManualReplaceDuration] = useState(60);

  // Hotel suggestions ("Where to stay" card)
  const [hotelSuggestions, setHotelSuggestions] = useState<NormalizedPlace[]>([]);
  const [hotelsDismissed, setHotelsDismissed] = useState(false);
  const [hotelPhotoUrls, setHotelPhotoUrls] = useState<Map<string, string>>(new Map());

  // Activity-specific customization target
  const [customizeTarget, setCustomizeTarget] = useState<Activity | null>(null);
  // Context menu state (hold or "..." tap)
  const [contextMenuActivity, setContextMenuActivity] = useState<Activity | null>(null);
  const [droppedActivityId, setDroppedActivityId] = useState<string | null>(null);

  const [scopePickerCommand, setScopePickerCommand] = useState<TravonalCommand | null>(null);
  const [scopePickerDays, setScopePickerDays] = useState<Set<number>>(new Set());
  const [scopePickerSearchTerms, setScopePickerSearchTerms] = useState<string | undefined>(undefined);
  const [scopePickerStartAfter, setScopePickerStartAfter] = useState<string | undefined>(undefined);

  // Store pending transformation for preview-before-apply
  const [pendingTransform, setPendingTransform] = useState<{
    activities: Activity[];
    summary: string;
    changes: string[];
    whyFits?: string;
    memoryEntry?: { type: string; category: string; detail: string };
    preview?: ChangePreview;
    conflicts?: ReturnType<typeof checkConflicts>;
  } | null>(null);

  // Subscription gates
  const editGate = useGate('edit_trip');
  const analyzeGate = useGate('analyze_trip');
  const searchGate = useGate('natural_search');
  const { refresh: refreshSubscription } = useSubscription();
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<'edit_trip' | 'analyze_trip' | 'natural_search' | 'import_place'>('edit_trip');

  const trip = getTrip(id);

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

  // Auto-detect active trip and switch to live mode on mount
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!trip || liveMode !== null || dayParam) return; // skip if already set or deep-linked to a day
    if (isTripActive(trip, undefined)) {
      const todayDay = getTripDayNumber(trip.startDate, trip.endDate, undefined);
      if (todayDay >= 1) {
        setFilterDay(todayDay);
        setLiveMode(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  // Auto-hide the undo banner after ~10 seconds (without removing the snapshot)
  useEffect(() => {
    const undoable = getUndoableChange(id);
    if (!undoable || undoable.id === undoDismissedId || undoable.id === autoHideUndoId) return;
    const timer = setTimeout(() => {
      setAutoHideUndoId(undoable.id);
    }, 10000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, undoDismissedId]);

  // Initialize default prep items — must be before early returns to avoid hook-order crash
  const prepTripId = trip?.id;
  useEffect(() => {
    if (!trip) return;
    if (viewMode === 'prep' && (!trip.prepItems || trip.prepItems.length === 0)) {
      const dest = trip.destination;
      const country = trip.country;
      const hasHotel = trip.activities.some((a) => a.type === 'hotel');
      // Detect domestic trips (US-to-US) to skip passport/visa items
      const domesticCountries = ['united states', 'usa', 'us'];
      const isDomestic = domesticCountries.includes(country?.toLowerCase?.() ?? '');
      const items: PrepItem[] = [];
      if (!isDomestic) {
        items.push(
          { id: 'prep-1', text: 'Pack passport / ID', done: false, custom: false, category: 'documents' },
          { id: 'prep-2', text: `Check visa requirements for ${dest}`, done: false, custom: false, category: 'documents' },
        );
      }
      if (!hasHotel) {
        items.push({ id: 'prep-3', text: 'Book accommodation', done: false, custom: false, category: 'accommodation' });
      }
      items.push(
        { id: 'prep-5', text: `Download offline maps for ${dest}`, done: false, custom: false, category: 'packing' },
      );
      if (!isDomestic) {
        items.push({ id: 'prep-4', text: 'Arrange travel insurance', done: false, custom: false, category: 'health' });
      }
      updateTripPrepItems(trip.id, items);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, prepTripId]);

  // Fetch hotel suggestions when trip has no hotel
  const tripHasHotel = trip?.activities.some((a) => a.type === 'hotel') ?? true;
  useEffect(() => {
    if (!trip || tripHasHotel || hotelsDismissed) return;
    let cancelled = false;
    fetchExplorePlaces(
      { type: 'trip', tripId: trip.id, destination: trip.destination, label: trip.destination },
      'stays',
    ).then((places) => {
      if (cancelled) return;
      const top = places.slice(0, 3);
      setHotelSuggestions(top);
      // Fetch photos for hotel cards
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
  }, [trip?.id, tripHasHotel, hotelsDismissed]);

  // Destination photo — must be before early returns (hook ordering rule)
  const heroPhotoQuery = trip ? `${trip.destination}, ${trip.country}` : '';
  const heroPhoto = useDestinationPhoto(heroPhotoQuery);

  // Activity thumbnails — batch prefetch from shared cache
  const activityPlaceIds = useMemo(
    () => (trip?.activities ?? []).map((a) => a.placeId).filter((id): id is string => !!id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip?.id, trip?.activities.length],
  );
  const activityPhotos = useActivityPhotos(activityPlaceIds);

  // Weather forecast for weather-aware pulse alerts + live view
  const [weatherForecast, setWeatherForecast] = useState<import('@/services/weather').TripWeatherForecast | null>(null);
  useEffect(() => {
    if (!trip) return;
    const actWithCoords = trip.activities.find((a) => a.lat != null && a.lng != null);
    if (!actWithCoords || actWithCoords.lat == null || actWithCoords.lng == null) return;
    let cancelled = false;
    const isActive = isTripActive(trip);
    import('@/services/weather').then((wx) => {
      const fetchFn = isActive ? wx.fetchWeatherForecastActive : wx.fetchWeatherForecast;
      fetchFn(actWithCoords.lat!, actWithCoords.lng!, trip.startDate, trip.endDate).then((forecast) => {
        if (!cancelled) setWeatherForecast(forecast);
      });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, trip?.startDate, trip?.endDate]);

  // Pre-compute pulse alerts for the solutions hook (needs to be before early returns)
  const prePulseAlerts = (trip && shouldRunTripPulse(tripPulseLoaded, tripPulseEnabled))
    ? runTripPulse(trip, profile, memoryEntries, 5, weatherForecast)
    : [];

  // Pulse solutions hook — prepares AI fixes in the background
  const { getSolution, isPreparing: isSolutionPreparing } = usePulseSolutions(
    trip,
    prePulseAlerts,
    profile,
    memoryEntries,
  );

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
    const unbookedCritical = trip.activities.filter(
      (a) => (a.type === 'hotel' || a.type === 'flight') && a.bookingStatus !== 'booked',
    );
    if (unbookedCritical.length > 0) {
      scheduleBookingReminders(trip.id, trip.destination, unbookedCritical.length, trip.startDate);
    } else {
      cancelBookingReminders(trip.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, bookedCount]);

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

  // Monotonic revision counter — scopes pulse dismissals so they expire when activities change
  const itineraryRevision = currentTrip.itineraryRevision ?? 0;

  // Pulse alerts — reuse pre-computed alerts (already computed before early returns for hook ordering)
  const allPulseAlerts = prePulseAlerts;
  const activePulseAlerts = allPulseAlerts
    .filter((a) => !isPulseDismissed(dismissedPulse, currentTrip.id, a.id, itineraryRevision));
  const dismissedPulseAlerts = allPulseAlerts
    .filter((a) => isPulseDismissed(dismissedPulse, currentTrip.id, a.id, itineraryRevision));
  // Compute new-issue badge count: active alerts not yet seen (trip-scoped)
  const makeSeenKey = (alertId: string) => `${currentTrip.id}:${alertId}`;
  const newIssueCount = activePulseAlerts.filter((a) => !seenPulse.has(makeSeenKey(a.id))).length;
  // Resolved history entries for this trip from centralized context
  const resolvedHistoryForTrip = pulseHistory.getResolvedForTrip(currentTrip.id);

  function handlePulseOpen() {
    // Mark all current active pulse alerts as "seen" (trip-scoped)
    const newSeen = new Set(seenPulse);
    for (const a of activePulseAlerts) {
      newSeen.add(makeSeenKey(a.id));
    }
    setSeenPulse(newSeen);
    saveSeenPulse([...newSeen]);

    // Update centralized pulse history: mark viewed alerts as "seen"
    pulseHistory.markSeen(currentTrip.id, activePulseAlerts.map((a) => a.id));
  }

  function dismissPulseAlert(alertId: string) {
    const scopedKey = makePulseDismissalKey(currentTrip.id, alertId, itineraryRevision);
    const next = new Set(dismissedPulse).add(scopedKey);
    setDismissedPulse(next);
    saveDismissedPulse([...next]);

    // Resolve in centralized pulse history
    pulseHistory.resolveAlert(currentTrip.id, alertId);
  }

  function handlePulseAction(alert: PulseAlert) {
    // Check if we have a prepared solution from the background AI
    const solution = getSolution(alert.id);
    if (solution) {
      setPendingPulseAlertId(alert.id);
      // Route directly to TransformationReveal with the prepared solution
      const preview = computeChangePreview(
        currentTrip.activities,
        solution.activities,
        solution.summary,
      );
      const solutionConflicts = checkConflicts(solution.activities, totalDays);
      setPendingTransform({
        activities: solution.activities,
        summary: solution.summary,
        changes: solution.changes,
        preview,
        conflicts: solutionConflicts,
      });
      setTransformResult({
        summary: solution.summary,
        changes: solution.changes,
      });
      return;
    }

    if (alert.command) {
      setPendingPulseAlertId(alert.id);
      handleCommand(alert.command as TravonalCommand, alert.day);
    } else {
      // Non-command actions dismiss immediately
      dismissPulseAlert(alert.id);
    }
  }

  function handlePulseDismiss(alertId: string) {
    const scopedKey = makePulseDismissalKey(currentTrip.id, alertId, itineraryRevision);
    const next = new Set(dismissedPulse).add(scopedKey);
    setDismissedPulse(next);
    saveDismissedPulse([...next]);

    // Also resolve in centralized pulse history (Issue 7: dismiss = resolve in history)
    pulseHistory.resolveAlert(currentTrip.id, alertId);
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

  // Post-visit feedback handler — saves rating + reason to memory
  function handlePostVisitFeedback(activity: Activity, rating: FeedbackRating, why?: WhyOption) {
    const typeLabel = rating === 'loved' ? 'recommendation_accepted'
      : rating === 'liked' ? 'recommendation_accepted'
      : 'recommendation_rejected';
    const detail = why
      ? why.memoryDetail(activity)
      : rating === 'loved' ? `Loved "${activity.title}"`
      : rating === 'liked' ? `Liked "${activity.title}"`
      : `Didn't enjoy "${activity.title}"`;
    addMemoryEntry({
      type: typeLabel,
      category: why?.memoryCategory ?? activity.type,
      detail,
      tripId: currentTrip.id,
      isGlobal: true,
      origin: `Post-visit feedback in ${currentTrip.destination}`,
    });
  }

  // Group activities by day
  const dayMap = new Map<number, Activity[]>();
  for (const act of currentTrip.activities) {
    const existing = dayMap.get(act.day) ?? [];
    existing.push(act);
    dayMap.set(act.day, existing);
  }

  // Include all days even empty ones
  const allDays: number[] = [];
  for (let d = 1; d <= totalDays; d++) {
    allDays.push(d);
  }

  // Live mode — determine if we're showing today's live view
  const tripIsActive = isTripActive(currentTrip, undefined);
  const todayDayNumber = tripIsActive
    ? getTripDayNumber(currentTrip.startDate, currentTrip.endDate, undefined)
    : 0;
  const isViewingToday = filterDay === todayDayNumber && todayDayNumber >= 1;
  const showLiveView = liveMode === true && isViewingToday && tripIsActive;

  // Today's weather for live view header
  const todayWeather = (() => {
    if (!showLiveView || !weatherForecast || todayDayNumber < 1) return null;
    const start = new Date(currentTrip.startDate + 'T00:00:00');
    const target = new Date(start);
    target.setDate(target.getDate() + todayDayNumber - 1);
    const targetStr = target.toISOString().split('T')[0];
    return weatherForecast.days.find((d) => d.date === targetStr) ?? null;
  })();

  // Navigate to place-detail for an activity
  function handleActivityTap(activity: Activity) {
    if (!activity.placeId && !activity.title) return;
    let url = `/place-detail?name=${encodeURIComponent(activity.title)}`;
    if (activity.placeId) url += `&placeId=${encodeURIComponent(activity.placeId)}`;
    if (activity.address) url += `&address=${encodeURIComponent(activity.address)}`;
    if (activity.lat != null) url += `&lat=${activity.lat}`;
    if (activity.lng != null) url += `&lng=${activity.lng}`;
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
      const beforeEnd = bh * 60 + bm + (before.duration ?? 60);
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
      const prevEnd = timeToMin(prev.time) + (prev.duration ?? 60);
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
              setManualReplaceDuration(target.duration ?? 60);
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
        budget: currentTrip.budget ?? profile.budget ?? 'moderate',
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
          duration: alt.duration ?? 60,
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
                    duration: manualReplaceDuration,
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
      `Replace "${replaceTarget.title}" with "${picked.title}"?\n\nTime: ${formatTimeDisplay(replaceTarget.time)}\nDuration: ${picked.duration} min\nCost: ${costLabel}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => applyReplacement(picked),
        },
      ],
    );
  }

  function applyReplacement(picked: { title: string; description: string; cost: string; duration: number }) {
    if (!replaceTarget) return;

    // Cap duration to avoid overlapping the next activity on the same day
    const nextActivity = currentTrip.activities
      .filter((a) => a.day === replaceTarget.day && a.time > replaceTarget.time)
      .sort(compareByTime)[0];
    let duration = Math.min(picked.duration, 240);
    if (nextActivity) {
      const gap = timeToMinutes(nextActivity.time) - timeToMinutes(replaceTarget.time) - 15;
      duration = Math.min(duration, Math.max(30, gap));
    }

    const result = currentTrip.activities.map((a) =>
      a.id === replaceTarget.id
        ? {
            id: generateActivityId(),
            title: picked.title,
            type: replaceTarget.type,
            day: replaceTarget.day,
            time: replaceTarget.time,
            duration,
            category: replaceTarget.category,
            cost: picked.cost as Activity['cost'],
            description: picked.description,
          }
        : a
    );
    setTripActivities(currentTrip.id, result, `Replaced "${replaceTarget.title}" with "${picked.title}"`);
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
        duration: newDuration,
        cost: (newCost || undefined) as Activity['cost'],
        description: [newAddress.trim(), newActivityNotes.trim()].filter(Boolean).join(' — ') || undefined,
        fixed: newFixed || undefined,
        locked: newFixed || undefined,
      });
      setNewTitle('');
      setNewTime(defaultTimeForType('activity'));
      setNewDuration(60);
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

  function handleCommand(command: TravonalCommand, dayOverride?: number, scopeOverride?: TransformScope, searchTerms?: string, startAfter?: string) {
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
      duration: 90,
    });
    showToast(`"${suggestion.title}" added to Day ${day}`, 'success');
    setShowAIAddSheet(false);
    setAiAddSuggestions([]);
  }

  function applyLocalTransform(command: TravonalCommand, scope: TransformScope, searchTerms?: string, startAfter?: string) {
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
    // Dismiss the pulse alert that triggered this transform (if any)
    if (pendingPulseAlertId) {
      dismissPulseAlert(pendingPulseAlertId);
      setPendingPulseAlertId(null);
    }
    // Save memory preference ONLY after successful apply
    if (memoryAction && pendingTransform.memoryEntry) {
      addMemoryEntry({
        type: pendingTransform.memoryEntry.type as any,
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

  function handleUndo() {
    const undoable = getUndoableChange(currentTrip.id);
    if (undoable) {
      undoChange(currentTrip.id);
      setUndoDismissedId(undoable.id);
      setAutoHideUndoId(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }

  const persistedUndoable = getUndoableChange(currentTrip.id);
  const canUndo = !!persistedUndoable && persistedUndoable.id !== undoDismissedId && persistedUndoable.id !== autoHideUndoId;
  const undoLabel = persistedUndoable?.description || '';

  function handleStartEdit(activity: Activity) {
    setEditingActivity(activity);
    setEditTitle(activity.title);
    setEditTime(activity.time);
    setEditType(activity.type);
    setEditDuration(activity.duration ?? 60);
  }

  function handleSaveEdit() {
    if (!editingActivity || !editTitle.trim()) return;
    const time = editTime.trim() || editingActivity.time;
    const updates = {
      title: editTitle.trim(),
      time: isValidTime(time) ? time : editingActivity.time,
      type: editType,
      duration: editDuration,
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
    setEditBudget(currentTrip.budget || profile.budget || 'moderate');
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
    // Record as a change so undo works: create updated activities and use setTripActivities
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

  // Trip Prep helpers
  function getDefaultPrepItems(): PrepItem[] {
    const dest = currentTrip.destination;
    const country = currentTrip.country;
    const hasHotel = currentTrip.activities.some((a) => a.type === 'hotel');
    const travelers = currentTrip.travelers ?? 1;
    const reservations = currentTrip.reservations ?? [];
    const members = currentTrip.members ?? [];
    const restrictions = currentTrip.restrictions;
    const hasFlight = currentTrip.activities.some((a) => a.type === 'flight') || reservations.some((r) => r.type === 'flight');
    const hasFlightRes = reservations.some((r) => r.type === 'flight');
    const hasHotelRes = reservations.some((r) => r.type === 'hotel');
    const domesticCountries = ['united states', 'usa', 'us'];
    const isDomestic = domesticCountries.includes(country?.toLowerCase?.() ?? '');

    const items: PrepItem[] = [];
    if (!isDomestic) {
      items.push(
        { id: 'prep-1', text: 'Pack passport / ID', done: false, custom: false, category: 'documents' },
        { id: 'prep-2', text: `Check visa requirements for ${dest}`, done: false, custom: false, category: 'documents' },
      );
    }
    items.push(
      { id: 'prep-5', text: `Download offline maps for ${dest}`, done: false, custom: false, category: 'packing' },
    );
    if (!isDomestic) {
      items.push({ id: 'prep-4', text: 'Arrange travel insurance', done: false, custom: false, category: 'health' });
    }
    if (!hasHotel && !hasHotelRes) {
      items.push({ id: 'prep-3', text: 'Book accommodation', done: false, custom: false, category: 'accommodation' });
    }
    // Travelers context
    if (travelers > 1) {
      items.push({ id: 'prep-travelers', text: `Confirm plans with all ${travelers} travelers`, done: false, custom: false, category: 'other' });
    }
    if (members.length > 1) {
      const otherNames = members.filter((m) => m.role !== 'owner').map((m) => m.name).join(', ');
      if (otherNames) {
        items.push({ id: 'prep-members', text: `Share final itinerary with ${otherNames}`, done: false, custom: false, category: 'other' });
      }
    }
    // Reservation context
    if (hasFlightRes) {
      items.push({ id: 'prep-flight-check', text: 'Confirm flight reservation details', done: false, custom: false, category: 'transport' });
    } else if (hasFlight) {
      items.push({ id: 'prep-flight-book', text: 'Book flights', done: false, custom: false, category: 'transport' });
    }
    if (reservations.some((r) => r.type === 'restaurant')) {
      items.push({ id: 'prep-dining', text: 'Confirm restaurant reservations', done: false, custom: false, category: 'other' });
    }
    // Accessibility / restrictions context
    if (restrictions) {
      items.push({ id: 'prep-access', text: `Verify accessibility needs: ${restrictions}`, done: false, custom: false, category: 'health' });
    }
    if (profile.mobilityNeeds.length > 0) {
      items.push({ id: 'prep-mobility', text: 'Arrange mobility assistance if needed', done: false, custom: false, category: 'health' });
    }
    if (profile.dietaryRestrictions.length > 0) {
      items.push({ id: 'prep-dietary', text: `Note dietary needs: ${profile.dietaryRestrictions.join(', ')}`, done: false, custom: false, category: 'health' });
    }
    return items;
  }

  // (prep useEffect moved before early returns to fix hook-order crash)

  // Active prep items — always read from trip (never mutate during render)
  const prepItems = currentTrip.prepItems && currentTrip.prepItems.length > 0
    ? currentTrip.prepItems
    : getDefaultPrepItems();

  function togglePrepItem(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = prepItems.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
    updateTripPrepItems(currentTrip.id, updated);
  }

  function addPrepItem() {
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
    };
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateTripPrepItems(currentTrip.id, [...prepItems, newItem]);
    setNewPrepItem('');
  }

  function removePrepItem(id: string) {
    updateTripPrepItems(currentTrip.id, prepItems.filter((i) => i.id !== id));
  }

  function handleShareItinerary() {
    let text = `${currentTrip.title ?? currentTrip.destination} - ${currentTrip.destination}\n`;
    text += `${formatDate(currentTrip.startDate)} to ${formatDate(currentTrip.endDate)} (${totalDays} days)\n\n`;

    for (let d = 1; d <= totalDays; d++) {
      const dayActivities = (dayMap.get(d) ?? []).sort(compareByTime);
      text += `${formatDayLabel(d, currentTrip.startDate, currentTrip.datesKnown)}\n`;
      if (dayActivities.length === 0) {
        text += '  (no activities planned)\n';
      } else {
        for (const a of dayActivities) {
          const dur = a.duration ? ` (${a.duration} min)` : '';
          text += `  \u2022 ${formatTimeDisplay(a.time)} ${a.title}${dur}\n`;
        }
      }
      text += '\n';
    }

    // Include reservations
    const reservations = (currentTrip.reservations ?? []).filter((r) => !r.cancelled);
    if (reservations.length > 0) {
      text += 'Bookings\n';
      for (const r of reservations) {
        const timeStr = r.time ? ` at ${formatTimeDisplay(r.time)}` : '';
        const dayStr = r.day ? ` (Day ${r.day})` : r.date ? ` (${r.date})` : '';
        const confStr = r.confirmationNumber ? ` — #${r.confirmationNumber}` : '';
        text += `  \u2022 ${r.title}${timeStr}${dayStr}${confStr}\n`;
      }
      text += '\n';
    }

    if (currentTrip.notes) {
      text += `Notes: ${currentTrip.notes}\n\n`;
    }
    text += 'Shared from Travonal';

    Share.share({ message: text });
  }

  const QUICK_ACTIONS: { label: string; command: TravonalCommand }[] = [
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
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
      >
        {/* Hero — photo background with gradient overlay */}
        <View style={[styles.hero, { height: 260 + insets.top }]}>
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
                <SymbolView name="pencil" size={18} tintColor="#fff" />
              </Pressable>
              <Pressable
                onPress={handleShareItinerary}
                hitSlop={8}
                style={styles.heroIconBtn}
                accessibilityRole="button"
                accessibilityLabel="Share itinerary"
              >
                <SymbolView name="square.and.arrow.up" size={18} tintColor="#fff" />
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
        </View>

        {/* View toggle — underline segment */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 0 }}>
          <View style={[styles.toggleRow, { borderBottomColor: theme.border }]}>
            {(['itinerary', 'prep', 'map', 'reservations', 'budget', 'members'] as const).map((mode, modeIdx) => {
              const readiness = mode === 'reservations' ? getTripReadiness(currentTrip.activities) : null;
              const showBadge = readiness && readiness.total > 0;
              return (
                <Fragment key={mode}>
                  <Pressable onPress={() => setViewMode(mode)} style={styles.toggleItem} accessibilityRole="button" accessibilityLabel={mode === 'itinerary' ? 'Itinerary tab' : mode === 'prep' ? 'Prep tab' : mode === 'budget' ? 'Budget tab' : mode === 'reservations' ? 'Bookings tab' : mode === 'members' ? 'Members tab' : 'Map tab'}>
                    <View style={styles.toggleTabContent}>
                      <ThemedText style={[styles.toggleText, { color: viewMode === mode ? theme.primary : theme.textSecondary }]}>
                        {mode === 'itinerary' ? 'Itinerary' : mode === 'prep' ? 'Prep' : mode === 'budget' ? 'Budget' : mode === 'reservations' ? 'Bookings' : mode === 'members' ? 'Members' : 'Map'}
                      </ThemedText>
                      {showBadge && (
                        <View style={[styles.toggleBadge, { backgroundColor: readiness.percentage === 100 ? '#10B981' : theme.primary + '20' }]}>
                          <ThemedText style={[styles.toggleBadgeText, { color: readiness.percentage === 100 ? '#fff' : theme.primary }]}>
                            {readiness.booked}/{readiness.total}
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
                        <SymbolView name="sparkles" size={13} tintColor={viewMode === 'ai' ? theme.primary : theme.textSecondary} />
                        <ThemedText style={[styles.toggleText, { color: viewMode === 'ai' ? theme.primary : theme.textSecondary }]}>Edit with AI</ThemedText>
                      </View>
                      {viewMode === 'ai' && <View style={[styles.toggleIndicator, { backgroundColor: theme.primary }]} />}
                    </Pressable>
                  )}
                </Fragment>
              );
            })}
          </View>
        </ScrollView>

        {/* Day selector */}
        {viewMode === 'itinerary' && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.daySelectorRow}
            style={styles.daySelectorScroll}
          >
            <Pressable
              onPress={() => { setFilterDay(null); setLiveMode(false); }}
              style={[
                styles.daySelectorPill,
                filterDay === null
                  ? { backgroundColor: theme.primary }
                  : { borderWidth: 1, borderColor: theme.border, backgroundColor: 'transparent' },
              ]}
              accessibilityRole="button"
              accessibilityLabel="All days"
            >
              <ThemedText
                style={[
                  styles.daySelectorText,
                  filterDay === null && styles.daySelectorTextActive,
                  filterDay === null && { color: theme.primaryText },
                ]}
              >
                All
              </ThemedText>
            </Pressable>
            {allDays.map((day) => {
              const isTodayPill = tripIsActive && day === todayDayNumber;
              return (
              <Pressable
                key={day}
                onPress={() => {
                  setFilterDay(day);
                  // Auto-enable live mode when tapping today's pill on an active trip
                  if (isTodayPill) setLiveMode(true);
                  else setLiveMode(false);
                }}
                style={[
                  styles.daySelectorPill,
                  filterDay === day
                    ? { backgroundColor: isTodayPill && liveMode ? theme.live : theme.primary }
                    : { borderWidth: 1, borderColor: isTodayPill ? theme.live + '60' : theme.border, backgroundColor: 'transparent' },
                ]}
                accessibilityRole="button"
                accessibilityLabel={isTodayPill ? `Today — Day ${day}` : `Day ${day} activities`}
              >
                {isTodayPill && filterDay !== day && (
                  <View style={[styles.liveDotSmall, { backgroundColor: theme.live }]} />
                )}
                <ThemedText
                  style={[
                    styles.daySelectorText,
                    filterDay === day && styles.daySelectorTextActive,
                    filterDay === day && { color: theme.primaryText },
                  ]}
                >
                  {isTodayPill ? 'Today' : `Day ${day}`}
                </ThemedText>
              </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Live / Plan toggle — shown when viewing today on an active trip */}
        {viewMode === 'itinerary' && isViewingToday && tripIsActive && (
          <View style={styles.liveToggleRow}>
            <Pressable
              onPress={() => setLiveMode(true)}
              style={[styles.liveToggleBtn, showLiveView && { backgroundColor: theme.live + '18' }]}
              accessibilityRole="button"
              accessibilityLabel="Switch to live view"
            >
              {showLiveView && <View style={[styles.liveDotSmall, { backgroundColor: theme.live }]} />}
              <ThemedText style={[styles.liveToggleText, { color: showLiveView ? theme.live : theme.textSecondary }]}>
                Live
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setLiveMode(false)}
              style={[styles.liveToggleBtn, !showLiveView && { backgroundColor: theme.primary + '18' }]}
              accessibilityRole="button"
              accessibilityLabel="Switch to planning view"
            >
              <ThemedText style={[styles.liveToggleText, { color: !showLiveView ? theme.primary : theme.textSecondary }]}>
                Plan
              </ThemedText>
            </Pressable>
          </View>
        )}

        {/* Undo banner */}
        {canUndo && viewMode === 'itinerary' && (
          <Animated.View
            entering={SlideInDown.springify()}
            exiting={FadeOut.duration(200)}
            style={[styles.undoBanner, { backgroundColor: 'rgba(229,229,229,0.1)' }]}
          >
            <ThemedText style={styles.undoText} numberOfLines={1}>
              {undoLabel}
            </ThemedText>
            <Pressable onPress={handleUndo} style={[styles.undoBtn, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel="Undo last change">
              <ThemedText style={[styles.undoBtnText, { color: theme.primaryText }]}>Undo</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setUndoDismissedId(persistedUndoable?.id ?? null)}
              hitSlop={8}
              style={styles.undoDismissBtn}
              accessibilityRole="button"
              accessibilityLabel="Dismiss undo"
            >
              <SymbolView name="xmark" size={12} tintColor={theme.textSecondary} />
            </Pressable>
          </Animated.View>
        )}

        {/* Trip Alerts — itinerary only */}
        {viewMode === 'itinerary' && (
          <PulseBanner
            alerts={activePulseAlerts}
            onAction={handlePulseAction}
            onDismiss={handlePulseDismiss}
            dismissedAlerts={dismissedPulseAlerts}
            resolvedHistory={resolvedHistoryForTrip}
            newIssueCount={newIssueCount}
            onOpen={handlePulseOpen}
            externalOpen={showPulseModal}
            onExternalClose={() => setShowPulseModal(false)}
            hasSolution={(alertId) => !!getSolution(alertId)}
            isPreparing={isSolutionPreparing}
          />
        )}

        {/* Booking progress bar — itinerary only */}
        {viewMode === 'itinerary' && (() => {
          const readiness = getTripReadiness(currentTrip.activities);
          if (readiness.total === 0) return null;
          if (readiness.percentage === 100) return null;
          return (
            <Pressable
              onPress={() => setViewMode('reservations')}
              style={[styles.bookingProgressBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel={`${readiness.booked} of ${readiness.total} booked. Tap to view reservations.`}
            >
              <View style={styles.bookingProgressInfo}>
                <SymbolView name={"calendar.badge.checkmark" as any} size={16} tintColor={theme.primary} />
                <ThemedText style={styles.bookingProgressText}>
                  {readiness.booked} of {readiness.total} booked
                </ThemedText>
                <ThemedText style={[styles.bookingProgressAction, { color: theme.primary }]}>
                  View all
                </ThemedText>
              </View>
              <View style={[styles.bookingProgressTrack, { backgroundColor: theme.border }]}>
                <View style={[styles.bookingProgressFill, { width: `${readiness.percentage}%`, backgroundColor: theme.primary }]} />
              </View>
            </Pressable>
          );
        })()}

        {/* Booking nudge banner — when trip is within 14 days and has unbooked hotels/flights */}
        {viewMode === 'itinerary' && (() => {
          const now = new Date();
          const start = new Date(currentTrip.startDate + 'T00:00:00');
          const daysUntil = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (daysUntil < 0 || daysUntil > 14) return null;
          const unbookedCritical = currentTrip.activities.filter(
            (a) => (a.type === 'hotel' || a.type === 'flight') && a.bookingStatus !== 'booked',
          );
          if (unbookedCritical.length === 0) return null;
          const hotelCount = unbookedCritical.filter((a) => a.type === 'hotel').length;
          const flightCount = unbookedCritical.filter((a) => a.type === 'flight').length;
          const parts: string[] = [];
          if (hotelCount > 0) parts.push(`${hotelCount} hotel${hotelCount > 1 ? 's' : ''}`);
          if (flightCount > 0) parts.push(`${flightCount} flight${flightCount > 1 ? 's' : ''}`);
          return (
            <Pressable
              onPress={() => setViewMode('reservations')}
              style={[styles.bookingNudgeBanner, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B40' }]}
              accessibilityRole="button"
              accessibilityLabel={`Trip starts in ${daysUntil} days. ${parts.join(' and ')} still need booking.`}
            >
              <View style={styles.bookingNudgeContent}>
                <SymbolView name={"exclamationmark.triangle.fill" as any} size={16} tintColor="#D97706" />
                <ThemedText style={styles.bookingNudgeText}>
                  Your trip starts in {daysUntil} day{daysUntil !== 1 ? 's' : ''} — {parts.join(' and ')} still need booking
                </ThemedText>
              </View>
              <ThemedText style={[styles.bookingNudgeAction, { color: '#D97706' }]}>Book now</ThemedText>
            </Pressable>
          );
        })()}

        {/* "Where to Stay" hotel suggestions — shown when no hotel in trip */}
        {viewMode === 'itinerary' && !tripHasHotel && !hotelsDismissed && hotelSuggestions.length > 0 && (
          <Animated.View entering={FadeInDown.duration(300)} style={[styles.hotelSuggestSection, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.hotelSuggestHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <SymbolView name="bed.double.fill" size={16} tintColor={theme.primary} />
                <ThemedText style={[styles.hotelSuggestTitle, { color: theme.text }]}>Where to stay</ThemedText>
              </View>
              <Pressable onPress={() => setHotelsDismissed(true)} hitSlop={8}>
                <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>Dismiss</ThemedText>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 2 }}>
              {hotelSuggestions.map((hotel) => {
                const photoUrl = hotelPhotoUrls.get(hotel.placeId ?? hotel.name);
                const links = getPlaceBookingLinks(hotel.name, hotel.category, currentTrip.destination);
                return (
                  <Pressable
                    key={hotel.placeId ?? hotel.name}
                    onPress={() => {
                      if (links[0]) openBookingLink(links[0].url);
                    }}
                    style={[styles.hotelCard, { backgroundColor: theme.background, borderColor: theme.border }]}
                  >
                    {photoUrl ? (
                      <ExpoImage source={{ uri: photoUrl }} style={styles.hotelCardPhoto} contentFit="cover" />
                    ) : (
                      <View style={[styles.hotelCardPhoto, { backgroundColor: theme.border, alignItems: 'center', justifyContent: 'center' }]}>
                        <SymbolView name="building.2.fill" size={24} tintColor={theme.textSecondary} />
                      </View>
                    )}
                    <View style={styles.hotelCardInfo}>
                      <ThemedText numberOfLines={1} style={[styles.hotelCardName, { color: theme.text }]}>{hotel.name}</ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        {hotel.rating != null && (
                          <>
                            <SymbolView name="star.fill" size={11} tintColor="#F59E0B" />
                            <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>{hotel.rating.toFixed(1)}</ThemedText>
                          </>
                        )}
                        {hotel.priceLevel != null && (
                          <ThemedText style={{ fontSize: 12, color: theme.textSecondary, marginLeft: 4 }}>
                            {'$'.repeat(hotel.priceLevel)}
                          </ThemedText>
                        )}
                      </View>
                      <View style={[styles.hotelBookBtn, { backgroundColor: theme.primary }]}>
                        <ThemedText style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Book</ThemedText>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => router.push('/(tabs)/explore')}
                style={[styles.hotelCard, { backgroundColor: theme.background, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }]}
              >
                <SymbolView name="magnifyingglass" size={20} tintColor={theme.primary} />
                <ThemedText style={{ color: theme.primary, fontSize: 12, fontWeight: '600', marginTop: 6 }}>Browse more</ThemedText>
              </Pressable>
            </ScrollView>
          </Animated.View>
        )}

        {viewMode === 'itinerary' ? (
          <View style={styles.itinerary}>
            {/* Live Day View — shown when on an active trip viewing today */}
            {showLiveView && (
              <Animated.View entering={FadeIn.duration(300)} style={styles.daySection}>
                <LiveDayView
                  trip={currentTrip}
                  timezone={undefined}
                  weather={todayWeather}
                  renderActivity={(activity, idx, total) => (
                    <ActivityCard
                      activity={activity}
                      photoUrl={activity.placeId ? activityPhotos.get(activity.placeId) : undefined}
                      bookLabel={getBookLabel(activity)}
                      onMenu={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        setContextMenuActivity(activity);
                      }}
                      onTap={() => handleActivityTap(activity)}
                      onBook={() => handleBookActivity(activity)}
                    />
                  )}
                  onRunningLate={() => {
                    const delays = [
                      { label: '15 min', minutes: 15 },
                      { label: '30 min', minutes: 30 },
                      { label: '1 hour', minutes: 60 },
                    ];
                    Alert.alert(
                      "Running late?",
                      "Push your upcoming activities forward. How much time do you need?",
                      [
                        ...delays.map((d) => ({
                          text: d.label,
                          onPress: () => {
                            const { timeStr } = getDestinationNow();
                            const updated = reflowFromTime(currentTrip.activities, todayDayNumber, timeStr, d.minutes);
                            setTripActivities(currentTrip.id, updated, `Pushed schedule ${d.label} later`);
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            showToast(`Schedule pushed ${d.label} later`);
                          },
                        })),
                        { text: 'Cancel', style: 'cancel' as const },
                      ],
                    );
                  }}
                  onSkipActivity={(activity) => {
                    Alert.alert(
                      'Skip activity?',
                      `Skip "${activity.title}" and adjust the rest of your day?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Skip',
                          onPress: () => {
                            setTripActivities(
                              currentTrip.id,
                              currentTrip.activities.filter((a) => a.id !== activity.id),
                              `Skipped "${activity.title}"`,
                            );
                            showToast(`Skipped "${activity.title}"`);
                          },
                        },
                      ],
                    );
                  }}
                  onDayComplete={(dayNumber) => {
                    // Auto-show feedback when all activities for today are done
                    setFeedbackDay(dayNumber);
                  }}
                />

                {/* Add activity link */}
                <Pressable
                  onPress={() => setAddingToDay(todayDayNumber)}
                  style={styles.addLink}
                  accessibilityRole="button"
                  accessibilityLabel="Add activity to today"
                >
                  <ThemedText style={[styles.addLinkText, { color: theme.primary }]}>+ Add activity</ThemedText>
                </Pressable>
              </Animated.View>
            )}

            {/* Standard planning view */}
            {!showLiveView && visibleDays.map((day) => {
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
                  <Pressable
                    onPress={() => setQuickActionDay(quickActionDay === day ? null : day)}
                    style={[styles.dayHeader, { borderBottomColor: theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Day ${day} actions`}
                  >
                    <ThemedText style={styles.dayLabel}>{formatDayLabel(day, currentTrip.startDate)}</ThemedText>
                    <View style={styles.dayHeaderActions}>
                      {/* Show feedback link for past days with activities */}
                      {(() => {
                        if (dayActivities.length === 0) return null;
                        const dayDate = new Date(currentTrip.startDate + 'T00:00:00');
                        dayDate.setDate(dayDate.getDate() + day - 1);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        if (dayDate >= today) return null;
                        return (
                          <Pressable
                            onPress={(e) => { e.stopPropagation(); setFeedbackDay(day); }}
                            accessibilityRole="button"
                            accessibilityLabel={`Give feedback for Day ${day}`}
                          >
                            <ThemedText style={[styles.dayAction, { color: theme.live }]}>How was it?</ThemedText>
                          </Pressable>
                        );
                      })()}
                      <SymbolView
                        name={quickActionDay === day ? 'chevron.up' : 'chevron.down'}
                        size={12}
                        tintColor={theme.textSecondary}
                      />
                    </View>
                  </Pressable>

                  {/* Quick action chips — expand on day header tap */}
                  {quickActionDay === day && (
                    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
                      <View style={styles.quickActionRow}>
                        <Pressable
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            handleDayAction(day);
                            setQuickActionDay(null);
                          }}
                          style={({ pressed }) => [
                            styles.quickActionChip,
                            { transform: [{ scale: pressed ? 0.97 : 1 }] },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Adjust with AI"
                        >
                          <ThemedText style={[styles.quickActionText, { color: theme.primary }]}>Adjust</ThemedText>
                        </Pressable>
                        {QUICK_ACTIONS.map((action) => (
                          <Pressable
                            key={action.command}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setSelectedDay(day);
                              handleCommand(action.command, day);
                              setQuickActionDay(null);
                            }}
                            style={({ pressed }) => [
                              styles.quickActionChip,
                              { transform: [{ scale: pressed ? 0.97 : 1 }] },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={action.label}
                          >
                            <ThemedText style={[styles.quickActionText, { color: theme.primary }]}>{action.label}</ThemedText>
                          </Pressable>
                        ))}
                      </View>
                    </Animated.View>
                  )}

                  {dayActivities.length === 0 ? (
                    <View style={styles.emptyDay}>
                      {dragState && dragState.targetDay === day && (
                        <Animated.View entering={FadeIn.duration(150)} style={styles.insertionLine}>
                          <View style={[styles.insertionTimeBadge, { backgroundColor: theme.live }]}>
                            <ThemedText style={styles.insertionTimeText}>{formatTimeDisplay(dragState.previewTime)}</ThemedText>
                          </View>
                          <View style={[styles.insertionDot, { backgroundColor: theme.live }]} />
                          <View style={[styles.insertionBar, { backgroundColor: theme.live }]} />
                        </Animated.View>
                      )}
                      <ThemedText style={[styles.emptyDayText, { color: theme.textSecondary }]}>No activities</ThemedText>
                      <Pressable
                        onPress={() => setAddingToDay(day)}
                        style={styles.addLink}
                        accessibilityRole="button"
                        accessibilityLabel={`Add activity to Day ${day}`}
                      >
                        <ThemedText style={[styles.addLinkText, { color: theme.primary }]}>+ Add</ThemedText>
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
                            onReplace={(a) => handleReplace(a.id)}
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
                              <View style={styles.timelineItem}>
                                {/* Left column: time */}
                                <View style={styles.timeCol}>
                                  <ThemedText style={[styles.timeText, { color: theme.textSecondary }]}>
                                    {formatTimeDisplay(activity.time)}
                                  </ThemedText>
                                </View>

                                {/* Center column: dot + connector */}
                                <View style={styles.dotCol}>
                                  <View style={[styles.timelineDot, { backgroundColor: theme.primary }]} />
                                  {idx < dayActivities.length - 1 && (
                                    <View style={[styles.timelineConnector, { backgroundColor: theme.border }]} />
                                  )}
                                </View>

                                {/* Right column: activity card */}
                                <ActivityCard
                                  activity={activity}
                                  photoUrl={activity.placeId ? activityPhotos.get(activity.placeId) : undefined}
                                  bookLabel={getBookLabel(activity)}
                                  onMenu={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    setContextMenuActivity(activity);
                                  }}
                                  onTap={() => handleActivityTap(activity)}
                                  onBook={() => handleBookActivity(activity)}
                                />
                              </View>

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
                                <Animated.View entering={FadeIn.duration(200)} style={[styles.addForm, { backgroundColor: theme.backgroundElement }]}>
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
                                      showDuration
                                      duration={editDuration}
                                      onDurationChange={setEditDuration}
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

                      {/* End-of-day marker */}
                      <View style={styles.timelineEndRow}>
                        <View style={styles.timeCol} />
                        <View style={styles.dotCol}>
                          <View style={[styles.timelineEndDot, { borderColor: theme.border }]} />
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Add activity link */}
                  <Pressable
                    onPress={() => setAddingToDay(day)}
                    style={styles.addLink}
                    accessibilityRole="button"
                    accessibilityLabel={`Add activity to Day ${day}`}
                  >
                    <ThemedText style={[styles.addLinkText, { color: theme.primary }]}>+ Add activity</ThemedText>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        ) : viewMode === 'ai' ? (
          <View style={styles.aiView}>
            {/* Trip Analysis — deep AI review */}
            <Pressable
              onPress={() => {
                if (tripAnalysis || analysisLoading) return;
                if (!analyzeGate.allowed) {
                  setUpgradeFeature('analyze_trip');
                  setShowUpgradePrompt(true);
                  return;
                }
                setAnalysisLoading(true);
                analyzeTripAI({ trip: currentTrip, profile })
                  .then((result) => {
                    setTripAnalysis(result);
                    // Auto-expand all categories
                    setAnalysisExpanded(new Set(result.categories.map((c) => c.id)));
                  })
                  .catch(() => showToast('Analysis failed — try again'))
                  .finally(() => setAnalysisLoading(false));
              }}
              style={[styles.analysisCard, { backgroundColor: theme.primaryMuted, borderColor: theme.primary + '30' }]}
            >
              <View style={styles.analysisCardHeader}>
                <SymbolView name="wand.and.stars" size={24} tintColor={theme.primary} />
                <View style={styles.analysisCardTextCol}>
                  <ThemedText style={styles.analysisCardTitle}>Analyze my trip</ThemedText>
                  <ThemedText style={[styles.analysisCardDesc, { color: theme.textSecondary }]}>
                    Deep AI review of pacing, balance, logistics & more
                  </ThemedText>
                </View>
                {analysisLoading && (
                  <Animated.View entering={FadeIn.duration(200)}>
                    <ThemedText style={[styles.analysisLoadingText, { color: theme.primary }]}>Analyzing...</ThemedText>
                  </Animated.View>
                )}
                {!analysisLoading && !tripAnalysis && (
                  <SymbolView name="chevron.right" size={14} tintColor={theme.primary} />
                )}
              </View>
            </Pressable>

            {/* Analysis results */}
            {tripAnalysis && (
              <Animated.View entering={FadeInDown.springify()} style={styles.analysisResults}>
                {/* Overall score */}
                <View style={[styles.analysisOverall, { backgroundColor: theme.backgroundElement }]}>
                  <View style={styles.analysisScoreRow}>
                    <ThemedText style={styles.analysisScoreNum}>{tripAnalysis.overallScore}</ThemedText>
                    <ThemedText style={[styles.analysisScoreLabel, { color: theme.textSecondary }]}>/5</ThemedText>
                  </View>
                  <ThemedText style={[styles.analysisOverallText, { color: theme.textSecondary }]}>
                    {tripAnalysis.overallSummary}
                  </ThemedText>
                  <Pressable
                    onPress={() => {
                      setTripAnalysis(null);
                      setAnalysisExpanded(new Set());
                    }}
                    hitSlop={8}
                    style={styles.analysisRefreshBtn}
                  >
                    <SymbolView name="arrow.clockwise" size={14} tintColor={theme.primary} />
                    <ThemedText style={[styles.analysisRefreshText, { color: theme.primary }]}>Re-analyze</ThemedText>
                  </Pressable>
                </View>

                {/* Category breakdowns */}
                {tripAnalysis.categories.map((cat) => {
                  const isExpanded = analysisExpanded.has(cat.id);
                  const scoreColor = cat.score >= 4 ? '#10B981' : cat.score >= 3 ? '#F59E0B' : '#EF4444';
                  return (
                    <View key={cat.id} style={[styles.analysisCatCard, { backgroundColor: theme.backgroundElement }]}>
                      <Pressable
                        onPress={() => {
                          const next = new Set(analysisExpanded);
                          if (isExpanded) next.delete(cat.id);
                          else next.add(cat.id);
                          setAnalysisExpanded(next);
                        }}
                        style={styles.analysisCatHeader}
                      >
                        <ThemedText style={styles.analysisCatEmoji}>{cat.emoji}</ThemedText>
                        <ThemedText style={[styles.analysisCatLabel, { flex: 1 }]}>{cat.label}</ThemedText>
                        <View style={[styles.analysisCatScoreBadge, { backgroundColor: scoreColor + '18' }]}>
                          <ThemedText style={[styles.analysisCatScoreText, { color: scoreColor }]}>{cat.score}/5</ThemedText>
                        </View>
                        <SymbolView name={isExpanded ? 'chevron.up' : 'chevron.down'} size={12} tintColor={theme.textSecondary} />
                      </Pressable>

                      {isExpanded && (
                        <Animated.View entering={FadeIn.duration(150)} style={styles.analysisCatBody}>
                          <ThemedText style={[styles.analysisCatSummary, { color: theme.textSecondary }]}>{cat.summary}</ThemedText>
                          {cat.suggestions.length > 0 && (
                            <View style={styles.analysisSuggestions}>
                              {cat.suggestions.map((sug, i) => (
                                <View key={i} style={styles.analysisSugRow}>
                                  <ThemedText style={styles.analysisSugText}>{sug.text}</ThemedText>
                                  {sug.actionCommand && (
                                    <Pressable
                                      onPress={() => {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        handleCommand(sug.actionCommand as TravonalCommand, sug.actionDay);
                                        setViewMode('itinerary');
                                      }}
                                      style={[styles.analysisSugBtn, { backgroundColor: theme.primary }]}
                                    >
                                      <ThemedText style={[styles.analysisSugBtnText, { color: theme.primaryText }]}>Fix</ThemedText>
                                    </Pressable>
                                  )}
                                </View>
                              ))}
                            </View>
                          )}
                        </Animated.View>
                      )}
                    </View>
                  );
                })}
              </Animated.View>
            )}

            {/* Divider */}
            <View style={[styles.aiViewDivider, { backgroundColor: theme.border }]} />

            {/* Free text input */}
            <ThemedText style={[styles.aiViewSectionLabel, { color: theme.textSecondary }]}>Tell AI what to change</ThemedText>
            <View style={[styles.aiViewInputRow, { borderColor: theme.border }]}>
              <TextInput
                style={[styles.aiViewInput, { color: theme.text }]}
                value={aiViewQuery}
                onChangeText={(t) => { setAiViewQuery(t); setAiViewError(''); }}
                placeholder="e.g. Make day 2 more relaxed, add a rooftop bar..."
                placeholderTextColor={theme.textSecondary}
                onSubmitEditing={() => {
                  if (!aiViewQuery.trim()) return;
                  const { command, extractedDay, searchTerms, startAfter } = parseTextToCommand(aiViewQuery);
                  if (command === null) {
                    handleAIEdit(aiViewQuery.trim());
                    setAiViewQuery('');
                    setViewMode('itinerary');
                    return;
                  }
                  setAiViewQuery('');
                  handleCommand(command, extractedDay, undefined, searchTerms, startAfter);
                  setViewMode('itinerary');
                }}
                returnKeyType="go"
                multiline={false}
              />
              {aiViewQuery.trim().length > 0 && (
                <Pressable
                  onPress={() => {
                    const { command, extractedDay, searchTerms, startAfter } = parseTextToCommand(aiViewQuery);
                    if (command === null) {
                      handleAIEdit(aiViewQuery.trim());
                      setAiViewQuery('');
                      setViewMode('itinerary');
                      return;
                    }
                    setAiViewQuery('');
                    handleCommand(command, extractedDay, undefined, searchTerms, startAfter);
                    setViewMode('itinerary');
                  }}
                  style={[styles.aiViewSendBtn, { backgroundColor: theme.primary }]}
                >
                  <SymbolView name="arrow.up" size={16} tintColor={theme.primaryText} />
                </Pressable>
              )}
            </View>

            {aiViewError.length > 0 && (
              <ThemedText style={{ color: theme.danger, fontSize: 13, marginTop: 4 }}>{aiViewError}</ThemedText>
            )}

            {/* Quick action commands */}
            <ThemedText style={[styles.aiViewSectionLabel, { color: theme.textSecondary, marginTop: 24 }]}>Quick actions</ThemedText>
            <View style={styles.aiViewCommands}>
              {AI_COMMANDS.map((cmd) => (
                <Pressable
                  key={cmd.id}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    handleCommand(cmd.id);
                    setViewMode('itinerary');
                  }}
                  style={({ pressed }) => [
                    styles.aiViewCommandRow,
                    { backgroundColor: pressed ? theme.primaryMuted : theme.backgroundElement },
                  ]}
                >
                  <SymbolView name={cmd.icon as any} size={22} tintColor={theme.primary} />
                  <View style={styles.aiViewCommandText}>
                    <ThemedText style={styles.aiViewCommandLabel}>{cmd.label}</ThemedText>
                    <ThemedText style={[styles.aiViewCommandDesc, { color: theme.textSecondary }]}>{cmd.description}</ThemedText>
                  </View>
                  <SymbolView name="chevron.right" size={12} tintColor={theme.textSecondary} />
                </Pressable>
              ))}
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
                  <ThemedText style={styles.prepProgress}>
                    {doneCount} of {prepItems.length} complete
                  </ThemedText>
                  <View style={[styles.prepProgressBar, { backgroundColor: theme.backgroundElement }]}>
                    <View style={[styles.prepProgressFill, { width: `${prepItems.length > 0 ? (doneCount / prepItems.length) * 100 : 0}%`, backgroundColor: theme.primary }]} />
                  </View>
                  {PREP_CATEGORIES.map((cat) => {
                    const catItems = prepItems.filter((i) => (i.category ?? 'other') === cat.key);
                    if (catItems.length === 0) return null;
                    return (
                      <View key={cat.key}>
                        <ThemedText style={[styles.prepCategoryHeader, { color: theme.textSecondary }]}>{cat.label}</ThemedText>
                        {catItems.map((item) => (
                          <View key={item.id}>
                            {editingPrepId === item.id ? (
                              <View style={[styles.prepItem, { backgroundColor: theme.backgroundElement }]}>
                                <SymbolView name={item.done ? 'checkmark.circle.fill' : 'circle'} size={18} tintColor={item.done ? '#22C55E' : undefined} />
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
                              <Pressable
                                onPress={() => togglePrepItem(item.id)}
                                onLongPress={() => {
                                  setEditingPrepId(item.id);
                                  setEditPrepText(item.text);
                                }}
                                style={[styles.prepItem, { backgroundColor: theme.backgroundElement }]}
                                accessibilityRole="button"
                                accessibilityLabel={`Toggle prep item: ${item.text}`}
                              >
                                <SymbolView name={item.done ? 'checkmark.circle.fill' : 'circle'} size={18} tintColor={item.done ? '#22C55E' : undefined} />
                                <ThemedText style={[styles.prepItemText, item.done && styles.prepItemDone]}>{item.text}</ThemedText>
                                {item.custom && (
                                  <Pressable onPress={() => removePrepItem(item.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove prep item">
                                    <SymbolView name="xmark" size={14} tintColor={theme.textSecondary} />
                                  </Pressable>
                                )}
                              </Pressable>
                            )}
                          </View>
                        ))}
                      </View>
                    );
                  })}
                  {/* Items without category */}
                  {prepItems.filter((i) => !i.category).length > 0 && (
                    <>
                      {prepItems.filter((i) => !i.category).map((item) => (
                        <Pressable
                          key={item.id}
                          onPress={() => togglePrepItem(item.id)}
                          onLongPress={() => {
                            setEditingPrepId(item.id);
                            setEditPrepText(item.text);
                          }}
                          style={[styles.prepItem, { backgroundColor: theme.backgroundElement }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Toggle prep item: ${item.text}`}
                        >
                          <SymbolView name={item.done ? 'checkmark.circle.fill' : 'circle'} size={18} tintColor={item.done ? '#22C55E' : undefined} />
                          <ThemedText style={[styles.prepItemText, item.done && styles.prepItemDone]}>{item.text}</ThemedText>
                          {item.custom && (
                            <Pressable onPress={() => removePrepItem(item.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove prep item">
                              <SymbolView name="xmark" size={14} tintColor={theme.textSecondary} />
                            </Pressable>
                          )}
                        </Pressable>
                      ))}
                    </>
                  )}
                  <View style={[styles.prepAddRow, { borderColor: theme.border }]}>
                    <TextInput
                      style={[styles.prepAddInput, { color: theme.text }]}
                      value={newPrepItem}
                      onChangeText={setNewPrepItem}
                      placeholder="Add a prep item..."
                      placeholderTextColor={theme.textSecondary}
                      onSubmitEditing={addPrepItem}
                      returnKeyType="done"
                      accessibilityLabel="Add prep item"
                    />
                    <Pressable
                      onPress={addPrepItem}
                      style={[styles.prepAddBtn, { backgroundColor: theme.primary, opacity: newPrepItem.trim() ? 1 : 0.4 }]}
                      disabled={!newPrepItem.trim()}
                      accessibilityRole="button"
                      accessibilityLabel="Add prep item"
                    >
                      <ThemedText style={[styles.prepAddBtnText, { color: theme.primaryText }]}>Add</ThemedText>
                    </Pressable>
                  </View>

                  {/* Offline readiness section */}
                  <View style={styles.offlineSection}>
                    <ThemedText style={[styles.prepCategoryHeader, { color: theme.textSecondary }]}>Offline Readiness</ThemedText>
                    <View style={styles.offlineRow}>
                      <SymbolView name="checkmark.circle.fill" size={16} tintColor="#22C55E" />
                      <ThemedText style={styles.offlineText}>Itinerary saved locally</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <SymbolView name="checkmark.circle.fill" size={16} tintColor="#22C55E" />
                      <ThemedText style={styles.offlineText}>Bookings saved locally</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <SymbolView name="checkmark.circle.fill" size={16} tintColor="#22C55E" />
                      <ThemedText style={styles.offlineText}>Prep list saved locally</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <SymbolView name="exclamationmark.triangle.fill" size={16} tintColor="#D97706" />
                      <ThemedText style={styles.offlineText}>Maps require internet (download offline maps)</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <SymbolView name="exclamationmark.triangle.fill" size={16} tintColor="#D97706" />
                      <ThemedText style={styles.offlineText}>Booking websites require internet</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <SymbolView name="exclamationmark.triangle.fill" size={16} tintColor="#D97706" />
                      <ThemedText style={styles.offlineText}>Live prices and availability require internet</ThemedText>
                    </View>
                  </View>
                </>
              );
            })()}
          </View>
        ) : viewMode === 'budget' ? (
          <View style={styles.itinerary}>
            {(() => {
              // Midpoint estimates for totalling (honest approximation)
              const ACTIVITY_COST_MID: Record<string, number> = { free: 0, budget: 15, moderate: 40, premium: 100 };
              const estimatedActivityCost = currentTrip.activities.reduce(
                (sum, a) => sum + (ACTIVITY_COST_MID[a.cost ?? 'free'] ?? 0), 0
              );
              const expenses = currentTrip.expenses ?? [];
              const manualExpensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
              const budgetCurrency = currentTrip.budgetCurrency ?? 'USD';
              const currencySymbol = getCurrSymbol(budgetCurrency);
              // Only sum reservations in the same currency as the trip budget
              const activeReservations = (currentTrip.reservations ?? []).filter((r) => !r.cancelled && r.price != null && r.price > 0);
              const sameCurrencyRes = activeReservations.filter((r) => !r.currency || r.currency === budgetCurrency);
              const otherCurrencyRes = activeReservations.filter((r) => r.currency && r.currency !== budgetCurrency);
              const reservationCost = sameCurrencyRes.reduce((sum, r) => sum + (r.price ?? 0), 0);
              // Confirmed = reservations + manual expenses (real money committed)
              const confirmedSpent = reservationCost + manualExpensesTotal;
              // Projected = confirmed + activity estimates (honest projection, not actual spending)
              const projectedTotal = confirmedSpent + estimatedActivityCost;
              const budgetTotal = currentTrip.budgetTotal ?? 0;
              const remainingConfirmed = budgetTotal - confirmedSpent;
              const remainingProjected = budgetTotal - projectedTotal;
              const EXPENSE_CATEGORIES = ['Food', 'Transport', 'Activity', 'Accommodation', 'Other'];
              return (
                <>
                  {/* Currency selector */}
                  <View style={styles.budgetCurrencyRow}>
                    <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Currency</ThemedText>
                    <View style={styles.typeRow}>
                      {['USD', 'EUR', 'GBP', 'JPY'].map((cur) => (
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
                    </View>
                  </View>

                  {/* Total budget */}
                  <Pressable
                    onPress={() => { setEditBudgetTotal(true); setBudgetTotalInput(budgetTotal ? String(budgetTotal) : ''); }}
                    style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}
                    accessibilityRole="button"
                    accessibilityLabel="Set total budget"
                  >
                    <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Total budget</ThemedText>
                    <ThemedText style={styles.budgetAmount}>
                      {budgetTotal > 0 ? `${currencySymbol}${budgetTotal.toLocaleString()}` : 'Tap to set'}
                    </ThemedText>
                  </Pressable>

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

                  {/* Confirmed costs */}
                  {(reservationCost > 0 || manualExpensesTotal > 0) && (
                    <>
                      <ThemedText type="sectionTitle" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                        Confirmed
                      </ThemedText>
                      {reservationCost > 0 && (
                        <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}>
                          <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Bookings ({budgetCurrency})</ThemedText>
                          <ThemedText style={styles.budgetAmount}>{currencySymbol}{reservationCost.toLocaleString()}</ThemedText>
                        </View>
                      )}
                      {manualExpensesTotal > 0 && (
                        <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}>
                          <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Manual expenses</ThemedText>
                          <ThemedText style={styles.budgetAmount}>{currencySymbol}{manualExpensesTotal.toLocaleString()}</ThemedText>
                        </View>
                      )}
                      <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement, borderLeftWidth: 3, borderLeftColor: '#16A34A' }]}>
                        <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Confirmed subtotal</ThemedText>
                        <ThemedText style={styles.budgetAmount}>{currencySymbol}{(reservationCost + manualExpensesTotal).toLocaleString()}</ThemedText>
                      </View>
                    </>
                  )}

                  {otherCurrencyRes.length > 0 && (
                    <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Bookings (other currencies)</ThemedText>
                      {otherCurrencyRes.map((r) => (
                        <ThemedText key={r.id} style={[styles.budgetEstNote, { color: theme.text, marginTop: 4 }]}>
                          {r.title}: {getCurrSymbol(r.currency!)}{(r.price ?? 0).toLocaleString()} {r.currency}
                        </ThemedText>
                      ))}
                      <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary, marginTop: 6 }]}>
                        Not included in totals (different currency)
                      </ThemedText>
                    </View>
                  )}

                  {/* Estimated activity costs */}
                  <ThemedText type="sectionTitle" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                    Activity estimates
                  </ThemedText>
                  <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement, borderLeftWidth: 3, borderLeftColor: theme.textSecondary }]}>
                    <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Estimated activity costs</ThemedText>
                    <ThemedText style={[styles.budgetAmount, { fontStyle: 'italic', color: theme.textSecondary }]}>
                      ~{currencySymbol}{estimatedActivityCost.toLocaleString()}
                    </ThemedText>
                    <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary }]}>
                      Rough estimate based on cost tiers — not actual spending
                    </ThemedText>
                  </View>

                  {/* Budget vs confirmed */}
                  {budgetTotal > 0 && (
                    <>
                      <ThemedText type="sectionTitle" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                        Budget status
                      </ThemedText>
                      <View style={[styles.budgetCard, { backgroundColor: remainingConfirmed >= 0 ? theme.backgroundElement : 'rgba(220,38,38,0.08)' }]}>
                        <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Remaining (confirmed costs)</ThemedText>
                        <ThemedText style={[styles.budgetAmount, { color: remainingConfirmed >= 0 ? '#16A34A' : '#DC2626' }]}>
                          {remainingConfirmed >= 0 ? `${currencySymbol}${remainingConfirmed.toLocaleString()}` : `-${currencySymbol}${Math.abs(remainingConfirmed).toLocaleString()}`}
                        </ThemedText>
                        <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary }]}>
                          {currencySymbol}{budgetTotal.toLocaleString()} budget − {currencySymbol}{confirmedSpent.toLocaleString()} confirmed
                        </ThemedText>
                      </View>
                      {estimatedActivityCost > 0 && (
                        <View style={[styles.budgetCard, { backgroundColor: remainingProjected >= 0 ? theme.backgroundElement : 'rgba(220,38,38,0.08)', opacity: 0.85 }]}>
                          <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Projected remaining (incl. estimates)</ThemedText>
                          <ThemedText style={[styles.budgetAmount, { fontStyle: 'italic', color: remainingProjected >= 0 ? theme.textSecondary : '#DC2626' }]}>
                            ~{remainingProjected >= 0 ? `${currencySymbol}${remainingProjected.toLocaleString()}` : `-${currencySymbol}${Math.abs(remainingProjected).toLocaleString()}`}
                          </ThemedText>
                          <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary }]}>
                            Includes ~{currencySymbol}{estimatedActivityCost.toLocaleString()} estimated activity costs
                          </ThemedText>
                        </View>
                      )}
                    </>
                  )}

                  {/* Manual Expenses section */}
                  <ThemedText type="sectionTitle" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                    Manual expenses
                  </ThemedText>

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
                            Alert.alert(
                              'Delete expense?',
                              `Remove "${expense.label}"?`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: () => updateTripExpenses(currentTrip.id, expenses.filter((e) => e.id !== expense.id)),
                                },
                              ],
                            );
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
                            <Pressable onPress={() => setEditingExpenseId(null)} style={styles.editCancelBtn} accessibilityRole="button" accessibilityLabel="Cancel edit">
                              <ThemedText style={styles.editCancelText}>Cancel</ThemedText>
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                const label = editExpenseLabel.trim();
                                const amount = parseFloat(editExpenseAmount);
                                if (!label || isNaN(amount) || amount <= 0) return;
                                const dayNum = editExpenseDay ? parseInt(editExpenseDay, 10) : undefined;
                                const updated = expenses.map((e) =>
                                  e.id === expense.id
                                    ? { ...e, label, amount, category: editExpenseCategory, day: dayNum && !isNaN(dayNum) ? dayNum : undefined }
                                    : e
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

                  {expenses.length === 0 && (
                    <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary }]}>
                      No manual expenses yet. Add things like accommodation, transport, or dining costs.
                    </ThemedText>
                  )}

                  {/* Add expense form */}
                  {showAddExpense ? (
                    <Animated.View entering={FadeIn.duration(200)} style={[styles.addExpenseForm, { backgroundColor: theme.backgroundElement }]}>
                      <TextInput
                        style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                        value={newExpenseLabel}
                        onChangeText={setNewExpenseLabel}
                        placeholder="Expense label (e.g. Hotel night 1)"
                        placeholderTextColor={theme.textSecondary}
                        returnKeyType="next"
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
                          onPress={() => { setShowAddExpense(false); setNewExpenseLabel(''); setNewExpenseAmount(''); setNewExpenseCategory('Other'); setNewExpenseDay(''); }}
                          style={styles.editCancelBtn}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel expense"
                        >
                          <ThemedText style={styles.editCancelText}>Cancel</ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() => {
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
                  ) : (
                    <Pressable
                      onPress={() => setShowAddExpense(true)}
                      style={[styles.addLink, { marginBottom: 16 }]}
                      accessibilityRole="button"
                      accessibilityLabel="Add expense"
                    >
                      <ThemedText style={[styles.addLinkText, { color: theme.primary }]}>+ Add Expense</ThemedText>
                    </Pressable>
                  )}

                  {/* Per-day breakdown */}
                  <ThemedText type="sectionTitle" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                    Per-day breakdown (estimates)
                  </ThemedText>
                  {allDays.map((d) => {
                    const dayActs = (dayMap.get(d) ?? []);
                    const dayActCost = dayActs.reduce((s, a) => s + (ACTIVITY_COST_MID[a.cost ?? 'moderate'] ?? 35), 0);
                    const dayExpenses = expenses.filter((e) => e.day === d).reduce((s, e) => s + e.amount, 0);
                    const dayResCost = (currentTrip.reservations ?? [])
                      .filter((r) => !r.cancelled && r.day === d && (!r.currency || r.currency === budgetCurrency))
                      .reduce((s, r) => s + (r.price ?? 0), 0);
                    const dayCost = dayActCost + dayExpenses + dayResCost;
                    return (
                      <View key={d} style={[styles.budgetDayRow, { borderBottomColor: theme.border }]}>
                        <ThemedText style={styles.budgetDayLabel}>Day {d}</ThemedText>
                        <ThemedText style={styles.budgetDayAmount}>{currencySymbol}{dayCost}</ThemedText>
                        <ThemedText style={[styles.budgetDayCount, { color: theme.textSecondary }]}>
                          {dayActs.length} {dayActs.length === 1 ? 'activity' : 'activities'}
                        </ThemedText>
                      </View>
                    );
                  })}
                </>
              );
            })()}
          </View>
        ) : viewMode === 'reservations' ? (
          <View style={styles.itinerary}>
            {/* Progress summary */}
            {(() => {
              const readiness = getTripReadiness(currentTrip.activities);
              if (readiness.total === 0) return null;
              const pct = readiness.percentage;
              const barColor = pct === 100 ? '#10B981' : theme.primary;
              return (
                <View style={[styles.bookingSummary, { backgroundColor: theme.backgroundElement }]}>
                  <View style={styles.bookingSummaryRow}>
                    <ThemedText style={styles.bookingSummaryTitle}>
                      {pct === 100 ? 'All booked!' : `${readiness.booked} of ${readiness.total} booked`}
                    </ThemedText>
                    <ThemedText style={[styles.bookingSummaryPct, { color: barColor }]}>{pct}%</ThemedText>
                  </View>
                  <View style={[styles.bookingSummaryTrack, { backgroundColor: theme.border }]}>
                    <View style={[styles.bookingSummaryFill, { width: `${pct}%`, backgroundColor: barColor }]} />
                  </View>
                  {readiness.pending > 0 && (
                    <ThemedText style={[styles.bookingSummaryMeta, { color: theme.textSecondary }]}>
                      {readiness.pending} pending confirmation
                    </ThemedText>
                  )}
                </View>
              );
            })()}

            {/* View all bookings link */}
            <Pressable
              onPress={() => router.push('/bookings' as any)}
              style={[styles.viewAllBookingsBtn, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel="View all bookings"
            >
              <SymbolView name="doc.text.fill" size={16} tintColor={theme.primary} />
              <ThemedText style={[styles.viewAllBookingsText, { color: theme.primary }]}>View all bookings</ThemedText>
              <SymbolView name="chevron.right" size={12} tintColor={theme.primary} />
            </Pressable>

            {/* Grouped sections by type */}
            {(() => {
              const typeSymbol: Record<string, string> = {
                hotel: 'bed.double.fill',
                flight: 'airplane',
                food: 'fork.knife',
                activity: 'star.fill',
                train: 'tram.fill',
                other: 'doc.text.fill',
              };
              const typeLabel: Record<string, string> = {
                hotel: 'Hotels',
                flight: 'Flights',
                food: 'Restaurants',
                activity: 'Activities',
                train: 'Transport',
                other: 'Other',
              };
              // Map reservation types to activity types for grouping
              const resToActivityType: Record<ReservationType, string> = {
                hotel: 'hotel',
                flight: 'flight',
                restaurant: 'food',
                activity: 'activity',
                train: 'train',
                other: 'other',
              };

              // Get bookable activities
              const bookableActivities = currentTrip.activities.filter(isBookableActivity);

              // Build sections: group activities and reservations by type
              const sectionOrder = ['hotel', 'flight', 'food', 'activity', 'train', 'other'];
              const reservations = currentTrip.reservations ?? [];

              return sectionOrder.map((sectionType) => {
                const sectionActivities = bookableActivities.filter((a) => a.type === sectionType);
                const sectionReservations = reservations.filter((r) => resToActivityType[r.type] === sectionType && !sectionActivities.some((a) => a.reservationId === r.id));
                const totalItems = sectionActivities.length + sectionReservations.length;
                if (totalItems === 0) return null;

                const bookedCount = sectionActivities.filter((a) => a.bookingStatus === 'booked').length + sectionReservations.filter((r) => !r.cancelled).length;

                return (
                  <View key={sectionType} style={styles.bookingSection}>
                    {/* Section header */}
                    <View style={styles.bookingSectionHeader}>
                      <SymbolView name={typeSymbol[sectionType] as any} size={18} tintColor={theme.textSecondary} />
                      <ThemedText style={styles.bookingSectionTitle}>{typeLabel[sectionType]}</ThemedText>
                      <ThemedText style={[styles.bookingSectionCount, { color: theme.textSecondary }]}>
                        {bookedCount}/{totalItems}
                      </ThemedText>
                    </View>

                    {/* Activity items in this section */}
                    {sectionActivities
                      .sort((a, b) => a.day - b.day)
                      .map((activity) => {
                        const linkedRes = activity.reservationId
                          ? reservations.find((r) => r.id === activity.reservationId)
                          : undefined;
                        const isBooked = activity.bookingStatus === 'booked';
                        const isPending = activity.bookingStatus === 'pending';
                        return (
                          <View key={activity.id} style={[styles.bookingItemCard, { backgroundColor: theme.backgroundElement }]}>
                            <View style={styles.bookingItemRow}>
                              <View style={[styles.bookingStatusDot, { backgroundColor: isBooked ? '#10B981' : isPending ? '#F59E0B' : theme.border }]} />
                              <View style={styles.bookingItemInfo}>
                                <ThemedText style={styles.bookingItemTitle}>{activity.title}</ThemedText>
                                <ThemedText style={[styles.bookingItemMeta, { color: theme.textSecondary }]}>
                                  Day {activity.day} · {formatTimeDisplay(activity.time)}
                                  {linkedRes?.confirmationNumber ? ` · ${linkedRes.confirmationNumber}` : ''}
                                </ThemedText>
                                {linkedRes?.price != null && (
                                  <ThemedText style={[styles.bookingItemMeta, { color: theme.textSecondary }]}>
                                    {getCurrSymbol(linkedRes.currency ?? 'USD')}{linkedRes.price.toLocaleString()}
                                  </ThemedText>
                                )}
                                {linkedRes?.notes ? (
                                  <ThemedText style={[styles.bookingItemNotes, { color: theme.textSecondary }]}>{linkedRes.notes}</ThemedText>
                                ) : null}
                              </View>

                              {/* Right side action */}
                              {isBooked && linkedRes ? (
                                <View style={styles.bookingItemActions}>
                                  <Pressable
                                    onPress={() => {
                                      setEditingReservation(linkedRes);
                                      setResType(linkedRes.type);
                                      setResTitle(linkedRes.title);
                                      setResDay(linkedRes.day != null ? String(linkedRes.day) : '');
                                      setResTime(linkedRes.time ?? '');
                                      setResConfirmation(linkedRes.confirmationNumber ?? '');
                                      setResBookingUrl(linkedRes.bookingUrl ?? '');
                                      setResPrice(linkedRes.price != null ? String(linkedRes.price) : '');
                                      setResNotes(linkedRes.notes ?? '');
                                      setResAddress(linkedRes.address ?? '');
                                      setResCurrency(linkedRes.currency ?? 'USD');
                                      setResDate(linkedRes.date ?? '');
                                      setResEntryMode('manual');
                                      setResLinkUrl('');
                                      setResLinkError('');
                                      setResCheckoutDate('');
                                      setShowAddReservationModal(true);
                                    }}
                                    hitSlop={8}
                                    style={styles.reservationActionBtn}
                                    accessibilityRole="button"
                                    accessibilityLabel="Edit booking details"
                                  >
                                    <SymbolView name="pencil" size={14} tintColor={theme.textSecondary} />
                                  </Pressable>
                                  {linkedRes.bookingUrl ? (
                                    <Pressable
                                      onPress={() => { if (linkedRes.bookingUrl) Linking.openURL(linkedRes.bookingUrl); }}
                                      hitSlop={8}
                                      style={styles.reservationActionBtn}
                                      accessibilityRole="button"
                                      accessibilityLabel="Open booking link"
                                    >
                                      <SymbolView name={"arrow.up.right.square" as any} size={14} tintColor={theme.primary} />
                                    </Pressable>
                                  ) : null}
                                </View>
                              ) : isBooked ? (
                                <View style={styles.bookingItemActions}>
                                  <SymbolView name={"checkmark.circle.fill" as any} size={18} tintColor="#10B981" />
                                </View>
                              ) : (
                                <View style={styles.bookingItemPlatforms}>
                                  {getBookingLinks(activity, currentTrip.startDate, currentTrip.endDate, currentTrip.destination, currentTrip.travelers)
                                    .filter((l) => l.platform !== 'google_maps')
                                    .slice(0, 2)
                                    .map((link) => (
                                      <Pressable
                                        key={link.platform}
                                        onPress={() => openBookingLink(link.url)}
                                        style={({ pressed }) => [
                                          styles.bookingItemBookBtn,
                                          { borderColor: theme.primary + '40' },
                                          pressed && { opacity: 0.7 },
                                        ]}
                                        accessibilityRole="button"
                                        accessibilityLabel={link.label}
                                      >
                                        <ThemedText style={[styles.bookingItemBookText, { color: theme.primary }]}>
                                          {platformDisplayName(link.platform)}
                                        </ThemedText>
                                      </Pressable>
                                    ))}
                                  {getBookingLinks(activity, currentTrip.startDate, currentTrip.endDate, currentTrip.destination, currentTrip.travelers)
                                    .filter((l) => l.platform !== 'google_maps').length === 0 && (
                                    <Pressable
                                      onPress={() => handleBookActivity(activity)}
                                      style={({ pressed }) => [
                                        styles.bookingItemBookBtn,
                                        { borderColor: theme.primary + '40' },
                                        pressed && { opacity: 0.7 },
                                      ]}
                                      accessibilityRole="button"
                                      accessibilityLabel={`Book ${activity.title}`}
                                    >
                                      <ThemedText style={[styles.bookingItemBookText, { color: theme.primary }]}>
                                        {getBookLabel(activity)}
                                      </ThemedText>
                                    </Pressable>
                                  )}
                                </View>
                              )}
                            </View>
                          </View>
                        );
                      })}

                    {/* Standalone reservations (not linked to an activity) */}
                    {sectionReservations.map((res) => (
                      <View key={res.id} style={[styles.bookingItemCard, { backgroundColor: theme.backgroundElement }]}>
                        <View style={styles.bookingItemRow}>
                          <View style={[styles.bookingStatusDot, { backgroundColor: res.cancelled ? theme.border : '#10B981' }]} />
                          <View style={styles.bookingItemInfo}>
                            <ThemedText style={[styles.bookingItemTitle, res.cancelled && { textDecorationLine: 'line-through', opacity: 0.5 }]}>
                              {res.title}{res.cancelled ? ' (cancelled)' : ''}
                            </ThemedText>
                            <ThemedText style={[styles.bookingItemMeta, { color: theme.textSecondary }]}>
                              {res.day != null ? `Day ${res.day}` : ''}{res.time ? ` · ${formatTimeDisplay(res.time)}` : ''}
                              {res.confirmationNumber ? ` · ${res.confirmationNumber}` : ''}
                            </ThemedText>
                            {res.price != null && (
                              <ThemedText style={[styles.bookingItemMeta, { color: theme.textSecondary }]}>
                                {getCurrSymbol(res.currency ?? 'USD')}{res.price.toLocaleString()}
                              </ThemedText>
                            )}
                            {res.notes ? (
                              <ThemedText style={[styles.bookingItemNotes, { color: theme.textSecondary }]}>{res.notes}</ThemedText>
                            ) : null}
                          </View>
                          <View style={styles.bookingItemActions}>
                            <Pressable
                              onPress={() => {
                                setEditingReservation(res);
                                setResType(res.type);
                                setResTitle(res.title);
                                setResDay(res.day != null ? String(res.day) : '');
                                setResTime(res.time ?? '');
                                setResConfirmation(res.confirmationNumber ?? '');
                                setResBookingUrl(res.bookingUrl ?? '');
                                setResPrice(res.price != null ? String(res.price) : '');
                                setResNotes(res.notes ?? '');
                                setResAddress(res.address ?? '');
                                setResCurrency(res.currency ?? 'USD');
                                setResDate(res.date ?? '');
                                setResEntryMode('manual');
                                setResLinkUrl('');
                                setResLinkError('');
                                setResCheckoutDate('');
                                setShowAddReservationModal(true);
                              }}
                              hitSlop={8}
                              style={styles.reservationActionBtn}
                              accessibilityRole="button"
                              accessibilityLabel="Edit booking"
                            >
                              <SymbolView name="pencil" size={14} tintColor={theme.textSecondary} />
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                Alert.alert('Remove booking?', `Remove "${res.title}"?`, [
                                  { text: 'Cancel', style: 'cancel' },
                                  { text: 'Remove', style: 'destructive', onPress: () => { removeReservation(currentTrip.id, res.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } },
                                ]);
                              }}
                              hitSlop={8}
                              style={styles.reservationActionBtn}
                              accessibilityRole="button"
                              accessibilityLabel="Remove booking"
                            >
                              <SymbolView name="xmark" size={14} tintColor={theme.textSecondary} />
                            </Pressable>
                            {res.bookingUrl ? (
                              <Pressable
                                onPress={() => { if (res.bookingUrl) Linking.openURL(res.bookingUrl); }}
                                hitSlop={8}
                                style={styles.reservationActionBtn}
                                accessibilityRole="button"
                                accessibilityLabel="Open booking link"
                              >
                                <SymbolView name={"arrow.up.right.square" as any} size={14} tintColor={theme.primary} />
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                );
              });
            })()}

            {/* Empty state */}
            {getTripReadiness(currentTrip.activities).total === 0 && (currentTrip.reservations ?? []).length === 0 && (
              <View style={styles.reservationsEmpty}>
                <ThemedText style={[styles.reservationsEmptyText, { color: theme.textSecondary }]}>
                  No bookable activities yet. Add hotels, flights, restaurants, and activities to your itinerary to start booking.
                </ThemedText>
              </View>
            )}

            <Pressable
              onPress={() => {
                setEditingReservation(null);
                setResType('restaurant');
                setResTitle('');
                setResDay('');
                setResTime('');
                setResConfirmation('');
                setResBookingUrl('');
                setResPrice('');
                setResNotes('');
                setResAddress('');
                setResCurrency('USD');
                setResDate('');
                setResEntryMode('choose');
                setResLinkUrl('');
                setResLinkError('');
                setResCheckoutDate('');
                setShowAddReservationModal(true);
              }}
              style={[styles.addResBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Add booking manually"
            >
              <ThemedText style={[styles.addResBtnText, { color: theme.primaryText }]}>+ Add Booking</ThemedText>
            </Pressable>
          </View>
        ) : viewMode === 'members' ? (
          <View style={styles.itinerary}>
            {/* Current members */}
            <ThemedText type="sectionTitle" style={{ color: theme.textSecondary, marginBottom: 8 }}>Members</ThemedText>
            {(currentTrip.members ?? []).length === 0 ? (
              <ThemedText style={[{ fontSize: 14, color: theme.textSecondary, marginBottom: 12 }]}>
                No members yet. You are the owner of this trip.
              </ThemedText>
            ) : (
              (currentTrip.members ?? []).map((member: TripMember) => (
                <View key={member.id} style={[styles.memberRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <View style={styles.memberRowLeft}>
                    <ThemedText style={styles.memberName}>{member.name}</ThemedText>
                    <View style={[styles.memberRoleBadge, { backgroundColor: member.role === 'owner' ? theme.primaryMuted : theme.backgroundElement, borderColor: member.role === 'owner' ? theme.primary : theme.border }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        {member.role === 'owner' && <SymbolView name="star.fill" size={12} tintColor={theme.primary} />}
                        <ThemedText style={[styles.memberRoleText, { color: member.role === 'owner' ? theme.primary : theme.textSecondary }]}>
                          {member.role === 'owner' ? 'Owner' : member.role === 'member' ? 'Member' : 'Viewer'}
                        </ThemedText>
                      </View>
                    </View>
                    {member.joinedAt && (
                      <ThemedText style={[{ fontSize: 11, color: theme.textSecondary }]}>
                        Joined {new Date(member.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </ThemedText>
                    )}
                  </View>
                  {member.role !== 'owner' && (
                    <Pressable
                      onPress={() => {
                        Alert.alert('Remove member?', `Remove ${member.name} from this trip?`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => removeMember(currentTrip.id, member.id) },
                        ]);
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${member.name}`}
                    >
                      <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
                    </Pressable>
                  )}
                </View>
              ))
            )}

            {/* Pending invitations */}
            {((currentTrip.invitations ?? []).filter((i: Invitation) => i.status === 'pending')).length > 0 && (
              <>
                <ThemedText type="sectionTitle" style={{ color: theme.textSecondary, marginTop: 20, marginBottom: 8 }}>Pending Invitations</ThemedText>
                {(currentTrip.invitations ?? []).filter((i: Invitation) => i.status === 'pending').map((inv: Invitation) => (
                  <View key={inv.id} style={[styles.memberRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <View style={styles.memberRowLeft}>
                      <ThemedText style={styles.memberName}>{inv.name}</ThemedText>
                      <ThemedText style={[{ fontSize: 13, color: theme.textSecondary }]}>{inv.contact}</ThemedText>
                      {inv.inviteCode && (
                        <View style={[styles.inviteCodeBox, { backgroundColor: theme.primaryMuted, borderColor: theme.primary }]}>
                          <ThemedText style={[{ fontSize: 12, color: theme.textSecondary }]}>Invite code:</ThemedText>
                          <ThemedText style={[{ fontSize: 15, fontWeight: '700', color: theme.primary, letterSpacing: 1 }]}>{inv.inviteCode}</ThemedText>
                          <ThemedText style={[{ fontSize: 11, color: theme.textSecondary }]}>{"Share this code with your travel companion. They'll need it to join this trip."}</ThemedText>
                        </View>
                      )}
                    </View>
                    <View style={[styles.memberRoleBadge, { borderColor: theme.border }]}>
                      <ThemedText style={[styles.memberRoleText, { color: theme.textSecondary }]}>{inv.role ?? 'member'}</ThemedText>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Invite someone */}
            <ThemedText type="sectionTitle" style={{ color: theme.textSecondary, marginTop: 20, marginBottom: 8 }}>Invite a Travel Companion</ThemedText>
            <View style={[styles.inviteForm, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={styles.modalLabel}>Name</ThemedText>
              <TextInput
                style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                value={inviteName}
                onChangeText={setInviteName}
                placeholder="Their name"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Invite name"
              />
              <ThemedText style={styles.modalLabel}>Email or phone</ThemedText>
              <TextInput
                style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                value={inviteContact}
                onChangeText={setInviteContact}
                placeholder="email@example.com or +1 555..."
                placeholderTextColor={theme.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                accessibilityLabel="Invite contact"
              />
              <ThemedText style={styles.modalLabel}>Role</ThemedText>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                {(['member', 'viewer'] as const).map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setInviteRole(r)}
                    style={[
                      styles.typeChip,
                      { backgroundColor: inviteRole === r ? theme.primary : 'transparent', borderWidth: 1, borderColor: inviteRole === r ? theme.primary : theme.border },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Role: ${r}`}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <SymbolView name={r === 'member' ? 'pencil' : 'eye'} size={14} tintColor={inviteRole === r ? theme.primaryText : theme.text} />
                      <ThemedText style={[styles.typeText, inviteRole === r && { color: theme.primaryText }]}>
                        {r === 'member' ? 'Member' : 'Viewer'}
                      </ThemedText>
                    </View>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => {
                  if (!inviteName.trim() || !inviteContact.trim()) return;
                  addInvitation(currentTrip.id, { name: inviteName.trim(), contact: inviteContact.trim(), role: inviteRole, status: 'pending' });
                  // Find the just-added invitation to get its invite code
                  const freshTrip = getTrip(currentTrip.id);
                  const pendingInvs = (freshTrip?.invitations ?? []).filter((i: Invitation) => i.status === 'pending');
                  const newest = pendingInvs[pendingInvs.length - 1];
                  setLastInviteCode(newest?.inviteCode ?? '');
                  setInviteName('');
                  setInviteContact('');
                  setInviteRole('member');
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  showToast('Invitation created!');
                }}
                style={[styles.addSaveBtn, { backgroundColor: theme.primary, opacity: inviteName.trim() && inviteContact.trim() ? 1 : 0.4, marginTop: 8 }]}
                disabled={!inviteName.trim() || !inviteContact.trim()}
                accessibilityRole="button"
                accessibilityLabel="Generate invite code"
              >
                <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>Generate Invite Code</ThemedText>
              </Pressable>
              {lastInviteCode ? (
                <Animated.View entering={FadeIn.duration(300)} style={[styles.inviteCodeBox, { backgroundColor: theme.primaryMuted, borderColor: theme.primary, marginTop: 12 }]}>
                  <ThemedText style={[{ fontSize: 12, color: theme.textSecondary }]}>Invitation created! Invite code:</ThemedText>
                  <ThemedText style={[{ fontSize: 18, fontWeight: '700', color: theme.primary, letterSpacing: 1.5 }]}>{lastInviteCode}</ThemedText>
                  <ThemedText style={[{ fontSize: 12, color: theme.textSecondary }]}>
                    {"Share this code with your travel companion. They'll need it to join this trip."}
                  </ThemedText>
                </Animated.View>
              ) : null}
            </View>
          </View>
        ) : (
          <TripMap
            activities={currentTrip.activities}
            destination={currentTrip.destination}
            totalDays={totalDays}
          />
        )}
      </ScrollView>
      )}

      {/* Floating chat bar — always visible at bottom on itinerary */}
      {viewMode === 'itinerary' && !aiEditLoading && (
        <Pressable
          onPress={() => router.push(`/(tabs)/chat?tripId=${id}` as any)}
          style={[styles.floatingChatPill, { bottom: insets.bottom + 12, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Chat with AI about your trip"
        >
          <SymbolView name="bubble.left.fill" size={16} tintColor={theme.primary} />
          <ThemedText style={[styles.floatingAIPlaceholder, { color: theme.textSecondary }]}>Chat with AI...</ThemedText>
        </Pressable>
      )}

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
        onReplace={(a) => handleReplace(a.id)}
        onMove={(a) => handleOpenMoveActivity(a)}
        onEdit={(a) => handleStartEdit(a)}
        onCustomize={(a) => {
          setCustomizeTarget(a);
          setSelectedDay(a.day);
          setAskVisible(true);
        }}
        onLock={handleContextLock}
        onRemove={handleContextRemove}
        onReaction={handleActivityReaction}
      />

      <AskTravonal
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
            <ThemedText style={styles.modalLabel}>Time & Duration</ThemedText>
            <TimePickerButton
              value={manualReplaceTime}
              onChange={setManualReplaceTime}
              showDuration
              duration={manualReplaceDuration}
              onDurationChange={setManualReplaceDuration}
            />
            {manualReplaceName.trim() ? (
              <View style={[styles.replacePreview, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <ThemedText style={{ fontSize: 12, fontWeight: '700', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Preview</ThemedText>
                <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>{manualReplaceName.trim()}</ThemedText>
                <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>
                  Day {manualReplaceTarget?.day} at {formatTimeDisplay(manualReplaceTime)} · {manualReplaceDuration} min
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

      {/* Trip Edit Modal */}
      <Modal visible={showTripEdit} transparent animationType="fade" onRequestClose={() => {
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.modalBackdrop} onPress={() => {
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
        }} accessibilityRole="button" accessibilityLabel="Close">
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.background }]} onPress={() => Keyboard.dismiss()} accessibilityRole="button" accessibilityLabel="Edit trip dialog">
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <ThemedText type="subtitle" style={styles.modalTitle}>Edit trip</ThemedText>

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

            <ThemedText style={styles.modalLabel}>Travelers</ThemedText>
            <TextInput
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={editTravelers}
              onChangeText={(text) => {
                const num = text.replace(/[^0-9]/g, '');
                const val = parseInt(num, 10);
                if (num === '' || (val >= 1 && val <= 20)) setEditTravelers(num);
              }}
              placeholder="Number of travelers"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              accessibilityLabel="Number of travelers"
            />

            <ThemedText style={styles.modalLabel}>Departing from</ThemedText>
            <TextInput
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={editDepartureFrom}
              onChangeText={setEditDepartureFrom}
              placeholder="e.g. New York"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Departing from"
            />

            <ThemedText style={styles.modalLabel}>Budget</ThemedText>
            <View style={styles.editChipRow}>
              {(['budget', 'moderate', 'premium'] as const).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setEditBudget(v)}
                  style={[styles.editChip, { backgroundColor: editBudget === v ? theme.primary : theme.backgroundElement, borderColor: editBudget === v ? theme.primary : theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${v} budget`}
                >
                  <ThemedText style={[styles.editChipText, editBudget === v && { color: theme.primaryText }]}>{v.charAt(0).toUpperCase() + v.slice(1)}</ThemedText>
                </Pressable>
              ))}
            </View>

            <ThemedText style={styles.modalLabel}>Pace</ThemedText>
            <View style={styles.editChipRow}>
              {(['relaxed', 'moderate', 'active'] as const).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setEditPace(v)}
                  style={[styles.editChip, { backgroundColor: editPace === v ? theme.primary : theme.backgroundElement, borderColor: editPace === v ? theme.primary : theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${v} pace`}
                >
                  <ThemedText style={[styles.editChipText, editPace === v && { color: theme.primaryText }]}>{v.charAt(0).toUpperCase() + v.slice(1)}</ThemedText>
                </Pressable>
              ))}
            </View>

            <ThemedText style={styles.modalLabel}>Traveling with</ThemedText>
            <View style={styles.editChipRow}>
              {(['solo', 'partner', 'family', 'friends', 'group'] as const).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setEditTravelWith(v)}
                  style={[styles.editChip, { backgroundColor: editTravelWith === v ? theme.primary : theme.backgroundElement, borderColor: editTravelWith === v ? theme.primary : theme.border }]}
                >
                  <ThemedText style={[styles.editChipText, editTravelWith === v && { color: theme.primaryText }]}>{v.charAt(0).toUpperCase() + v.slice(1)}</ThemedText>
                </Pressable>
              ))}
            </View>

            <ThemedText style={styles.modalLabel}>Restrictions / accessibility</ThemedText>
            <TextInput
              style={[styles.modalInput, styles.modalInputMulti, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={editRestrictions}
              onChangeText={setEditRestrictions}
              placeholder="e.g. Wheelchair access needed, no stairs..."
              placeholderTextColor={theme.textSecondary}
              multiline
              textAlignVertical="top"
              returnKeyType="done"
              blurOnSubmit
              accessibilityLabel="Trip restrictions and accessibility needs"
            />

            <ThemedText style={styles.modalLabel}>Special instructions</ThemedText>
            <TextInput
              style={[styles.modalInput, styles.modalInputMulti, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={editTripInstructions}
              onChangeText={setEditTripInstructions}
              placeholder="e.g. Prefer walking routes, avoid tourist traps..."
              placeholderTextColor={theme.textSecondary}
              multiline
              textAlignVertical="top"
              returnKeyType="done"
              blurOnSubmit
              accessibilityLabel="Trip special instructions"
            />

            <ThemedText style={styles.modalLabel}>Notes</ThemedText>
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
            </ScrollView>

            {/* Buttons outside ScrollView so keyboard never covers them */}
            <View style={styles.modalBtnRow}>
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
              }} style={[styles.modalBtnSecondary, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="Cancel trip edit">
                <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
              </Pressable>
              <Pressable onPress={() => { Keyboard.dismiss(); handleSaveTripEdit(); }} style={[styles.modalBtnPrimary, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel="Save trip details">
                <ThemedText style={{ color: theme.primaryText, fontSize: 15, fontWeight: '600' }}>Save</ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
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

      {/* Move Activity Modal */}
      <Modal visible={!!movingActivity} transparent animationType="fade" onRequestClose={() => setMovingActivity(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMovingActivity(null)} accessibilityRole="button" accessibilityLabel="Close">
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()}>
            <ThemedText type="subtitle" style={styles.modalTitle}>Move activity</ThemedText>
            {movingActivity && (
              <ThemedText style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                {movingActivity.title}
              </ThemedText>
            )}
            <ThemedText style={styles.modalLabel}>Day</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moveDayRow}>
              {allDays.map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setMoveDay(d)}
                  style={[styles.moveDayChip, { backgroundColor: moveDay === d ? theme.primary : theme.backgroundElement }]}
                >
                  <ThemedText style={[styles.moveDayText, moveDay === d && { color: theme.primaryText }]}>Day {d}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
            <ThemedText style={styles.modalLabel}>Time</ThemedText>
            <TimePickerButton
              value={moveTime}
              onChange={setMoveTime}
            />
            <View style={styles.modalBtnRow}>
              <Pressable onPress={() => setMovingActivity(null)} style={[styles.modalBtnSecondary, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="Cancel move">
                <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
              </Pressable>
              <Pressable onPress={handleConfirmMove} style={[styles.modalBtnPrimary, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel="Confirm move activity">
                <ThemedText style={{ color: theme.primaryText, fontSize: 15, fontWeight: '600' }}>Move</ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add Activity Modal (Task 1) */}
      <Modal
        visible={addingToDay !== null}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setAddingToDay(null)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.addModal, { backgroundColor: theme.background }]}>
            <View style={[styles.addModalHeader, { borderBottomColor: theme.border }]}>
              <ThemedText style={styles.addModalTitle}>Add to Day {addingToDay}</ThemedText>
              <Pressable onPress={() => setAddingToDay(null)} hitSlop={8} style={styles.addModalClose} accessibilityRole="button" accessibilityLabel="Close">
                <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={[styles.addForm, { backgroundColor: theme.background, paddingBottom: 40 }]}
              keyboardShouldPersistTaps="handled"
            >
              <TextInput
                style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="Activity name"
                placeholderTextColor={theme.textSecondary}
                autoFocus
                accessibilityLabel="Activity name"
              />
              <View style={styles.addRow}>
                <TimePickerButton
                  value={newTime}
                  onChange={setNewTime}
                  showDuration
                  duration={newDuration}
                  onDurationChange={setNewDuration}
                />
              </View>
              <View style={styles.typeRow}>
                {(['activity', 'food', 'hotel', 'flight'] as const).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => {
                      setNewType(t);
                      // Use smart time suggestion based on existing activities
                      const smartTime = addingToDay
                        ? suggestTimeForActivity(currentTrip.activities, addingToDay, t)
                        : defaultTimeForType(t);
                      setNewTime(smartTime);
                      setNewDuration(defaultDurationForType(t));
                    }}
                    style={[
                      styles.typeChip,
                      { backgroundColor: newType === t ? theme.primary : 'transparent', borderWidth: 1, borderColor: newType === t ? theme.primary : theme.border },
                    ]}
                  >
                    <ThemedText style={[styles.typeText, newType === t && { color: theme.primaryText }]}>
                      {t}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <View style={styles.editChipRow}>
                {(['free', 'budget', 'moderate', 'premium'] as const).map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setNewCost(newCost === c ? '' : c)}
                    style={[styles.editChip, { backgroundColor: newCost === c ? theme.primary : theme.backgroundElement, borderColor: newCost === c ? theme.primary : theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Cost: ${c}`}
                  >
                    <ThemedText style={[styles.editChipText, newCost === c && { color: theme.primaryText }]}>{c}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                value={newAddress}
                onChangeText={setNewAddress}
                placeholder="Address (optional)"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Activity address"
              />
              <TextInput
                style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                value={newActivityNotes}
                onChangeText={setNewActivityNotes}
                placeholder="Notes (optional)"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Activity notes"
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                <ThemedText style={{ fontSize: 14, fontWeight: '600' }}>Fixed (cannot be moved)</ThemedText>
                <Switch
                  value={newFixed}
                  onValueChange={setNewFixed}
                  trackColor={{ false: 'rgba(128,128,128,0.2)', true: '#10B981' }}
                  accessibilityLabel="Mark as fixed activity"
                />
              </View>
              <Pressable
                onPress={() => {
                  setAddingToDay(null);
                  router.push({ pathname: '/(tabs)/explore', params: { tripId: id, day: String(addingToDay) } } as any);
                }}
                style={[styles.discoverBtn, { borderColor: theme.border }]}
                accessibilityRole="button"
                accessibilityLabel="Discover place in Explore"
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <SymbolView name="magnifyingglass" size={13} tintColor={theme.primary} />
                  <ThemedText style={[styles.discoverBtnText, { color: theme.primary }]}>
                    Discover a place in Explore
                  </ThemedText>
                </View>
              </Pressable>
              <Pressable
                onPress={() => { if (addingToDay !== null) handleAddActivity(addingToDay); }}
                style={[styles.addSaveBtn, { backgroundColor: theme.primary, opacity: newTitle.trim() ? 1 : 0.4 }]}
                disabled={!newTitle.trim()}
                accessibilityRole="button"
                accessibilityLabel="Add activity"
              >
                <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>Add Activity</ThemedText>
              </Pressable>
            </ScrollView>
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

      {/* Add / Edit Reservation Modal */}
      <Modal
        visible={showAddReservationModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowAddReservationModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.addModal, { backgroundColor: theme.background }]}>
            <View style={[styles.addModalHeader, { borderBottomColor: theme.border }]}>
              <ThemedText style={styles.addModalTitle}>
                {editingReservation ? 'Edit Reservation' : resEntryMode === 'choose' ? 'Add Reservation' : resEntryMode === 'link' ? 'From Booking Link' : 'Reservation Details'}
              </ThemedText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {!editingReservation && resEntryMode !== 'choose' && (
                  <Pressable onPress={() => setResEntryMode('choose')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <SymbolView name="chevron.left" size={14} tintColor={theme.primary} />
                    <ThemedText style={[{ fontSize: 14, color: theme.primary, fontWeight: '600' }]}>Back</ThemedText>
                  </Pressable>
                )}
                <Pressable onPress={() => setShowAddReservationModal(false)} hitSlop={8} style={styles.addModalClose} accessibilityRole="button" accessibilityLabel="Close">
                  <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
                </Pressable>
              </View>
            </View>

            {/* STEP 1: Choose path (new reservation only) */}
            {!editingReservation && resEntryMode === 'choose' && (
              <View style={{ padding: 24, gap: 16 }}>
                <ThemedText style={[{ fontSize: 15, color: theme.textSecondary, textAlign: 'center' }]}>
                  How would you like to add this reservation?
                </ThemedText>
                <Pressable
                  onPress={() => setResEntryMode('link')}
                  style={({ pressed }) => [
                    styles.resChoiceBtn,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="From booking link"
                >
                  <View style={styles.resChoiceBtnIcon}><SymbolView name="link" size={24} tintColor={theme.text} /></View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.resChoiceBtnTitle}>From Booking Link</ThemedText>
                    <ThemedText style={[styles.resChoiceBtnDesc, { color: theme.textSecondary }]}>
                      Paste a URL and AI will extract reservation details
                    </ThemedText>
                  </View>
                  <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
                </Pressable>
                <Pressable
                  onPress={() => setResEntryMode('manual')}
                  style={({ pressed }) => [
                    styles.resChoiceBtn,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Enter manually"
                >
                  <View style={styles.resChoiceBtnIcon}><SymbolView name="pencil" size={24} tintColor={theme.text} /></View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.resChoiceBtnTitle}>Enter Manually</ThemedText>
                    <ThemedText style={[styles.resChoiceBtnDesc, { color: theme.textSecondary }]}>
                      Fill in the details yourself
                    </ThemedText>
                  </View>
                  <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
                </Pressable>
              </View>
            )}

            {/* STEP 2A: Booking link path */}
            {!editingReservation && resEntryMode === 'link' && (
              <ScrollView
                contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
              >
                <ThemedText style={[styles.modalLabel, { marginTop: 0 }]}>Booking URL</ThemedText>
                <TextInput
                  style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={resLinkUrl}
                  onChangeText={setResLinkUrl}
                  placeholder="https://booking.com/..."
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoFocus
                  accessibilityLabel="Booking URL"
                />
                {resLinkError ? (
                  <ThemedText style={[{ fontSize: 13, color: theme.danger ?? '#EF4444' }]}>{resLinkError}</ThemedText>
                ) : null}
                <Pressable
                  onPress={async () => {
                    const url = resLinkUrl.trim();
                    if (!url) return;
                    setResLinkLoading(true);
                    setResLinkError('');
                    try {
                      const result = await importPlaceAI({ content: url, contentType: 'url' });
                      setResTitle(result.name || '');
                      setResAddress(result.location || '');
                      setResNotes(result.description || '');
                      setResBookingUrl(url);
                      setResEntryMode('manual');
                    } catch {
                      setResLinkError('Could not extract details. You can fill them in manually.');
                    } finally {
                      setResLinkLoading(false);
                    }
                  }}
                  style={[styles.addSaveBtn, { backgroundColor: theme.primary, opacity: resLinkUrl.trim() && !resLinkLoading ? 1 : 0.4 }]}
                  disabled={!resLinkUrl.trim() || resLinkLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Extract reservation info"
                >
                  <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>
                    {resLinkLoading ? 'Extracting...' : 'Extract Info'}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => { setResBookingUrl(resLinkUrl.trim()); setResEntryMode('manual'); }}
                  style={[styles.resCancelBtn, { borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Skip and enter manually"
                >
                  <ThemedText style={[styles.resCancelBtnText, { color: theme.textSecondary }]}>Skip — enter details manually</ThemedText>
                </Pressable>
              </ScrollView>
            )}

            {/* STEP 2B: Manual entry (also used when editing) */}
            {(editingReservation || resEntryMode === 'manual') && (
              <ScrollView
                contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
              >
                {/* Type picker */}
                <ThemedText style={[styles.modalLabel, { marginTop: 0 }]}>Type</ThemedText>
                <View style={styles.typeRow}>
                  {([
                    { value: 'restaurant', symbol: 'fork.knife' },
                    { value: 'hotel', symbol: 'bed.double.fill' },
                    { value: 'flight', symbol: 'airplane' },
                    { value: 'train', symbol: 'tram.fill' },
                    { value: 'activity', symbol: 'star.fill' },
                    { value: 'other', symbol: 'doc.text.fill' },
                  ] as { value: ReservationType; symbol: string }[]).map((opt) => (
                    <Pressable
                      key={opt.value}
                      onPress={() => setResType(opt.value)}
                      style={[
                        styles.typeChip,
                        { backgroundColor: resType === opt.value ? theme.primary : 'transparent', borderWidth: 1, borderColor: resType === opt.value ? theme.primary : theme.border },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <SymbolView name={opt.symbol as any} size={14} tintColor={resType === opt.value ? theme.primaryText : theme.text} />
                        <ThemedText style={[styles.typeText, resType === opt.value && { color: theme.primaryText }]}>
                          {opt.value}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))}
                </View>

                {/* Title */}
                <ThemedText style={styles.modalLabel}>Title *</ThemedText>
                <TextInput
                  style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={resTitle}
                  onChangeText={setResTitle}
                  placeholder="e.g. Hotel Majestic, United Flight 123"
                  placeholderTextColor={theme.textSecondary}
                  autoFocus={!editingReservation && resEntryMode === 'manual' && !resTitle}
                  accessibilityLabel="Reservation name"
                />

                {/* Date fields based on type */}
                {resType === 'hotel' ? (
                  <>
                    <ThemedText style={styles.modalLabel}>Check-in date (YYYY-MM-DD)</ThemedText>
                    <TextInput
                      style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                      value={resDate}
                      onChangeText={(v) => {
                        setResDate(v);
                        if (currentTrip.datesKnown !== false && v.trim() && v.trim() >= currentTrip.startDate && v.trim() <= currentTrip.endDate) {
                          const [sy2, sm2, sd2] = currentTrip.startDate.split('-').map(Number);
                          const [dy2, dm2, dd2] = v.trim().split('-').map(Number);
                          const d = Math.round((Date.UTC(dy2, dm2 - 1, dd2) - Date.UTC(sy2, sm2 - 1, sd2)) / 86400000) + 1;
                          setResDay(String(Math.max(1, Math.min(d, totalDays))));
                        }
                      }}
                      placeholder={currentTrip.startDate}
                      placeholderTextColor={theme.textSecondary}
                      accessibilityLabel="Check-in date"
                    />
                    <ThemedText style={styles.modalLabel}>Check-out date (YYYY-MM-DD, optional)</ThemedText>
                    <TextInput
                      style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                      value={resCheckoutDate}
                      onChangeText={setResCheckoutDate}
                      placeholder={currentTrip.endDate}
                      placeholderTextColor={theme.textSecondary}
                      accessibilityLabel="Check-out date"
                    />
                  </>
                ) : resType === 'flight' || resType === 'train' ? (
                  <>
                    <ThemedText style={styles.modalLabel}>Departure date (YYYY-MM-DD)</ThemedText>
                    <TextInput
                      style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                      value={resDate}
                      onChangeText={(v) => {
                        setResDate(v);
                        if (currentTrip.datesKnown !== false && v.trim() && v.trim() >= currentTrip.startDate && v.trim() <= currentTrip.endDate) {
                          const [sy2, sm2, sd2] = currentTrip.startDate.split('-').map(Number);
                          const [dy2, dm2, dd2] = v.trim().split('-').map(Number);
                          const d = Math.round((Date.UTC(dy2, dm2 - 1, dd2) - Date.UTC(sy2, sm2 - 1, sd2)) / 86400000) + 1;
                          setResDay(String(Math.max(1, Math.min(d, totalDays))));
                        }
                      }}
                      placeholder={currentTrip.startDate}
                      placeholderTextColor={theme.textSecondary}
                      accessibilityLabel="Departure date"
                    />
                  </>
                ) : resType === 'restaurant' || resType === 'activity' ? (
                  <>
                    <ThemedText style={styles.modalLabel}>Reservation date (YYYY-MM-DD)</ThemedText>
                    <TextInput
                      style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                      value={resDate}
                      onChangeText={(v) => {
                        setResDate(v);
                        if (currentTrip.datesKnown !== false && v.trim() && v.trim() >= currentTrip.startDate && v.trim() <= currentTrip.endDate) {
                          const [sy2, sm2, sd2] = currentTrip.startDate.split('-').map(Number);
                          const [dy2, dm2, dd2] = v.trim().split('-').map(Number);
                          const d = Math.round((Date.UTC(dy2, dm2 - 1, dd2) - Date.UTC(sy2, sm2 - 1, sd2)) / 86400000) + 1;
                          setResDay(String(Math.max(1, Math.min(d, totalDays))));
                        }
                      }}
                      placeholder={currentTrip.startDate}
                      placeholderTextColor={theme.textSecondary}
                      accessibilityLabel="Reservation date"
                    />
                  </>
                ) : (
                  <>
                    <ThemedText style={styles.modalLabel}>Date (optional, YYYY-MM-DD)</ThemedText>
                    <TextInput
                      style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                      value={resDate}
                      onChangeText={(v) => {
                        setResDate(v);
                        if (currentTrip.datesKnown !== false && v.trim() && v.trim() >= currentTrip.startDate && v.trim() <= currentTrip.endDate) {
                          const [sy2, sm2, sd2] = currentTrip.startDate.split('-').map(Number);
                          const [dy2, dm2, dd2] = v.trim().split('-').map(Number);
                          const d = Math.round((Date.UTC(dy2, dm2 - 1, dd2) - Date.UTC(sy2, sm2 - 1, sd2)) / 86400000) + 1;
                          setResDay(String(Math.max(1, Math.min(d, totalDays))));
                        }
                      }}
                      placeholder="2026-08-20"
                      placeholderTextColor={theme.textSecondary}
                      accessibilityLabel="Reservation date"
                    />
                  </>
                )}

                {/* Day selector — only shown when datesKnown is NOT true (dates unknown, so day must be picked manually) */}
                {currentTrip.datesKnown === false && (
                  <>
                    <ThemedText style={styles.modalLabel}>Day (optional)</ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moveDayRow}>
                      <Pressable
                        onPress={() => setResDay('')}
                        style={[styles.moveDayChip, { backgroundColor: resDay === '' ? theme.primary : theme.backgroundElement }]}
                        accessibilityRole="button"
                        accessibilityLabel="Select no day"
                      >
                        <ThemedText style={[styles.moveDayText, resDay === '' && { color: theme.primaryText }]}>None</ThemedText>
                      </Pressable>
                      {allDays.map((d) => (
                        <Pressable
                          key={d}
                          onPress={() => setResDay(String(d))}
                          style={[styles.moveDayChip, { backgroundColor: resDay === String(d) ? theme.primary : theme.backgroundElement }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Select day ${d}`}
                        >
                          <ThemedText style={[styles.moveDayText, resDay === String(d) && { color: theme.primaryText }]}>Day {d}</ThemedText>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </>
                )}
                {/* When datesKnown is true and a date was entered, show the computed day */}
                {currentTrip.datesKnown !== false && resDay && (
                  <ThemedText style={[{ fontSize: 13, color: theme.primary, fontWeight: '500' }]}>
                    Computed: Day {resDay} of trip
                  </ThemedText>
                )}

                {/* Time */}
                <ThemedText style={styles.modalLabel}>Time (optional)</ThemedText>
                <TimePickerButton value={resTime} onChange={setResTime} />

                {/* Confirmation number */}
                <ThemedText style={styles.modalLabel}>Confirmation number (optional)</ThemedText>
                <TextInput
                  style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={resConfirmation}
                  onChangeText={setResConfirmation}
                  placeholder="ABC123"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="characters"
                  accessibilityLabel="Confirmation number"
                />

                {/* Booking URL */}
                <ThemedText style={styles.modalLabel}>Booking URL (optional)</ThemedText>
                <TextInput
                  style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={resBookingUrl}
                  onChangeText={setResBookingUrl}
                  placeholder="https://..."
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="url"
                  autoCapitalize="none"
                  accessibilityLabel="Booking URL"
                />

                {/* Price */}
                <ThemedText style={styles.modalLabel}>Price (optional)</ThemedText>
                <TextInput
                  style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={resPrice}
                  onChangeText={setResPrice}
                  placeholder="0.00"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Price"
                />

                {/* Currency */}
                <ThemedText style={styles.modalLabel}>Currency</ThemedText>
                <View style={styles.typeRow}>
                  {['USD', 'EUR', 'GBP', 'JPY'].map((cur) => (
                    <Pressable
                      key={cur}
                      onPress={() => setResCurrency(cur)}
                      style={[
                        styles.typeChip,
                        { backgroundColor: resCurrency === cur ? theme.primary : 'transparent', borderWidth: 1, borderColor: resCurrency === cur ? theme.primary : theme.border },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${cur} currency`}
                    >
                      <ThemedText style={[styles.typeText, resCurrency === cur && { color: theme.primaryText }]}>
                        {cur}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>

                {/* Address */}
                <ThemedText style={styles.modalLabel}>Address (optional)</ThemedText>
                <TextInput
                  style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={resAddress}
                  onChangeText={setResAddress}
                  placeholder="123 Main St, City"
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel="Address"
                />

                {/* Notes */}
                <ThemedText style={styles.modalLabel}>Notes (optional)</ThemedText>
                <TextInput
                  style={[styles.addInput, styles.modalInputMulti, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={resNotes}
                  onChangeText={setResNotes}
                  placeholder="Additional details..."
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  textAlignVertical="top"
                  accessibilityLabel="Reservation notes"
                />

                {/* Cancel reservation button (edit mode only) */}
                {editingReservation && !editingReservation.cancelled && (
                  <Pressable
                    onPress={() => {
                      Alert.alert('Cancel reservation?', `Mark "${editingReservation.title}" as cancelled?`, [
                        { text: 'Keep', style: 'cancel' },
                        {
                          text: 'Cancel reservation',
                          style: 'destructive',
                          onPress: () => {
                            updateReservation(currentTrip.id, { ...editingReservation, cancelled: true });
                            setShowAddReservationModal(false);
                            setEditingReservation(null);
                          },
                        },
                      ]);
                    }}
                    style={[styles.resCancelBtn, { borderColor: theme.danger }]}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel reservation"
                  >
                    <ThemedText style={[styles.resCancelBtnText, { color: theme.danger }]}>Cancel reservation</ThemedText>
                  </Pressable>
                )}

                <Pressable
                  onPress={() => {
                    if (!resTitle.trim()) return;
                    const dayNum = resDay ? parseInt(resDay, 10) : undefined;
                    if (dayNum != null && dayNum > totalDays) {
                      Alert.alert('Invalid day', `Day ${dayNum} is outside the trip range (1–${totalDays}).`);
                      return;
                    }
                    if (resDate.trim() && currentTrip.datesKnown !== false && (resDate.trim() < currentTrip.startDate || resDate.trim() > currentTrip.endDate)) {
                      Alert.alert('Invalid date', `Date ${resDate.trim()} is outside the trip dates (${currentTrip.startDate} to ${currentTrip.endDate}).`);
                      return;
                    }
                    // Build notes, appending checkout date for hotels if provided
                    const checkoutNote = resType === 'hotel' && resCheckoutDate.trim() ? `Check-out: ${resCheckoutDate.trim()}` : '';
                    const combinedNotes = [resNotes.trim(), checkoutNote].filter(Boolean).join('\n') || undefined;
                    const payload: Omit<Reservation, 'id' | 'tripId'> = {
                      type: resType,
                      title: resTitle.trim(),
                      day: dayNum,
                      time: resTime || undefined,
                      confirmationNumber: resConfirmation.trim() || undefined,
                      bookingUrl: resBookingUrl.trim() || undefined,
                      price: resPrice ? parseFloat(resPrice) : undefined,
                      notes: combinedNotes,
                      address: resAddress.trim() || undefined,
                      currency: resCurrency || undefined,
                      fixed: true,
                      date: resDate.trim() || undefined,
                    };
                    if (editingReservation) {
                      updateReservation(currentTrip.id, { ...editingReservation, ...payload });
                    } else {
                      addReservation(currentTrip.id, payload);
                    }
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowAddReservationModal(false);
                    setEditingReservation(null);
                  }}
                  style={[styles.addSaveBtn, { backgroundColor: theme.primary, opacity: resTitle.trim() ? 1 : 0.4 }]}
                  disabled={!resTitle.trim()}
                  accessibilityRole="button"
                  accessibilityLabel={editingReservation ? 'Save reservation changes' : 'Add reservation'}
                >
                  <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>
                    {editingReservation ? 'Save Changes' : 'Add Reservation'}
                  </ThemedText>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Post-visit feedback */}
      {feedbackDay != null && (
        <PostVisitFeedback
          activities={(dayMap.get(feedbackDay) ?? []).sort(compareByTime)}
          dayLabel={formatDayLabel(feedbackDay, currentTrip.startDate, currentTrip.datesKnown)}
          visible={feedbackDay != null}
          onClose={() => setFeedbackDay(null)}
          onFeedback={handlePostVisitFeedback}
        />
      )}
      <UpgradePrompt
        visible={showUpgradePrompt}
        feature={upgradeFeature}
        title={upgradeFeature === 'edit_trip' ? 'AI trip editing' : upgradeFeature === 'analyze_trip' ? 'Trip analysis' : upgradeFeature === 'natural_search' ? 'AI search' : 'More imports'}
        description={upgradeFeature === 'edit_trip' ? 'Unlock unlimited AI-powered trip edits with Travonal+.' : upgradeFeature === 'analyze_trip' ? 'Get deep AI analysis of your trips with Travonal+.' : upgradeFeature === 'natural_search' ? 'Search and discover places with AI using Travonal+.' : 'Import places from links, text, and screenshots with Travonal+.'}
        icon={upgradeFeature === 'edit_trip' ? 'wand.and.stars' : upgradeFeature === 'analyze_trip' ? 'chart.bar' : upgradeFeature === 'natural_search' ? 'magnifyingglass' : 'link'}
        onClose={() => setShowUpgradePrompt(false)}
      />
    </ThemedView>
  );
}

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
  liveDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveToggleRow: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingBottom: 8,
  },
  liveToggleBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.md,
  },
  liveToggleText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },

  // Undo banner
  undoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  undoText: {
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  undoBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.md,
  },
  undoBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  undoDismissBtn: {
    padding: 4,
    marginLeft: 4,
  },
  undoDismissText: {
    fontSize: 12,
    fontWeight: '300',
  },

  // Itinerary
  itinerary: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three },

  // Day section
  daySection: { marginBottom: Spacing.four },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
  },
  dayLabel: { fontSize: 17, fontWeight: '700' },
  dayDate: { fontSize: 13, marginTop: 2 },
  dayAction: { fontSize: 13, fontWeight: '600' },

  // Quick action chips — compact row (not horizontal scroll)
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  quickActionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.md,
    backgroundColor: '#F4F5FA',
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '500',
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
  emptyDay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
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
  prepCheckbox: { fontSize: 18, lineHeight: 22 },
  prepItemText: { fontSize: 14, fontWeight: '500', flex: 1 },
  prepItemDone: { textDecorationLine: 'line-through', opacity: 0.5 },
  prepRemove: { fontSize: 14, padding: 4 },
  prepAddRow: { flexDirection: 'row', gap: 8, marginTop: 8, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 12, alignItems: 'center' },
  prepAddInput: { flex: 1, paddingVertical: 10, fontSize: 14 },
  prepAddBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.xs },
  prepAddBtnText: { fontSize: 13, fontWeight: '600' },

  // Budget
  budgetCard: { padding: 16, borderRadius: Radius.sm, marginBottom: 12, gap: 4 },
  budgetLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  budgetAmount: { fontSize: 24, fontWeight: '700' },
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

  // Invite disclaimer
  inviteDisclaimer: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
  },

  // Invitation status badge
  invStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  invStatusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
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
  resCancelBtn: {
    borderWidth: 1.5,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  resCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Reservation entry mode choice buttons
  resChoiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: 16,
  },
  resChoiceBtnIcon: { width: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  resChoiceBtnTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  resChoiceBtnDesc: { fontSize: 13, lineHeight: 18 },

  // Budget currency row
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

  // Offline readiness
  offlineSection: {
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  offlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  offlineIcon: {
    fontSize: 16,
    lineHeight: 20,
  },
  offlineText: {
    fontSize: 13,
    flex: 1,
  },

  // Members tab
  memberRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: 14,
    marginBottom: 10,
  },
  memberRowLeft: { flex: 1, gap: 4 },
  memberName: { fontSize: 16, fontWeight: '600' },
  memberRoleBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  memberRoleText: { fontSize: 12, fontWeight: '600' },
  inviteForm: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: 16,
    gap: 6,
  },
  inviteCodeBox: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: 12,
    gap: 4,
    alignItems: 'center',
  },
  dayHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  distanceIndicator: {
    paddingLeft: 78, // align with activity content (time col + dot col)
    marginTop: -4,
    marginBottom: -2,
  },
  distanceText: {
    fontSize: 10,
    fontWeight: '500' as const,
  },

  // AI view (Edit with AI tab)
  aiView: {
    padding: Spacing.four,
  },
  aiViewTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    marginBottom: 4,
  },
  aiViewSubtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  aiViewInputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    gap: 8,
  },
  aiViewInput: {
    flex: 1,
    fontSize: 15,
  },
  aiViewSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  aiViewDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 24,
  },
  aiViewSectionLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 12,
  },

  // Trip Analysis
  analysisCard: {
    padding: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.four,
  },
  analysisCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  analysisCardTextCol: {
    flex: 1,
    flexShrink: 1,
  },
  analysisCardTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  analysisCardDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  analysisLoadingText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  analysisResults: {
    gap: 10,
    marginBottom: 8,
  },
  analysisOverall: {
    padding: 16,
    borderRadius: Radius.md,
    alignItems: 'center' as const,
    gap: 8,
  },
  analysisScoreRow: {
    flexDirection: 'row' as const,
    alignItems: 'baseline' as const,
  },
  analysisScoreNum: {
    fontSize: 36,
    fontWeight: '800' as const,
  },
  analysisScoreLabel: {
    fontSize: 18,
    fontWeight: '600' as const,
  },
  analysisOverallText: {
    fontSize: 14,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  analysisRefreshBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 4,
  },
  analysisRefreshText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  analysisCatCard: {
    borderRadius: Radius.md,
    overflow: 'hidden' as const,
  },
  analysisCatHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 14,
    gap: 10,
  },
  analysisCatEmoji: {
    fontSize: 20,
  },
  analysisCatLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  analysisCatScoreBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  analysisCatScoreText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  analysisCatBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  analysisCatSummary: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  analysisSuggestions: {
    gap: 8,
  },
  analysisSugRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  analysisSugText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  analysisSugBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  analysisSugBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  aiViewCommands: {
    gap: 8,
  },
  aiViewCommandRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 14,
    borderRadius: Radius.md,
    gap: 12,
  },
  aiViewCommandText: {
    flex: 1,
  },
  aiViewCommandLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  aiViewCommandDesc: {
    fontSize: 13,
    marginTop: 1,
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
