import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { TimePickerButton } from '@/components/time-picker';
import { SelectionSheet, SelectionOption } from '@/components/selection-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useSavedPlaces } from '@/context/saved-places';
import { useTheme } from '@/hooks/use-theme';
import { searchAllPlaces } from '@/services/places-data';
import { sortTripsForPicker } from '@/services/trip-helpers';

const costLabels: Record<string, string> = {
  free: 'Free',
  budget: '$',
  moderate: '$$',
  premium: '$$$',
};

const crowdLabels: Record<string, string> = {
  low: 'Usually quiet',
  medium: 'Moderate crowds',
  high: 'Often crowded',
};

const energyLabels: Record<string, string> = {
  low: 'Low effort',
  medium: 'Moderate activity',
  high: 'Active / Physical',
};

const noiseLevelLabels: Record<string, string> = {
  quiet: 'Quiet',
  moderate: 'Moderate',
  lively: 'Lively',
};

const busyLabels: Record<string, string> = {
  'not busy': 'Not busy',
  'moderate': 'Moderately busy',
  'busy': 'Busy right now',
  'very busy': 'Very busy right now',
};

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const REVIEW_THEME_ICONS: Record<string, string> = {
  food: '\uD83C\uDF7D',
  service: '\u2605',
  atmosphere: '\u2728',
  value: '\uD83D\uDCB0',
  view: '\uD83C\uDF05',
};

function StarRating({ rating, reviewCount }: { rating: number; reviewCount: number }) {
  const theme = useTheme();
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.3;

  return (
    <View style={styles.ratingRow}>
      <View style={styles.stars}>
        {Array.from({ length: 5 }, (_, i) => (
          <ThemedText
            key={i}
            style={[
              styles.star,
              { color: i < fullStars || (i === fullStars && hasHalf) ? '#F59E0B' : theme.border },
            ]}
          >
            {i < fullStars ? '\u2605' : i === fullStars && hasHalf ? '\u2605' : '\u2606'}
          </ThemedText>
        ))}
      </View>
      <ThemedText style={[styles.ratingNum, { color: theme.text }]}>{rating.toFixed(1)}</ThemedText>
      <ThemedText style={[styles.reviewCount, { color: theme.textSecondary }]}>
        ({reviewCount.toLocaleString()} reviews)
      </ThemedText>
    </View>
  );
}

