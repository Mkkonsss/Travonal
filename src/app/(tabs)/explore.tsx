import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';

import { TimePickerButton } from '@/components/time-picker';
import { SelectionSheet, SelectionOption } from '@/components/selection-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useSavedPlaces, SavedPlace } from '@/context/saved-places';
import { useMemory } from '@/context/memory';
import { useTheme } from '@/hooks/use-theme';
import { PlaceWithDestination, searchAllPlaces, personalizeResults, BROWSE_CATEGORIES } from '@/services/places-data';
import { loadRecentSearches, saveRecentSearches } from '@/services/storage';
import {
  parseSearchQuery,
  applyDietaryFilter,
  summarizeFeedback,
  applyFeedbackToResults,
  hasDuplicateFeedback,
} from '@/services/explore-filters';

// ============ Constants ============

const SORT_OPTIONS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'rating', label: 'Highest rated' },
  { id: 'reviews', label: 'Most reviewed' },
  { id: 'price_low', label: 'Lowest price' },
] as const;

const CUISINE_FILTERS = [
  'All', 'Ramen', 'Soba', 'Izakaya', 'Tapas', 'Pintxos', 'Market',
  'Street food', 'Cafe', 'Seafood', 'Vegetarian',
] as const;

const ATMOSPHERE_FILTERS = [
  'Quiet', 'Lively', 'Romantic', 'Casual', 'Authentic', 'Trendy', 'Historic',
] as const;

const MEAL_FILTERS = [
  { id: 'all', label: 'Any time' },
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
] as const;

const TAG_TINTS: Record<string, string> = {
  activity: 'rgba(229,229,229,0.08)',
  food: 'rgba(229,229,229,0.06)',
  culture: 'rgba(229,229,229,0.08)',
  nature: 'rgba(22,163,74,0.08)',
  shopping: 'rgba(229,229,229,0.06)',
  nightlife: 'rgba(229,229,229,0.08)',
};

const COST_LABELS: Record<string, string> = {
  free: 'Free', budget: '$', moderate: '$$', premium: '$$$',
};

const SEARCH_SUGGESTIONS = [
  'Best ramen in Tokyo',
  'Quiet cafes',
  'Free things to do',
  'Romantic dinner spots',
  'Street food',
  'Art museums',
  'Outdoor activities',
  'Local hidden gems',
];

const CATEGORY_SHORTCUTS = [
  { id: 'food', label: 'Restaurants', icon: '\u{1F37D}\uFE0F' },
  { id: 'hotel', label: 'Stays', icon: '\u{1F3E8}' },
  { id: 'culture', label: 'Things to do', icon: '\u{1F3AD}' },
  { id: 'nature', label: 'Attractions', icon: '\u{1F3DE}\uFE0F' },
  { id: 'shopping', label: 'Shopping', icon: '\u{1F6CD}\uFE0F' },
  { id: 'art', label: 'Scenic', icon: '\u{1F305}' },
  { id: 'cafe', label: 'Cafes', icon: '\u2615' },
];

// ============ Helpers ============

function getMatchReason(
  place: PlaceWithDestination,
  profile: { interests: string[]; budget: string; pace: string },
): string | null {
  if (place.matchReasons && place.matchReasons.length > 0) {
    return place.matchReasons[0];
  }
  for (const interest of profile.interests) {
    if (place.tags.some((t) => t.toLowerCase().includes(interest.toLowerCase()))) {
      return `Matches your interest in ${interest}`;
    }
    if (place.category.toLowerCase().includes(interest.toLowerCase())) {
      return `Matches your interest in ${interest}`;
    }
  }
  const budgetOrder = ['free', 'budget', 'moderate', 'premium'];
  const userIdx = budgetOrder.indexOf(profile.budget);
  const placeIdx = budgetOrder.indexOf(place.cost);
  if (placeIdx <= userIdx && placeIdx >= 0) return 'Fits your budget';
  if (profile.pace === 'relaxed' && place.energyLevel === 'low') return 'Great for your relaxed pace';
  if (profile.pace === 'active' && place.energyLevel === 'high') return 'Matches your active pace';
  return null;
}

function isHighlyRecommended(
  place: PlaceWithDestination,
  profile: { interests: string[]; dislikes: string[]; budget: string; pace: string },
): boolean {
  let score = 0;
  for (const interest of profile.interests) {
    if (place.tags.some((t) => t.toLowerCase().includes(interest.toLowerCase()))) score += 3;
    if (place.category.toLowerCase().includes(interest.toLowerCase())) score += 2;
  }
  if (profile.dislikes.includes('Crowds') && place.crowdLevel === 'high') score -= 5;
  const budgetOrder = ['free', 'budget', 'moderate', 'premium'];
  if (budgetOrder.indexOf(place.cost) <= budgetOrder.indexOf(profile.budget)) score += 2;
  if (profile.pace === 'relaxed' && place.energyLevel === 'low') score += 2;
  if (profile.pace === 'active' && place.energyLevel === 'high') score += 2;
  return score >= 4;
}

// parseNaturalSearch is now the exported parseSearchQuery from explore-filters.ts

function sortPlaces(places: PlaceWithDestination[], sortBy: string): PlaceWithDestination[] {
  const sorted = [...places];
  switch (sortBy) {
    case 'rating':
      return sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    case 'reviews':
      return sorted.sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
    case 'price_low': {
      const order = { free: 0, budget: 1, moderate: 2, premium: 3 };
      return sorted.sort((a, b) => (order[a.cost] ?? 2) - (order[b.cost] ?? 2));
    }
    default:
      return sorted;
  }
}

// ============ PlaceCard ============

