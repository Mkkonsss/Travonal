import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';

import { DatePickerModal, formatDisplayDate } from '@/components/date-picker-modal';
import { TimePickerButton } from '@/components/time-picker';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trips';
import type { Activity } from '@/context/trips';
import { useBoards } from '@/context/boards';
import { useInbox } from '@/context/inbox';
import { useProfile } from '@/context/profile';
import { useTheme } from '@/hooks/use-theme';
import { generateId, suggestTimeForActivity } from '@/services/itinerary-engine';
import { buildGeoContext, distributeActivitiesAcrossDays } from '@/services/geo-cluster';
import { resolveCountry } from '@/services/trip-helpers';
import { cityAutocompleteAI, type CityAutocompleteSuggestion } from '@/services/ai';
import { useGate } from '@/hooks/use-gate';
import { UpgradePrompt } from '@/components/upgrade-prompt';
import { Image as ExpoImage } from 'expo-image';
import { fetchExplorePlaces } from '@/services/explore-service';
import { getPlacePhoto } from '@/services/free-photos';
import { getPlaceBookingLinks, openBookingLink } from '@/services/booking-links';
import type { NormalizedPlace } from '@/services/place-model';

const DESTINATION_EMOJIS: Record<string, string> = {
  tokyo: '\u{1F5FC}',
  japan: '\u{1F1EF}\u{1F1F5}',
  kyoto: '\u26E9\uFE0F',
  osaka: '\u{1F3EF}',
  paris: '\u{1F1EB}\u{1F1F7}',
  france: '\u{1F1EB}\u{1F1F7}',
  london: '\u{1F1EC}\u{1F1E7}',
  rome: '\u{1F1EE}\u{1F1F9}',
  italy: '\u{1F1EE}\u{1F1F9}',
  barcelona: '\u{1F1EA}\u{1F1F8}',
  spain: '\u{1F1EA}\u{1F1F8}',
  'new york': '\u{1F5FD}',
  miami: '\u{1F334}',
  hawaii: '\u{1F3D6}\uFE0F',
  bali: '\u{1F30A}',
  thailand: '\u{1F1F9}\u{1F1ED}',
  bangkok: '\u{1F6D5}',
  mexico: '\u{1F1F2}\u{1F1FD}',
  greece: '\u{1F1EC}\u{1F1F7}',
  santorini: '\u{1F3D6}\uFE0F',
  amsterdam: '\u{1F1F3}\u{1F1F1}',
  berlin: '\u{1F1E9}\u{1F1EA}',
  germany: '\u{1F1E9}\u{1F1EA}',
  australia: '\u{1F1E6}\u{1F1FA}',
  sydney: '\u{1F3D6}\uFE0F',
  iceland: '\u{1F9CA}',
  egypt: '\u{1F3DB}\uFE0F',
  morocco: '\u{1F1F2}\u{1F1E6}',
  dubai: '\u{1F3D9}\uFE0F',
  singapore: '\u{1F1F8}\u{1F1EC}',
  seoul: '\u{1F1F0}\u{1F1F7}',
  korea: '\u{1F1F0}\u{1F1F7}',
  india: '\u{1F1EE}\u{1F1F3}',
  portugal: '\u{1F1F5}\u{1F1F9}',
  lisbon: '\u{1F1F5}\u{1F1F9}',
  brazil: '\u{1F1E7}\u{1F1F7}',
  canada: '\u{1F1E8}\u{1F1E6}',
  switzerland: '\u{1F1E8}\u{1F1ED}',
  austria: '\u{1F1E6}\u{1F1F9}',
  prague: '\u{1F3F0}',
  vietnam: '\u{1F1FB}\u{1F1F3}',
};

const DEFAULT_EMOJI_POOL = [
  '\u{1F30D}', '\u{1F30E}', '\u{1F30F}', '\u{1F3D6}\uFE0F', '\u{1F3DD}\uFE0F',
  '\u{1F3DE}\uFE0F', '\u{1F5FA}\uFE0F', '\u{2708}\uFE0F', '\u{1F9F3}', '\u{1F30A}',
  '\u26F0\uFE0F', '\u{1F3D4}\uFE0F', '\u{1F334}', '\u{1F305}', '\u{1F303}',
];

function pickTripEmoji(destination: string): string {
  const lower = destination.toLowerCase().trim();
  // Check direct match
  if (DESTINATION_EMOJIS[lower]) return DESTINATION_EMOJIS[lower];
  // Check partial match
  for (const [key, emoji] of Object.entries(DESTINATION_EMOJIS)) {
    if (lower.includes(key) || key.includes(lower)) return emoji;
  }
  // Hash-based pick from the default pool
  let h = 0;
  for (const ch of lower) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return DEFAULT_EMOJI_POOL[Math.abs(h) % DEFAULT_EMOJI_POOL.length];
}

const PACE_OPTIONS = [
  { value: 'relaxed' as const, label: 'Relaxed' },
  { value: 'moderate' as const, label: 'Moderate' },
  { value: 'active' as const, label: 'Active' },
];

const BUDGET_OPTIONS = [
  { value: 'budget' as const, label: 'Budget' },
  { value: 'moderate' as const, label: 'Moderate' },
  { value: 'premium' as const, label: 'Premium' },
];

const TRAVEL_WITH_OPTIONS = [
  { value: 'solo' as const, label: 'Solo' },
  { value: 'partner' as const, label: 'Partner' },
  { value: 'family' as const, label: 'Family' },
  { value: 'friends' as const, label: 'Friends' },
  { value: 'group' as const, label: 'Group' },
];

const RESERVATION_TYPES = [
  { value: 'activity' as const, label: 'Activity' },
  { value: 'food' as const, label: 'Food' },
  { value: 'hotel' as const, label: 'Hotel' },
];

interface Reservation {
  id: string;
  title: string;
  dayOrDate: string;
  time: string;
  type: 'activity' | 'food' | 'hotel';
}

