import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { AskTravonal, TravonalCommand } from '@/components/ask-travonal';
import { DatePickerModal, formatDisplayDate } from '@/components/date-picker-modal';
import { PulseBanner } from '@/components/pulse-banner';
import { TimePickerButton, formatTimeDisplay, defaultTimeForType, defaultDurationForType } from '@/components/time-picker';
import { TransformationReveal, SmartReplacePicker } from '@/components/transformation-reveal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { Activity, PrepItem, Reservation, ReservationType, useTrips } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useMemory } from '@/context/memory';
import { useTheme } from '@/hooks/use-theme';
import { checkConflicts, getTripDayCount, computeChangePreview, ChangePreview, timeToMinutes } from '@/services/itinerary-engine';
import { transformTrip, findTopReplacements, TransformScope } from '@/services/transformation-service';
import { runTripPulse, PulseAlert } from '@/services/trip-pulse';
import { useTripPulse, shouldRunTripPulse } from '@/context/trip-pulse';
import { loadDismissedPulse, saveDismissedPulse, loadSeenPulse, saveSeenPulse } from '@/services/storage';
import { makePulseDismissalKey, isPulseDismissed } from '@/services/trip-helpers';
import { usePulseHistory } from '@/context/pulse-history';

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '\u20AC', GBP: '\u00A3', JPY: '\u00A5', AUD: 'A$', CAD: 'C$', CHF: 'CHF', CNY: '\u00A5', KRW: '\u20A9', THB: '\u0E3F', INR: '\u20B9', MXN: 'MX$', BRL: 'R$' };
function getCurrSymbol(cur: string) { return CURRENCY_SYMBOLS[cur] ?? cur + ' '; }

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function tripDuration(start: string, end: string) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const days = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
  return `${days} night${days !== 1 ? 's' : ''}`;
}