function PlaceCard({
  place,
  onAdd,
  onToggleSave,
  onDetails,
  onFeedback,
  saved,
  matchReason,
  showBadge,
}: {
  place: PlaceWithDestination;
  onAdd: () => void;
  onToggleSave: () => void;
  onDetails: () => void;
  onFeedback: (type: string) => void;
  saved: boolean;
  matchReason?: string | null;
  showBadge?: boolean;
}) {
  const theme = useTheme();
  const [showFeedback, setShowFeedback] = useState(false);

  return (
    <Pressable
      onPress={onDetails}
      style={[styles.placeCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${place.title}, ${place.destination}`}
    >
      {showBadge && (
        <View style={[styles.recBadge, { backgroundColor: theme.primaryMuted }]}>
          <ThemedText style={[styles.recBadgeText, { color: theme.primary }]}>Recommended for you</ThemedText>
        </View>
      )}

      {/* Top: title, location, save */}
      <View style={styles.placeTop}>
        <View style={styles.placeInfo}>
          <ThemedText style={styles.placeTitle}>{place.title}</ThemedText>
          <View style={styles.placeMetaRow}>
            {place.cuisine && (
              <ThemedText style={[styles.placeMeta, { color: theme.textSecondary }]}>{place.cuisine}</ThemedText>
            )}
            <ThemedText style={[styles.placeMeta, { color: theme.textSecondary }]}>
              {place.neighborhood ?? place.destination}
            </ThemedText>
            {place.walkingTime && (
              <ThemedText style={[styles.placeMeta, { color: theme.textSecondary }]}>{place.walkingTime}</ThemedText>
            )}
          </View>
        </View>
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggleSave(); }} style={styles.saveBtn} accessibilityRole="button" accessibilityLabel={saved ? `Unsave ${place.title}` : `Save ${place.title}`}>
          <ThemedText style={styles.saveIcon}>{saved ? '\u2665' : '\u2661'}</ThemedText>
        </Pressable>
      </View>

      {/* Rating row */}
      {place.rating != null && (
        <View style={styles.ratingRow}>
          <ThemedText style={styles.ratingStar}>{'\u2605'}</ThemedText>
          <ThemedText style={styles.ratingNum}>{place.rating.toFixed(1)}</ThemedText>
          {place.reviewCount != null && (
            <ThemedText style={[styles.reviewCount, { color: theme.textSecondary }]}>({place.reviewCount})</ThemedText>
          )}
          <ThemedText style={[styles.priceBadge, { color: theme.primary }]}>{COST_LABELS[place.cost]}</ThemedText>
          {place.openNow != null && (
            <ThemedText style={[styles.openStatus, { color: place.openNow ? '#22C55E' : '#DC2626' }]}>
              {place.openNow ? `Open${place.closingTime ? ` \u00B7 Closes ${place.closingTime}` : ''}` : 'Closed'}
            </ThemedText>
          )}
        </View>
      )}

      {/* Description */}
      {place.description && (
        <ThemedText style={[styles.placeDesc, { color: theme.textSecondary }]} numberOfLines={2}>
          {place.description}
        </ThemedText>
      )}

      {/* Sample data label */}
      <ThemedText style={styles.sampleInfoLabel}>Sample information</ThemedText>

      {/* Match reason */}
      {matchReason && (
        <ThemedText style={[styles.matchReason, { color: theme.primary }]}>{matchReason}</ThemedText>
      )}

      {/* Warning */}
      {place.warnings && place.warnings.length > 0 && (
        <ThemedText style={[styles.warningText, { color: '#DC2626' }]} numberOfLines={1}>
          {'\u26A0'} {place.warnings[0]}
        </ThemedText>
      )}

      {/* Atmosphere tags */}
      {place.atmosphere && place.atmosphere.length > 0 && (
        <View style={styles.tagRow}>
          {place.atmosphere.slice(0, 3).map((a) => (
            <View key={a} style={[styles.atmoChip, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={[styles.atmoChipText, { color: theme.primary }]}>{a}</ThemedText>
            </View>
          ))}
        </View>
      )}

      {/* Bottom: type tag, duration, add button */}
      <View style={styles.placeBottom}>
        <View style={styles.tagRow}>
          <View style={[styles.typeTag, { backgroundColor: TAG_TINTS[place.type] ?? 'rgba(128,128,128,0.08)' }]}>
            <ThemedText style={styles.typeTagText}>{place.type}</ThemedText>
          </View>
          <ThemedText style={[styles.durationText, { color: theme.textSecondary }]}>{place.duration}m</ThemedText>
        </View>
        <View style={styles.cardActions}>
          <Pressable
            onPress={(e) => { e.stopPropagation(); setShowFeedback(!showFeedback); }}
            style={styles.feedbackBtn}
            accessibilityRole="button"
            accessibilityLabel="More options"
          >
            <ThemedText style={[styles.feedbackIcon, { color: theme.textSecondary }]}>{'\u2026'}</ThemedText>
          </Pressable>
          <Pressable onPress={(e) => { e.stopPropagation(); onAdd(); }} style={[styles.addBtn, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel={`Add ${place.title} to trip`}>
            <ThemedText style={[styles.addBtnText, { color: theme.primaryText }]}>Add</ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Feedback menu */}
      {showFeedback && (
        <Animated.View entering={FadeIn.duration(150)}>
          <View style={[styles.feedbackMenu, { backgroundColor: theme.background, borderColor: theme.border }]}>
            {[
              { id: 'more', label: 'More like this' },
              { id: 'less', label: 'Less like this' },
              { id: 'not_interested', label: 'Not interested' },
              { id: 'too_expensive', label: 'Too expensive' },
              { id: 'been_here', label: "I've been here" },
            ].map((f) => (
              <Pressable
                key={f.id}
                onPress={() => { setShowFeedback(false); onFeedback(f.id); }}
                style={[styles.feedbackItem, { borderBottomColor: theme.border }]}
                accessibilityRole="button"
                accessibilityLabel={f.label}
              >
                <ThemedText style={styles.feedbackItemText}>{f.label}</ThemedText>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}

// ============ Main Screen ============

export default function ExploreScreen() {
  const router = useRouter();
  const { tripId: paramTripId, day: paramDay } = useLocalSearchParams<{ tripId?: string; day?: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { trips, addActivity } = useTrips();
  const { profile } = useProfile();
  const { savedPlaces, savePlace, unsavePlace, isSaved } = useSavedPlaces();
  const { entries: memoryEntries, addEntry: addMemoryEntry } = useMemory();

  // Search
  const [search, setSearch] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedBudget, setSelectedBudget] = useState('all');
  const [selectedCrowd, setSelectedCrowd] = useState('all');
  const [selectedRating, setSelectedRating] = useState('all');
  const [selectedCuisine, setSelectedCuisine] = useState('All');
  const [selectedAtmosphere, setSelectedAtmosphere] = useState('all');
  const [selectedMeal, setSelectedMeal] = useState('all');
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [outdoorOnly, setOutdoorOnly] = useState(false);
  const [familyOnly, setFamilyOnly] = useState(false);
  const [showAllFilters, setShowAllFilters] = useState(false);

  // Sorting
  const [sortBy, setSortBy] = useState('recommended');

  // View mode
  const [viewTab, setViewTab] = useState<'results' | 'map' | 'photos'>('results');

  // Permissions
  const [locationStatus, setLocationStatus] = useState<'undetermined' | 'granted' | 'denied'>('undetermined');

  // Landing sections
  const [showAllForYou, setShowAllForYou] = useState(false);
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [savedModalFilter, setSavedModalFilter] = useState<'all' | 'food' | 'activity'>('all');

  // Map
  const [mapSelectedPlace, setMapSelectedPlace] = useState<PlaceWithDestination | null>(null);

  const searchInputRef = useRef<TextInput>(null);

  // Hide suggestions when navigating away from the screen
  useFocusEffect(
    useCallback(() => {
      return () => {
        setSearchFocused(false);
        Keyboard.dismiss();
      };
    }, []),
  );

  // Pending add — time/duration picker before confirming
  const [pendingAdd, setPendingAdd] = useState<{
    tripId: string;
    day: number;
    place: PlaceWithDestination | SavedPlace;
    time: string;
    duration: number;
  } | null>(null);

  // Generic selection sheet — used for trip and day selection instead of Alert.
  const [sheetState, setSheetState] = useState<{
    title: string;
    subtitle?: string;
    options: SelectionOption[];
    onSelect: (value: string) => void;
  } | null>(null);

  // Load persisted state on mount
  useEffect(() => {
    (async () => {
      const savedSearches = await loadRecentSearches();
      if (savedSearches.length > 0) setRecentSearches(savedSearches);
    })();
  }, []);

  // Persist recent searches when they change
  useEffect(() => {
    if (recentSearches.length > 0) saveRecentSearches(recentSearches);
  }, [recentSearches]);

  // Check permissions on mount
  useEffect(() => {
    (async () => {
      const { status: locStatus } = await Location.getForegroundPermissionsAsync();
      setLocationStatus(locStatus === 'granted' ? 'granted' : locStatus === 'denied' ? 'denied' : 'undetermined');
    })();
  }, []);

  async function requestLocationPermission() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationStatus(status === 'granted' ? 'granted' : 'denied');
    if (status !== 'granted') {
      Alert.alert('Location Permission', 'Enable location in Settings for nearby recommendations.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
    }
  }


  // Count active filters
  const activeFilterCount = [
    selectedCategory !== 'all',
    selectedBudget !== 'all',
    selectedCrowd !== 'all',
    selectedRating !== 'all',
    selectedCuisine !== 'All',
    selectedAtmosphere !== 'all',
    selectedMeal !== 'all',
    openNowOnly,
    outdoorOnly,
    familyOnly,
  ].filter(Boolean).length;

  function clearAllFilters() {
    setSelectedCategory('all');
    setSelectedBudget('all');
    setSelectedCrowd('all');
    setSelectedRating('all');
    setSelectedCuisine('All');
    setSelectedAtmosphere('all');
    setSelectedMeal('all');
    setOpenNowOnly(false);
    setOutdoorOnly(false);
    setFamilyOnly(false);
  }

  // Build results using exported filter pipeline
  const parsed = parseSearchQuery(search);
  // Use cleaned text query so dietary/noise words don't eliminate results
  let allResults = searchAllPlaces(parsed.textQuery, selectedCategory);

  // Apply manual UI filters
  if (selectedBudget !== 'all') allResults = allResults.filter((p) => p.cost === selectedBudget);
  if (selectedCrowd !== 'all') allResults = allResults.filter((p) => p.crowdLevel === selectedCrowd);
  if (selectedRating !== 'all') allResults = allResults.filter((p) => (p.rating ?? 0) >= parseFloat(selectedRating));
  if (selectedCuisine !== 'All') allResults = allResults.filter((p) => p.cuisine?.toLowerCase().includes(selectedCuisine.toLowerCase()));
  if (selectedAtmosphere !== 'all') allResults = allResults.filter((p) => p.atmosphere?.some((a) => a.toLowerCase() === selectedAtmosphere.toLowerCase()));
  if (openNowOnly) allResults = allResults.filter((p) => p.openNow === true);
  if (outdoorOnly) allResults = allResults.filter((p) => p.outdoorSeating === true);
  if (familyOnly) allResults = allResults.filter((p) => p.familyFriendly === true);
  if (selectedMeal !== 'all') {
    const mealTimes: Record<string, [string, string]> = { breakfast: ['06:00', '11:00'], lunch: ['11:00', '15:00'], dinner: ['17:00', '23:00'] };
    const [start, end] = mealTimes[selectedMeal] ?? ['00:00', '23:59'];
    allResults = allResults.filter((p) => {
      if (!p.bestTime) return true;
      return p.bestTime >= start && p.bestTime <= end;
    });
  }

  // NLP-derived filters
  if (parsed.filters.budget) allResults = allResults.filter((p) => p.cost === 'free' || p.cost === 'budget');
  if (parsed.filters.crowd) allResults = allResults.filter((p) => p.crowdLevel === 'low');
  if (parsed.filters.outdoor) allResults = allResults.filter((p) => p.outdoorSeating);
  if (parsed.filters.family) allResults = allResults.filter((p) => p.familyFriendly);
  if (parsed.filters.atmosphere) allResults = allResults.filter((p) => p.atmosphere?.some((a) => a.toLowerCase().includes(parsed.filters.atmosphere.toLowerCase())));

  // Dietary filter using exported function
  if (parsed.filters.dietary) {
    allResults = applyDietaryFilter(allResults, parsed.dietaryTerms);
  }

  let results = personalizeResults(allResults, profile);

  // Apply feedback from Travel Memory using exported functions
  const feedback = summarizeFeedback(memoryEntries ?? []);
  results = applyFeedbackToResults(results, feedback);

  if (sortBy !== 'recommended') results = sortPlaces(results, sortBy);

  const isSearching = search.trim().length > 0 || activeFilterCount > 0;
  const forYouAll = isSearching ? [] : results.slice(0, 10);
  const forYouVisible = showAllForYou ? forYouAll : forYouAll.slice(0, 3);
  const remaining = isSearching ? results : results.slice(forYouAll.length);

  // Upcoming trip destinations for "For your trip" section
  const upcomingDests = trips.filter((t) => {
    const start = new Date(t.startDate + 'T00:00:00');
    return start > new Date();
  }).map((t) => t.destination);

  const forYourTrip = isSearching ? [] : results.filter((p) => upcomingDests.includes(p.destination)).slice(0, 5);

  function submitSearch() {
    if (!search.trim()) return;
    setRecentSearches((prev) => [search.trim(), ...prev.filter((s) => s !== search.trim())].slice(0, 8));
    setSearchFocused(false);
  }

  function navigateToDetail(place: PlaceWithDestination) {
    let url = `/place-detail?title=${encodeURIComponent(place.title)}&destination=${encodeURIComponent(place.destination)}`;
    // Pass context so place-detail can offer direct "Add to trip" without re-picking
    if (paramTripId && paramDay) {
      url += `&tripId=${encodeURIComponent(paramTripId)}&day=${encodeURIComponent(paramDay)}`;
    }
    router.push(url as any);
  }

  function handleAddToTrip(place: PlaceWithDestination | SavedPlace) {
    if (trips.length === 0) {
      Alert.alert('No trips yet', 'Plan a trip first, then add activities.');
      return;
    }

    // If we have a context tripId/day, validate and use directly
    if (paramTripId && paramDay) {
      const contextTrip = trips.find((t) => t.id === paramTripId);
      if (contextTrip) {
        doAdd(paramTripId, Number(paramDay), place);
        return;
      }
    }

    // Matching trips first, then all others — so destination matches appear at the top
    const matchingTrips = trips.filter((t) => t.destination === place.destination);
    const otherTrips = trips.filter((t) => t.destination !== place.destination);
    const tripList = [...matchingTrips, ...otherTrips];

    if (tripList.length === 1) {
      showDayPicker(tripList[0].id, place);
      return;
    }

    setSheetState({
      title: 'Add to which trip?',
      subtitle: `"${place.title}"`,
      options: tripList.map((trip) => ({ label: `${trip.emoji} ${trip.destination}`, value: trip.id })),
      onSelect: (tripId) => {
        setSheetState(null);
        showDayPicker(tripId, place);
      },
    });
  }

  function showDayPicker(tripId: string, place: PlaceWithDestination | SavedPlace) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;

    // DST-safe UTC day count
    const [sy, sm, sd] = trip.startDate.split('-').map(Number);
    const [ey, em, ed] = trip.endDate.split('-').map(Number);
    const totalDays = Math.max(
      1,
      Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1,
    );

    if (totalDays <= 1) {
      doAdd(tripId, 1, place);
      return;
    }

    setSheetState({
      title: 'Which day?',
      subtitle: `Add "${place.title}" to ${trip.emoji} ${trip.destination}`,
      options: Array.from({ length: totalDays }, (_, i) => ({
        label: `Day ${i + 1}`,
        value: String(i + 1),
      })),
      onSelect: (dayStr) => {
        setSheetState(null);
        doAdd(tripId, Number(dayStr), place);
      },
    });
  }

  function doAdd(tripId: string, day: number, place: PlaceWithDestination | SavedPlace) {
    setPendingAdd({
      tripId,
      day,
      place,
      time: place.bestTime ?? '10:00',
      duration: place.duration ?? 60,
    });
  }

  function confirmPendingAdd() {
    if (!pendingAdd) return;
    const { tripId, day, place, time, duration } = pendingAdd;
    const trip = trips.find((t) => t.id === tripId);
    addActivity(tripId, {
      title: place.title,
      day,
      time,
      type: place.type,
      duration,
      category: place.category,
      cost: place.cost,
      description: place.description,
    });
    setPendingAdd(null);
    Alert.alert('Added!', `"${place.title}" added to ${trip?.emoji ?? ''} ${trip?.destination ?? 'trip'} (Day ${day}).`);
  }

  function handleToggleSave(place: PlaceWithDestination) {
    if (isSaved(place.title, place.destination)) {
      const saved = savedPlaces.find((p) => p.title === place.title && p.destination === place.destination);
      if (saved) unsavePlace(saved.id);
    } else {
      savePlace({
        title: place.title, destination: place.destination, type: place.type,
        category: place.category, cost: place.cost, duration: place.duration,
        description: place.description, tags: place.tags, crowdLevel: place.crowdLevel,
        energyLevel: place.energyLevel, bestTime: place.bestTime,
      });
    }
  }

  function handleFeedback(place: PlaceWithDestination, type: string) {
    // Prevent duplicate feedback
    if (hasDuplicateFeedback(memoryEntries ?? [], place.title, type)) {
      Alert.alert('Already noted', 'You already gave this feedback for this place.');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const messages: Record<string, string> = {
      more: `We'll show more places like "${place.title}"`,
      less: `We'll show fewer places like this`,
      not_interested: `"${place.title}" removed from recommendations`,
      too_expensive: `Noted \u2014 we'll prioritize more affordable options`,
      been_here: `Marked as visited`,
    };

    const memoryType = type === 'more' ? 'recommendation_accepted' as const
      : type === 'been_here' ? 'recommendation_accepted' as const
      : 'recommendation_rejected' as const;

    const detailMap: Record<string, string> = {
      more: `Likes: ${place.title} (${place.destination}) tags:${place.tags.join(',')}`,
      less: `Less like: ${place.title} (${place.destination}) tags:${place.tags.join(',')}`,
      not_interested: `Not interested in: ${place.title} (${place.destination})`,
      too_expensive: `Too expensive: ${place.title} (${place.destination})`,
      been_here: `Has visited: ${place.title} (${place.destination})`,
    };

    addMemoryEntry({
      type: memoryType,
      category: place.category ?? place.type,
      detail: detailMap[type] ?? `Feedback: ${place.title} (${place.destination})`,
      tripId: '',
      isGlobal: true,
    });

    Alert.alert('Feedback noted', messages[type] ?? 'Thanks for the feedback!');
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText type="title" style={{ marginBottom: Spacing.two }}>Explore</ThemedText>

        {/* ====== Permission banners ====== */}
        {locationStatus !== 'granted' && (
          <View style={[styles.banner, { backgroundColor: theme.primaryMuted, borderColor: theme.border }]}>
            <View style={styles.bannerRow}>
              <ThemedText style={styles.bannerIcon}>{'\u{1F4CD}'}</ThemedText>
              <ThemedText style={styles.bannerTitle}>
                {locationStatus === 'denied' ? 'Location denied \u2014 enable in Settings' : 'Enable location for nearby places'}
              </ThemedText>
            </View>
            <Pressable
              onPress={locationStatus === 'denied' ? () => Linking.openSettings() : requestLocationPermission}
              style={[styles.bannerBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel={locationStatus === 'denied' ? 'Open location settings' : 'Enable location'}
            >
              <ThemedText style={[styles.bannerBtnText, { color: theme.primaryText }]}>{locationStatus === 'denied' ? 'Settings' : 'Enable'}</ThemedText>
            </Pressable>
          </View>
        )}


        {/* ====== Search ====== */}
        <View style={styles.searchWithSaved}>
          <View style={[styles.searchRow, { borderColor: theme.border, flex: 1 }]}>
            <ThemedText style={styles.searchIcon}>{'\u{1F50D}'}</ThemedText>
            <TextInput
              ref={searchInputRef}
              style={[styles.searchInput, { color: theme.text }]}
              value={search}
              onChangeText={setSearch}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onSubmitEditing={() => { submitSearch(); setSearchFocused(false); }}
              placeholder="Search places, cities, activities..."
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              accessibilityLabel="Search places, cities, or activities"
            />
            {search.length > 0 && (
              <Pressable onPress={() => { setSearch(''); setSearchFocused(false); searchInputRef.current?.blur(); }} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel="Clear search">
                <ThemedText style={[styles.clearText, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
              </Pressable>
            )}
          </View>
          {savedPlaces.length > 0 && (
            <Pressable
              onPress={() => { setSavedModalFilter('all'); setSavedModalOpen(true); }}
              style={[styles.savedAccessBtn, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel="View saved places"
            >
              <ThemedText style={[styles.savedAccessIcon, { color: theme.primary }]}>{'\u2665'}</ThemedText>
            </Pressable>
          )}
        </View>

        {/* Search suggestions / recent searches */}
        {searchFocused && search.length === 0 && (
          <Animated.View entering={FadeIn.duration(150)}>
            {recentSearches.length > 0 && (
              <View style={styles.searchSection}>
                <View style={styles.searchSectionHeader}>
                  <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Recent</ThemedText>
                  <Pressable onPress={() => { setRecentSearches([]); saveRecentSearches([]); }} accessibilityRole="button" accessibilityLabel="Clear recent searches">
                    <ThemedText style={[styles.clearAllText, { color: theme.primary }]}>Clear</ThemedText>
                  </Pressable>
                </View>
                {recentSearches.map((s) => (
                  <Pressable key={s} onPress={() => { setSearch(s); setSearchFocused(false); searchInputRef.current?.blur(); }} style={styles.searchSuggestion} accessibilityRole="button" accessibilityLabel={`Search for ${s}`}>
                    <ThemedText style={styles.searchSuggestionText}>{s}</ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.searchSection}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Suggestions</ThemedText>
              {SEARCH_SUGGESTIONS.slice(0, 5).map((s) => (
                <Pressable key={s} onPress={() => { setSearch(s); setSearchFocused(false); searchInputRef.current?.blur(); }} style={styles.searchSuggestion} accessibilityRole="button" accessibilityLabel={`Search for ${s}`}>
                  <ThemedText style={styles.searchSuggestionText}>{s}</ThemedText>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        )}


        {/* ====== Identify / import section ====== */}
        {paramTripId && paramDay ? (
          <View style={[styles.identifyBanner, { backgroundColor: theme.primaryMuted, borderColor: theme.primary + '40' }]}>
            <ThemedText style={[styles.identifyBannerTitle, { color: theme.primary }]}>
              {'\u{1F4CD}'} Adding to Day {paramDay}
              {trips.find((t) => t.id === paramTripId) ? ` \u00B7 ${trips.find((t) => t.id === paramTripId)!.emoji} ${trips.find((t) => t.id === paramTripId)!.title ?? trips.find((t) => t.id === paramTripId)!.destination}` : ''}
            </ThemedText>
            <ThemedText style={[styles.identifyBannerSub, { color: theme.textSecondary }]}>
              Find a place below, or import from a link or photo
            </ThemedText>
            <View style={styles.identifyBtnRow}>
              <Pressable
                onPress={() => router.push((`/import-link?tripId=${paramTripId}&day=${paramDay}`) as any)}
                style={[styles.identifyBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                accessibilityRole="button"
                accessibilityLabel="Paste a link"
              >
                <ThemedText style={styles.identifyBtnIcon}>{'\u{1F517}'}</ThemedText>
                <ThemedText style={styles.identifyBtnLabel}>Paste a link</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => router.push((`/import-screenshot?tripId=${paramTripId}&day=${paramDay}`) as any)}
                style={[styles.identifyBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                accessibilityRole="button"
                accessibilityLabel="Import from media"
              >
                <ThemedText style={styles.identifyBtnIcon}>{'\u{1F4F7}'}</ThemedText>
                <ThemedText style={styles.identifyBtnLabel}>Import media</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.importCompactRow}>
            <Pressable
              onPress={() => router.push('/import-link' as any)}
              style={[styles.importCompactBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Paste a link"
            >
              <ThemedText style={styles.importCompactIcon}>{'\u{1F517}'}</ThemedText>
              <ThemedText style={[styles.importCompactLabel, { color: theme.textSecondary }]}>Paste a link</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/import-screenshot' as any)}
              style={[styles.importCompactBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Import from media"
            >
              <ThemedText style={styles.importCompactIcon}>{'\u{1F4F7}'}</ThemedText>
              <ThemedText style={[styles.importCompactLabel, { color: theme.textSecondary }]}>Import media</ThemedText>
            </Pressable>
          </View>
        )}

        {/* ====== Category shortcuts (horizontal scroll) ====== */}
        <View style={styles.categoryScrollWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll} contentContainerStyle={styles.categoryScrollContent}>
            {[{ id: 'all', label: 'All', icon: '\u{1F30D}' }, ...CATEGORY_SHORTCUTS].map((cat) => (
              <Pressable
                key={cat.id}
                onPress={() => { setSelectedCategory(cat.id); setViewTab('results'); }}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${cat.label}`}
                accessibilityState={{ selected: selectedCategory === cat.id }}
                style={[styles.categoryCard, {
                  backgroundColor: selectedCategory === cat.id ? theme.primaryMuted : theme.backgroundElement,
                  borderColor: selectedCategory === cat.id ? theme.primary : theme.border,
                }]}
              >
                <ThemedText style={styles.categoryIcon}>{cat.icon}</ThemedText>
                <ThemedText style={[styles.categoryLabel, selectedCategory === cat.id && { color: theme.primary }]}>{cat.label}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          <LinearGradient
            colors={[`${theme.background}00`, theme.background]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.categoryFadeHint}
            pointerEvents="none"
          />
        </View>

        {/* ====== View tabs ====== */}
        <View style={styles.viewTabs}>
          {(['results', 'map', 'photos'] as const).map((tab) => (
            <Pressable key={tab} onPress={() => setViewTab(tab)} style={styles.viewTab} accessibilityRole="button" accessibilityLabel={tab === 'results' ? 'Results view' : tab === 'map' ? 'Map view' : 'Photos view'} accessibilityState={{ selected: viewTab === tab }}>
              <ThemedText style={[styles.viewTabText, { color: viewTab === tab ? theme.primary : theme.textSecondary }]}>
                {tab === 'results' ? 'Results' : tab === 'map' ? 'Map' : 'Photos'}
              </ThemedText>
              {viewTab === tab && <View style={[styles.viewTabIndicator, { backgroundColor: theme.primary }]} />}
            </Pressable>
          ))}
        </View>

        {/* Filter controls */}
        <View style={styles.filterActions}>
          <Pressable onPress={() => setShowAllFilters(!showAllFilters)} accessibilityRole="button" accessibilityLabel={showAllFilters ? 'Hide filters' : `Show filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}>
            <ThemedText style={[styles.moreFiltersText, { color: theme.primary }]}>
              {showAllFilters ? 'Hide filters' : 'Filters'}
              {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </ThemedText>
          </Pressable>
          {activeFilterCount > 0 && (
            <Pressable onPress={clearAllFilters} accessibilityRole="button" accessibilityLabel="Clear all filters">
              <ThemedText style={[styles.clearFiltersText, { color: theme.textSecondary }]}>Clear all</ThemedText>
            </Pressable>
          )}
        </View>

        {/* Extended filters */}
        {showAllFilters && (
          <Animated.View entering={FadeIn.duration(200)} style={styles.extendedFilters}>
            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Category</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {BROWSE_CATEGORIES.map((cat) => (
                <Pressable key={cat.id} onPress={() => setSelectedCategory(cat.id)}
                  style={[styles.filterChip, { backgroundColor: selectedCategory === cat.id ? theme.primary : theme.backgroundElement }]}
                  accessibilityRole="button" accessibilityLabel={`Filter by ${cat.label}`}>
                  <ThemedText style={[styles.filterChipText, selectedCategory === cat.id && { color: theme.primaryText }]}>{cat.label}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Budget</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {[
                { id: 'all', label: 'Any' },
                { id: 'free', label: 'Free' },
                { id: 'budget', label: '$' }, { id: 'moderate', label: '$$' }, { id: 'premium', label: '$$$' },
              ].map((b) => (
                <Pressable key={b.id} onPress={() => setSelectedBudget(b.id)}
                  style={[styles.filterChip, { backgroundColor: selectedBudget === b.id ? theme.primary : theme.backgroundElement }]}
                  accessibilityRole="button" accessibilityLabel={`Budget: ${b.label}`}>
                  <ThemedText style={[styles.filterChipText, selectedBudget === b.id && { color: theme.primaryText }]}>{b.label}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Crowd level</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {[{ id: 'all', label: 'Any' }, { id: 'low', label: 'Quiet' }, { id: 'medium', label: 'Moderate' }, { id: 'high', label: 'Lively' }].map((c) => (
                <Pressable key={c.id} onPress={() => setSelectedCrowd(c.id)}
                  style={[styles.filterChip, { backgroundColor: selectedCrowd === c.id ? theme.primary : theme.backgroundElement }]}
                  accessibilityRole="button" accessibilityLabel={`Crowd level: ${c.label}`}>
                  <ThemedText style={[styles.filterChipText, selectedCrowd === c.id && { color: theme.primaryText }]}>{c.label}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Rating</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {[{ id: 'all', label: 'Any' }, { id: '4', label: '4+ stars' }, { id: '4.5', label: '4.5+' }].map((r) => (
                <Pressable key={r.id} onPress={() => setSelectedRating(r.id)}
                  style={[styles.filterChip, { backgroundColor: selectedRating === r.id ? theme.primary : theme.backgroundElement }]}
                  accessibilityRole="button" accessibilityLabel={`Rating: ${r.label}`}>
                  <ThemedText style={[styles.filterChipText, selectedRating === r.id && { color: theme.primaryText }]}>{r.label}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Cuisine</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {CUISINE_FILTERS.map((c) => (
                <Pressable key={c} onPress={() => setSelectedCuisine(c)}
                  style={[styles.filterChip, { backgroundColor: selectedCuisine === c ? theme.primary : theme.backgroundElement }]}
                  accessibilityRole="button" accessibilityLabel={`Cuisine: ${c}`}>
                  <ThemedText style={[styles.filterChipText, selectedCuisine === c && { color: theme.primaryText }]}>{c}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Atmosphere</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              <Pressable onPress={() => setSelectedAtmosphere('all')}
                style={[styles.filterChip, { backgroundColor: selectedAtmosphere === 'all' ? theme.primary : theme.backgroundElement }]}
                accessibilityRole="button" accessibilityLabel="Atmosphere: Any">
                <ThemedText style={[styles.filterChipText, selectedAtmosphere === 'all' && { color: theme.primaryText }]}>Any</ThemedText>
              </Pressable>
              {ATMOSPHERE_FILTERS.map((a) => (
                <Pressable key={a} onPress={() => setSelectedAtmosphere(a.toLowerCase())}
                  style={[styles.filterChip, { backgroundColor: selectedAtmosphere === a.toLowerCase() ? theme.primary : theme.backgroundElement }]}
                  accessibilityRole="button" accessibilityLabel={`Atmosphere: ${a}`}>
                  <ThemedText style={[styles.filterChipText, selectedAtmosphere === a.toLowerCase() && { color: theme.primaryText }]}>{a}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Meal</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {MEAL_FILTERS.map((m) => (
                <Pressable key={m.id} onPress={() => setSelectedMeal(m.id)}
                  style={[styles.filterChip, { backgroundColor: selectedMeal === m.id ? theme.primary : theme.backgroundElement }]}
                  accessibilityRole="button" accessibilityLabel={`Meal: ${m.label}`}>
                  <ThemedText style={[styles.filterChipText, selectedMeal === m.id && { color: theme.primaryText }]}>{m.label}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.toggleFilters}>
              {[
                { label: 'Open now', value: openNowOnly, set: setOpenNowOnly },
                { label: 'Outdoor seating', value: outdoorOnly, set: setOutdoorOnly },
                { label: 'Family-friendly', value: familyOnly, set: setFamilyOnly },
              ].map((f) => (
                <Pressable key={f.label} onPress={() => f.set(!f.value)}
                  style={[styles.toggleChip, { backgroundColor: f.value ? theme.primary : theme.backgroundElement, borderColor: f.value ? theme.primary : theme.border }]}
                  accessibilityRole="button" accessibilityLabel={`${f.label}: ${f.value ? 'on' : 'off'}`}>
                  <ThemedText style={[styles.filterChipText, f.value && { color: theme.primaryText }]}>{f.label}</ThemedText>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={() => setShowAllFilters(false)}
              style={[styles.filterDoneBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Done with filters"
            >
              <ThemedText style={[styles.filterDoneBtnText, { color: theme.primaryText }]}>Done</ThemedText>
            </Pressable>
          </Animated.View>
        )}

        {/* Sort */}
        {isSearching && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filterRow, { marginBottom: Spacing.two }]}>
            <ThemedText style={[styles.sortLabel, { color: theme.textSecondary }]}>Sort:</ThemedText>
            {SORT_OPTIONS.map((s) => (
              <Pressable key={s.id} onPress={() => setSortBy(s.id)}
                style={[styles.filterChip, { backgroundColor: sortBy === s.id ? theme.primary : theme.backgroundElement }]}
                accessibilityRole="button" accessibilityLabel={`Sort by ${s.label}`}>
                <ThemedText style={[styles.filterChipText, sortBy === s.id && { color: theme.primaryText }]}>{s.label}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* ====== Content by view tab ====== */}
        {viewTab === 'map' ? (
          <Animated.View entering={FadeIn.duration(200)}>
            <View style={[styles.mapPlaceholder, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={styles.mapTitle}>Interactive map</ThemedText>
              <ThemedText style={[styles.mapSubtitle, { color: theme.textSecondary }]}>
                {results.filter((p) => p.lat && p.lng).length} places with map pins
              </ThemedText>
              <View style={[styles.mapPreview, { backgroundColor: theme.background, borderColor: theme.border }]}>
                {results.filter((p) => p.lat && p.lng).slice(0, 8).map((p) => (
                  <Pressable key={p.title} onPress={() => setMapSelectedPlace(p)}
                    style={[styles.mapPin, {
                      backgroundColor: mapSelectedPlace?.title === p.title ? theme.primary : theme.backgroundElement,
                      borderWidth: 2,
                      borderColor: mapSelectedPlace?.title === p.title ? theme.primary : theme.border,
                    }]}
                    accessibilityRole="button" accessibilityLabel={`Select ${p.title} on map`}>
                    <ThemedText style={[styles.mapPinText, { color: mapSelectedPlace?.title === p.title ? theme.primaryText : theme.text }]}>
                      {p.type === 'food' ? '\u{1F37D}' : p.category === 'nature' ? '\u{1F33F}' : '\u{1F3DB}'}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText style={[styles.mapNote, { color: theme.textSecondary }]}>
                Full interactive map coming soon
              </ThemedText>
            </View>

            {mapSelectedPlace && (
              <Animated.View entering={FadeInDown.duration(200)}>
                <View style={[styles.mapPreviewCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <Pressable onPress={() => navigateToDetail(mapSelectedPlace)} style={styles.mapPreviewContent} accessibilityRole="button" accessibilityLabel={`View details for ${mapSelectedPlace.title}`}>
                    <View style={styles.mapPreviewInfo}>
                      <ThemedText style={styles.mapPreviewTitle}>{mapSelectedPlace.title}</ThemedText>
                      <ThemedText style={[styles.mapPreviewMeta, { color: theme.textSecondary }]}>
                        {mapSelectedPlace.neighborhood ?? mapSelectedPlace.destination}
                        {mapSelectedPlace.walkingTime ? ` \u00B7 ${mapSelectedPlace.walkingTime} walk` : ''}
                      </ThemedText>
                      {mapSelectedPlace.rating != null && (
                        <View style={styles.mapPreviewRating}>
                          <ThemedText style={{ color: '#F59E0B', fontSize: 13 }}>{'\u2605'} {mapSelectedPlace.rating.toFixed(1)}</ThemedText>
                          <ThemedText style={[styles.mapPreviewPrice, { color: theme.primary }]}>{COST_LABELS[mapSelectedPlace.cost]}</ThemedText>
                        </View>
                      )}
                    </View>
                    <Pressable
                      onPress={(e) => { e.stopPropagation(); handleAddToTrip(mapSelectedPlace!); }}
                      style={[styles.addBtn, { backgroundColor: theme.primary }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${mapSelectedPlace!.title} to trip`}
                    >
                      <ThemedText style={[styles.addBtnText, { color: theme.primaryText }]}>Add</ThemedText>
                    </Pressable>
                  </Pressable>
                </View>
              </Animated.View>
            )}

            <View style={styles.placesList}>
              {results.filter((p) => p.lat && p.lng).map((place) => (
                <Pressable
                  key={`map-${place.title}`}
                  onPress={() => setMapSelectedPlace(place)}
                  style={[styles.mapListItem, {
                    backgroundColor: mapSelectedPlace?.title === place.title ? theme.primaryMuted : theme.backgroundElement,
                    borderColor: mapSelectedPlace?.title === place.title ? theme.primary + '40' : theme.border,
                  }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${place.title}`}
                >
                  <View style={styles.mapListInfo}>
                    <ThemedText style={styles.mapListTitle}>{place.title}</ThemedText>
                    <ThemedText style={[styles.mapListMeta, { color: theme.textSecondary }]}>
                      {place.neighborhood ?? place.destination}{place.walkingTime ? ` \u00B7 ${place.walkingTime}` : ''}
                    </ThemedText>
                  </View>
                  {place.rating != null && (
                    <ThemedText style={{ color: '#F59E0B', fontSize: 13 }}>{'\u2605'} {place.rating.toFixed(1)}</ThemedText>
                  )}
                </Pressable>
              ))}
            </View>
          </Animated.View>
        ) : viewTab === 'photos' ? (
          <Animated.View entering={FadeIn.duration(200)}>
            <View style={styles.photoGrid}>
              {results.filter((p) => (p.photoCount ?? 0) > 0).slice(0, 12).map((p) => (
                <Pressable key={p.title} onPress={() => navigateToDetail(p)}
                  style={[styles.photoCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  accessibilityRole="button" accessibilityLabel={`View ${p.title} photos`}>
                  <View style={[styles.photoPlaceholder, { backgroundColor: theme.primaryMuted }]}>
                    <ThemedText style={styles.photoEmoji}>
                      {p.type === 'food' ? '\u{1F37D}\uFE0F' : p.category === 'nature' ? '\u{1F33F}' : '\u{1F3DB}\uFE0F'}
                    </ThemedText>
                    <ThemedText style={[styles.photoCountBadge, { color: theme.primary }]}>{p.photoCount} photos</ThemedText>
                  </View>
                  <ThemedText style={styles.photoTitle} numberOfLines={1}>{p.title}</ThemedText>
                  <ThemedText style={[styles.photoDestination, { color: theme.textSecondary }]} numberOfLines={1}>
                    {p.neighborhood ?? p.destination}
                  </ThemedText>
                  <View style={styles.photoMeta}>
                    {p.rating != null && (
                      <ThemedText style={[styles.photoRating, { color: theme.textSecondary }]}>{'\u2605'} {p.rating.toFixed(1)}</ThemedText>
                    )}
                    <Pressable onPress={(e) => { e.stopPropagation(); handleToggleSave(p); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={isSaved(p.title, p.destination) ? `Unsave ${p.title}` : `Save ${p.title}`}>
                      <ThemedText style={styles.photoSave}>{isSaved(p.title, p.destination) ? '\u2665' : '\u2661'}</ThemedText>
                    </Pressable>
                  </View>
                </Pressable>
              ))}
            </View>

            {results.filter((p) => (p.photoCount ?? 0) > 0).length === 0 && (
              <View style={styles.emptyState}>
                <ThemedText style={styles.emptyTitle}>No photos available</ThemedText>
                <ThemedText style={[styles.emptySub, { color: theme.textSecondary }]}>
                  Photos will appear as places are added
                </ThemedText>
              </View>
            )}
          </Animated.View>
        ) : (
          <>

            {/* For your upcoming trip */}
            {forYourTrip.length > 0 && !isSearching && (
              <Animated.View entering={FadeIn.duration(300)}>
                <ThemedText type="headline" style={styles.sectionHeadline}>For your upcoming trip</ThemedText>
                <View style={styles.placesList}>
                  {forYourTrip.slice(0, 3).map((place) => (
                    <PlaceCard
                      key={`trip-${place.destination}-${place.title}`}
                      place={place} saved={isSaved(place.title, place.destination)}
                      onAdd={() => handleAddToTrip(place)} onToggleSave={() => handleToggleSave(place)}
                      onDetails={() => navigateToDetail(place)} onFeedback={(t) => handleFeedback(place, t)}
                      matchReason={getMatchReason(place, profile)}
                    />
                  ))}
                </View>
              </Animated.View>
            )}

            {/* For You */}
            {forYouVisible.length > 0 && (
              <Animated.View entering={FadeIn.duration(300)}>
                <View style={styles.forYouHeader}>
                  <ThemedText type="headline">For You</ThemedText>
                  <ThemedText style={[styles.forYouSub, { color: theme.textSecondary }]}>Based on your travel profile</ThemedText>
                </View>
                <View style={styles.placesList}>
                  {forYouVisible.map((place) => (
                    <PlaceCard
                      key={`fy-${place.destination}-${place.title}`}
                      place={place} saved={isSaved(place.title, place.destination)}
                      onAdd={() => handleAddToTrip(place)} onToggleSave={() => handleToggleSave(place)}
                      onDetails={() => navigateToDetail(place)} onFeedback={(t) => handleFeedback(place, t)}
                      matchReason={getMatchReason(place, profile)}
                      showBadge={isHighlyRecommended(place, profile)}
                    />
                  ))}
                </View>
                {!showAllForYou && forYouAll.length > 3 && (
                  <Pressable onPress={() => setShowAllForYou(true)} style={[styles.seeAllBtn, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="See all recommendations">
                    <ThemedText style={[styles.seeAllText, { color: theme.primary }]}>See all recommendations</ThemedText>
                  </Pressable>
                )}
              </Animated.View>
            )}

            {/* All results */}
            <ThemedText type="eyebrow" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              {isSearching ? `${results.length} ${results.length === 1 ? 'place' : 'places'}` : 'All places'}
            </ThemedText>

            {remaining.length === 0 && results.length === 0 ? (
              <View style={styles.emptyState}>
                <ThemedText style={styles.emptyEmoji}>{'\u{1F50D}'}</ThemedText>
                <ThemedText style={styles.emptyTitle}>No places found</ThemedText>
                <ThemedText style={[styles.emptySub, { color: theme.textSecondary }]}>
                  {activeFilterCount > 0 ? 'Try removing some filters' : 'Try a different search'}
                </ThemedText>
                {activeFilterCount > 0 && (
                  <Pressable onPress={clearAllFilters} style={[styles.clearFiltersBtn, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel="Clear all filters">
                    <ThemedText style={[styles.clearFiltersBtnText, { color: theme.primaryText }]}>Clear all filters</ThemedText>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={styles.placesList}>
                {remaining.map((place) => (
                  <PlaceCard
                    key={`${place.destination}-${place.title}`}
                    place={place} saved={isSaved(place.title, place.destination)}
                    onAdd={() => handleAddToTrip(place)} onToggleSave={() => handleToggleSave(place)}
                    onDetails={() => navigateToDetail(place)} onFeedback={(t) => handleFeedback(place, t)}
                    matchReason={isSearching ? getMatchReason(place, profile) : null}
                    showBadge={isSearching && isHighlyRecommended(place, profile)}
                  />
                ))}
              </View>
            )}

          </>
        )}
      </ScrollView>

      {/* Trip / day selection sheet — avoids variable-length Android Alert */}
      {sheetState && (
        <SelectionSheet
          visible={!!sheetState}
          title={sheetState.title}
          subtitle={sheetState.subtitle}
          options={sheetState.options}
          onSelect={sheetState.onSelect}
          onClose={() => setSheetState(null)}
        />
      )}

      {/* Time & duration picker before adding to trip */}
      {pendingAdd && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPendingAdd(null)}>
          <Pressable style={styles.addModalBackdrop} onPress={() => setPendingAdd(null)} accessibilityRole="button" accessibilityLabel="Close">
            <Pressable style={[styles.addModalSheet, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()} accessibilityRole="button" accessibilityLabel="Add to trip dialog">
              <ThemedText type="subtitle" style={styles.addModalTitle}>Add to trip</ThemedText>
              <ThemedText style={[styles.addModalPlace, { color: theme.textSecondary }]}>
                {pendingAdd.place.title} {'\u00B7'} Day {pendingAdd.day}
              </ThemedText>
              <TimePickerButton
                value={pendingAdd.time}
                onChange={(t) => setPendingAdd((p) => p ? { ...p, time: t } : p)}
                showDuration
                duration={pendingAdd.duration}
                onDurationChange={(d) => setPendingAdd((p) => p ? { ...p, duration: d } : p)}
              />
              <View style={styles.addModalBtns}>
                <Pressable onPress={() => setPendingAdd(null)} style={[styles.addModalCancel, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="Cancel">
                  <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
                </Pressable>
                <Pressable onPress={confirmPendingAdd} style={[styles.addModalConfirm, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel="Confirm add to trip">
                  <ThemedText style={{ color: theme.primaryText, fontSize: 15, fontWeight: '700' }}>Add to trip</ThemedText>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Saved Places Modal */}
      <Modal visible={savedModalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSavedModalOpen(false)}>
        <View style={[styles.savedModal, { backgroundColor: theme.background }]}>
          <View style={[styles.savedModalHeader, { borderBottomColor: theme.border }]}>
            <ThemedText type="subtitle">Saved places ({savedPlaces.length})</ThemedText>
            <Pressable onPress={() => setSavedModalOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close saved places">
              <ThemedText style={[styles.savedModalClose, { color: theme.primary }]}>{'\u2715'}</ThemedText>
            </Pressable>
          </View>
          {savedPlaces.length > 3 && (
            <View style={[styles.savedFilterRow, { paddingHorizontal: Spacing.four, paddingTop: 12 }]}>
              {(['all', 'food', 'activity'] as const).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setSavedModalFilter(f)}
                  style={[styles.filterChip, { backgroundColor: savedModalFilter === f ? theme.primary : theme.backgroundElement }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter ${f === 'all' ? 'All' : f === 'food' ? 'Food' : 'Activities'}`}
                >
                  <ThemedText style={[styles.filterChipText, savedModalFilter === f && { color: theme.primaryText }]}>
                    {f === 'all' ? 'All' : f === 'food' ? 'Food' : 'Activities'}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          )}
          <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: 8 }} showsVerticalScrollIndicator={false}>
            {savedPlaces
              .filter((p) => savedModalFilter === 'all' || p.type === savedModalFilter)
              .map((p) => (
                <View key={p.id} style={[styles.savedRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <Pressable
                    onPress={() => {
                      setSavedModalOpen(false);
                      let url = `/place-detail?title=${encodeURIComponent(p.title)}&destination=${encodeURIComponent(p.destination)}`;
                      if (paramTripId && paramDay) {
                        url += `&tripId=${encodeURIComponent(paramTripId)}&day=${encodeURIComponent(paramDay)}`;
                      }
                      router.push(url as any);
                    }}
                    style={styles.savedInfo}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${p.title}`}
                  >
                    <ThemedText style={styles.savedTitle}>{p.title}</ThemedText>
                    <ThemedText style={[styles.savedDest, { color: theme.textSecondary }]}>
                      {p.destination}{' \u00B7 '}{p.type.charAt(0).toUpperCase() + p.type.slice(1)}{' \u00B7 '}{COST_LABELS[p.cost]}
                    </ThemedText>
                  </Pressable>
                  <View style={styles.savedActions}>
                    <Pressable onPress={() => handleAddToTrip(p)} style={[styles.addBtn, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel={`Add ${p.title} to trip`}>
                      <ThemedText style={[styles.addBtnText, { color: theme.primaryText }]}>Add</ThemedText>
                    </Pressable>
                    <Pressable onPress={() => unsavePlace(p.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Unsave ${p.title}`}>
                      <ThemedText style={styles.saveIcon}>{'\u2665'}</ThemedText>
                    </Pressable>
                  </View>
                </View>
              ))}
            {savedPlaces.filter((p) => savedModalFilter === 'all' || p.type === savedModalFilter).length === 0 && (
              <ThemedText style={{ color: theme.textSecondary, textAlign: 'center', paddingTop: 40 }}>No saved places in this category.</ThemedText>
            )}
          </ScrollView>
        </View>
      </Modal>
    </ThemedView>
  );
}

// ============ Styles ============

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four },

  // Banners
  banner: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12, gap: 10 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerIcon: { fontSize: 18, lineHeight: 24 },
  bannerTitle: { fontSize: 14, fontWeight: '600', flex: 1 },
  bannerBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  bannerBtnText: { fontSize: 13, fontWeight: '600' },
  bannerBtnRow: { flexDirection: 'row', gap: 8 },
  bannerDismiss: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  bannerDismissText: { fontSize: 13, fontWeight: '500' },

  // Search
  searchWithSaved: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 12 },
  savedAccessBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
  savedAccessIcon: { fontSize: 18, lineHeight: 22 },
  searchRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, gap: 8 },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, paddingVertical: 14, fontSize: 16 },
  clearBtn: { padding: 4 },
  clearText: { fontSize: 16, fontWeight: '300' },

  // Search suggestions
  searchSection: { marginBottom: 12, gap: 4 },
  searchSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  clearAllText: { fontSize: 13, fontWeight: '500' },
  searchSuggestion: { paddingVertical: 10, paddingHorizontal: 4 },
  searchSuggestionText: { fontSize: 15 },

  // Category shortcuts (horizontal)
  categoryScrollWrapper: { position: 'relative' as const, marginBottom: 12 },
  categoryScroll: {},
  categoryScrollContent: { gap: 8, paddingVertical: 4, paddingRight: 40 },
  categoryCard: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingHorizontal: 10, paddingVertical: 8, height: 36, borderRadius: 20, borderWidth: 1, width: 108 },
  categoryIcon: { fontSize: 16, lineHeight: 20 },
  categoryLabel: { fontSize: 13, fontWeight: '600' },
  categoryFadeHint: { position: 'absolute' as const, right: 0, top: 0, bottom: 0, width: 32 },

  // View tabs
  viewTabs: { flexDirection: 'row', marginBottom: 12, gap: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.15)' },
  viewTab: { paddingBottom: 10, alignItems: 'center' },
  viewTabText: { fontSize: 14, fontWeight: '600' },
  viewTabIndicator: { position: 'absolute', bottom: 0, height: 2, width: '100%', borderRadius: 1 },

  // Filters
  filterScroll: { marginBottom: 8 },
  filterRow: { gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  filterChipText: { fontSize: 13, fontWeight: '500' },
  filterDivider: { width: 1, height: 20, alignSelf: 'center', marginHorizontal: 2 },
  filterActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  moreFiltersText: { fontSize: 13, fontWeight: '600' },
  clearFiltersText: { fontSize: 13, fontWeight: '500' },
  extendedFilters: { gap: 10, marginBottom: Spacing.three },
  toggleFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  filterDoneBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  filterDoneBtnText: { fontSize: 14, fontWeight: '600' },

  // Sort
  sortLabel: { fontSize: 13, fontWeight: '600', paddingVertical: 8 },
  resultCount: { marginBottom: 8 },

  // Map
  mapPlaceholder: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: 'center', gap: 8, marginBottom: 12 },
  mapTitle: { fontSize: 18, fontWeight: '600' },
  mapSubtitle: { fontSize: 14 },
  mapPreview: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1 },
  mapPin: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mapPinText: { fontSize: 16, lineHeight: 20 },
  mapNote: { fontSize: 12, marginTop: 8 },
  mapPreviewCard: { borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  mapPreviewContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  mapPreviewInfo: { flex: 1, gap: 2 },
  mapPreviewTitle: { fontSize: 16, fontWeight: '600' },
  mapPreviewMeta: { fontSize: 13 },
  mapPreviewRating: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  mapPreviewPrice: { fontSize: 13, fontWeight: '700' },
  mapListItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 6 },
  mapListInfo: { flex: 1, gap: 1 },
  mapListTitle: { fontSize: 14, fontWeight: '600' },
  mapListMeta: { fontSize: 12 },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoCard: { width: '47%' as any, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  photoPlaceholder: { height: 100, alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoEmoji: { fontSize: 28, lineHeight: 36 },
  photoCountBadge: { fontSize: 11, fontWeight: '600' },
  photoTitle: { fontSize: 13, fontWeight: '600', paddingHorizontal: 10, paddingTop: 8 },
  photoDestination: { fontSize: 11, paddingHorizontal: 10, marginTop: 1 },
  photoMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 8, paddingTop: 4 },
  photoRating: { fontSize: 12 },
  photoSave: { fontSize: 18 },

  // Sections
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.two, marginBottom: 8 },
  chevron: { fontSize: 18, fontWeight: '300' },
  sectionTitle: { marginTop: Spacing.three, marginBottom: 8 },
  sectionHeadline: { marginTop: Spacing.three, marginBottom: 12 },

  // For You
  forYouHeader: { marginTop: Spacing.three, marginBottom: 12 },
  forYouSub: { fontSize: 13, marginTop: 2 },
  seeAllBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  seeAllText: { fontSize: 14, fontWeight: '600' },

  // Saved places
  savedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  savedInfo: { flex: 1, gap: 2 },
  savedTitle: { fontSize: 15, fontWeight: '600' },
  savedDest: { fontSize: 13 },
  savedActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  savedFilterRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  savedModal: { flex: 1 },
  savedModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.four, paddingTop: 20, borderBottomWidth: 1 },
  savedModalClose: { fontSize: 20, fontWeight: '400' },

  // Place cards
  placesList: { gap: 12 },
  placeCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 8 },
  recBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 2 },
  recBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  placeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  placeInfo: { flex: 1 },
  placeTitle: { fontSize: 16, fontWeight: '600' },
  placeMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  placeMeta: { fontSize: 12 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingStar: { fontSize: 14, color: '#F59E0B' },
  ratingNum: { fontSize: 14, fontWeight: '700' },
  reviewCount: { fontSize: 12 },
  priceBadge: { fontSize: 13, fontWeight: '700', marginLeft: 6 },
  openStatus: { fontSize: 12, fontWeight: '600', marginLeft: 6 },
  placeDesc: { fontSize: 14, lineHeight: 20 },
  matchReason: { fontSize: 12, fontWeight: '600' },
  sampleInfoLabel: { fontSize: 10, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 },
  warningText: { fontSize: 12, fontWeight: '500' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  atmoChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  atmoChipText: { fontSize: 11, fontWeight: '600' },
  placeBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeTagText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  durationText: { fontSize: 13 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feedbackBtn: { padding: 6 },
  feedbackIcon: { fontSize: 18, fontWeight: '700' },
  addBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  addBtnText: { fontSize: 13, fontWeight: '600' },
  saveBtn: { padding: 4 },
  saveIcon: { fontSize: 22 },

  // Feedback menu
  feedbackMenu: { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  feedbackItem: { paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  feedbackItemText: { fontSize: 14 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyEmoji: { fontSize: 48, lineHeight: 60 },
  emptyTitle: { fontSize: 20, fontWeight: '600' },
  emptySub: { fontSize: 14, textAlign: 'center' },
  clearFiltersBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 8 },
  clearFiltersBtnText: { fontSize: 14, fontWeight: '600' },

  // Identify / import section (top of screen)
  identifyBanner: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 12, gap: 6 },
  identifyBannerTitle: { fontSize: 14, fontWeight: '700' },
  identifyBannerSub: { fontSize: 12 },
  identifyBtnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  identifyBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', gap: 3 },
  identifyBtnIcon: { fontSize: 18, lineHeight: 24 },
  identifyBtnLabel: { fontSize: 12, fontWeight: '600' },
  importCompactRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  importCompactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 8 },
  importCompactIcon: { fontSize: 14, lineHeight: 20 },
  importCompactLabel: { fontSize: 13, fontWeight: '500' },

  // Add to trip modal
  addModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  addModalSheet: {
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    gap: 14,
  },
  addModalTitle: { textAlign: 'center' },
  addModalPlace: { textAlign: 'center', fontSize: 14 },
  addModalBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  addModalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  addModalConfirm: { flex: 2, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
});