function ReviewCard({ review, theme }: { review: { source: string; text: string; rating: number; date: string; theme?: string }; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.reviewCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewSourceRow}>
          {review.theme && REVIEW_THEME_ICONS[review.theme] && (
            <ThemedText style={styles.reviewThemeIcon}>{REVIEW_THEME_ICONS[review.theme]}</ThemedText>
          )}
          <ThemedText style={[styles.reviewSource, { color: theme.textSecondary }]}>{review.source}</ThemedText>
          {review.theme && (
            <View style={[styles.reviewThemeBadge, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={[styles.reviewThemeText, { color: theme.primary }]}>{review.theme}</ThemedText>
            </View>
          )}
        </View>
        <View style={styles.reviewMeta}>
          <ThemedText style={[styles.reviewRating, { color: '#F59E0B' }]}>
            {Array.from({ length: review.rating }, () => '\u2605').join('')}
            {Array.from({ length: 5 - review.rating }, () => '\u2606').join('')}
          </ThemedText>
          <ThemedText style={[styles.reviewDate, { color: theme.textSecondary }]}>{review.date}</ThemedText>
        </View>
      </View>
      <ThemedText style={styles.reviewText}>{review.text}</ThemedText>
    </View>
  );
}

export default function PlaceDetailScreen() {
  const { title, destination, tripId: paramTripId, day: paramDay } = useLocalSearchParams<{ title: string; destination: string; tripId?: string; day?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { trips, addActivity } = useTrips();
  const { profile } = useProfile();
  const { savedPlaces, savePlace, unsavePlace, isSaved } = useSavedPlaces();
  const [showAllHours, setShowAllHours] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<{
    tripId: string;
    day: number;
    time: string;
    duration: number;
  } | null>(null);
  const [sheetState, setSheetState] = useState<{
    title: string;
    subtitle?: string;
    options: SelectionOption[];
    onSelect: (value: string) => void;
  } | null>(null);

  // Find the place
  const allPlaces = searchAllPlaces('', 'all');
  const place = allPlaces.find((p) => p.title === title && p.destination === destination);

  if (!place) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ThemedText style={{ color: theme.textSecondary }}>Place not found</ThemedText>
          <Pressable onPress={() => router.back()} style={styles.backLink} accessibilityRole="button" accessibilityLabel="Go back">
            <ThemedText style={{ color: theme.primary }}>Go back</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  const saved = isSaved(place.title, place.destination);

  // Build personalized match reasons
  const personalReasons: string[] = [];
  if (place.matchReasons && place.matchReasons.length > 0) {
    personalReasons.push(...place.matchReasons);
  } else {
    // Generate reasons from profile
    if (profile.interests) {
      const matched = place.tags.filter((t) => profile.interests!.includes(t));
      if (matched.length > 0) personalReasons.push(`Matches your interest in ${matched[0]}`);
    }
    if (profile.pace === 'relaxed' && place.energyLevel === 'low') {
      personalReasons.push('Great for your relaxed pace');
    }
    if (profile.budget === place.cost) {
      personalReasons.push('Fits your budget preference');
    }
  }

  function handleToggleSave() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (saved) {
      const entry = savedPlaces.find((p) => p.title === place!.title && p.destination === place!.destination);
      if (entry) unsavePlace(entry.id);
    } else {
      savePlace({
        title: place!.title,
        destination: place!.destination,
        type: place!.type,
        category: place!.category,
        cost: place!.cost,
        duration: place!.duration,
        description: place!.description,
        tags: place!.tags,
        crowdLevel: place!.crowdLevel,
        energyLevel: place!.energyLevel,
        bestTime: place!.bestTime,
      });
    }
  }

  function handleAddToTrip() {
    // If launched with explicit tripId + day context, skip the pickers
    if (paramTripId && paramDay) {
      doAdd(paramTripId, Number(paramDay));
      return;
    }

    if (trips.length === 0) {
      Alert.alert('No trips yet', 'Plan a trip first, then you can add activities.');
      return;
    }

    const sorted = sortTripsForPicker(trips, place!.destination);

    if (sorted.length === 1) {
      showDayPicker(sorted[0].id);
      return;
    }

    setSheetState({
      title: 'Add to which trip?',
      subtitle: `Select a trip for "${place!.title}"`,
      options: sorted.map((trip) => ({ label: `${trip.emoji} ${trip.destination}`, value: trip.id })),
      onSelect: (tid) => {
        setSheetState(null);
        showDayPicker(tid);
      },
    });
  }

  function showDayPicker(tripId: string) {
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
      doAdd(tripId, 1);
      return;
    }

    setSheetState({
      title: 'Which day?',
      subtitle: `Add "${place!.title}" to ${trip.emoji} ${trip.destination}`,
      options: Array.from({ length: totalDays }, (_, i) => ({
        label: `Day ${i + 1}`,
        value: String(i + 1),
      })),
      onSelect: (dayStr) => {
        setSheetState(null);
        doAdd(tripId, Number(dayStr));
      },
    });
  }

  function doAdd(tripId: string, day: number) {
    setPendingAdd({
      tripId,
      day,
      time: place!.bestTime ?? '10:00',
      duration: place!.duration ?? 60,
    });
  }

  function confirmPendingAdd() {
    if (!pendingAdd || !place) return;
    const { tripId, day, time, duration } = pendingAdd;
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

  const reviewsToShow = place.reviews
    ? (showAllReviews ? place.reviews : place.reviews.slice(0, 2))
    : [];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <ThemedText style={[styles.headerBackText, { color: theme.primary }]}>{'\u2190'} Back</ThemedText>
        </Pressable>
        <ThemedText style={[styles.headerSubtitle, { color: theme.textSecondary }]}>{place.destination}</ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Sample information notice */}
        <View style={[styles.sampleBanner, { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }]}>
          <ThemedText style={styles.sampleBannerText}>
            Sample information {'\u2014'} details shown are simulated for demonstration
          </ThemedText>
        </View>

        {/* Title section */}
        <Animated.View entering={FadeIn.duration(300)}>
          <View style={styles.titleSection}>
            <ThemedText type="title" style={styles.placeTitle}>{place.title}</ThemedText>
            <ThemedText style={[styles.destination, { color: theme.textSecondary }]}>
              {place.neighborhood ? `${place.neighborhood}, ` : ''}{place.destination}
              {place.address ? ` \u00B7 ${place.address}` : ''}
            </ThemedText>
            {place.verified && (
              <ThemedText style={[styles.verified, { color: theme.primary }]}>{'\u2713'} Verified listing</ThemedText>
            )}
          </View>
        </Animated.View>

        {/* Rating */}
        {place.rating != null && place.reviewCount != null && (
          <Animated.View entering={FadeInDown.delay(50).duration(200)}>
            <StarRating rating={place.rating} reviewCount={place.reviewCount} />
          </Animated.View>
        )}

        {/* Quick info pills */}
        <Animated.View entering={FadeInDown.delay(100).duration(200)}>
          <View style={styles.pillRow}>
            <View style={[styles.pill, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={[styles.pillText, { color: theme.primary }]}>
                {costLabels[place.cost]}
                {place.pricePerPerson ? ` \u00B7 ${place.pricePerPerson}/person` : ''}
              </ThemedText>
            </View>
            <View style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.pillText}>{place.duration}m</ThemedText>
            </View>
            {place.cuisine && (
              <View style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.pillText}>{place.cuisine}</ThemedText>
              </View>
            )}
            {place.walkingTime && (
              <View style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.pillText}>{place.walkingTime} walk</ThemedText>
              </View>
            )}
            {place.openNow != null && (
              <View style={[styles.pill, { backgroundColor: place.openNow ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.1)' }]}>
                <ThemedText style={[styles.pillText, { color: place.openNow ? '#16A34A' : '#EF4444' }]}>
                  {place.openNow ? 'Open now' : 'Closed'}
                  {place.openNow && place.closingTime ? ` \u00B7 closes ${place.closingTime}` : ''}
                </ThemedText>
              </View>
            )}
            {place.bestTime && (
              <View style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.pillText}>Best at {place.bestTime}</ThemedText>
              </View>
            )}
          </View>
        </Animated.View>

        {/* Action buttons: Directions, Website, Phone, Book */}
        <Animated.View entering={FadeInDown.delay(115).duration(200)}>
          <View style={styles.actionBtnRow}>
            <Pressable
              onPress={async () => {
                const url = `https://maps.apple.com/?q=${encodeURIComponent(place.title)}`;
                const supported = await Linking.canOpenURL(url);
                if (supported) Linking.openURL(url);
                else Alert.alert('Cannot open', 'Maps app is not available on this device.');
              }}
              style={[styles.actionBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel={`Get directions to ${place.title}`}
            >
              <ThemedText style={styles.actionBtnIcon}>{'\u{1F4CD}'}</ThemedText>
              <ThemedText style={[styles.actionBtnLabel, { color: theme.primary }]}>Directions</ThemedText>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!place.website) {
                  Alert.alert('Website unavailable', 'No website is listed for this place.');
                  return;
                }
                const supported = await Linking.canOpenURL(place.website);
                if (supported) Linking.openURL(place.website);
                else Alert.alert('Cannot open', 'Unable to open this URL.');
              }}
              style={[
                styles.actionBtn,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: place.website ? 1 : 0.45 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={place.website ? `Visit ${place.title} website` : 'Website unavailable'}
            >
              <ThemedText style={styles.actionBtnIcon}>{'\u{1F310}'}</ThemedText>
              <ThemedText style={[styles.actionBtnLabel, { color: place.website ? theme.primary : theme.textSecondary }]}>Website</ThemedText>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!place.phone) {
                  Alert.alert('Phone unavailable', 'No phone number is listed for this place.');
                  return;
                }
                const url = `tel:${place.phone}`;
                const supported = await Linking.canOpenURL(url);
                if (supported) Linking.openURL(url);
                else Alert.alert('Cannot open', 'Phone calls are not supported on this device.');
              }}
              style={[
                styles.actionBtn,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: place.phone ? 1 : 0.45 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={place.phone ? `Call ${place.title}` : 'Phone unavailable'}
            >
              <ThemedText style={styles.actionBtnIcon}>{'\u{1F4DE}'}</ThemedText>
              <ThemedText style={[styles.actionBtnLabel, { color: place.phone ? theme.primary : theme.textSecondary }]}>Call</ThemedText>
            </Pressable>
          </View>
          {place.reservationsRecommended && (
            <Pressable
              onPress={async () => {
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(place.title + ' reservation ' + place.destination)}`;
                const supported = await Linking.canOpenURL(searchUrl);
                if (supported) Linking.openURL(searchUrl);
                else Alert.alert('Cannot open', 'Unable to open browser.');
              }}
              style={[styles.bookBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel={`Book reservation at ${place.title}`}
            >
              <ThemedText style={[styles.bookBtnText, { color: theme.primaryText }]}>Book a reservation</ThemedText>
            </Pressable>
          )}
        </Animated.View>

        {/* Personalized match reasons */}
        {personalReasons.length > 0 && (
          <Animated.View entering={FadeInDown.delay(120).duration(200)}>
            <View style={[styles.matchCard, { backgroundColor: theme.primaryMuted, borderColor: theme.primary + '30' }]}>
              <ThemedText style={[styles.matchTitle, { color: theme.primary }]}>Why we recommend this</ThemedText>
              {personalReasons.map((reason, i) => (
                <ThemedText key={i} style={[styles.matchReason, { color: theme.text }]}>{'\u2022'} {reason}</ThemedText>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Warnings */}
        {place.warnings && place.warnings.length > 0 && (
          <Animated.View entering={FadeInDown.delay(140).duration(200)}>
            <View style={[styles.warningCard, { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }]}>
              {place.warnings.map((w, i) => (
                <ThemedText key={i} style={styles.warningText}>{'\u26A0'} {w}</ThemedText>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Current status */}
        {(place.busyLevel || place.estimatedWait) && (
          <Animated.View entering={FadeInDown.delay(150).duration(200)}>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Right now</ThemedText>
              <View style={styles.statusRow}>
                {place.busyLevel && (
                  <View style={[styles.statusPill, {
                    backgroundColor: place.busyLevel === 'not busy' ? 'rgba(22,163,74,0.1)' :
                      place.busyLevel === 'moderate' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                  }]}>
                    <ThemedText style={[styles.statusText, {
                      color: place.busyLevel === 'not busy' ? '#16A34A' :
                        place.busyLevel === 'moderate' ? '#F59E0B' : '#EF4444',
                    }]}>
                      {busyLabels[place.busyLevel]}
                    </ThemedText>
                  </View>
                )}
                {place.estimatedWait && (
                  <ThemedText style={[styles.waitText, { color: theme.textSecondary }]}>
                    Est. wait: {place.estimatedWait}
                  </ThemedText>
                )}
              </View>
            </View>
          </Animated.View>
        )}

        {/* Description */}
        <Animated.View entering={FadeInDown.delay(160).duration(200)}>
          <View style={[styles.section, { borderColor: theme.border }]}>
            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>About</ThemedText>
            <ThemedText style={styles.descText}>{place.description}</ThemedText>
          </View>
        </Animated.View>

        {/* Review summary */}
        {place.reviewSummary && (
          <Animated.View entering={FadeInDown.delay(180).duration(200)}>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <View style={styles.sampleLabelRow}>
                <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>What people say</ThemedText>
                <ThemedText style={styles.sampleLabel}>Sample data</ThemedText>
              </View>
              <ThemedText style={[styles.descText, { fontStyle: 'italic' }]}>{`\u201C${place.reviewSummary}\u201D`}</ThemedText>
              {place.bestQualities && place.bestQualities.length > 0 && (
                <View style={styles.qualitiesRow}>
                  <ThemedText style={[styles.qualitiesLabel, { color: theme.textSecondary }]}>Best for:</ThemedText>
                  <View style={styles.tagRow}>
                    {place.bestQualities.map((q) => (
                      <View key={q} style={[styles.qualityTag, { backgroundColor: 'rgba(22,163,74,0.08)' }]}>
                        <ThemedText style={[styles.qualityTagText, { color: '#16A34A' }]}>{q}</ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {place.commonComplaints && place.commonComplaints.length > 0 && (
                <View style={styles.qualitiesRow}>
                  <ThemedText style={[styles.qualitiesLabel, { color: theme.textSecondary }]}>Heads up:</ThemedText>
                  {place.commonComplaints.map((c, i) => (
                    <ThemedText key={i} style={[styles.complaintText, { color: theme.textSecondary }]}>{'\u2022'} {c}</ThemedText>
                  ))}
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* Individual reviews */}
        {place.reviews && place.reviews.length > 0 && (
          <Animated.View entering={FadeInDown.delay(200).duration(200)}>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <View style={styles.sampleLabelRow}>
                <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>
                  Reviews ({place.reviews.length})
                </ThemedText>
                <ThemedText style={styles.sampleLabel}>Sample data</ThemedText>
              </View>
              {reviewsToShow.map((review, i) => (
                <ReviewCard key={i} review={review} theme={theme} />
              ))}
              {place.reviews.length > 2 && (
                <Pressable onPress={() => setShowAllReviews(!showAllReviews)} accessibilityRole="button" accessibilityLabel={showAllReviews ? 'Show fewer reviews' : `Show all ${place.reviews.length} reviews`}>
                  <ThemedText style={[styles.showMoreText, { color: theme.primary }]}>
                    {showAllReviews ? 'Show less' : `Show all ${place.reviews.length} reviews`}
                  </ThemedText>
                </Pressable>
              )}
            </View>
          </Animated.View>
        )}

        {/* Atmosphere */}
        {place.atmosphere && place.atmosphere.length > 0 && (
          <Animated.View entering={FadeInDown.delay(220).duration(200)}>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Atmosphere</ThemedText>
              <View style={styles.tagRow}>
                {place.atmosphere.map((a) => (
                  <View key={a} style={[styles.atmoTag, { backgroundColor: theme.primaryMuted }]}>
                    <ThemedText style={[styles.atmoTagText, { color: theme.primary }]}>{a}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          </Animated.View>
        )}

        {/* Popular dishes / menu */}
        {place.popularDishes && place.popularDishes.length > 0 && (
          <Animated.View entering={FadeInDown.delay(240).duration(200)}>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Popular dishes</ThemedText>
              {place.popularDishes.map((dish, i) => (
                <View key={i} style={styles.dishRow}>
                  <ThemedText style={styles.dishBullet}>{'\u2022'}</ThemedText>
                  <ThemedText style={styles.dishText}>{dish}</ThemedText>
                </View>
              ))}
              {place.menuCategories && place.menuCategories.length > 0 && (
                <View style={[styles.menuCats, { marginTop: 8 }]}>
                  <ThemedText style={[styles.qualitiesLabel, { color: theme.textSecondary }]}>Menu sections:</ThemedText>
                  <ThemedText style={[styles.menuCatText, { color: theme.textSecondary }]}>
                    {place.menuCategories.join(' \u00B7 ')}
                  </ThemedText>
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* Hours & availability */}
        <Animated.View entering={FadeInDown.delay(260).duration(200)}>
          <View style={[styles.section, { borderColor: theme.border }]}>
            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Hours & availability</ThemedText>
            {place.weeklyHours ? (
              <>
                {(showAllHours ? DAY_NAMES : DAY_NAMES.slice(0, 3)).map((day) => (
                  <View key={day} style={styles.hoursRow}>
                    <ThemedText style={[styles.hoursDay, { color: theme.textSecondary }]}>{day}</ThemedText>
                    <ThemedText style={styles.hoursTime}>
                      {place.weeklyHours![day] ?? place.hours ?? 'Unknown'}
                    </ThemedText>
                  </View>
                ))}
                <Pressable onPress={() => setShowAllHours(!showAllHours)} accessibilityRole="button" accessibilityLabel={showAllHours ? 'Show fewer hours' : 'Show full week hours'}>
                  <ThemedText style={[styles.showMoreText, { color: theme.primary }]}>
                    {showAllHours ? 'Show less' : 'Show full week'}
                  </ThemedText>
                </Pressable>
              </>
            ) : place.hours ? (
              <ThemedText style={styles.detailValue}>{place.hours}</ThemedText>
            ) : (
              <ThemedText style={[styles.detailValue, { color: theme.textSecondary }]}>Hours not available</ThemedText>
            )}
            {place.reservationsRecommended && (
              <View style={[styles.reservationNote, { backgroundColor: 'rgba(229,229,229,0.06)' }]}>
                <ThemedText style={[styles.reservationText, { color: theme.primary }]}>
                  Reservations recommended
                </ThemedText>
              </View>
            )}
          </View>
        </Animated.View>

        {/* Experience details */}
        <Animated.View entering={FadeInDown.delay(280).duration(200)}>
          <View style={[styles.section, { borderColor: theme.border }]}>
            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Details</ThemedText>
            <View style={styles.detailGrid}>
              <View style={styles.detailItem}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Crowds</ThemedText>
                <ThemedText style={styles.detailValue}>{crowdLabels[place.crowdLevel]}</ThemedText>
              </View>
              <View style={styles.detailItem}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Activity level</ThemedText>
                <ThemedText style={styles.detailValue}>{energyLabels[place.energyLevel]}</ThemedText>
              </View>
              {place.noiseLevel && (
                <View style={styles.detailItem}>
                  <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Noise level</ThemedText>
                  <ThemedText style={styles.detailValue}>{noiseLevelLabels[place.noiseLevel]}</ThemedText>
                </View>
              )}
              {place.dressCode && (
                <View style={styles.detailItem}>
                  <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Dress code</ThemedText>
                  <ThemedText style={styles.detailValue}>{place.dressCode}</ThemedText>
                </View>
              )}
            </View>
          </View>
        </Animated.View>

        {/* Facilities & practical info */}
        {(place.outdoorSeating || place.rooftop || place.waterfront || place.scenicView ||
          place.wifi || place.parking || place.petFriendly || place.familyFriendly ||
          place.groupFriendly || place.takeout || place.delivery) && (
          <Animated.View entering={FadeInDown.delay(300).duration(200)}>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Facilities</ThemedText>
              <View style={styles.facilitiesGrid}>
                {place.outdoorSeating && <FacilityItem label="Outdoor seating" theme={theme} />}
                {place.rooftop && <FacilityItem label="Rooftop" theme={theme} />}
                {place.waterfront && <FacilityItem label="Waterfront" theme={theme} />}
                {place.scenicView && <FacilityItem label="Scenic view" theme={theme} />}
                {place.wifi && <FacilityItem label="Wi-Fi" theme={theme} />}
                {place.parking && <FacilityItem label="Parking" theme={theme} />}
                {place.takeout && <FacilityItem label="Takeout" theme={theme} />}
                {place.delivery && <FacilityItem label="Delivery" theme={theme} />}
                {place.familyFriendly && <FacilityItem label="Family-friendly" theme={theme} />}
                {place.groupFriendly && <FacilityItem label="Group-friendly" theme={theme} />}
                {place.petFriendly && <FacilityItem label="Pet-friendly" theme={theme} />}
              </View>
            </View>
          </Animated.View>
        )}

        {/* Dietary options */}
        {place.dietaryOptions && place.dietaryOptions.length > 0 && (
          <Animated.View entering={FadeInDown.delay(320).duration(200)}>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Dietary info</ThemedText>
              <View style={styles.tagRow}>
                {place.dietaryOptions.map((d) => (
                  <View key={d} style={[styles.dietTag, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <ThemedText style={styles.dietTagText}>{d}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          </Animated.View>
        )}

        {/* Accessibility */}
        {place.accessibility && place.accessibility.length > 0 && (
          <Animated.View entering={FadeInDown.delay(340).duration(200)}>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Accessibility</ThemedText>
              {place.accessibility.map((a) => (
                <ThemedText key={a} style={styles.accessItem}>{'\u2713'} {a}</ThemedText>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Tags */}
        <Animated.View entering={FadeInDown.delay(380).duration(200)}>
          <View style={[styles.section, { borderColor: theme.border }]}>
            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Tags</ThemedText>
            <View style={styles.tagRow}>
              {place.tags.map((t) => (
                <View key={t} style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={styles.tagText}>{t}</ThemedText>
                </View>
              ))}
            </View>
          </View>
        </Animated.View>

        {/* Last updated */}
        {place.lastUpdated && (
          <Animated.View entering={FadeInDown.delay(400).duration(200)}>
            <ThemedText style={[styles.lastUpdated, { color: theme.textSecondary }]}>
              Last updated {place.lastUpdated}
            </ThemedText>
          </Animated.View>
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
          <Pressable style={styles.addModalBackdrop} onPress={() => setPendingAdd(null)} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Pressable style={[styles.addModalSheet, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()} accessibilityRole="button" accessibilityLabel="Add to trip options">
              <ThemedText type="subtitle" style={styles.addModalTitle}>Add to trip</ThemedText>
              <ThemedText style={[styles.addModalPlace, { color: theme.textSecondary }]}>
                {place.title} {'\u00B7'} Day {pendingAdd.day}
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

      {/* Bottom action bar */}
      <View style={[styles.bottomBar, { backgroundColor: theme.background, borderTopColor: theme.border, paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          onPress={handleToggleSave}
          style={[styles.saveButton, { borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Unsave place' : 'Save place'}
        >
          <ThemedText style={styles.saveButtonIcon}>{saved ? '\u2665' : '\u2661'}</ThemedText>
          <ThemedText style={[styles.saveButtonText, { color: theme.text }]}>
            {saved ? 'Saved' : 'Save'}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={handleAddToTrip}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Add to trip"
        >
          <ThemedText style={[styles.addButtonText, { color: theme.primaryText }]}>Add to trip</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function FacilityItem({ label, theme }: { label: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.facilityItem, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText style={styles.facilityCheck}>{'\u2713'}</ThemedText>
      <ThemedText style={styles.facilityLabel}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  backLink: { paddingVertical: 8 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: {},
  headerBackText: { fontSize: 16, fontWeight: '500' },
  headerSubtitle: { fontSize: 14, fontWeight: '500' },

  // Sample banner
  sampleBanner: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: Spacing.three,
  },
  sampleBannerText: { fontSize: 12, fontWeight: '500', color: '#B45309', textAlign: 'center' },

  // Scroll
  scrollContent: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four },

  // Title
  titleSection: { gap: 4, marginBottom: Spacing.three },
  placeTitle: { fontSize: 26 },
  destination: { fontSize: 14 },
  verified: { fontSize: 12, fontWeight: '600', marginTop: 2 },

  // Rating
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.three },
  stars: { flexDirection: 'row', gap: 2 },
  star: { fontSize: 18, lineHeight: 22 },
  ratingNum: { fontSize: 16, fontWeight: '700' },
  reviewCount: { fontSize: 13 },

  // Pills
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.four },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  pillText: { fontSize: 13, fontWeight: '600' },

  // Action buttons row (Directions, Website, Phone)
  actionBtnRow: { flexDirection: 'row', gap: 10, marginBottom: Spacing.three },
  actionBtn: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 10, alignItems: 'center', gap: 4 },
  actionBtnIcon: { fontSize: 18, lineHeight: 24 },
  actionBtnLabel: { fontSize: 12, fontWeight: '600' },
  bookBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center' as const, marginTop: 8, marginBottom: 4 },
  bookBtnText: { fontSize: 15, fontWeight: '700' as const },

  // Match card
  matchCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.three,
    gap: 6,
  },
  matchTitle: { fontSize: 14, fontWeight: '700' },
  matchReason: { fontSize: 14, lineHeight: 20, paddingLeft: 4 },

  // Warning card
  warningCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: Spacing.three,
    gap: 4,
  },
  warningText: { fontSize: 13, lineHeight: 20, color: '#B45309' },

  // Status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  statusText: { fontSize: 13, fontWeight: '600' },
  waitText: { fontSize: 13 },

  // Sections
  section: { gap: 8, paddingBottom: Spacing.three, marginBottom: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  sampleLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sampleLabel: { fontSize: 10, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 },

  descText: { fontSize: 15, lineHeight: 23 },

  // Reviews
  reviewCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  reviewHeader: { gap: 4 },
  reviewSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reviewThemeIcon: { fontSize: 14, lineHeight: 20 },
  reviewSource: { fontSize: 12, fontWeight: '600' },
  reviewThemeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  reviewThemeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  reviewMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewRating: { fontSize: 12, letterSpacing: 1 },
  reviewDate: { fontSize: 11 },
  reviewText: { fontSize: 14, lineHeight: 21 },
  showMoreText: { fontSize: 14, fontWeight: '600', marginTop: 4 },

  // Qualities
  qualitiesRow: { gap: 4, marginTop: 4 },
  qualitiesLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  qualityTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  qualityTagText: { fontSize: 12, fontWeight: '600' },
  complaintText: { fontSize: 13, lineHeight: 20, paddingLeft: 4 },

  // Tags
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  tagText: { fontSize: 12, fontWeight: '600' },

  // Atmosphere
  atmoTag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  atmoTagText: { fontSize: 13, fontWeight: '600' },

  // Dishes
  dishRow: { flexDirection: 'row', gap: 6, paddingLeft: 2 },
  dishBullet: { fontSize: 14 },
  dishText: { fontSize: 14, lineHeight: 22, flex: 1 },
  menuCats: { gap: 2 },
  menuCatText: { fontSize: 13 },

  // Hours
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  hoursDay: { fontSize: 14, fontWeight: '500', width: 100 },
  hoursTime: { fontSize: 14 },
  reservationNote: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginTop: 4 },
  reservationText: { fontSize: 13, fontWeight: '600' },

  // Diet
  dietTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  dietTagText: { fontSize: 12, fontWeight: '500' },

  // Details
  detailGrid: { gap: 12 },
  detailItem: { gap: 2 },
  detailLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: 15 },

  // Facilities
  facilitiesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  facilityItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  facilityCheck: { fontSize: 12, color: '#16A34A' },
  facilityLabel: { fontSize: 13 },

  // Access
  accessItem: { fontSize: 14, lineHeight: 22 },

  // Last updated
  lastUpdated: { fontSize: 11, textAlign: 'center', marginTop: 8, marginBottom: 16 },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing.four,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  saveButtonIcon: { fontSize: 18, lineHeight: 24 },
  saveButtonText: { fontSize: 15, fontWeight: '600' },
  addButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  addButtonText: { fontSize: 17, fontWeight: '700' },

  // Add to trip time picker modal
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