export default function AddTripScreen() {
  const { addTrip, addTripWithActivities } = useTrips();
  const { profile } = useProfile();
  const { items: inboxItems, markPlanned } = useInbox();
  const { initialDest, fromInboxDest, fromBoardId, mode: modeParam } = useLocalSearchParams<{ initialDest?: string; fromInboxDest?: string; fromBoardId?: string; mode?: string }>();
  const { boards, getBoard, createBoard, markItemPlanned } = useBoards();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const titleRef = useRef<TextInput>(null);
  const destRef = useRef<TextInput>(null);
  const generateGate = useGate('generate_trip');
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);

  // Mode: 'choose' (landing), 'quick' (Plan it for me), 'detailed' (Plan with Travonal)
  // Auto-enter quick mode when coming from inbox with saved items, or detailed if explicitly requested
  const [mode, setMode] = useState<'choose' | 'quick' | 'detailed'>(
    modeParam === 'detailed' ? 'detailed' : (fromInboxDest || fromBoardId ? 'quick' : 'choose'),
  );

  // Required fields
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState(initialDest ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateMode, setDateMode] = useState<'dates' | 'duration'>('dates');
  const [durationDays, setDurationDays] = useState(5);

  // Date picker modals
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Wizard step for quick mode (1-4)
  const [quickStep, setQuickStep] = useState(1);
  // Optional fields
  // country field removed from UI; derived from destination
  const [travelers, setTravelers] = useState(1);
  const [departureFrom, setDepartureFrom] = useState('');
  const [budget, setBudget] = useState<'budget' | 'moderate' | 'premium'>(profile.budget ?? 'moderate');
  const [pace, setPace] = useState<'relaxed' | 'moderate' | 'active'>(profile.pace);
  const [travelWith, setTravelWith] = useState<'solo' | 'partner' | 'family' | 'friends' | 'group'>(profile.travelWith ?? 'solo');
  const [tripPurpose] = useState('');
  const [restrictions] = useState('');
  const [notes, setNotes] = useState('');

  // Hotel suggestions for step 4
  const [hotelSuggestions, setHotelSuggestions] = useState<NormalizedPlace[]>([]);
  const [loadingHotels, setLoadingHotels] = useState(false);
  const [hotelPhotoUrls, setHotelPhotoUrls] = useState<Map<string, string>>(new Map());

  // Destination autocomplete
  const [destSuggestions, setDestSuggestions] = useState<CityAutocompleteSuggestion[]>([]);
  const [destSearching, setDestSearching] = useState(false);
  const destDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const destPickedRef = useRef(false);

  useEffect(() => {
    if (destPickedRef.current) { destPickedRef.current = false; return; }
    const query = destination.trim();
    if (query.length < 2) {
      setDestSuggestions([]);
      return;
    }
    if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
    destDebounceRef.current = setTimeout(async () => {
      setDestSearching(true);
      try {
        const result = await cityAutocompleteAI({ query });
        setDestSuggestions(result.suggestions.slice(0, 5));
      } catch {
        // Silently ignore autocomplete failures
      } finally {
        setDestSearching(false);
      }
    }, 400);
    return () => { if (destDebounceRef.current) clearTimeout(destDebounceRef.current); };
  }, [destination]);

  function selectDestination(place: CityAutocompleteSuggestion) {
    destPickedRef.current = true;
    setDestination(place.display);
    setDestSuggestions([]);
  }

  // Departing from autocomplete
  const [depSuggestions, setDepSuggestions] = useState<CityAutocompleteSuggestion[]>([]);
  const [depSearching, setDepSearching] = useState(false);
  const depDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const depPickedRef = useRef(false);

  useEffect(() => {
    if (depPickedRef.current) { depPickedRef.current = false; return; }
    const query = departureFrom.trim();
    if (query.length < 2) {
      setDepSuggestions([]);
      return;
    }
    if (depDebounceRef.current) clearTimeout(depDebounceRef.current);
    depDebounceRef.current = setTimeout(async () => {
      setDepSearching(true);
      try {
        const result = await cityAutocompleteAI({ query });
        setDepSuggestions(result.suggestions.slice(0, 5));
      } catch {
        // Silently ignore
      } finally {
        setDepSearching(false);
      }
    }, 400);
    return () => { if (depDebounceRef.current) clearTimeout(depDebounceRef.current); };
  }, [departureFrom]);

  function selectDeparture(place: CityAutocompleteSuggestion) {
    depPickedRef.current = true;
    setDepartureFrom(place.city);
    setDepSuggestions([]);
  }

  // Day assignments for detailed mode — maps activity title → day number
  const [dayAssignments, setDayAssignments] = useState<Map<string, number>>(new Map());

  // Board selection (when not coming from a board directly)
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(fromBoardId ?? null);
  const [excludedBoardItems, setExcludedBoardItems] = useState<Set<string>>(new Set());
  const boardsWithItems = boards.filter(b => b.items.some(i => !i.plannedTripId));

  // Sync URL params → state when params arrive after initial render (Expo Router timing).
  // This uses the React-supported "adjusting state during rendering" pattern.
  const prevFromBoardId = useRef(fromBoardId);
  if (fromBoardId && fromBoardId !== prevFromBoardId.current) {
    prevFromBoardId.current = fromBoardId;
    if (!selectedBoardId) setSelectedBoardId(fromBoardId);
    if (mode === 'choose') setMode(modeParam === 'detailed' ? 'detailed' : 'quick');
  }

  const prevInitialDest = useRef(initialDest);
  if (initialDest && initialDest !== prevInitialDest.current) {
    prevInitialDest.current = initialDest;
    if (!destination) setDestination(initialDest);
  }

  /**
   * Compute effective start/end dates.
   * Returns { start, end, datesKnown }.
   * When datesKnown=false, start/end are synthetic placeholders used only for
   * internal day-count calculation — they must NOT be displayed as real calendar dates.
   */
  function getEffectiveDates(): { start: string; end: string; datesKnown: boolean } {
    if (dateMode === 'dates' && startDate && endDate) {
      return { start: startDate, end: endDate, datesKnown: true };
    }
    // Duration mode: use a far-future synthetic anchor so the trip doesn't appear "upcoming soon".
    // datesKnown=false signals that these are NOT real dates.
    const anchor = new Date(2099, 0, 1); // neutral anchor, never shown
    const s = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-${String(anchor.getDate()).padStart(2, '0')}`;
    const endAnchor = new Date(anchor);
    endAnchor.setDate(endAnchor.getDate() + durationDays - 1);
    const e = `${endAnchor.getFullYear()}-${String(endAnchor.getMonth() + 1).padStart(2, '0')}-${String(endAnchor.getDate()).padStart(2, '0')}`;
    return { start: s, end: e, datesKnown: false };
  }

  // Fixed reservations
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [showAddReservation, setShowAddReservation] = useState(false);
  const [newResTitle, setNewResTitle] = useState('');
  const [newResDayOrDate, setNewResDayOrDate] = useState('');
  const [newResTime, setNewResTime] = useState('');
  const [newResType, setNewResType] = useState<'activity' | 'food' | 'hotel'>('activity');

  const today = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }];

  // Total trip days for reservation validation
  const totalTripDays = (() => {
    if (dateMode === 'duration') return durationDays;
    if (startDate && endDate && endDate >= startDate) {
      const [sy, sm, sd] = startDate.split('-').map(Number);
      const [ey, em, ed] = endDate.split('-').map(Number);
      return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
    }
    return 0; // dates not set yet
  })();

  function addReservation() {
    if (!newResTitle.trim()) return;
    const time = newResTime || '19:00';
    // Validate day number
    const dayNum = parseInt(newResDayOrDate.trim() || '1', 10);
    if (isNaN(dayNum) || dayNum < 1) return;
    if (totalTripDays > 0 && dayNum > totalTripDays) {
      Alert.alert('Invalid day', `Your trip is ${totalTripDays} day${totalTripDays !== 1 ? 's' : ''} long. Day ${dayNum} is out of range.`);
      return;
    }
    setReservations((prev) => [
      ...prev,
      {
        id: generateId(),
        title: newResTitle.trim(),
        dayOrDate: String(dayNum),
        time,
        type: newResType,
      },
    ]);
    setNewResTitle('');
    setNewResDayOrDate('');
    setNewResTime('');
    setNewResType('activity');
    setShowAddReservation(false);
  }

  function removeReservation(id: string) {
    setReservations((prev) => prev.filter((r) => r.id !== id));
  }

  function handleSetStartDate(date: string) {
    setStartDate(date);
    // Auto-clear end date if it's now before the new start
    if (date && endDate && endDate < date) {
      setEndDate('');
    }
  }

  // Validate end date is not before start date
  const dateWarning = startDate && endDate && endDate < startDate
    ? 'End date is before start date'
    : '';

  function handleBuild() {
    if (!destination.trim()) return;
    if (dateMode === 'dates' && startDate && endDate && endDate < startDate) {
      Alert.alert('Invalid dates', 'End date must be on or after the start date.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const dest = destination.trim();
    const tripTitle = title.trim() || `${dest} Trip`;
    const dates = getEffectiveDates();

    const buildActivities = reservations.map((r) => ({
      title: r.title,
      day: parseInt(r.dayOrDate, 10) || 1,
      time: r.time,
      type: r.type as Activity['type'],
      fixed: true,
      locked: true,
    }));

    const buildReservations = reservations.map((r) => ({
      type: (r.type === 'food' ? 'restaurant' : r.type) as 'restaurant' | 'hotel' | 'activity' | 'other',
      title: r.title,
      day: parseInt(r.dayOrDate, 10) || 1,
      time: r.time,
      fixed: true,
    }));

    // Pull matching inbox items
    const inboxItemsForDest = fromInboxDest
      ? inboxItems.filter(i => i.status !== 'planned' && i.destination?.toLowerCase() === fromInboxDest.toLowerCase())
      : [];
    // Use dayAssignments if available (from Step 5 preview), otherwise fall back to distribution
    const hasDayAssignments = dayAssignments.size > 0;
    const tripDays = dateMode === 'duration'
      ? durationDays
      : Math.max(1, Math.round((Date.parse(dates.end) - Date.parse(dates.start)) / 86400000) + 1);

    // Track placed activities for smart time suggestions
    const placedSoFar: Activity[] = [...buildActivities.map((a) => ({ id: '', ...a }) as Activity)];

    const inboxActivities = inboxItemsForDest.map((item) => {
      const actType = (item.activityType ?? (item.category === 'food' ? 'food' : 'activity')) as Activity['type'];
      const day = hasDayAssignments ? (dayAssignments.get(item.title) ?? 1) : 1;
      const time = hasDayAssignments
        ? suggestTimeForActivity(placedSoFar, day, actType)
        : `${9 + placedSoFar.filter(a => a.day === day).length}:00`;
      const act = { title: item.title, day, time, type: actType, requested: true, duration: item.duration, category: item.category, cost: item.cost, description: item.description };
      placedSoFar.push({ id: '', ...act } as Activity);
      return act;
    });

    // Pull board items
    const effectiveBoardId = selectedBoardId ?? fromBoardId;
    const board = effectiveBoardId ? getBoard(effectiveBoardId) : undefined;
    const boardItems = board
      ? board.items.filter(i => (fromBoardId ? true : !i.plannedTripId) && !excludedBoardItems.has(i.id))
      : [];
    const boardActivities = boardItems.map((item) => {
      const day = hasDayAssignments ? (dayAssignments.get(item.title) ?? 1) : 1;
      const actType = item.type as Activity['type'];
      const time = hasDayAssignments
        ? suggestTimeForActivity(placedSoFar, day, actType)
        : `${10 + placedSoFar.filter(a => a.day === day).length}:00`;
      const act = {
        title: item.title, day, time, type: actType, requested: true,
        duration: item.duration, category: item.category, cost: item.cost,
        description: item.description, placeId: item.placeId, address: item.address,
        lat: item.lat, lng: item.lng, openingHours: item.openingHours,
        rating: item.rating, reviewCount: item.reviewCount, notes: item.notes,
      };
      placedSoFar.push({ id: '', ...act } as Activity);
      return act;
    });

    const allActivities = [...buildActivities, ...inboxActivities, ...boardActivities];
    const hasActivities = allActivities.length > 0 || buildReservations.length > 0;

    const tripId = hasActivities
      ? addTripWithActivities({
          title: tripTitle,
          destination: dest,
          country: resolveCountry(dest) ?? dest,
          emoji: pickTripEmoji(dest),
          startDate: dates.start,
          endDate: dates.end,
          datesKnown: dates.datesKnown,
          notes: notes.trim(),
          budget: budget || profile.budget,
          pace: pace || profile.pace,
          travelWith: travelWith || profile.travelWith,
          departurePoint: departureFrom.trim() || undefined,
          tripPurpose: tripPurpose.trim() || undefined,
          restrictions: restrictions.trim() || undefined,
          travelers: travelers > 1 ? travelers : undefined,
          status: 'draft',
        }, allActivities, buildReservations)
      : addTrip({
          title: tripTitle,
          destination: dest,
          country: resolveCountry(dest) ?? dest,
          emoji: pickTripEmoji(dest),
          startDate: dates.start,
          endDate: dates.end,
          datesKnown: dates.datesKnown,
          notes: notes.trim(),
          budget: budget || profile.budget,
          pace: pace || profile.pace,
          travelWith: travelWith || profile.travelWith,
          departurePoint: departureFrom.trim() || undefined,
          tripPurpose: tripPurpose.trim() || undefined,
          restrictions: restrictions.trim() || undefined,
          travelers: travelers > 1 ? travelers : undefined,
          status: 'draft',
        });

    // Mark inbox items as planned
    for (const item of inboxItemsForDest) {
      markPlanned(item.id, tripId);
    }

    // Mark board items as planned
    if (effectiveBoardId) {
      for (const item of boardItems) {
        markItemPlanned(effectiveBoardId, item.id, tripId);
      }
    }

    router.push(`/trip/${tripId}` as any);
  }

  function handleQuickBuild() {
    if (!destination.trim()) return;
    if (dateMode === 'dates' && startDate && endDate && endDate < startDate) {
      Alert.alert('Invalid dates', 'End date must be on or after the start date.');
      return;
    }
    // Gate check: can the user generate an AI trip?
    if (!generateGate.allowed) {
      setShowUpgradePrompt(true);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const dest = destination.trim();
    const tripTitle = title.trim() || `${dest} Trip`;
    const dates = getEffectiveDates();

    const quickActivities = reservations.map((r) => ({
      title: r.title,
      day: parseInt(r.dayOrDate, 10) || 1,
      time: r.time,
      type: r.type as Activity['type'],
      fixed: true,
      locked: true,
    }));

    const quickReservations = reservations.map((r) => ({
      type: (r.type === 'food' ? 'restaurant' : r.type) as 'restaurant' | 'hotel' | 'activity' | 'other',
      title: r.title,
      day: parseInt(r.dayOrDate, 10) || 1,
      time: r.time,
      fixed: true,
    }));

    // Pull matching inbox items when coming from the inbox "Plan a trip" flow
    const inboxItemsForDest = fromInboxDest
      ? inboxItems.filter(i => i.status !== 'planned' && i.destination?.toLowerCase() === fromInboxDest.toLowerCase())
      : [];

    const inboxActivities = inboxItemsForDest.map((item, index) => ({
      title: item.title,
      day: 1, // placeholder — AI will redistribute across the trip
      time: `${9 + index}:00`,
      type: (item.activityType ?? (item.category === 'food' ? 'food' : 'activity')) as Activity['type'],
      requested: true,
      duration: item.duration,
      category: item.category,
      cost: item.cost,
      description: item.description,
    }));

    // Pull board items — from direct board link OR user-selected board in Step 4
    const effectiveBoardId = selectedBoardId ?? fromBoardId;
    const board = effectiveBoardId ? getBoard(effectiveBoardId) : undefined;
    const boardItems = board
      ? board.items.filter(i => (fromBoardId ? true : !i.plannedTripId) && !excludedBoardItems.has(i.id))
      : [];
    const tripDays = dateMode === 'duration'
      ? durationDays
      : Math.max(1, Math.round((Date.parse(dates.end) - Date.parse(dates.start)) / 86400000) + 1);
    const boardActivities = boardItems.map((item, index) => ({
      title: item.title,
      day: (index % tripDays) + 1,
      time: `${10 + Math.floor(index / tripDays)}:00`,
      type: item.type as Activity['type'],
      requested: true,
      duration: item.duration,
      category: item.category,
      cost: item.cost,
      description: item.description,
      placeId: item.placeId,
      address: item.address,
      lat: item.lat,
      lng: item.lng,
      openingHours: item.openingHours,
      rating: item.rating,
      reviewCount: item.reviewCount,
      notes: item.notes,
    }));

    const allActivities = [...quickActivities, ...inboxActivities, ...boardActivities];
    const requestedQuick = allActivities.filter(a => a.requested);
    const quickGeoContext = buildGeoContext(requestedQuick);
    const hasActivities = allActivities.length > 0 || quickReservations.length > 0;

    const tripId = hasActivities
      ? addTripWithActivities({
          title: tripTitle,
          destination: dest,
          country: resolveCountry(dest) ?? dest,
          emoji: pickTripEmoji(dest),
          startDate: dates.start,
          endDate: dates.end,
          datesKnown: dates.datesKnown,
          notes: notes.trim() || '',
          budget: budget || profile.budget,
          pace: pace || profile.pace,
          travelWith: travelWith || profile.travelWith,
          travelers: travelers > 1 ? travelers : undefined,
          departurePoint: departureFrom.trim() || undefined,
          geoContext: quickGeoContext || undefined,
          status: 'draft',
        }, allActivities, quickReservations)
      : addTrip({
          title: tripTitle,
          destination: dest,
          country: resolveCountry(dest) ?? dest,
          emoji: pickTripEmoji(dest),
          startDate: dates.start,
          endDate: dates.end,
          datesKnown: dates.datesKnown,
          notes: notes.trim() || '',
          budget: budget || profile.budget,
          pace: pace || profile.pace,
          travelWith: travelWith || profile.travelWith,
          travelers: travelers > 1 ? travelers : undefined,
          departurePoint: departureFrom.trim() || undefined,
          status: 'draft',
        });

    // Mark inbox items as planned
    for (const item of inboxItemsForDest) {
      markPlanned(item.id, tripId);
    }

    // Mark board items as planned
    if (effectiveBoardId) {
      for (const item of boardItems) {
        markItemPlanned(effectiveBoardId, item.id, tripId);
      }
    }

    router.push(`/generating-trip?tripId=${tripId}` as any);
  }

  // Compute days/nights from dates
  const daysNightsLabel = startDate && endDate && endDate >= startDate
    ? (() => {
        const [sy, sm, sd] = startDate.split('-').map(Number);
        const [ey, em, ed] = endDate.split('-').map(Number);
        const nights = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
        const days = nights + 1;
        return `${days} day${days !== 1 ? 's' : ''} / ${nights} night${nights !== 1 ? 's' : ''}`;
      })()
    : '';

  // Only title and destination are required now

  // ========== Mode chooser ==========
  if (mode === 'choose') {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.navHeader, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
          <View style={styles.navHeaderSpacer} />
          <ThemedText style={styles.navHeaderTitle}>New Trip</ThemedText>
          <View style={[styles.navHeaderBtn, { alignItems: 'flex-end' }]}>
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <SymbolView name="xmark" size={16} tintColor={theme.primary} />
            </Pressable>
          </View>
        </View>
        <View style={[styles.chooseContent, { paddingBottom: insets.bottom + 40 }]}>
          <ThemedText type="subtitle" style={styles.chooseTitle}>How would you like to start?</ThemedText>

          <Pressable
            onPress={() => setMode('quick')}
            style={({ pressed }) => [
              styles.chooseCard,
              { backgroundColor: theme.backgroundElement, borderColor: theme.primary, opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Start with a full plan"
          >
            <View style={styles.chooseCardHeader}>
              <ThemedText style={styles.chooseCardTitle}>Start with a full plan</ThemedText>
              <View style={[styles.recommendedBadge, { backgroundColor: theme.primaryMuted }]}>
                <ThemedText style={[styles.recommendedText, { color: theme.primary }]}>Recommended</ThemedText>
              </View>
            </View>
            <ThemedText style={[styles.chooseCardDesc, { color: theme.textSecondary }]}>
              Get a complete itinerary personalized to you. Swap, move, or change anything in seconds.
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => setMode('detailed')}
            style={({ pressed }) => [
              styles.chooseCard,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Build my own trip"
          >
            <ThemedText style={styles.chooseCardTitle}>Build my own trip</ThemedText>
            <ThemedText style={[styles.chooseCardDesc, { color: theme.textSecondary }]}>
              Start with an empty trip and add what you want, with Travonal ready to help at every step.
            </ThemedText>
          </Pressable>

          <ThemedText style={[styles.chooseFooter, { color: theme.textSecondary }]}>
            Whichever you choose, your trip stays flexible and effortless to update.
          </ThemedText>
        </View>
      </View>
    );
  }

  // ========== Multi-step wizard (both quick/AI and detailed/manual modes) ==========
  if (mode === 'quick' || mode === 'detailed') {
    const TOTAL_STEPS = 5;
    const stepTitles = [
      'Where are you going?',
      'When are you going?',
      'A few more details',
      (fromInboxDest || fromBoardId) ? 'Review your saved places' : 'Anything to include?',
      'Review your trip',
    ];
    const canGoNext =
      quickStep === 1 ? !!destination.trim() :
      quickStep === 2 ? (dateMode === 'duration' || (!!startDate && !!endDate)) :
      true;

    function handleNext() {
      if (quickStep < TOTAL_STEPS) {
        Haptics.selectionAsync();

        // Fetch hotel suggestions when entering step 4
        if (quickStep === 3 && destination.trim() && hotelSuggestions.length === 0) {
          setLoadingHotels(true);
          fetchExplorePlaces(
            { type: 'custom', query: destination, label: destination },
            'stays',
          ).then((places) => {
            const top = places.slice(0, 4);
            setHotelSuggestions(top);
            top.forEach((place) => {
              const photoRef = place.photos?.[0]?.reference;
              if (!photoRef) return;
              getPlacePhoto({
                cacheKey: place.placeId ?? place.name,
                photoRef,
                name: place.name,
                category: place.category,
              }).then((result) => {
                if (result) {
                  setHotelPhotoUrls((prev) => {
                    const next = new Map(prev);
                    next.set(place.placeId ?? place.name, result.url);
                    return next;
                  });
                }
              });
            });
          }).catch(() => {}).finally(() => setLoadingHotels(false));
        }

        // Pre-compute day assignments when entering review step in detailed mode
        if (quickStep === 4 && mode === 'detailed') {
          const dates = getEffectiveDates();
          const tripDays = dateMode === 'duration'
            ? durationDays
            : Math.max(1, Math.round((Date.parse(dates.end) - Date.parse(dates.start)) / 86400000) + 1);

          const effectiveBid = selectedBoardId ?? fromBoardId;
          const board = effectiveBid ? getBoard(effectiveBid) : undefined;
          const boardItems = board
            ? board.items.filter(i => (fromBoardId ? true : !i.plannedTripId) && !excludedBoardItems.has(i.id))
            : [];
          const inboxItemsForDest = fromInboxDest
            ? inboxItems.filter(i => i.status !== 'planned' && i.destination?.toLowerCase() === fromInboxDest.toLowerCase() && !excludedBoardItems.has(i.id))
            : [];

          const rawItems = [
            ...boardItems.map((item) => ({
              title: item.title,
              type: item.type as Activity['type'],
              lat: item.lat,
              lng: item.lng,
              address: item.address,
            })),
            ...inboxItemsForDest.map((item) => ({
              title: item.title,
              type: (item.activityType ?? (item.category === 'food' ? 'food' : 'activity')) as Activity['type'],
            })),
          ];

          if (rawItems.length > 0) {
            const existingActs = reservations.map((r) => ({
              id: r.id,
              title: r.title,
              day: parseInt(r.dayOrDate, 10) || 1,
              time: r.time,
              type: r.type as Activity['type'],
              fixed: true,
              locked: true,
            }));
            const distributed = distributeActivitiesAcrossDays(rawItems, tripDays, existingActs);
            const assignments = new Map<string, number>();
            for (const a of distributed) {
              assignments.set(a.title, a.day);
            }
            setDayAssignments(assignments);
          }
        }

        setQuickStep(quickStep + 1);
      } else {
        mode === 'detailed' ? handleBuild() : handleQuickBuild();
      }
    }

    function handleBack() {
      if (quickStep > 1) {
        setQuickStep(quickStep - 1);
      } else {
        setMode('choose');
      }
    }

    return (
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: theme.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.navHeader, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
          <Pressable onPress={handleBack} style={styles.navHeaderBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <ThemedText style={[styles.navHeaderBack, { color: theme.primary }]}>{'\u2039'} Back</ThemedText>
          </Pressable>
          <ThemedText style={styles.navHeaderTitle}>Step {quickStep} of {TOTAL_STEPS}</ThemedText>
          <View style={[styles.navHeaderBtn, { alignItems: 'flex-end' as const }]}>
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <SymbolView name="xmark" size={16} tintColor={theme.textSecondary} />
            </Pressable>
          </View>
        </View>

        {/* Progress bar */}
        <View style={[styles.progressBarTrack, { backgroundColor: theme.border }]}>
          <View style={[styles.progressBarFill, { width: `${(quickStep / TOTAL_STEPS) * 100}%`, backgroundColor: theme.primary }]} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="interactive"
        >
          <ThemedText type="subtitle" style={styles.wizardStepTitle}>{stepTitles[quickStep - 1]}</ThemedText>

          {/* ---- Step 1: Destination ---- */}
          {quickStep === 1 && (
            <>
              <ThemedText style={[styles.wizardHint, { color: theme.textSecondary }]}>
                {mode === 'quick'
                  ? "We'll build a complete itinerary personalized to you."
                  : "Start by choosing where you're headed."}
              </ThemedText>

              <ThemedText style={styles.label}>Destination *</ThemedText>
              <View style={{ position: 'relative', zIndex: 10 }}>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                  value={destination}
                  onChangeText={setDestination}
                  placeholder="e.g. Tokyo, Barcelona, Bali..."
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  autoFocus
                  returnKeyType="done"
                  accessibilityLabel="Destination"
                />
                {destSuggestions.length > 0 && (
                  <View style={[styles.autocompleteDropdown, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    {destSuggestions.map((place, i) => (
                      <Pressable
                        key={`${place.city}-${i}`}
                        onPress={() => selectDestination(place)}
                        style={[styles.autocompleteItem, i < destSuggestions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}
                        accessibilityRole="button"
                        accessibilityLabel={place.display}
                      >
                        <View style={styles.autocompleteItemRow}>
                          <SymbolView name="mappin.circle.fill" size={18} tintColor={theme.primary} />
                          <View style={{ flex: 1 }}>
                            <ThemedText style={styles.autocompleteItemText}>{place.city}</ThemedText>
                            <ThemedText style={[styles.autocompleteItemSub, { color: theme.textSecondary }]}>{place.display}</ThemedText>
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
                {destSearching && destination.length >= 2 && destSuggestions.length === 0 && (
                  <ThemedText style={[styles.autocompleteSearching, { color: theme.textSecondary }]}>Searching...</ThemedText>
                )}
              </View>

              <ThemedText style={styles.label}>Trip name (optional)</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                value={title}
                onChangeText={setTitle}
                placeholder={destination.trim() ? `${destination.trim()} Trip` : 'e.g. Summer Getaway'}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </>
          )}

          {/* ---- Step 2: Dates ---- */}
          {quickStep === 2 && (
            <>
              <ThemedText style={[styles.wizardHint, { color: theme.textSecondary }]}>
                {"Don't worry if you're not sure yet — you can always change this later."}
              </ThemedText>

              <View style={[styles.dateModeRow, { marginTop: 4 }]}>
                <Pressable
                  onPress={() => setDateMode('dates')}
                  style={[styles.dateModeBtn, { backgroundColor: dateMode === 'dates' ? theme.primary : theme.backgroundElement, borderColor: dateMode === 'dates' ? theme.primary : theme.border }]}
                  accessibilityRole="button"
                >
                  <ThemedText style={[styles.dateModeBtnText, dateMode === 'dates' && { color: theme.primaryText }]}>I know my dates</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setDateMode('duration')}
                  style={[styles.dateModeBtn, { backgroundColor: dateMode === 'duration' ? theme.primary : theme.backgroundElement, borderColor: dateMode === 'duration' ? theme.primary : theme.border }]}
                  accessibilityRole="button"
                >
                  <ThemedText style={[styles.dateModeBtnText, dateMode === 'duration' && { color: theme.primaryText }]}>Just duration</ThemedText>
                </Pressable>
              </View>

              {dateMode === 'dates' ? (
                <>
                  <View style={styles.row}>
                    <View style={styles.halfField}>
                      <ThemedText style={styles.label}>Start date</ThemedText>
                      <Pressable
                        onPress={() => setShowStartPicker(true)}
                        style={[styles.dateInput, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                        accessibilityRole="button"
                        accessibilityLabel="Select start date"
                      >
                        <ThemedText style={[styles.dateInputText, { color: startDate ? theme.text : theme.textSecondary }]}>
                          {startDate ? formatDisplayDate(startDate) : 'Tap to set'}
                        </ThemedText>
                      </Pressable>
                    </View>
                    <View style={styles.halfField}>
                      <ThemedText style={styles.label}>End date</ThemedText>
                      <Pressable
                        onPress={() => setShowEndPicker(true)}
                        style={[styles.dateInput, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                        accessibilityRole="button"
                        accessibilityLabel="Select end date"
                      >
                        <ThemedText style={[styles.dateInputText, { color: endDate ? theme.text : theme.textSecondary }]}>
                          {endDate ? formatDisplayDate(endDate) : 'Tap to set'}
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>

                  {dateWarning ? (
                    <ThemedText style={styles.dateWarning}>{dateWarning}</ThemedText>
                  ) : null}
                  {daysNightsLabel ? (
                    <ThemedText style={[styles.daysNightsLabel, { color: theme.primary }]}>{daysNightsLabel}</ThemedText>
                  ) : null}
                </>
              ) : (
                <>
                  <ThemedText style={styles.label}>How many days?</ThemedText>
                  <View style={styles.stepperRow}>
                    <Pressable
                      onPress={() => { Haptics.selectionAsync(); setDurationDays(Math.max(1, durationDays - 1)); }}
                      style={[styles.stepperBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease days"
                    >
                      <ThemedText style={styles.stepperBtnText}>{'\u2212'}</ThemedText>
                    </Pressable>
                    <ThemedText style={styles.stepperValue}>{durationDays} {durationDays === 1 ? 'day' : 'days'}</ThemedText>
                    <Pressable
                      onPress={() => { Haptics.selectionAsync(); setDurationDays(Math.min(30, durationDays + 1)); }}
                      style={[styles.stepperBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                      accessibilityRole="button"
                      accessibilityLabel="Increase days"
                    >
                      <ThemedText style={styles.stepperBtnText}>+</ThemedText>
                    </Pressable>
                  </View>
                  <ThemedText style={[styles.durationHint, { color: theme.textSecondary }]}>
                    {"You can set exact dates later from the trip screen."}
                  </ThemedText>
                </>
              )}

              <DatePickerModal
                visible={showStartPicker}
                label="Start date"
                value={startDate}
                onSelect={handleSetStartDate}
                onClose={() => setShowStartPicker(false)}
                minDate={today}
              />
              <DatePickerModal
                visible={showEndPicker}
                label="End date"
                value={endDate || startDate}
                onSelect={setEndDate}
                onClose={() => setShowEndPicker(false)}
                minDate={startDate || today}
              />
            </>
          )}

          {/* ---- Step 3: More details ---- */}
          {quickStep === 3 && (
            <>
              <ThemedText style={[styles.wizardHint, { color: theme.textSecondary }]}>
{mode === 'quick' ? 'These help us tailor your itinerary.' : 'Optional details about your trip.'}
              </ThemedText>

              <ThemedText style={styles.label}>Travelers</ThemedText>
              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    const n = Math.max(1, travelers - 1);
                    setTravelers(n);
                    if (n === 1 && travelWith !== 'solo') setTravelWith('solo');
                  }}
                  style={[styles.stepperBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease travelers"
                >
                  <ThemedText style={styles.stepperBtnText}>{'\u2212'}</ThemedText>
                </Pressable>
                <ThemedText style={styles.stepperValue}>{travelers}</ThemedText>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    const n = Math.min(20, travelers + 1);
                    setTravelers(n);
                    if (n > 1 && travelWith === 'solo') setTravelWith('partner');
                  }}
                  style={[styles.stepperBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Increase travelers"
                >
                  <ThemedText style={styles.stepperBtnText}>+</ThemedText>
                </Pressable>
              </View>

              <ThemedText style={styles.label}>Traveling with</ThemedText>
              <View style={styles.chipRow}>
                {TRAVEL_WITH_OPTIONS.map((o) => (
                  <Pressable
                    key={o.value}
                    onPress={() => {
                      setTravelWith(o.value);
                      if (o.value === 'solo' && travelers > 1) setTravelers(1);
                      if (o.value !== 'solo' && travelers < 2) setTravelers(2);
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: travelWith === o.value ? theme.primary : theme.backgroundElement,
                        borderColor: travelWith === o.value ? theme.primary : theme.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Travel with: ${o.label}`}
                  >
                    <ThemedText style={[styles.chipText, travelWith === o.value && { color: theme.primaryText }]}>
                      {o.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              <ThemedText style={styles.label}>Budget</ThemedText>
              <View style={styles.chipRow}>
                {BUDGET_OPTIONS.map((o) => (
                  <Pressable
                    key={o.value}
                    onPress={() => setBudget(o.value)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: budget === o.value ? theme.primary : theme.backgroundElement,
                        borderColor: budget === o.value ? theme.primary : theme.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Budget: ${o.label}`}
                  >
                    <ThemedText style={[styles.chipText, budget === o.value && { color: theme.primaryText }]}>
                      {o.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              <ThemedText style={styles.label}>Pace</ThemedText>
              <View style={styles.chipRow}>
                {PACE_OPTIONS.map((o) => (
                  <Pressable
                    key={o.value}
                    onPress={() => setPace(o.value)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: pace === o.value ? theme.primary : theme.backgroundElement,
                        borderColor: pace === o.value ? theme.primary : theme.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Pace: ${o.label}`}
                  >
                    <ThemedText style={[styles.chipText, pace === o.value && { color: theme.primaryText }]}>
                      {o.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              <ThemedText style={styles.label}>Departing from</ThemedText>
              <View style={{ position: 'relative', zIndex: 10 }}>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                  value={departureFrom}
                  onChangeText={setDepartureFrom}
                  placeholder="e.g. New York"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                />
                {depSuggestions.length > 0 && (
                  <View style={[styles.autocompleteDropdown, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    {depSuggestions.map((place, i) => (
                      <Pressable
                        key={`${place.city}-${i}`}
                        onPress={() => selectDeparture(place)}
                        style={[styles.autocompleteItem, i < depSuggestions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}
                        accessibilityRole="button"
                        accessibilityLabel={place.display}
                      >
                        <View style={styles.autocompleteItemRow}>
                          <SymbolView name="airplane.departure" size={16} tintColor={theme.textSecondary} />
                          <View style={{ flex: 1 }}>
                            <ThemedText style={styles.autocompleteItemText}>{place.city}</ThemedText>
                            <ThemedText style={[styles.autocompleteItemSub, { color: theme.textSecondary }]}>{place.display}</ThemedText>
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
                {depSearching && departureFrom.length >= 2 && depSuggestions.length === 0 && (
                  <ThemedText style={[styles.autocompleteSearching, { color: theme.textSecondary }]}>Searching...</ThemedText>
                )}
              </View>

              <ThemedText style={styles.label}>Notes</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                value={notes}
                onChangeText={setNotes}
                placeholder={mode === 'quick' ? "Anything else we should know..." : "Any notes for your trip..."}
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
              />
            </>
          )}

          {/* ---- Step 4: Saved places & reservations ---- */}
          {quickStep === 4 && (
            <>
              {/* ── Saved Places section ── */}
              <View style={[styles.step4Section, { marginTop: 8 }]}>
                <View style={styles.step4SectionHeader}>
                  <SymbolView name="rectangle.stack" size={16} tintColor={theme.primary} />
                  <ThemedText style={[styles.step4SectionTitle, { color: theme.text }]}>Saved Places</ThemedText>
                </View>
                <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 2 }}>
{mode === 'quick' ? 'Include places from a board so the AI builds around them.' : 'Include places from a board to add to your trip.'}
                </ThemedText>

                {/* Show saved items preview from inbox or selected board */}
                {(() => {
                  const inboxForDest = fromInboxDest
                    ? inboxItems.filter(i => i.status !== 'planned' && i.destination?.toLowerCase() === fromInboxDest.toLowerCase())
                    : [];
                  const effectiveBid = selectedBoardId ?? fromBoardId;
                  const board = effectiveBid ? getBoard(effectiveBid) : undefined;
                  // When navigating from a board directly, include all items (even previously planned ones)
                  const boardForTrip = board ? board.items.filter(i => fromBoardId ? true : !i.plannedTripId) : [];
                  const allSaved = [
                    ...inboxForDest.map(i => ({ id: i.id, title: i.title, source: 'inbox' as const })),
                    ...boardForTrip.map(i => ({ id: i.id, title: i.title, source: 'board' as const })),
                  ];
                  if (allSaved.length === 0) return null;
                  const includedCount = allSaved.filter(i => !excludedBoardItems.has(i.id)).length;
                  return (
                    <View style={[styles.savedItemsPreview, { backgroundColor: theme.primaryMuted, borderColor: theme.primary }]}>
                      <View style={styles.savedItemsHeader}>
                        <SymbolView name="sparkles" size={16} tintColor={theme.primary} />
                        <ThemedText style={[styles.savedItemsTitle, { color: theme.primary }]}>
                          {includedCount} of {allSaved.length} {allSaved.length === 1 ? 'place' : 'places'} selected
                        </ThemedText>
                      </View>
                      {allSaved.map((item) => {
                        const included = !excludedBoardItems.has(item.id);
                        return (
                          <Pressable
                            key={item.id}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setExcludedBoardItems(prev => {
                                const next = new Set(prev);
                                if (included) next.add(item.id);
                                else next.delete(item.id);
                                return next;
                              });
                            }}
                            style={styles.savedItemRow}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: included }}
                          >
                            <SymbolView
                              name={included ? 'checkmark.circle.fill' : 'circle'}
                              size={18}
                              tintColor={included ? theme.primary : theme.textSecondary}
                            />
                            <ThemedText style={[styles.savedItemText, !included && { color: theme.textSecondary, textDecorationLine: 'line-through' }]} numberOfLines={1}>{item.title}</ThemedText>
                          </Pressable>
                        );
                      })}
                      {selectedBoardId && !fromBoardId && (
                        <Pressable onPress={() => setSelectedBoardId(null)} style={{ marginTop: 6 }} accessibilityRole="button">
                          <ThemedText style={{ color: theme.primary, fontSize: 13, fontWeight: '600' }}>Remove board</ThemedText>
                        </Pressable>
                      )}
                    </View>
                  );
                })()}

                {/* Board picker — show when no board is selected */}
                {!selectedBoardId && !fromBoardId && (
                  <View style={{ gap: 8 }}>
                    {boardsWithItems.map((b) => {
                      const unplanned = b.items.filter(i => !i.plannedTripId).length;
                      return (
                        <Pressable
                          key={b.id}
                          onPress={() => { Haptics.selectionAsync(); setSelectedBoardId(b.id); }}
                          style={({ pressed }) => [
                            styles.boardPickCard,
                            { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Include ${b.name}`}
                        >
                          <SymbolView name="rectangle.stack" size={18} tintColor={theme.primary} />
                          <View style={{ flex: 1 }}>
                            <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>{b.name}</ThemedText>
                            <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                              {unplanned} {unplanned === 1 ? 'place' : 'places'}
                            </ThemedText>
                          </View>
                          <SymbolView name="plus.circle" size={20} tintColor={theme.primary} />
                        </Pressable>
                      );
                    })}
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        const id = createBoard('My Places');
                        setSelectedBoardId(id);
                        router.push(`/board-detail?id=${id}` as any);
                      }}
                      style={({ pressed }) => [
                        styles.addButton,
                        { borderColor: theme.text, opacity: pressed ? 0.85 : 1 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Create a new board"
                    >
                      <ThemedText style={[styles.addButtonText, { color: theme.text }]}>+ Create a board</ThemedText>
                    </Pressable>
                  </View>
                )}
              </View>

              {/* ── Where to Stay section ── */}
              {(hotelSuggestions.length > 0 || loadingHotels) && (
                <>
                  <View style={[styles.step4Divider, { backgroundColor: theme.border }]} />
                  <View style={styles.step4Section}>
                    <View style={styles.step4SectionHeader}>
                      <SymbolView name="bed.double.fill" size={16} tintColor={theme.primary} />
                      <ThemedText style={[styles.step4SectionTitle, { color: theme.text }]}>
                        Where to stay{destination.trim() ? ` in ${destination.trim()}` : ''}
                      </ThemedText>
                    </View>
                    <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 10 }}>
                      Book your accommodation early for the best rates.
                    </ThemedText>
                    {loadingHotels && hotelSuggestions.length === 0 ? (
                      <ThemedText type="small" style={{ color: theme.textSecondary, paddingVertical: 16, textAlign: 'center' }}>
                        Finding hotels...
                      </ThemedText>
                    ) : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                        {hotelSuggestions.map((hotel) => {
                          const photoUrl = hotelPhotoUrls.get(hotel.placeId ?? hotel.name);
                          const links = getPlaceBookingLinks(hotel.name, hotel.category, destination);
                          return (
                            <Pressable
                              key={hotel.placeId ?? hotel.name}
                              onPress={() => {
                                if (links[0]) openBookingLink(links[0].url);
                              }}
                              style={[styles.hotelCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
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
                      </ScrollView>
                    )}
                  </View>
                </>
              )}

              {/* ── Divider ── */}
              <View style={[styles.step4Divider, { backgroundColor: theme.border }]} />

              {/* ── Reservations section ── */}
              <View style={styles.step4Section}>
                <View style={styles.step4SectionHeader}>
                  <SymbolView name="calendar.badge.clock" size={16} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.step4SectionTitle, { color: theme.text }]}>Reservations</ThemedText>
                </View>
                <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 10 }}>
                  Pre-booked plans that the AI should work around.
                </ThemedText>

                {reservations.map((res) => (
                  <View
                    key={res.id}
                    style={[styles.reservationCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  >
                    <View style={styles.reservationInfo}>
                      <ThemedText type="smallBold">{res.title}</ThemedText>
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>
                        Day {res.dayOrDate} at {res.time} · {res.type}
                      </ThemedText>
                    </View>
                    <Pressable onPress={() => removeReservation(res.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove reservation">
                      <ThemedText style={{ color: theme.danger, fontSize: 14, fontWeight: '600' }}>Remove</ThemedText>
                    </Pressable>
                  </View>
                ))}

                {showAddReservation ? (
                  <View style={[styles.addResForm, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <TextInput
                      style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                      value={newResTitle}
                      onChangeText={setNewResTitle}
                      placeholder="e.g. Dinner at La Maison"
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="done"
                    />
                    <View style={styles.row}>
                      <View style={styles.halfField}>
                        <ThemedText type="small" style={{ marginBottom: 4 }}>Day number{totalTripDays > 0 ? ` (1\u2013${totalTripDays})` : ''}</ThemedText>
                        <TextInput
                          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                          value={newResDayOrDate}
                          onChangeText={setNewResDayOrDate}
                          placeholder="1"
                          placeholderTextColor={theme.textSecondary}
                          keyboardType="number-pad"
                          returnKeyType="done"
                        />
                      </View>
                      <View style={styles.halfField}>
                        <ThemedText type="small" style={{ marginBottom: 4 }}>Time</ThemedText>
                        <TimePickerButton
                          value={newResTime || '19:00'}
                          onChange={setNewResTime}
                        />
                      </View>
                    </View>
                    <View style={styles.chipRow}>
                      {RESERVATION_TYPES.map((t) => (
                        <Pressable
                          key={t.value}
                          onPress={() => setNewResType(t.value)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: newResType === t.value ? theme.primary : theme.backgroundElement,
                              borderColor: newResType === t.value ? theme.primary : theme.border,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Type: ${t.label}`}
                        >
                          <ThemedText style={[styles.chipText, newResType === t.value && { color: theme.primaryText }]}>
                            {t.label}
                          </ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.row}>
                      <Pressable
                        onPress={addReservation}
                        style={[styles.smallButton, { backgroundColor: theme.primary }]}
                        accessibilityRole="button"
                        accessibilityLabel="Add reservation"
                      >
                        <ThemedText style={[styles.smallButtonText, { color: theme.primaryText }]}>Add</ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => setShowAddReservation(false)}
                        style={[styles.smallButton, { backgroundColor: theme.backgroundElement, borderWidth: 1, borderColor: theme.border }]}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel reservation"
                      >
                        <ThemedText style={[styles.smallButtonText, { color: theme.text }]}>Cancel</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setShowAddReservation(true)}
                    style={[styles.addButton, { borderColor: theme.text }]}
                    accessibilityRole="button"
                    accessibilityLabel="Add reservation"
                  >
                    <ThemedText style={[styles.addButtonText, { color: theme.text }]}>
                      + Add reservation
                    </ThemedText>
                  </Pressable>
                )}
              </View>
            </>
          )}

          {/* ---- Step 5: Review ---- */}
          {quickStep === 5 && (
            <>
              <ThemedText style={[styles.wizardHint, { color: theme.textSecondary }]}>
{mode === 'quick' ? 'Make sure everything looks good before we start planning.' : 'Review your trip details before creating.'}
              </ThemedText>

              <View style={[styles.reviewCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                {/* Destination */}
                <View style={styles.reviewRow}>
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Destination</ThemedText>
                  <ThemedText style={styles.reviewValue}>{destination}</ThemedText>
                </View>

                {/* Trip name */}
                {title.trim() ? (
                  <View style={styles.reviewRow}>
                    <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Trip name</ThemedText>
                    <ThemedText style={styles.reviewValue}>{title}</ThemedText>
                  </View>
                ) : null}

                {/* Dates / Duration */}
                <View style={styles.reviewRow}>
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>
                    {dateMode === 'dates' ? 'Dates' : 'Duration'}
                  </ThemedText>
                  <ThemedText style={styles.reviewValue}>
                    {dateMode === 'dates' && startDate && endDate
                      ? `${formatDisplayDate(startDate)} \u2013 ${formatDisplayDate(endDate)}`
                      : `${durationDays} day${durationDays !== 1 ? 's' : ''}`}
                  </ThemedText>
                </View>

                {/* Travelers */}
                <View style={styles.reviewRow}>
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Travelers</ThemedText>
                  <ThemedText style={styles.reviewValue}>
                    {travelers} · {TRAVEL_WITH_OPTIONS.find(o => o.value === travelWith)?.label ?? travelWith}
                  </ThemedText>
                </View>

                {/* Budget */}
                <View style={styles.reviewRow}>
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Budget</ThemedText>
                  <ThemedText style={styles.reviewValue}>
                    {BUDGET_OPTIONS.find(o => o.value === budget)?.label ?? budget}
                  </ThemedText>
                </View>

                {/* Pace */}
                <View style={styles.reviewRow}>
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Pace</ThemedText>
                  <ThemedText style={styles.reviewValue}>
                    {PACE_OPTIONS.find(o => o.value === pace)?.label ?? pace}
                  </ThemedText>
                </View>

                {/* Departing from */}
                {departureFrom.trim() ? (
                  <View style={styles.reviewRow}>
                    <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Departing from</ThemedText>
                    <ThemedText style={styles.reviewValue}>{departureFrom}</ThemedText>
                  </View>
                ) : null}

                {/* Notes */}
                {notes.trim() ? (
                  <View style={styles.reviewRow}>
                    <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Notes</ThemedText>
                    <ThemedText style={styles.reviewValue}>{notes}</ThemedText>
                  </View>
                ) : null}
              </View>

              {/* Board / inbox items — grouped by day in detailed mode, simple count in quick mode */}
              {(() => {
                const effectiveBid = selectedBoardId ?? fromBoardId;
                const boardForTrip = effectiveBid
                  ? (getBoard(effectiveBid)?.items.filter(i => (fromBoardId ? true : !i.plannedTripId) && !excludedBoardItems.has(i.id)) ?? [])
                  : [];
                const inboxForDest = fromInboxDest
                  ? inboxItems.filter(i => i.status !== 'planned' && i.destination?.toLowerCase() === fromInboxDest.toLowerCase() && !excludedBoardItems.has(i.id))
                  : [];
                const savedCount = boardForTrip.length + inboxForDest.length;
                if (savedCount === 0 && reservations.length === 0) return null;

                const dates = getEffectiveDates();
                const tripDays = dateMode === 'duration'
                  ? durationDays
                  : Math.max(1, Math.round((Date.parse(dates.end) - Date.parse(dates.start)) / 86400000) + 1);

                // Detailed mode: show grouped-by-day with day pickers
                if (mode === 'detailed' && savedCount > 0 && dayAssignments.size > 0) {
                  const allSavedTitles = [
                    ...boardForTrip.map(i => i.title),
                    ...inboxForDest.map(i => i.title),
                  ];
                  // Group by assigned day
                  const byDay = new Map<number, string[]>();
                  for (const title of allSavedTitles) {
                    const day = dayAssignments.get(title) ?? 1;
                    if (!byDay.has(day)) byDay.set(day, []);
                    byDay.get(day)!.push(title);
                  }
                  const sortedDays = [...byDay.entries()].sort((a, b) => a[0] - b[0]);

                  return (
                    <View style={[styles.reviewCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border, marginTop: 12, gap: 0 }]}>
                      <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary, marginBottom: 4 }]}>
                        Saved places
                      </ThemedText>
                      {sortedDays.map(([day, titles], idx) => (
                        <View key={day} style={idx < sortedDays.length - 1 ? { marginBottom: 6 } : undefined}>
                          <ThemedText style={[styles.reviewValue, { fontWeight: '600', textAlign: 'left', marginBottom: 2 }]}>
                            Day {day}
                          </ThemedText>
                          {titles.map((title) => (
                            <View key={title} style={styles.dayAssignRow}>
                              <ThemedText style={[styles.reviewValue, { flex: 1, fontSize: 14, textAlign: 'left' }]} numberOfLines={1}>
                                {title}
                              </ThemedText>
                              <View style={styles.dayStepper}>
                                <Pressable
                                  onPress={() => {
                                    const current = dayAssignments.get(title) ?? 1;
                                    const prev = current <= 1 ? tripDays : current - 1;
                                    const updated = new Map(dayAssignments);
                                    updated.set(title, prev);
                                    setDayAssignments(updated);
                                  }}
                                  style={[styles.dayStepBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                                  hitSlop={4}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Move ${title} to previous day`}
                                >
                                  <ThemedText style={[styles.dayStepBtnText, { color: theme.primary }]}>{'\u2212'}</ThemedText>
                                </Pressable>
                                <ThemedText style={[styles.dayStepLabel, { color: theme.primary }]}>
                                  {dayAssignments.get(title) ?? 1}
                                </ThemedText>
                                <Pressable
                                  onPress={() => {
                                    const current = dayAssignments.get(title) ?? 1;
                                    const next = current >= tripDays ? 1 : current + 1;
                                    const updated = new Map(dayAssignments);
                                    updated.set(title, next);
                                    setDayAssignments(updated);
                                  }}
                                  style={[styles.dayStepBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                                  hitSlop={4}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Move ${title} to next day`}
                                >
                                  <ThemedText style={[styles.dayStepBtnText, { color: theme.primary }]}>+</ThemedText>
                                </Pressable>
                              </View>
                            </View>
                          ))}
                        </View>
                      ))}
                      {reservations.length > 0 && (
                        <View style={{ gap: 6, marginTop: 4 }}>
                          <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Reservations</ThemedText>
                          {reservations.map((r) => (
                            <ThemedText key={r.id} style={[styles.reviewValue, { fontSize: 14 }]}>
                              {r.title} · Day {r.dayOrDate} at {r.time}
                            </ThemedText>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                }

                // Quick mode or no saved places: simple count
                return (
                  <View style={[styles.reviewCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border, marginTop: 12 }]}>
                    {savedCount > 0 && (
                      <View style={styles.reviewRow}>
                        <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Saved places</ThemedText>
                        <ThemedText style={styles.reviewValue}>{savedCount} included</ThemedText>
                      </View>
                    )}
                    {reservations.length > 0 && (
                      <View style={{ gap: 6 }}>
                        <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Reservations</ThemedText>
                        {reservations.map((r) => (
                          <ThemedText key={r.id} style={[styles.reviewValue, { fontSize: 14 }]}>
                            {r.title} · Day {r.dayOrDate} at {r.time}
                          </ThemedText>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })()}
            </>
          )}

          {/* Bottom navigation */}
          <View style={styles.wizardNav}>
            <Pressable
              onPress={handleNext}
              style={({ pressed }) => [
                styles.buildButton,
                { backgroundColor: theme.primary, opacity: !canGoNext ? 0.4 : pressed ? 0.85 : 1 },
              ]}
              disabled={!canGoNext}
              accessibilityRole="button"
              accessibilityLabel={quickStep === TOTAL_STEPS ? (mode === 'detailed' ? 'Create trip' : 'Plan my trip') : 'Next'}
            >
              <ThemedText style={[styles.buildButtonText, { color: theme.primaryText }]}>
                {quickStep === TOTAL_STEPS ? (mode === 'detailed' ? 'Create trip' : 'Plan my trip') : 'Next'}
              </ThemedText>
            </Pressable>

            {(quickStep === 3 || quickStep === 4) && (
              <Pressable
                onPress={() => setQuickStep(quickStep + 1)}
                style={styles.skipBtn}
                accessibilityRole="button"
                accessibilityLabel="Skip this step"
              >
                <ThemedText style={[styles.skipText, { color: theme.textSecondary }]}>Skip</ThemedText>
              </Pressable>
            )}

            {quickStep === 1 && mode === 'quick' && (
              <Pressable onPress={() => setMode('detailed')} style={styles.switchModeBtn} accessibilityRole="button" accessibilityLabel="Build my own trip">
                <ThemedText style={[styles.switchModeText, { color: theme.textSecondary }]}>
                  Want more control? Build my own trip
                </ThemedText>
              </Pressable>
            )}
          </View>
        </ScrollView>
        <UpgradePrompt
          visible={showUpgradePrompt}
          feature="generate_trip"
          title="Unlimited AI trip plans"
          description="Generate up to 3 AI-powered itineraries every month with Travonal+."
          icon="sparkles"
          onClose={() => setShowUpgradePrompt(false)}
        />
      </KeyboardAvoidingView>
    );
  }

  // Fallback (should not reach here)
  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navHeaderTitle: { fontSize: 17, fontWeight: '600' as const, textAlign: 'center' as const },
  navHeaderBtn: { width: 64 },
  navHeaderSpacer: { width: 64 },
  navHeaderBack: { fontSize: 17, fontWeight: '500' as const },
  navHeaderClose: { fontSize: 22, fontWeight: '300' as const, textAlign: 'right' as const },
  scrollContent: { padding: Spacing.four, gap: 4 },
  sectionTitle: {
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  label: { fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    minHeight: 48,
  },
  row: { flexDirection: 'row', gap: 12 },
  halfField: { flex: 1 },
  multilineInput: { minHeight: 80, paddingTop: 12 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: '500' },
  showMoreBtn: { paddingVertical: 12, alignItems: 'center' },
  showMoreText: { fontSize: 14, fontWeight: '600' },

  // Date input (tappable)
  dateInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  dateInputText: { fontSize: 16 },
  dateWarning: { color: '#DC2626', fontSize: 13, fontWeight: '500', marginTop: 4 },
  daysNightsLabel: { fontSize: 13, fontWeight: '600', marginTop: 4, textAlign: 'center' as const },

  // Reservations
  reservationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
    marginBottom: 8,
  },
  reservationInfo: { flex: 1, gap: 2 },
  addResForm: {
    padding: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: 10,
    marginBottom: 8,
  },
  addButton: {
    borderWidth: 1.5,
    borderRadius: Radius.sm,
    borderStyle: 'dashed',
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonText: { fontSize: 14, fontWeight: '600' },
  smallButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  smallButtonText: { fontSize: 14, fontWeight: '600' },
  buildButton: {
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: Spacing.four,
  },
  buildButtonText: { fontSize: 17, fontWeight: '700' },

  // Choose mode
  chooseContent: {
    flex: 1,
    padding: Spacing.four,
    justifyContent: 'center',
    gap: 16,
  },
  chooseTitle: { textAlign: 'center', marginBottom: 8 },
  chooseCard: {
    borderRadius: Radius.md,
    borderWidth: 1.5,
    padding: 20,
    gap: 8,
  },
  chooseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  chooseCardTitle: { fontSize: 17, fontWeight: '700' },
  chooseCardDesc: { fontSize: 14, lineHeight: 21 },
  recommendedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recommendedText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  chooseFooter: { fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 8 },

  // Quick mode wizard
  progressBarTrack: { height: 3 },
  progressBarFill: { height: 3 },
  wizardStepTitle: { marginBottom: 4, marginTop: 8 },
  wizardHint: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  wizardNav: { marginTop: Spacing.four },
  skipBtn: { paddingVertical: 12, alignItems: 'center' as const },
  skipText: { fontSize: 14, fontWeight: '500' as const },
  switchModeBtn: { paddingVertical: 16, alignItems: 'center' as const },
  switchModeText: { fontSize: 14, fontWeight: '500' as const },
  savedItemsPreview: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    marginBottom: 12,
  },
  savedItemsHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  savedItemsTitle: { fontSize: 14, fontWeight: '600' as const },
  savedItemRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingLeft: 4,
  },
  savedItemText: { fontSize: 14, flex: 1 },

  // Date mode toggle
  dateModeRow: { flexDirection: 'row', gap: 8 },
  dateModeBtn: { flex: 1, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center' },
  dateModeBtnText: { fontSize: 14, fontWeight: '600' },

  // Stepper
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: 'center', paddingVertical: 8 },
  stepperBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontSize: 20, fontWeight: '500' },
  stepperValue: { fontSize: 18, fontWeight: '700', minWidth: 80, textAlign: 'center' },

  // Duration hint
  durationHint: { fontSize: 13, textAlign: 'center', marginTop: 4 },

  // Destination autocomplete
  autocompleteDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: 'hidden',
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  boardPickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  autocompleteItem: { paddingHorizontal: 14, paddingVertical: 11 },
  autocompleteItemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  autocompleteItemText: { fontSize: 15, fontWeight: '500' },
  autocompleteItemSub: { fontSize: 12, marginTop: 2 },
  autocompleteSearching: { fontSize: 12, marginTop: 4, paddingHorizontal: 4 },

  // Review card (Step 5)
  reviewCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  reviewLabel: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 0,
  },
  reviewValue: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  dayAssignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
    paddingLeft: 8,
    gap: 8,
  },
  dayStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayStepBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayStepBtnText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 16,
  },
  dayStepLabel: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 14,
    textAlign: 'center',
  },

  // Step 4 sections
  step4Section: {
    gap: 10,
  },
  step4SectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  step4SectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  step4Divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 20,
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

});