export default function TripWorkspace() {
  const { id, openEdit, day: dayParam, addActivity: addActivityParam, applyCommand, applyDay, applySearch, applyStartAfter } = useLocalSearchParams<{ id: string; openEdit?: string; day?: string; addActivity?: string; applyCommand?: string; applyDay?: string; applySearch?: string; applyStartAfter?: string }>();
  const { getTrip, loaded: tripsLoaded, toggleLock, setTripActivities, addActivity, updateActivity, updateTrip, undoChange, getUndoableChange, updateTripPrepItems, updateTripBudget, updateTripExpenses, addReservation, updateReservation, removeReservation, addInvitation, removeInvitation, acceptInvitation, declineInvitation, removeMember, updateMemberRole } = useTrips();
  const { profile } = useProfile();
  const { entries: memoryEntries, addEntry: addMemoryEntry } = useMemory();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();

  const [askVisible, setAskVisible] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | undefined>();
  const [viewMode, setViewMode] = useState<'itinerary' | 'map' | 'prep' | 'budget' | 'reservations'>('itinerary');
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

  // Undo: tracks the last persisted ChangeRecord id so we can auto-show/dismiss the banner
  const [undoDismissedId, setUndoDismissedId] = useState<string | null>(null);
  const [autoHideUndoId, setAutoHideUndoId] = useState<string | null>(null);

  // Quick action chips
  const [quickActionDay, setQuickActionDay] = useState<number | null>(null);

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

  // Invite Travelers & Collaboration
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteContact, setInviteContact] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'viewer'>('member');

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
  const [resFixed, setResFixed] = useState(false);
  const [resDate, setResDate] = useState('');
  const [resPasteUrl, setResPasteUrl] = useState('');
  const [resParsedLabel, setResParsedLabel] = useState('');

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

  // Multi-day scope selection
  // Activity-specific customization target
  const [customizeTarget, setCustomizeTarget] = useState<Activity | null>(null);

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

  const trip = getTrip(id);

  useEffect(() => {
    if (trip) {
      navigation.setOptions({ headerTitle: `${trip.emoji} ${trip.title ?? trip.destination}`, headerShown: true, headerBackTitle: 'Back' });
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

  // Apply command from chat navigation with ?applyCommand=<command>&applyDay=<N>&applySearch=<terms>&applyStartAfter=<HH:MM>
  useEffect(() => {
    if (applyCommand && trip) {
      const day = applyDay ? parseInt(applyDay, 10) : undefined;
      const search = applySearch ? decodeURIComponent(applySearch) : undefined;
      const sa = applyStartAfter ? decodeURIComponent(applyStartAfter) : undefined;
      const scope: TransformScope | undefined = day != null ? { type: 'day', day } : undefined;
      handleCommand(applyCommand as TravonalCommand, day, scope, search, sa);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyCommand, trip?.id]);

  // Auto-hide the undo banner after ~7 seconds (without removing the snapshot)
  useEffect(() => {
    const undoable = getUndoableChange(id);
    if (!undoable || undoable.id === undoDismissedId || undoable.id === autoHideUndoId) return;
    const timer = setTimeout(() => {
      setAutoHideUndoId(undoable.id);
    }, 7000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, undoDismissedId]);

  // Initialize default prep items — must be before early returns to avoid hook-order crash
  const prepTripId = trip?.id;
  useEffect(() => {
    if (!trip) return;
    if (viewMode === 'prep' && (!trip.prepItems || trip.prepItems.length === 0)) {
      const dest = trip.destination;
      const hasHotel = trip.activities.some((a) => a.type === 'hotel');
      const items: PrepItem[] = [
        { id: 'prep-1', text: 'Pack passport / ID', done: false, custom: false, category: 'documents' },
        { id: 'prep-2', text: `Check visa requirements for ${dest}`, done: false, custom: false, category: 'documents' },
        { id: 'prep-4', text: 'Arrange travel insurance', done: false, custom: false, category: 'health' },
        { id: 'prep-5', text: `Download offline maps for ${dest}`, done: false, custom: false, category: 'packing' },
      ];
      if (!hasHotel) {
        items.splice(2, 0, { id: 'prep-3', text: 'Book accommodation', done: false, custom: false, category: 'accommodation' });
      }
      updateTripPrepItems(trip.id, items);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, prepTripId]);

  // Notification scheduling is handled centrally by AppPulseEvaluator — no local scheduling here.

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
  const conflicts = checkConflicts(currentTrip.activities, totalDays);

  // Monotonic revision counter — scopes pulse dismissals so they expire when activities change
  const itineraryRevision = currentTrip.itineraryRevision ?? 0;

  // Run Trip Pulse — only after setting loads and when enabled
  const allPulseAlerts = shouldRunTripPulse(tripPulseLoaded, tripPulseEnabled)
    ? runTripPulse(currentTrip, profile, memoryEntries)
    : [];
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

  function handleMoveActivity(activityId: string, day: number, direction: 'up' | 'down') {
    const dayActivities = (dayMap.get(day) ?? []).sort((a, b) => a.time.localeCompare(b.time));
    const idx = dayActivities.findIndex((a) => a.id === activityId);
    if (idx < 0) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= dayActivities.length) return;

    // Swap times
    const updated = currentTrip.activities.map((a) => {
      if (a.id === dayActivities[idx].id) return { ...a, time: dayActivities[swapIdx].time };
      if (a.id === dayActivities[swapIdx].id) return { ...a, time: dayActivities[idx].time };
      return a;
    });
    setTripActivities(currentTrip.id, updated, `Reordered activities on Day ${day}`);
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

  function handleSmartReplace(target: Activity) {
    // Find top 3 alternatives and show the picker
    const existingTitles = currentTrip.activities.filter((a) => a.day === target.day).map((a) => a.title);
    const alternatives = findTopReplacements(currentTrip.destination, target, {
      interests: profile.interests,
      dislikes: profile.dislikes,
      budget: currentTrip.budget ?? profile.budget,
      existingTitles,
    });

    if (alternatives.length === 0) {
      setTransformResult({
        summary: 'No alternatives found',
        changes: ['No suitable replacements available for this destination'],
      });
      return;
    }

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
                    id: String(Date.now()) + String(Math.floor(Math.random() * 1000)),
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
      .sort((a, b) => a.time.localeCompare(b.time))[0];
    let duration = Math.min(picked.duration, 240);
    if (nextActivity) {
      const gap = timeToMinutes(nextActivity.time) - timeToMinutes(replaceTarget.time) - 15;
      duration = Math.min(duration, Math.max(30, gap));
    }

    const result = currentTrip.activities.map((a) =>
      a.id === replaceTarget.id
        ? {
            id: String(Date.now()) + String(Math.floor(Math.random() * 1000)),
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
      setAddingToDay(dayOverride ?? selectedDay ?? filterDay ?? 1);
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

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    setEditBudget(currentTrip.budget || profile.budget);
    setEditPace(currentTrip.pace || profile.pace);
    setEditTravelWith(currentTrip.travelWith || profile.travelWith);
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
    const hasHotel = currentTrip.activities.some((a) => a.type === 'hotel');
    const travelers = currentTrip.travelers ?? 1;
    const reservations = currentTrip.reservations ?? [];
    const members = currentTrip.members ?? [];
    const restrictions = currentTrip.restrictions;
    const hasFlight = currentTrip.activities.some((a) => a.type === 'flight') || reservations.some((r) => r.type === 'flight');
    const hasFlightRes = reservations.some((r) => r.type === 'flight');
    const hasHotelRes = reservations.some((r) => r.type === 'hotel');

    const items: PrepItem[] = [
      { id: 'prep-1', text: 'Pack passport / ID', done: false, custom: false, category: 'documents' },
      { id: 'prep-2', text: `Check visa requirements for ${dest}`, done: false, custom: false, category: 'documents' },
      { id: 'prep-4', text: 'Arrange travel insurance', done: false, custom: false, category: 'health' },
      { id: 'prep-5', text: `Download offline maps for ${dest}`, done: false, custom: false, category: 'packing' },
    ];
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
    const updated = prepItems.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
    updateTripPrepItems(currentTrip.id, updated);
  }

  function addPrepItem() {
    if (!newPrepItem.trim()) return;
    const newItem: PrepItem = {
      id: `prep-custom-${prepItems.length}-${newPrepItem.trim().length}`,
      text: newPrepItem.trim(),
      done: false,
      custom: true,
    };
    updateTripPrepItems(currentTrip.id, [...prepItems, newItem]);
    setNewPrepItem('');
  }

  function removePrepItem(id: string) {
    updateTripPrepItems(currentTrip.id, prepItems.filter((i) => i.id !== id));
  }

  function handleShareItinerary() {
    let text = `\u{1F5FA}\uFE0F ${currentTrip.title ?? currentTrip.destination} - ${currentTrip.destination}\n`;
    text += `${formatDate(currentTrip.startDate)} to ${formatDate(currentTrip.endDate)} (${totalDays} days)\n\n`;

    for (let d = 1; d <= totalDays; d++) {
      const dayActivities = (dayMap.get(d) ?? []).sort((a, b) => a.time.localeCompare(b.time));
      text += `Day ${d} - ${addDays(currentTrip.startDate, d - 1)}\n`;
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
      text += '\u{1F4CB} Reservations\n';
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

  // Map day → { messages, types } — built from activePulseAlerts (not raw conflicts)
  // so the day chip only shows when there are live, non-dismissed alerts to open.
  const dayConflictsMap = new Map<number, { messages: string[]; types: Set<string> }>();
  if (tripPulseEnabled && tripPulseLoaded) {
    for (const a of activePulseAlerts) {
      if (a.day != null) {
        const entry = dayConflictsMap.get(a.day) ?? { messages: [], types: new Set<string>() };
        entry.messages.push(a.message);
        entry.types.add(a.type);
        dayConflictsMap.set(a.day, entry);
      }
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero section — simplified, left-aligned */}
        <View style={[styles.hero, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.heroEmoji}>{currentTrip.emoji}</ThemedText>
          <ThemedText type="title" numberOfLines={1}>{currentTrip.title ?? currentTrip.destination}</ThemedText>
          {currentTrip.title && currentTrip.title !== currentTrip.destination && (
            <ThemedText style={[styles.heroCountry, { color: theme.textSecondary }]}>{currentTrip.destination}</ThemedText>
          )}
          {currentTrip.country && currentTrip.country !== 'Unknown' && currentTrip.country !== currentTrip.destination && (
            <ThemedText style={[styles.heroCountry, { color: theme.textSecondary }]}>
              {currentTrip.country} {'\u00B7'} {tripDuration(currentTrip.startDate, currentTrip.endDate)}
            </ThemedText>
          )}
          {(!currentTrip.country || currentTrip.country === 'Unknown' || currentTrip.country === currentTrip.destination) && (
            <ThemedText style={[styles.heroCountry, { color: theme.textSecondary }]}>
              {tripDuration(currentTrip.startDate, currentTrip.endDate)}
            </ThemedText>
          )}
          <ThemedText style={[styles.heroDates, { color: theme.textSecondary }]}>
            {formatDate(currentTrip.startDate)} {'\u2014'} {formatDate(currentTrip.endDate)}
          </ThemedText>
          {currentTrip.notes ? <ThemedText style={[styles.heroNotes, { color: theme.textSecondary }]}>{currentTrip.notes}</ThemedText> : null}
          <View style={styles.heroActions}>
            <Pressable
              onPress={() => { setSelectedDay(undefined); setAskVisible(true); }}
              style={[styles.customizeBtn, { borderColor: theme.primary, flex: 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Customize trip"
            >
              <ThemedText style={[styles.customizeBtnText, { color: theme.primary }]}>Customize trip</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleOpenTripEdit}
              style={[styles.customizeBtn, { borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Edit trip details"
            >
              <ThemedText style={[styles.customizeBtnText, { color: theme.textSecondary }]}>Edit</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => { setInviteName(''); setInviteContact(''); setInviteRole('member'); setShowInviteModal(true); }}
              style={[styles.customizeBtn, { borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Invite travelers"
            >
              <SymbolView name="person.badge.plus" size={22} tintColor={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={handleShareItinerary}
              style={[styles.customizeBtn, { borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Share itinerary"
            >
              <SymbolView name="square.and.arrow.up" size={22} tintColor={theme.textSecondary} />
            </Pressable>
          </View>
        </View>

        {/* View toggle — underline segment */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 0 }}>
          <View style={[styles.toggleRow, { borderBottomColor: theme.border }]}>
            {(['itinerary', 'prep', 'budget', 'reservations', 'map'] as const).map((mode) => (
              <Pressable key={mode} onPress={() => setViewMode(mode)} style={styles.toggleItem} accessibilityRole="button" accessibilityLabel={mode === 'itinerary' ? 'Itinerary tab' : mode === 'prep' ? 'Prep tab' : mode === 'budget' ? 'Budget tab' : mode === 'reservations' ? 'Reservations tab' : 'Map tab'}>
                <ThemedText style={[styles.toggleText, viewMode === mode && { color: theme.primary }]}>
                  {mode === 'itinerary' ? 'Itinerary' : mode === 'prep' ? 'Prep' : mode === 'budget' ? 'Budget' : mode === 'reservations' ? 'Reservations' : 'Map'}
                </ThemedText>
                {viewMode === mode && <View style={[styles.toggleIndicator, { backgroundColor: theme.primary }]} />}
              </Pressable>
            ))}
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
              onPress={() => setFilterDay(null)}
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
            {allDays.map((day) => (
              <Pressable
                key={day}
                onPress={() => setFilterDay(day)}
                style={[
                  styles.daySelectorPill,
                  filterDay === day
                    ? { backgroundColor: theme.primary }
                    : { borderWidth: 1, borderColor: theme.border, backgroundColor: 'transparent' },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Day ${day} activities`}
              >
                <ThemedText
                  style={[
                    styles.daySelectorText,
                    filterDay === day && styles.daySelectorTextActive,
                    filterDay === day && { color: theme.primaryText },
                  ]}
                >
                  Day {day}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
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
              <ThemedText style={[styles.undoDismissText, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
            </Pressable>
          </Animated.View>
        )}

        {/* Trip Pulse */}
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
        />

        {viewMode === 'itinerary' ? (
          <View style={styles.itinerary}>
            {visibleDays.map((day) => {
              const dayActivities = (dayMap.get(day) ?? []).sort((a, b) => a.time.localeCompare(b.time));
              const dayConflictEntry = dayConflictsMap.get(day);

              return (
                <Animated.View key={day} entering={FadeInDown.delay(day * 60).springify()} style={styles.daySection}>
                  <View style={[styles.dayHeader, { borderBottomColor: theme.border }]}>
                    <View>
                      <ThemedText style={styles.dayLabel}>Day {day}</ThemedText>
                      <ThemedText style={[styles.dayDate, { color: theme.textSecondary }]}>{addDays(currentTrip.startDate, day - 1)}</ThemedText>
                    </View>
                    <Pressable onPress={() => handleDayAction(day)} accessibilityRole="button" accessibilityLabel={`Adjust Day ${day}`}>
                      <ThemedText style={[styles.dayAction, { color: theme.primary }]}>Adjust</ThemedText>
                    </Pressable>
                  </View>

                  {/* Quick action chips — compact row below header */}
                  {quickActionDay === day && (
                    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
                      <View style={styles.quickActionRow}>
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

                  {dayConflictEntry && (() => {
                    const isUrgent = dayConflictEntry.types.has('conflict');
                    const color = isUrgent ? '#DC2626' : '#D97706';
                    const bg = isUrgent ? 'rgba(220,38,38,0.08)' : 'rgba(217,119,6,0.09)';
                    const icon = isUrgent ? '⚠' : '●';
                    const count = dayConflictEntry.messages.length;
                    return (
                      <Pressable
                        onPress={() => { handlePulseOpen(); setShowPulseModal(true); }}
                        style={[styles.dayIssueLink, { backgroundColor: bg, borderColor: color + '30' }]}
                        accessibilityRole="button"
                        accessibilityLabel={`${count} ${count === 1 ? 'issue' : 'issues'} — tap to view`}
                      >
                        <ThemedText style={[styles.dayIssueLinkText, { color }]}>{icon}</ThemedText>
                        <ThemedText style={[styles.dayIssueLinkText, { color, flex: 1 }]}>
                          {count} {count === 1 ? 'issue' : 'issues'} needs attention
                        </ThemedText>
                        <ThemedText style={[styles.dayIssueLinkText, { color }]}>›</ThemedText>
                      </Pressable>
                    );
                  })()}

                  {dayActivities.length === 0 ? (
                    <View style={styles.emptyDay}>
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
                    <View style={styles.timeline}>
                      {dayActivities.map((activity, idx) => (
                        <View key={activity.id}>
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

                            {/* Right column: activity content */}
                            <ActivityCard
                              activity={activity}
                              onLock={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                toggleLock(currentTrip.id, activity.id);
                              }}
                              onRemove={() => {
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
                                        const isProtected = !!(activity.locked || activity.fixed);
                                        setTripActivities(
                                          currentTrip.id,
                                          currentTrip.activities.filter((a) => a.id !== activity.id),
                                          `Removed "${activity.title}"`,
                                          isProtected,
                                        );
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                      },
                                    },
                                  ],
                                );
                              }}
                              onReplace={() => handleReplace(activity.id)}
                              onMove={(dir) => handleMoveActivity(activity.id, day, dir)}
                              onMoveAdvanced={() => handleOpenMoveActivity(activity)}
                              onEdit={() => handleStartEdit(activity)}
                              onCustomize={() => {
                                setCustomizeTarget(activity);
                                setSelectedDay(activity.day);
                                setAskVisible(true);
                              }}
                              isFirst={idx === 0}
                              isLast={idx === dayActivities.length - 1}
                            />
                          </View>

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
                      ))}

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
                                <ThemedText style={styles.prepCheckbox}>{item.done ? '\u2705' : '\u2B1C'}</ThemedText>
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
                                <ThemedText style={styles.prepCheckbox}>{item.done ? '\u2705' : '\u2B1C'}</ThemedText>
                                <ThemedText style={[styles.prepItemText, item.done && styles.prepItemDone]}>{item.text}</ThemedText>
                                {item.custom && (
                                  <Pressable onPress={() => removePrepItem(item.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove prep item">
                                    <ThemedText style={[styles.prepRemove, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
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
                          <ThemedText style={styles.prepCheckbox}>{item.done ? '\u2705' : '\u2B1C'}</ThemedText>
                          <ThemedText style={[styles.prepItemText, item.done && styles.prepItemDone]}>{item.text}</ThemedText>
                          {item.custom && (
                            <Pressable onPress={() => removePrepItem(item.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove prep item">
                              <ThemedText style={[styles.prepRemove, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
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
                      <ThemedText style={styles.offlineIcon}>{'\u2705'}</ThemedText>
                      <ThemedText style={styles.offlineText}>Itinerary saved locally</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <ThemedText style={styles.offlineIcon}>{'\u2705'}</ThemedText>
                      <ThemedText style={styles.offlineText}>Reservations saved locally</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <ThemedText style={styles.offlineIcon}>{'\u2705'}</ThemedText>
                      <ThemedText style={styles.offlineText}>Prep list saved locally</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <ThemedText style={styles.offlineIcon}>{'\u26A0\uFE0F'}</ThemedText>
                      <ThemedText style={styles.offlineText}>Maps require internet (download offline maps)</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <ThemedText style={styles.offlineIcon}>{'\u26A0\uFE0F'}</ThemedText>
                      <ThemedText style={styles.offlineText}>Booking websites require internet</ThemedText>
                    </View>
                    <View style={styles.offlineRow}>
                      <ThemedText style={styles.offlineIcon}>{'\u26A0\uFE0F'}</ThemedText>
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
              const ACTIVITY_COST_TIERS: Record<string, number> = { free: 0, budget: 15, moderate: 35, premium: 75 };
              const estimatedActivityCost = currentTrip.activities.reduce((sum, a) => sum + (ACTIVITY_COST_TIERS[a.cost ?? 'moderate'] ?? 35), 0);
              const expenses = currentTrip.expenses ?? [];
              const manualExpensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
              const budgetCurrency = currentTrip.budgetCurrency ?? 'USD';
              const currencySymbol = getCurrSymbol(budgetCurrency);
              // Only sum reservations in the same currency as the trip budget
              const activeReservations = (currentTrip.reservations ?? []).filter((r) => !r.cancelled && r.price != null && r.price > 0);
              const sameCurrencyRes = activeReservations.filter((r) => !r.currency || r.currency === budgetCurrency);
              const otherCurrencyRes = activeReservations.filter((r) => r.currency && r.currency !== budgetCurrency);
              const reservationCost = sameCurrencyRes.reduce((sum, r) => sum + (r.price ?? 0), 0);
              const totalSpent = estimatedActivityCost + manualExpensesTotal + reservationCost;
              const budgetTotal = currentTrip.budgetTotal ?? 0;
              const remaining = budgetTotal - totalSpent;
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

                  {/* Summary cards */}
                  <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Estimated activity costs</ThemedText>
                    <ThemedText style={styles.budgetAmount}>{currencySymbol}{estimatedActivityCost.toLocaleString()}</ThemedText>
                    <ThemedText style={[styles.budgetEstNote, { color: theme.textSecondary }]}>
                      Based on activity cost tiers (approximate)
                    </ThemedText>
                  </View>

                  {reservationCost > 0 && (
                    <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Reservation costs ({budgetCurrency})</ThemedText>
                      <ThemedText style={styles.budgetAmount}>{currencySymbol}{reservationCost.toLocaleString()}</ThemedText>
                    </View>
                  )}

                  {otherCurrencyRes.length > 0 && (
                    <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Reservations (other currencies)</ThemedText>
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

                  {manualExpensesTotal > 0 && (
                    <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Manual expenses</ThemedText>
                      <ThemedText style={styles.budgetAmount}>{currencySymbol}{manualExpensesTotal.toLocaleString()}</ThemedText>
                    </View>
                  )}

                  <View style={[styles.budgetCard, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Total spent / committed</ThemedText>
                    <ThemedText style={styles.budgetAmount}>{currencySymbol}{totalSpent.toLocaleString()}</ThemedText>
                  </View>

                  {budgetTotal > 0 && (
                    <View style={[styles.budgetCard, { backgroundColor: remaining >= 0 ? theme.backgroundElement : 'rgba(220,38,38,0.08)' }]}>
                      <ThemedText style={[styles.budgetLabel, { color: theme.textSecondary }]}>Remaining</ThemedText>
                      <ThemedText style={[styles.budgetAmount, { color: remaining >= 0 ? '#16A34A' : '#DC2626' }]}>
                        {remaining >= 0 ? `${currencySymbol}${remaining.toLocaleString()}` : `-${currencySymbol}${Math.abs(remaining).toLocaleString()}`}
                      </ThemedText>
                      {remaining < 0 && (
                        <ThemedText style={styles.budgetWarning}>Over budget by {currencySymbol}{Math.abs(remaining).toLocaleString()}</ThemedText>
                      )}
                    </View>
                  )}

                  {/* Manual Expenses section */}
                  <ThemedText type="eyebrow" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
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
                          <ThemedText style={[styles.expenseDeleteText, { color: theme.primary }]}>{'\u270F\uFE0F'}</ThemedText>
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
                          <ThemedText style={[styles.expenseDeleteText, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
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
                  <ThemedText type="eyebrow" style={[styles.budgetSectionTitle, { color: theme.textSecondary }]}>
                    Per-day breakdown (estimates)
                  </ThemedText>
                  {allDays.map((d) => {
                    const dayActs = (dayMap.get(d) ?? []);
                    const dayActCost = dayActs.reduce((s, a) => s + (ACTIVITY_COST_TIERS[a.cost ?? 'moderate'] ?? 35), 0);
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
            {(currentTrip.reservations ?? []).length === 0 ? (
              <View style={styles.reservationsEmpty}>
                <ThemedText style={[styles.reservationsEmptyText, { color: theme.textSecondary }]}>
                  No reservations yet. Add hotels, flights, restaurants, and more.
                </ThemedText>
              </View>
            ) : (
              [...(currentTrip.reservations ?? [])]
                .sort((a, b) => (a.day ?? 9999) - (b.day ?? 9999))
                .map((res) => {
                  const typeEmoji: Record<ReservationType, string> = {
                    restaurant: '\u{1F37D}\uFE0F',
                    hotel: '\u{1F3E8}',
                    flight: '\u2708\uFE0F',
                    train: '\u{1F682}',
                    activity: '\u{1F3AF}',
                    other: '\u{1F4CB}',
                  };
                  return (
                    <View key={res.id} style={[styles.reservationCard, { backgroundColor: theme.backgroundElement }]}>
                      <View style={styles.reservationCardHeader}>
                        <ThemedText style={styles.reservationEmoji}>{typeEmoji[res.type]}</ThemedText>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={[styles.reservationTitle, res.cancelled && { textDecorationLine: 'line-through', opacity: 0.5 }]}>
                            {res.title}{res.cancelled ? ' (cancelled)' : ''}
                          </ThemedText>
                          {res.day != null && (
                            <ThemedText style={[styles.reservationMeta, { color: theme.textSecondary }]}>
                              Day {res.day}{res.time ? ` \u00B7 ${formatTimeDisplay(res.time)}` : ''}
                            </ThemedText>
                          )}
                          {res.confirmationNumber ? (
                            <ThemedText style={[styles.reservationMeta, { color: theme.textSecondary }]}>
                              Conf: {res.confirmationNumber}
                            </ThemedText>
                          ) : null}
                          {res.price != null ? (
                            <ThemedText style={[styles.reservationMeta, { color: theme.textSecondary }]}>
                              {getCurrSymbol(res.currency ?? 'USD')}{res.price.toLocaleString()}
                            </ThemedText>
                          ) : null}
                        </View>
                        <View style={styles.reservationCardActions}>
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
                              setResFixed(res.fixed ?? false);
                              setResDate(res.date ?? '');
                              setResPasteUrl('');
                              setResParsedLabel('');
                              setShowAddReservationModal(true);
                            }}
                            hitSlop={8}
                            style={styles.reservationActionBtn}
                            accessibilityRole="button"
                            accessibilityLabel="Edit reservation"
                          >
                            <ThemedText style={[styles.reservationActionText, { color: theme.textSecondary }]}>{'\u270F\uFE0F'}</ThemedText>
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              Alert.alert(
                                'Remove reservation?',
                                `Remove "${res.title}"?`,
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Remove',
                                    style: 'destructive',
                                    onPress: () => {
                                      removeReservation(currentTrip.id, res.id);
                                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    },
                                  },
                                ],
                              );
                            }}
                            hitSlop={8}
                            style={styles.reservationActionBtn}
                            accessibilityRole="button"
                            accessibilityLabel="Remove reservation"
                          >
                            <ThemedText style={[styles.reservationActionText, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
                          </Pressable>
                        </View>
                      </View>
                      {res.bookingUrl ? (
                        <Pressable
                          onPress={() => { if (res.bookingUrl) Linking.openURL(res.bookingUrl); }}
                          style={[styles.reservationLinkBtn, { borderColor: theme.border }]}
                          accessibilityRole="button"
                          accessibilityLabel="View booking"
                        >
                          <ThemedText style={[styles.reservationLinkText, { color: theme.primary }]}>View booking</ThemedText>
                        </Pressable>
                      ) : null}
                      {res.notes ? (
                        <ThemedText style={[styles.reservationNotes, { color: theme.textSecondary }]}>{res.notes}</ThemedText>
                      ) : null}
                    </View>
                  );
                })
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
                setResFixed(false);
                setResDate('');
                setResPasteUrl('');
                setResParsedLabel('');
                setShowAddReservationModal(true);
              }}
              style={[styles.addResBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Add reservation"
            >
              <ThemedText style={[styles.addResBtnText, { color: theme.primaryText }]}>+ Add Reservation</ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.mapPlaceholder}>
            <ThemedText style={{ fontSize: 48, lineHeight: 60 }}>{'\u{1F5FA}\uFE0F'}</ThemedText>
            <ThemedText style={styles.mapText}>Map view</ThemedText>
            <ThemedText style={[styles.mapSubtext, { color: theme.textSecondary }]}>
              Interactive map with route visualization will be available with Maps API integration
            </ThemedText>
          </View>
        )}
      </ScrollView>

      <AskTravonal
        visible={askVisible}
        onClose={() => { setAskVisible(false); setCustomizeTarget(null); }}
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
        tripDestination={currentTrip.title ?? currentTrip.destination}
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
                <ThemedText style={[{ fontSize: 18, color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
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
                      setNewTime(defaultTimeForType(t));
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
                  trackColor={{ false: 'rgba(128,128,128,0.2)', true: theme.primary }}
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
                <ThemedText style={[styles.discoverBtnText, { color: theme.primary }]}>
                  {'\u{1F50D}'} Discover a place in Explore
                </ThemedText>
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

      {/* Invite Travelers & Collaboration Modal (Task 4) */}
      <Modal
        visible={showInviteModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.addModal, { backgroundColor: theme.background }]}>
            <View style={[styles.addModalHeader, { borderBottomColor: theme.border }]}>
              <ThemedText style={styles.addModalTitle}>Trip Team</ThemedText>
              <Pressable onPress={() => setShowInviteModal(false)} hitSlop={8} style={styles.addModalClose} accessibilityRole="button" accessibilityLabel="Close">
                <ThemedText style={[{ fontSize: 18, color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              {(() => {
                const invitations = currentTrip.invitations ?? [];
                const members = currentTrip.members ?? [];
                const totalTravelers = currentTrip.travelers ?? 1;
                const roleLabel = (role: string) => role === 'owner' ? 'Owner' : role === 'member' ? 'Member' : 'Viewer';
                const roleColor = (role: string) => role === 'owner' ? theme.primary : role === 'member' ? '#16A34A' : theme.textSecondary;
                return (
                  <>
                    <ThemedText style={[styles.modalSubtitle, { color: theme.textSecondary, textAlign: 'left' }]}>
                      {totalTravelers} traveler{totalTravelers !== 1 ? 's' : ''} on this trip
                    </ThemedText>

                    {/* Members list */}
                    {members.length > 0 && (
                      <View style={{ gap: 8 }}>
                        <ThemedText style={styles.modalLabel}>Members</ThemedText>
                        {members.map((m) => (
                          <View key={m.id} style={[styles.expenseCard, { backgroundColor: theme.backgroundElement }]}>
                            <View style={{ flex: 1 }}>
                              <ThemedText style={styles.expenseLabel}>{m.name}</ThemedText>
                              <ThemedText style={[styles.expenseMeta, { color: theme.textSecondary }]}>
                                Joined {new Date(m.joinedAt).toLocaleDateString()}
                              </ThemedText>
                            </View>
                            <View style={[styles.invStatusBadge, { backgroundColor: roleColor(m.role) + '20' }]}>
                              <ThemedText style={[styles.invStatusText, { color: roleColor(m.role) }]}>{roleLabel(m.role)}</ThemedText>
                            </View>
                            {m.role !== 'owner' && (
                              <>
                                <Pressable
                                  onPress={() => {
                                    const nextRole = m.role === 'member' ? 'viewer' : 'member';
                                    updateMemberRole(currentTrip.id, m.id, nextRole);
                                  }}
                                  hitSlop={8}
                                  style={styles.expenseDeleteBtn}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Change role for ${m.name}`}
                                >
                                  <ThemedText style={[styles.expenseDeleteText, { color: theme.primary }]}>
                                    {m.role === 'member' ? 'Make Viewer' : 'Make Member'}
                                  </ThemedText>
                                </Pressable>
                                <Pressable
                                  onPress={() => {
                                    Alert.alert('Remove member?', `Remove ${m.name} from this trip?`, [
                                      { text: 'Cancel', style: 'cancel' },
                                      { text: 'Remove', style: 'destructive', onPress: () => removeMember(currentTrip.id, m.id) },
                                    ]);
                                  }}
                                  hitSlop={8}
                                  style={styles.expenseDeleteBtn}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Remove ${m.name}`}
                                >
                                  <ThemedText style={[styles.expenseDeleteText, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
                                </Pressable>
                              </>
                            )}
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Invitation list */}
                    {invitations.length > 0 && (
                      <View style={{ gap: 8 }}>
                        <ThemedText style={styles.modalLabel}>Invitations</ThemedText>
                        {invitations.map((inv) => {
                          const statusColor = inv.status === 'accepted' ? '#16A34A' : inv.status === 'declined' ? '#DC2626' : theme.textSecondary;
                          return (
                            <View key={inv.id} style={[styles.expenseCard, { backgroundColor: theme.backgroundElement }]}>
                              <View style={{ flex: 1 }}>
                                <ThemedText style={styles.expenseLabel}>{inv.name}</ThemedText>
                                <ThemedText style={[styles.expenseMeta, { color: theme.textSecondary }]}>
                                  {inv.contact} {'\u00B7'} {inv.role ?? 'member'}
                                </ThemedText>
                                {inv.inviteCode && inv.status === 'pending' && (
                                  <ThemedText style={[styles.expenseMeta, { color: theme.primary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11 }]}>
                                    Code: {inv.inviteCode}
                                  </ThemedText>
                                )}
                              </View>
                              <View style={[styles.invStatusBadge, { backgroundColor: statusColor + '20' }]}>
                                <ThemedText style={[styles.invStatusText, { color: statusColor }]}>{inv.status}</ThemedText>
                              </View>
                              {inv.status === 'pending' && (
                                <>
                                  <Pressable
                                    onPress={() => {
                                      Alert.alert('Accept invitation?', `Mark ${inv.name} as accepted? This simulates the invitee accepting locally.`, [
                                        { text: 'Cancel', style: 'cancel' },
                                        { text: 'Accept', onPress: () => acceptInvitation(currentTrip.id, inv.id) },
                                      ]);
                                    }}
                                    hitSlop={8}
                                    style={styles.expenseDeleteBtn}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Accept ${inv.name}`}
                                  >
                                    <ThemedText style={[styles.expenseDeleteText, { color: '#16A34A' }]}>Accept</ThemedText>
                                  </Pressable>
                                  <Pressable
                                    onPress={() => {
                                      Alert.alert('Decline invitation?', `Mark ${inv.name} as declined?`, [
                                        { text: 'Cancel', style: 'cancel' },
                                        { text: 'Decline', style: 'destructive', onPress: () => declineInvitation(currentTrip.id, inv.id) },
                                      ]);
                                    }}
                                    hitSlop={8}
                                    style={styles.expenseDeleteBtn}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Decline ${inv.name}`}
                                  >
                                    <ThemedText style={[styles.expenseDeleteText, { color: '#DC2626' }]}>Decline</ThemedText>
                                  </Pressable>
                                </>
                              )}
                              <Pressable
                                onPress={() => {
                                  const codeMsg = inv.inviteCode ? `\nInvite code: ${inv.inviteCode}` : '';
                                  Share.share({
                                    message: `Join my trip to ${currentTrip.destination} on Travonal!\n\nTrip: ${currentTrip.title ?? currentTrip.destination}\nDates: ${currentTrip.startDate} to ${currentTrip.endDate}${codeMsg}\n\n(Sent via Travonal)`,
                                  });
                                }}
                                hitSlop={8}
                                style={styles.expenseDeleteBtn}
                                accessibilityRole="button"
                                accessibilityLabel={`Resend invitation to ${inv.name}`}
                              >
                                <ThemedText style={[styles.expenseDeleteText, { color: theme.primary }]}>
                                  {inv.status === 'pending' ? 'Resend' : 'Share'}
                                </ThemedText>
                              </Pressable>
                              <Pressable
                                onPress={() => {
                                  Alert.alert('Remove invitation?', `Remove invitation for ${inv.name}?`, [
                                    { text: 'Cancel', style: 'cancel' },
                                    { text: 'Remove', style: 'destructive', onPress: () => removeInvitation(currentTrip.id, inv.id) },
                                  ]);
                                }}
                                hitSlop={8}
                                style={styles.expenseDeleteBtn}
                                accessibilityRole="button"
                                accessibilityLabel={`Remove invitation for ${inv.name}`}
                              >
                                <ThemedText style={[styles.expenseDeleteText, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {/* Add new invitation */}
                    <ThemedText style={[styles.modalLabel, { marginTop: 8 }]}>Invite a Traveler</ThemedText>
                    <ThemedText style={styles.modalLabel}>Name</ThemedText>
                    <TextInput
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                      value={inviteName}
                      onChangeText={setInviteName}
                      placeholder="Traveler's name"
                      placeholderTextColor={theme.textSecondary}
                      autoCapitalize="words"
                      accessibilityLabel="Traveler name"
                    />
                    <ThemedText style={styles.modalLabel}>Email or Phone</ThemedText>
                    <TextInput
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                      value={inviteContact}
                      onChangeText={setInviteContact}
                      placeholder="email@example.com or +1 555 0100"
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      accessibilityLabel="Traveler contact"
                    />
                    <ThemedText style={styles.modalLabel}>Role</ThemedText>
                    <View style={styles.editChipRow}>
                      {(['member', 'viewer'] as const).map((r) => (
                        <Pressable
                          key={r}
                          onPress={() => setInviteRole(r)}
                          style={[
                            styles.editChip,
                            { borderColor: inviteRole === r ? theme.primary : theme.border,
                              backgroundColor: inviteRole === r ? theme.primary : theme.backgroundElement },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Role: ${r}`}
                        >
                          <ThemedText style={[styles.editChipText, inviteRole === r && { color: theme.primaryText }]}>
                            {r === 'member' ? 'Member (can edit)' : 'Viewer (read only)'}
                          </ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable
                      onPress={() => {
                        if (!inviteName.trim() || !inviteContact.trim()) return;
                        addInvitation(currentTrip.id, {
                          name: inviteName.trim(),
                          contact: inviteContact.trim(),
                          status: 'pending',
                          role: inviteRole,
                        });
                        Share.share({
                          message: `Join my trip to ${currentTrip.destination} on Travonal!\n\nTrip: ${currentTrip.title ?? currentTrip.destination}\nDates: ${currentTrip.startDate} to ${currentTrip.endDate}\nRole: ${inviteRole === 'member' ? 'Member (can edit)' : 'Viewer (read only)'}\n\n(Sent via Travonal)`,
                        });
                        setInviteName('');
                        setInviteContact('');
                        setInviteRole('member');
                      }}
                      style={[styles.addSaveBtn, { backgroundColor: theme.primary, marginTop: 8, opacity: inviteName.trim() && inviteContact.trim() ? 1 : 0.4 }]}
                      disabled={!inviteName.trim() || !inviteContact.trim()}
                      accessibilityRole="button"
                      accessibilityLabel="Send invitation"
                    >
                      <ThemedText style={[styles.addSaveText, { color: theme.primaryText }]}>Send Invitation</ThemedText>
                    </Pressable>
                    <ThemedText style={[styles.inviteDisclaimer, { color: theme.textSecondary }]}>
                      Invitations are shared via the native share sheet with an invite code. Accept/decline can be simulated locally. Real-time sync requires a backend (not yet implemented).
                    </ThemedText>
                  </>
                );
              })()}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add / Edit Reservation Modal (Task 3) */}
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
                {editingReservation ? 'Edit Reservation' : 'Add Reservation'}
              </ThemedText>
              <Pressable onPress={() => setShowAddReservationModal(false)} hitSlop={8} style={styles.addModalClose} accessibilityRole="button" accessibilityLabel="Close">
                <ThemedText style={[{ fontSize: 18, color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Paste booking link */}
              <ThemedText style={[styles.modalLabel, { marginTop: 0 }]}>Paste booking link (optional)</ThemedText>
              <TextInput
                style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                value={resPasteUrl}
                onChangeText={(url) => {
                  setResPasteUrl(url);
                  if (url.trim().startsWith('http')) {
                    // Try to extract title from URL path segments
                    try {
                      const parsed = new URL(url.trim());
                      const pathParts = parsed.pathname.split('/').filter(Boolean);
                      const lastSegment = pathParts[pathParts.length - 1] ?? '';
                      const guessedTitle = lastSegment
                        .replace(/[-_]/g, ' ')
                        .replace(/\.(html?|php|aspx?)$/i, '')
                        .trim();
                      if (guessedTitle && !resTitle) {
                        setResTitle(guessedTitle.charAt(0).toUpperCase() + guessedTitle.slice(1));
                      }
                      setResBookingUrl(url.trim());
                      setResParsedLabel('Simulated parsing -- review all fields');
                    } catch {
                      setResParsedLabel('');
                    }
                  } else {
                    setResParsedLabel('');
                  }
                }}
                placeholder="https://booking.com/..."
                placeholderTextColor={theme.textSecondary}
                keyboardType="url"
                autoCapitalize="none"
                accessibilityLabel="Paste booking link"
              />
              {resParsedLabel ? (
                <ThemedText style={[styles.budgetEstNote, { color: theme.primary }]}>{resParsedLabel}</ThemedText>
              ) : null}

              {/* Type picker */}
              <ThemedText style={styles.modalLabel}>Type</ThemedText>
              <View style={styles.typeRow}>
                {([
                  { value: 'restaurant', emoji: '\u{1F37D}\uFE0F' },
                  { value: 'hotel', emoji: '\u{1F3E8}' },
                  { value: 'flight', emoji: '\u2708\uFE0F' },
                  { value: 'train', emoji: '\u{1F682}' },
                  { value: 'activity', emoji: '\u{1F3AF}' },
                  { value: 'other', emoji: '\u{1F4CB}' },
                ] as { value: ReservationType; emoji: string }[]).map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => setResType(opt.value)}
                    style={[
                      styles.typeChip,
                      { backgroundColor: resType === opt.value ? theme.primary : 'transparent', borderWidth: 1, borderColor: resType === opt.value ? theme.primary : theme.border },
                    ]}
                  >
                    <ThemedText style={[styles.typeText, resType === opt.value && { color: theme.primaryText }]}>
                      {opt.emoji} {opt.value}
                    </ThemedText>
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
                autoFocus={!editingReservation}
                accessibilityLabel="Reservation name"
              />

              {/* Day */}
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

              {/* Date */}
              <ThemedText style={styles.modalLabel}>Date (optional, YYYY-MM-DD)</ThemedText>
              <TextInput
                style={[styles.addInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                value={resDate}
                onChangeText={setResDate}
                placeholder="2026-08-20"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Reservation date"
              />

              {/* Protected switch */}
              <View style={styles.resProtectedRow}>
                <ThemedText style={styles.resProtectedLabel}>Protected (cannot be auto-changed)</ThemedText>
                <Switch
                  value={resFixed}
                  onValueChange={setResFixed}
                  trackColor={{ false: theme.border, true: theme.primary }}
                  accessibilityLabel="Protected reservation"
                  accessibilityRole="switch"
                />
              </View>

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
                  // Validate day is within trip range
                  const dayNum = resDay ? parseInt(resDay, 10) : undefined;
                  if (dayNum != null && dayNum > totalDays) {
                    Alert.alert('Invalid day', `Day ${dayNum} is outside the trip range (1–${totalDays}).`);
                    return;
                  }
                  // Validate date is within trip date range
                  if (resDate.trim() && (resDate.trim() < currentTrip.startDate || resDate.trim() > currentTrip.endDate)) {
                    Alert.alert('Invalid date', `Date ${resDate.trim()} is outside the trip dates (${currentTrip.startDate} to ${currentTrip.endDate}).`);
                    return;
                  }
                  const payload: Omit<Reservation, 'id' | 'tripId'> = {
                    type: resType,
                    title: resTitle.trim(),
                    day: dayNum,
                    time: resTime || undefined,
                    confirmationNumber: resConfirmation.trim() || undefined,
                    bookingUrl: resBookingUrl.trim() || undefined,
                    price: resPrice ? parseFloat(resPrice) : undefined,
                    notes: resNotes.trim() || undefined,
                    address: resAddress.trim() || undefined,
                    currency: resCurrency || undefined,
                    fixed: resFixed || undefined,
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
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Hero — left-aligned, simplified
  hero: {
    paddingVertical: 24,
    paddingHorizontal: 24,
    gap: 4,
  },
  heroEmoji: { fontSize: 36, lineHeight: 48, marginBottom: 4 },
  heroCountry: { fontSize: 15 },
  heroDates: { fontSize: 13 },
  heroNotes: { fontSize: 14, fontStyle: 'italic', marginTop: 8 },
  heroActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  customizeBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  customizeBtnText: { fontSize: 15, fontWeight: '600' },

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
  toggleText: {
    fontSize: 15,
    fontWeight: '600',
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
    borderRadius: 16,
    alignItems: 'center' as const,
  },
  daySelectorText: {
    fontSize: 13,
    fontWeight: '600',
  },
  daySelectorTextActive: {
  },

  // Day issue link (replaces inline conflict cards)
  dayIssueLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  dayIssueLinkText: {
    fontSize: 12,
    fontWeight: '600',
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
    borderRadius: 12,
  },
  undoText: {
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  undoBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
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
    borderRadius: 16,
    backgroundColor: 'rgba(229,229,229,0.12)',
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
    borderRadius: 14,
    gap: 10,
    marginTop: 4,
  },
  addInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInputSmall: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    width: 80,
  },
  typeRow: { flexDirection: 'row', gap: 4, flex: 1, flexWrap: 'wrap' },
  typeChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  typeText: { fontSize: 12, fontWeight: '500' },
  addSaveBtn: {
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  addSaveText: { fontSize: 15, fontWeight: '600' },

  // Discover a place (Issue 2)
  discoverBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  discoverBtnText: { fontSize: 13, fontWeight: '600' },

  // Fix timing button (Issue 5)
  fixTimingBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
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
    borderRadius: 10,
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
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: { textAlign: 'center', marginBottom: 4 },
  modalSubtitle: { textAlign: 'center', fontSize: 14, marginBottom: 16 },
  modalLabel: { fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  modalInputMulti: { minHeight: 80, paddingTop: 12 },
  modalDateRow: { flexDirection: 'row', gap: 10 },
  modalDateBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  modalDateBtnText: { fontSize: 14 },
  replacePreview: { padding: 12, borderRadius: 10, borderWidth: 1, gap: 4, marginTop: 12 },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalBtnSecondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalBtnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  dayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  // Trip Prep
  prepProgress: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  prepProgressBar: { height: 4, borderRadius: 2, marginBottom: 16 },
  prepProgressFill: { height: 4, borderRadius: 2 },
  prepItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, marginBottom: 8, gap: 10 },
  prepCheckbox: { fontSize: 18, lineHeight: 22 },
  prepItemText: { fontSize: 14, fontWeight: '500', flex: 1 },
  prepItemDone: { textDecorationLine: 'line-through', opacity: 0.5 },
  prepRemove: { fontSize: 14, padding: 4 },
  prepAddRow: { flexDirection: 'row', gap: 8, marginTop: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, alignItems: 'center' },
  prepAddInput: { flex: 1, paddingVertical: 10, fontSize: 14 },
  prepAddBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  prepAddBtnText: { fontSize: 13, fontWeight: '600' },

  // Budget
  budgetCard: { padding: 16, borderRadius: 12, marginBottom: 12, gap: 4 },
  budgetLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  budgetAmount: { fontSize: 24, fontWeight: '700' },
  budgetEstNote: { fontSize: 11, fontStyle: 'italic', marginTop: 4 },
  budgetWarning: { fontSize: 12, color: '#DC2626', fontWeight: '600', marginTop: 4 },
  budgetEditRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  budgetInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  budgetSaveBtn: { paddingHorizontal: 20, borderRadius: 10, justifyContent: 'center' },
  budgetSaveBtnText: { fontSize: 14, fontWeight: '600' },
  budgetSectionTitle: { marginTop: 8, marginBottom: 12 },
  budgetDayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  budgetDayLabel: { fontSize: 14, fontWeight: '600', width: 50 },
  budgetDayAmount: { fontSize: 14, fontWeight: '700', width: 60 },
  budgetDayCount: { fontSize: 12, flex: 1 },

  // Expense cards
  expenseCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, marginBottom: 8, gap: 8 },
  expenseLabel: { fontSize: 14, fontWeight: '600' },
  expenseMeta: { fontSize: 12, marginTop: 2 },
  expenseAmount: { fontSize: 16, fontWeight: '700' },
  expenseDeleteBtn: { padding: 6 },
  expenseDeleteText: { fontSize: 14 },
  addExpenseForm: { borderRadius: 12, padding: 14, marginBottom: 12, gap: 8 },
  expenseCategoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },

  editChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  editChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  editChipText: { fontSize: 13, fontWeight: '500' },
  moveDayRow: { gap: 8, paddingVertical: 4 },
  moveDayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
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

  // Reservations view
  reservationsEmpty: {
    paddingVertical: 48,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  reservationsEmptyText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  reservationCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  reservationCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  reservationEmoji: {
    fontSize: 24,
    lineHeight: 32,
  },
  reservationTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  reservationMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  reservationCardActions: {
    flexDirection: 'row',
    gap: 4,
  },
  reservationActionBtn: {
    padding: 6,
  },
  reservationActionText: {
    fontSize: 16,
  },
  reservationLinkBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  reservationLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  reservationNotes: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  addResBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  addResBtnText: {
    fontSize: 15,
    fontWeight: '600',
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
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  resCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },

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
});
