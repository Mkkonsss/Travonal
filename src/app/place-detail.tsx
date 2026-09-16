import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { SymbolView } from 'expo-symbols';
import NativeMap from '@/components/native-map';
import { DEFAULT_PATH_DATA } from '@/constants/map-icons';
import { TimePickerButton } from '@/components/time-picker';
import { SelectionSheet, SelectionOption } from '@/components/selection-sheet';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { BoardPicker } from '@/components/board-picker';
import { useBoards } from '@/context/boards';
import { useInbox } from '@/context/inbox';
import { useToast } from '@/context/toast';
import { useTheme } from '@/hooks/use-theme';
import { searchAllPlaces } from '@/services/places-data';
import { sortTripsForPicker, formatDayLabel } from '@/services/trip-helpers';
import { categoryToActivityType, priceLevelLabel } from '@/services/place-model';
import { getPlacePhoto } from '@/services/free-photos';
import { fetchPlaceDetails, getCachedPlaceDetails, searchExplorePlaces } from '@/services/explore-service';
import { normalizeGooglePlace } from '@/services/place-model';
import { getPlaceBookingLinks, getPlaceBookingSectionTitle, openBookingLink, isBookablePlace, getBookableCTA } from '@/services/booking-links';
import { generateDescriptionAI } from '@/services/ai';

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
  food: 'fork.knife',
  service: 'star.fill',
  atmosphere: 'sparkles',
  value: 'dollarsign.circle.fill',
  view: 'sun.horizon.fill',
};

/** All theme icons are now SF Symbol names */
const SF_SYMBOL_THEMES = new Set(Object.keys(REVIEW_THEME_ICONS));

function StarRating({ rating, reviewCount }: { rating: number; reviewCount: number }) {
  const theme = useTheme();
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.3;

  return (
    <View style={styles.ratingRow}>
      <View style={styles.stars}>
        {Array.from({ length: 5 }, (_, i) => {
          const filled = i < fullStars || (i === fullStars && hasHalf);
          return (
            <SymbolView
              key={i}
              name={filled ? 'star.fill' : 'star'}
              size={14}
              tintColor={filled ? '#F59E0B' : '#D1D5DB'}
            />
          );
        })}
      </View>
      <ThemedText style={[styles.ratingNum, { color: theme.text }]}>{rating.toFixed(1)}</ThemedText>
      <ThemedText style={[styles.reviewCount, { color: theme.textSecondary }]}>
        ({reviewCount.toLocaleString()} reviews)
      </ThemedText>
    </View>
  );
}

function ReviewCard({ review, theme }: { review: { source: string; photoUri?: string; text: string; rating: number; date: string; theme?: string }; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.reviewCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewSourceRow}>
          {review.photoUri ? (
            <ExpoImage source={{ uri: review.photoUri }} style={styles.reviewAvatar} contentFit="cover" cachePolicy="memory-disk" />
          ) : review.theme && REVIEW_THEME_ICONS[review.theme] ? (
            SF_SYMBOL_THEMES.has(review.theme) ? (
              <SymbolView name={REVIEW_THEME_ICONS[review.theme] as any} size={14} tintColor={theme.textSecondary} />
            ) : (
              <ThemedText style={styles.reviewThemeIcon}>{REVIEW_THEME_ICONS[review.theme]}</ThemedText>
            )
          ) : null}
          <ThemedText style={[styles.reviewSource, { color: theme.textSecondary }]}>{review.source}</ThemedText>
          {review.theme && (
            <View style={[styles.reviewThemeBadge, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={[styles.reviewThemeText, { color: theme.primary }]}>{review.theme}</ThemedText>
            </View>
          )}
        </View>
        <View style={styles.reviewMeta}>
          <View style={{ flexDirection: 'row', gap: 1 }}>
            {Array.from({ length: review.rating }, (_, i) => (
              <SymbolView key={`f${i}`} name="star.fill" size={14} tintColor="#F59E0B" />
            ))}
            {Array.from({ length: 5 - review.rating }, (_, i) => (
              <SymbolView key={`e${i}`} name="star" size={14} tintColor="#D1D5DB" />
            ))}
          </View>
          <ThemedText style={[styles.reviewDate, { color: theme.textSecondary }]}>{review.date}</ThemedText>
        </View>
      </View>
      <ThemedText style={styles.reviewText}>{review.text}</ThemedText>
    </View>
  );
}

export default function PlaceDetailScreen() {
  const params = useLocalSearchParams<{
    title?: string; destination?: string; tripId?: string; day?: string;
    description?: string; rating?: string; reviewCount?: string; category?: string;
    lat?: string; lng?: string; name?: string; placeId?: string; address?: string;
    website?: string; phone?: string; hours?: string;
    priceLevel?: string; googleMapsUri?: string; openNow?: string;
    photoRef?: string; imageUrl?: string; notes?: string;
  }>();
  const {
    title: paramTitle, destination: paramDest, tripId: paramTripId, day: paramDay,
    description: paramDescription, rating: paramRating, reviewCount: paramReviewCount,
    category: paramCategory, lat: paramLat, lng: paramLng,
    name: paramName, placeId: paramPlaceId, address: paramAddress,
    website: paramWebsite, phone: paramPhone, hours: paramHours,
    priceLevel: paramPriceLevel, googleMapsUri: paramGoogleMapsUri,
    openNow: paramOpenNow, photoRef: paramPhotoRef, imageUrl: paramImageUrl,
    notes: paramNotes,
  } = params;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { showToast } = useToast();
  const { trips, addActivity } = useTrips();
  const { profile } = useProfile();
  const { savedPlaces, savePlace, unsavePlace, isSaved } = useInbox();
  const { addItemToBoard } = useBoards();
  const [boardPickerVisible, setBoardPickerVisible] = useState(false);
  const [showAllHours, setShowAllHours] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [mapFullScreen, setMapFullScreen] = useState(false);
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

  // Resolve name: prefer paramName (new flow), fall back to paramTitle (old flow)
  const title = paramName ?? paramTitle ?? '';
  const destination = paramDest ?? '';
  console.log('[PLACE-DETAIL] Opened with params:', { name: paramName, title: paramTitle, placeId: paramPlaceId, rating: paramRating, destination: paramDest, imageUrl: paramImageUrl, photoRef: paramPhotoRef, openNow: paramOpenNow, address: paramAddress });

  // Photo URL — use image passed from caller (e.g. board) immediately if available
  const [photoUrl, setPhotoUrl] = useState<string | null>(paramImageUrl ?? null);
  // Google Place Details (reviews, summary, etc.) — initialize from cache if available
  const [googleDetails, setGoogleDetails] = useState<Record<string, unknown> | null>(
    () => {
      const cached = paramPlaceId ? getCachedPlaceDetails(paramPlaceId) : null;
      console.log('[PLACE-DETAIL] Cache hit?', !!cached, 'placeId:', paramPlaceId);
      return cached;
    }
  );
  // Resolved place data (from Google Places lookup when no placeId was provided)
  const [resolvedPlace, setResolvedPlace] = useState<{
    placeId?: string; address?: string; rating?: number; reviewCount?: number;
    lat?: number; lng?: number; website?: string; phone?: string;
    openingHours?: string[]; priceLevel?: number; googleMapsUri?: string;
    openNow?: boolean; category?: string;
  } | null>(null);
  const resolveAttempted = useRef(false);
  const [resolveFinished, setResolveFinished] = useState(!!paramPlaceId);
  const [aiDescription, setAiDescription] = useState<string | null>(null);
  const [aiDescLoading, setAiDescLoading] = useState(false);
  const aiDescAttempted = useRef(false);

  // The effective placeId — from URL params or from our own resolution
  const effectivePlaceId = paramPlaceId ?? resolvedPlace?.placeId;

  // When no placeId was provided, resolve via explore search.
  // Phase 1: search → sets basic info (address, rating, openNow) immediately
  // Phase 2: fetchPlaceDetails → adds reviews, summaries, hours
  useEffect(() => {
    if (paramPlaceId || resolveAttempted.current || !title) return;
    resolveAttempted.current = true;
    (async () => {
      try {
        // Use lat/lng from URL params to skip geocoding when available
        const hasCoords = paramLat != null && paramLng != null;
        const searchLocation = hasCoords
          ? { type: 'current' as const, lat: parseFloat(paramLat!), lng: parseFloat(paramLng!), label: destination || '' }
          : { type: 'custom' as const, query: destination || 'world', label: destination || '' };

        const results = await searchExplorePlaces(title, searchLocation);
        if (results.length > 0 && results[0].placeId) {
          const match = results[0];
          // Phase 1: show basic data immediately from search results
          setResolvedPlace({
            placeId: match.placeId,
            address: match.address,
            rating: match.rating,
            reviewCount: match.reviewCount,
            lat: match.lat ?? undefined,
            lng: match.lng ?? undefined,
            website: match.website,
            phone: match.phone,
            openingHours: match.openingHours,
            priceLevel: match.priceLevel,
            googleMapsUri: match.googleMapsUri,
            openNow: match.openNow,
            category: match.category,
          });
          setResolveFinished(true);

          // Phase 2: fetch full details for reviews/summaries (non-blocking)
          const details = await fetchPlaceDetails(match.placeId!);
          if (details) {
            setGoogleDetails(details);
          }
        }
      } catch (err) {
        console.log('[PLACE-DETAIL] Self-resolution error:', err);
      } finally {
        setResolveFinished(true);
      }
    })();
  }, [paramPlaceId, title, destination]);

  // Extract photo reference from Google details
  const googlePhotoRef = (() => {
    const photos = googleDetails?.photos as Record<string, unknown>[] | undefined;
    if (photos && photos.length > 0) return photos[0].name as string | undefined;
    return undefined;
  })();

  // Use photo ref from URL param or from Google details
  const effectivePhotoRef = paramPhotoRef ?? googlePhotoRef;

  // Fetch photo — skip if we already have one (e.g. from imageUrl param),
  // and only attempt when we have a photoRef to avoid caching null
  useEffect(() => {
    if (!title || !effectivePhotoRef || photoUrl) return;
    let cancelled = false;
    const cacheKey = effectivePlaceId ?? title;

    getPlacePhoto({
      cacheKey,
      photoRef: effectivePhotoRef,
      name: title,
    }).then((result) => {
      if (!cancelled && result) setPhotoUrl(result.url);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [title, effectivePlaceId, effectivePhotoRef]);

  // Fetch full Google Place Details when we have a placeId (from params or resolved)
  useEffect(() => {
    if (!effectivePlaceId || effectivePlaceId.startsWith('osm:')) return;
    // Skip if we already set googleDetails from the resolution step
    if (googleDetails) return;
    let cancelled = false;

    fetchPlaceDetails(effectivePlaceId).then((details) => {
      if (!cancelled && details) setGoogleDetails(details);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [effectivePlaceId]);

  // Real data flag — true if we have or resolved a placeId
  const isGooglePlace = !!effectivePlaceId;
  const showSampleBanner = !isGooglePlace && resolveFinished;

  // Only fall back to sample pool when we have no real data at all
  const foundPlace = isGooglePlace
    ? undefined
    : searchAllPlaces('', 'all').find((p) => p.title === title && p.destination === destination);

  // Parse opening hours — may be JSON array or single string
  const parsedOpeningHours: string[] | undefined = (() => {
    if (!paramHours) return undefined;
    try {
      const parsed = JSON.parse(paramHours);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return [paramHours];
  })();

  // Map numeric priceLevel (0-4) to cost label
  const priceLevelToCost = (level?: number): string | undefined => {
    if (level == null) return undefined;
    return ['free', 'budget', 'moderate', 'premium', 'premium'][level];
  };

  // Build a unified place object — merge URL params with resolved data
  const parsedPriceLevel = paramPriceLevel != null ? parseInt(paramPriceLevel, 10) : resolvedPlace?.priceLevel;
  const place: Record<string, any> | null = foundPlace ? { ...foundPlace } : (title ? {
    title,
    destination,
    placeId: effectivePlaceId,
    type: 'activity',
    category: paramCategory ?? resolvedPlace?.category ?? 'attraction',
    cost: priceLevelToCost(parsedPriceLevel),
    priceLevel: parsedPriceLevel,
    duration: 60,
    description: paramDescription ?? '',
    tags: [],
    rating: paramRating ? parseFloat(paramRating) : resolvedPlace?.rating,
    reviewCount: paramReviewCount ? parseInt(paramReviewCount, 10) : resolvedPlace?.reviewCount,
    lat: paramLat ? parseFloat(paramLat) : resolvedPlace?.lat,
    lng: paramLng ? parseFloat(paramLng) : resolvedPlace?.lng,
    website: paramWebsite ?? resolvedPlace?.website,
    phone: paramPhone ?? resolvedPlace?.phone,
    openingHours: parsedOpeningHours ?? resolvedPlace?.openingHours,
    googleMapsUri: paramGoogleMapsUri ?? resolvedPlace?.googleMapsUri,
    openNow: paramOpenNow === 'true' ? true : paramOpenNow === 'false' ? false : resolvedPlace?.openNow,
    address: paramAddress ?? resolvedPlace?.address,
  } : null);

  // Enrich place with Google Details data when available
  if (place && googleDetails) {
    const editorial = googleDetails.editorialSummary as Record<string, string> | undefined;
    const generative = googleDetails.generativeSummary as Record<string, unknown> | undefined;
    const overviewText = (generative?.overview as Record<string, string>)?.text;
    const descriptionText = (generative?.description as Record<string, string>)?.text;

    // Use description/editorial for the About section, overview for review summary
    if (!place.description || place.description.length < 10) {
      place.description = descriptionText ?? editorial?.text ?? overviewText ?? place.description;
    }
    // Track whether we have a real description from Google
    const hasRealDescription = !!place.description && place.description.length >= 10;
    if (!hasRealDescription) {
      // Don't use the redundant fallback — leave empty so AI generation kicks in
      place.description = '';
    }

    // Enrich with Google reviews (including author photos)
    const rawReviews = googleDetails.reviews as Record<string, unknown>[] | undefined;
    if (rawReviews && rawReviews.length > 0 && (!place.reviews || place.reviews.length === 0)) {
      place.reviews = rawReviews.map((r) => {
        const author = r.authorAttribution as Record<string, string> | undefined;
        const ratingVal = r.rating as number | undefined;
        const relTime = r.relativePublishTimeDescription as string | undefined;
        const origText = r.originalText as Record<string, string> | undefined;
        const rText = r.text as Record<string, string> | undefined;
        return {
          source: author?.displayName ?? 'Google User',
          photoUri: author?.photoUri ?? '',
          text: origText?.text ?? rText?.text ?? '',
          rating: ratingVal ?? 5,
          date: relTime ?? '',
        };
      }).filter((r) => r.text.length > 0);
    }

    // Review summary from overview text (distinct from description)
    if (!place.reviewSummary && overviewText && overviewText !== place.description) {
      place.reviewSummary = overviewText;
    }

    // Opening hours (current → regular fallback)
    const gHours = googleDetails.currentOpeningHours as Record<string, unknown> | undefined;
    const gRegularHours = googleDetails.regularOpeningHours as Record<string, unknown> | undefined;
    if (!place.openingHours) {
      const weekdays = (gHours?.weekdayDescriptions ?? gRegularHours?.weekdayDescriptions) as string[] | undefined;
      if (weekdays) place.openingHours = weekdays;
    }

    // Website / phone / googleMapsUri
    if (!place.website && googleDetails.websiteUri) place.website = googleDetails.websiteUri as string;
    if (!place.phone) {
      place.phone = (googleDetails.nationalPhoneNumber ?? googleDetails.internationalPhoneNumber) as string | undefined;
    }
    if (!place.googleMapsUri && googleDetails.googleMapsUri) place.googleMapsUri = googleDetails.googleMapsUri as string;

    // Price level
    if (place.priceLevel == null && googleDetails.priceLevel != null) {
      place.priceLevel = googleDetails.priceLevel as number;
      place.cost = priceLevelToCost(place.priceLevel);
    }

    // Open now
    if (place.openNow == null && gHours?.openNow != null) {
      place.openNow = gHours.openNow as boolean;
    }

    // Short address
    if (googleDetails.shortFormattedAddress) {
      place.shortFormattedAddress = googleDetails.shortFormattedAddress as string;
    }

    // Primary type display name (e.g. "Italian Restaurant")
    const primaryType = googleDetails.primaryTypeDisplayName as Record<string, string> | undefined;
    if (primaryType?.text) {
      place.primaryTypeLabel = primaryType.text;
    }

    // Business status warnings
    const bizStatus = googleDetails.businessStatus as string | undefined;
    if (bizStatus === 'CLOSED_TEMPORARILY' || bizStatus === 'CLOSED_PERMANENTLY') {
      place.businessStatus = bizStatus;
      if (!place.warnings) place.warnings = [];
      const msg = bizStatus === 'CLOSED_TEMPORARILY'
        ? 'This place is temporarily closed'
        : 'This place appears to be permanently closed';
      if (!place.warnings.includes(msg)) place.warnings.push(msg);
    }

    // Reservable
    if (googleDetails.reservable) place.reservationsRecommended = true;

    // Service options
    if (googleDetails.dineIn) place.dineIn = true;
    if (googleDetails.takeout) place.takeout = true;
    if (googleDetails.delivery) place.delivery = true;
    if (googleDetails.curbsidePickup) place.curbsidePickup = true;
    if (googleDetails.outdoorSeating) place.outdoorSeating = true;
    if (googleDetails.liveMusic) place.liveMusic = true;
    if (googleDetails.restroom) place.restroom = true;

    // Good for
    if (googleDetails.goodForChildren) place.familyFriendly = true;
    if (googleDetails.goodForGroups) place.groupFriendly = true;
    if (googleDetails.goodForWatchingSports) place.goodForSports = true;
    if (googleDetails.allowsDogs) place.petFriendly = true;
    if (googleDetails.menuForChildren) place.childrenMenu = true;

    // Meal service
    const meals: string[] = [];
    if (googleDetails.servesBreakfast) meals.push('Breakfast');
    if (googleDetails.servesBrunch) meals.push('Brunch');
    if (googleDetails.servesLunch) meals.push('Lunch');
    if (googleDetails.servesDinner) meals.push('Dinner');
    if (meals.length > 0) place.mealService = meals;

    // Drinks
    const drinks: string[] = [];
    if (googleDetails.servesCoffee) drinks.push('Coffee');
    if (googleDetails.servesBeer) drinks.push('Beer');
    if (googleDetails.servesWine) drinks.push('Wine');
    if (googleDetails.servesCocktails) drinks.push('Cocktails');
    if (googleDetails.servesDessert) drinks.push('Dessert');
    if (drinks.length > 0) place.drinksService = drinks;

    // Vegetarian
    if (googleDetails.servesVegetarianFood) {
      if (!place.dietaryOptions) place.dietaryOptions = [];
      if (!place.dietaryOptions.includes('Vegetarian')) place.dietaryOptions.push('Vegetarian');
    }

    // Accessibility (structured)
    const a11y = googleDetails.accessibilityOptions as Record<string, boolean> | undefined;
    if (a11y) {
      const items: string[] = [];
      if (a11y.wheelchairAccessibleEntrance) items.push('Wheelchair accessible entrance');
      if (a11y.wheelchairAccessibleParking) items.push('Wheelchair accessible parking');
      if (a11y.wheelchairAccessibleRestroom) items.push('Wheelchair accessible restroom');
      if (a11y.wheelchairAccessibleSeating) items.push('Wheelchair accessible seating');
      if (items.length > 0) place.accessibility = items;
    }

    // Parking
    const parkOpts = googleDetails.parkingOptions as Record<string, boolean> | undefined;
    if (parkOpts) {
      const items: string[] = [];
      if (parkOpts.freeParkingLot || parkOpts.freeStreetParking) items.push('Free parking');
      if (parkOpts.paidParkingLot || parkOpts.paidStreetParking) items.push('Paid parking');
      if (parkOpts.valetParking) items.push('Valet parking');
      if (items.length > 0) {
        place.parking = true;
        place.parkingDetails = items;
      }
    }

    // Payment
    const payOpts = googleDetails.paymentOptions as Record<string, boolean> | undefined;
    if (payOpts) {
      const items: string[] = [];
      if (payOpts.acceptsCreditCards) items.push('Credit cards');
      if (payOpts.acceptsDebitCards) items.push('Debit cards');
      if (payOpts.acceptsNfc) items.push('NFC / contactless');
      if (payOpts.acceptsCashOnly) items.push('Cash only');
      if (items.length > 0) place.paymentOptions = items;
    }
  }

  // If we have an AI-generated description, use it
  if (place && aiDescription) {
    place.description = aiDescription;
  }

  // Determine if we need to generate a description
  const needsAiDescription = !!place && (!place.description || place.description.length < 10) && !aiDescription && !aiDescLoading;

  // Generate AI description when no real one is available
  useEffect(() => {
    if (!needsAiDescription || aiDescAttempted.current) return;
    aiDescAttempted.current = true;
    setAiDescLoading(true);
    generateDescriptionAI({
      name: place!.title ?? title,
      location: place!.destination ?? place!.address ?? destination,
      category: place!.category,
      type: place!.type,
    }).then((result) => {
      if (result.description) {
        setAiDescription(result.description);
      }
    }).catch(() => {
      // Silent fail — About section just won't show
    }).finally(() => {
      setAiDescLoading(false);
    });
  }, [needsAiDescription]);

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

  const placeBookable = isBookablePlace({
    category: place.category ?? '',
    reservable: place.reservationsRecommended ?? (googleDetails?.reservable as boolean | undefined),
    priceLevel: place.priceLevel,
  });

  // Build genuinely personalized match reasons from real profile + place data
  const personalReasons: string[] = [];
  if (place.matchReasons && place.matchReasons.length > 0) {
    personalReasons.push(...place.matchReasons);
  } else {
    const interests = profile.interests ?? [];
    const cat = place.category ?? '';

    // Match interests to category
    const INTEREST_CATEGORIES: Record<string, string[]> = {
      food: ['food/restaurant', 'food/cafe', 'food/bakery', 'food/bar', 'food/other'],
      culture: ['activity/museum', 'activity/attraction'],
      history: ['activity/museum', 'activity/attraction'],
      art: ['activity/museum', 'activity/entertainment'],
      nature: ['activity/park'],
      photography: ['activity/attraction', 'activity/park'],
      architecture: ['activity/attraction', 'activity/museum'],
      shopping: ['shopping'],
      nightlife: ['food/bar'],
      music: ['food/bar', 'activity/entertainment'],
    };

    const matchedInterests = interests.filter((interest) => {
      const cats = INTEREST_CATEGORIES[interest.toLowerCase()] ?? [];
      return cats.includes(cat);
    });

    if (matchedInterests.length >= 2) {
      personalReasons.push(
        'Great fit for your interest in ' + matchedInterests.slice(0, 2).join(' and ')
      );
    } else if (matchedInterests.length === 1) {
      const interest = matchedInterests[0];
      if (cat.startsWith('activity/')) {
        personalReasons.push('Aligns with your interest in ' + interest);
      } else if (cat.startsWith('food/')) {
        personalReasons.push('A great pick for ' + interest + ' lovers');
      }
    }

    // Pace-aware suggestion
    if (profile.pace === 'relaxed' && cat.startsWith('activity/') && !cat.includes('entertainment')) {
      personalReasons.push('Easy to enjoy at a relaxed pace');
    }

    // Trip context: find nearest trip activity
    const activeTripId = paramTripId;
    const activeTrip = activeTripId ? trips.find((t) => t.id === activeTripId) : null;
    const placeLat = place.lat;
    const placeLng = place.lng;
    if (activeTrip && placeLat && placeLng) {
      const lastAct = [...activeTrip.activities]
        .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
        .find((a) => a.lat && a.lng);
      if (lastAct?.lat && lastAct?.lng) {
        const dLat = (placeLat - lastAct.lat) * 111000;
        const dLng = (placeLng - lastAct.lng) * 111000 * Math.cos(lastAct.lat * Math.PI / 180);
        const distM = Math.sqrt(dLat * dLat + dLng * dLng);
        const distMin = Math.round(distM / 80);
        if (distMin <= 30) {
          personalReasons.push(
            'About ' + distMin + ' min walk from ' + lastAct.title + ' on Day ' + lastAct.day
          );
        }
      }
    }
  }

  function handleSaveToBoard(boardId: string) {
    if (!place) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addItemToBoard(boardId, {
      title: place.title,
      destination: place.destination,
      type: place.type as 'activity' | 'food' | 'hotel' | 'flight',
      category: place.category,
      cost: place.cost,
      duration: place.duration,
      description: place.description,
      sourceType: 'explore',
      placeId: params.placeId,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      rating: place.rating,
      ...(photoUrl ? { mediaUri: photoUrl, mediaType: 'image' as const } : {}),
    });
    showToast(`"${place.title}" saved to board`, 'success');
    setBoardPickerVisible(false);
  }

  function handleAddToTrip() {
    // If launched with explicit tripId + day context, skip the pickers
    if (paramTripId && paramDay) {
      doAdd(paramTripId, Number(paramDay));
      return;
    }

    if (trips.length === 0) {
      showToast('Plan a trip first, then you can add activities', 'info');
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
      options: sorted.map((trip) => ({ label: trip.destination, value: trip.id })),
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
      subtitle: `Add "${place!.title}" to ${trip.destination}`,
      options: Array.from({ length: totalDays }, (_, i) => ({
        label: formatDayLabel(i + 1, trip.startDate, trip.datesKnown),
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
      placeId: place.placeId,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      rating: place.rating,
    });
    setPendingAdd(null);
    showToast(`"${place.title}" added to ${trip?.destination ?? 'trip'} (Day ${day})`, 'success');
  }

  const reviewsToShow = place.reviews
    ? (showAllReviews ? place.reviews : place.reviews.slice(0, 2))
    : [];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <SymbolView name="chevron.left" size={16} tintColor={theme.primary} />
            <ThemedText style={[styles.headerBackText, { color: theme.primary }]}>Back</ThemedText>
          </View>
        </Pressable>
        <ThemedText style={[styles.headerSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>{place.destination}</ThemedText>
        <Pressable
          onPress={async () => {
            const addr = place.shortFormattedAddress ?? place.address ?? '';
            const ratingStr = place.rating ? `Rating: ${place.rating}/5` + (place.reviewCount ? ` (${place.reviewCount} reviews)` : '') : '';
            const desc = place.description ? place.description.slice(0, 120) + (place.description.length > 120 ? '...' : '') : '';
            const link = place.googleMapsUri
              ?? (place.placeId ? `https://www.google.com/maps/place/?q=place_id:${place.placeId}` : '');
            const message = [place.title, addr, ratingStr, desc, link, '', 'Shared from Travonal'].filter(Boolean).join('\n');
            await Share.share({ message });
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Share ${place.title}`}
        >
          <SymbolView name="square.and.arrow.up" size={18} tintColor={theme.primary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Business status warning */}
        {place.businessStatus === 'CLOSED_PERMANENTLY' && (
          <View style={[styles.sampleBanner, { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <SymbolView name="exclamationmark.triangle" size={14} tintColor="#DC2626" />
              <ThemedText style={[styles.sampleBannerText, { color: '#DC2626' }]}>
                This place appears to be permanently closed
              </ThemedText>
            </View>
          </View>
        )}
        {place.businessStatus === 'CLOSED_TEMPORARILY' && (
          <View style={[styles.sampleBanner, { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <SymbolView name="exclamationmark.triangle" size={14} tintColor="#B45309" />
              <ThemedText style={[styles.sampleBannerText, { color: '#B45309' }]}>
                This place is temporarily closed
              </ThemedText>
            </View>
          </View>
        )}

        {/* Sample information notice — only for non-OSM, non-Google places */}
        {showSampleBanner && (
          <View style={[styles.sampleBanner, { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }]}>
            <ThemedText style={styles.sampleBannerText}>
              Sample information {'\u2014'} details shown are simulated for demonstration
            </ThemedText>
          </View>
        )}

        {/* Place photo or placeholder */}
        {photoUrl ? (
            <ExpoImage
              source={{ uri: photoUrl }}
              style={{ width: '100%', height: 200, borderRadius: Radius.sm, marginBottom: 12 }}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
        ) : (
          <View style={{
            width: '100%',
            height: 200,
            borderRadius: Radius.sm,
            marginBottom: 12,
            backgroundColor: theme.border,
          }} />
        )}

        {/* Title section */}
          <View style={styles.titleSection}>
            <ThemedText type="title" style={styles.placeTitle}>{place.title}</ThemedText>
            <ThemedText style={[styles.destination, { color: theme.textSecondary }]}>
              {place.neighborhood ? `${place.neighborhood}, ` : ''}{place.destination}
              {(place.shortFormattedAddress ?? place.address) ? ` \u00B7 ${place.shortFormattedAddress ?? place.address}` : ''}
            </ThemedText>
            {place.verified && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <SymbolView name="checkmark.seal.fill" size={14} tintColor={theme.primary} />
                <ThemedText style={[styles.verified, { color: theme.primary }]}>Verified listing</ThemedText>
              </View>
            )}
          </View>

        {/* Rating */}
        {place.rating != null && place.reviewCount != null && (
          <StarRating rating={place.rating} reviewCount={place.reviewCount} />
        )}

        {/* Quick info pills */}
          <View style={styles.pillRow}>
            {/* Type label — category */}
            {(place.primaryTypeLabel || place.category) && (
              <View style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.pillText} numberOfLines={1}>
                  {place.primaryTypeLabel ?? place.category?.split('/').pop() ?? ''}
                </ThemedText>
              </View>
            )}
            {(() => {
              const priceLabel = place.priceLevel != null
                ? priceLevelLabel(place.priceLevel, place.category)
                : (place.cost && costLabels[place.cost] ? costLabels[place.cost] : '');
              return priceLabel ? (
                <View style={[styles.pill, { backgroundColor: theme.primaryMuted }]}>
                  <ThemedText style={[styles.pillText, { color: theme.primary }]}>
                    {priceLabel}
                    {place.pricePerPerson ? ` \u00B7 ${place.pricePerPerson}/person` : ''}
                  </ThemedText>
                </View>
              ) : null;
            })()}
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
            {place.mealService && place.mealService.map((meal: string) => (
              <View key={meal} style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.pillText}>{meal}</ThemedText>
              </View>
            ))}
          </View>

        {/* Action buttons */}
          <View style={styles.actionBtnContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -Spacing.four }} contentContainerStyle={styles.actionBtnRow}>
            <Pressable
              onPress={handleAddToTrip}
              style={[styles.actionBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Add to trip"
            >
              <SymbolView name="plus.circle" size={18} tintColor={theme.primary} />
              <ThemedText style={[styles.actionBtnLabel, { color: theme.primary }]}>Add to trip</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setBoardPickerVisible(true)}
              style={[styles.actionBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Save to a board"
            >
              <SymbolView name="bookmark" size={18} tintColor={theme.primary} />
              <ThemedText style={[styles.actionBtnLabel, { color: theme.primary }]}>Save</ThemedText>
            </Pressable>
            <Pressable
              onPress={async () => {
                const name = encodeURIComponent(place.title + (place.destination ? ', ' + place.destination : ''));
                const ll = place.lat && place.lng ? `&ll=${place.lat},${place.lng}` : '';
                const url = `https://maps.apple.com/?q=${name}${ll}`;
                const supported = await Linking.canOpenURL(url);
                if (supported) Linking.openURL(url);
                else showToast('Maps app is not available on this device', 'error');
              }}
              style={[styles.actionBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel={`Get directions to ${place.title}`}
            >
              <SymbolView name="arrow.triangle.turn.up.right.diamond" size={18} tintColor={theme.primary} />
              <ThemedText style={[styles.actionBtnLabel, { color: theme.primary }]}>Directions</ThemedText>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!place.website) {
                  showToast('No website listed for this place', 'info');
                  return;
                }
                const supported = await Linking.canOpenURL(place.website);
                if (supported) Linking.openURL(place.website);
                else showToast('Unable to open this URL', 'error');
              }}
              style={[
                styles.actionBtn,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: place.website ? 1 : 0.45 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={place.website ? `Visit ${place.title} website` : 'Website unavailable'}
            >
              <SymbolView name="globe" size={18} tintColor={place.website ? theme.primary : theme.textSecondary} />
              <ThemedText style={[styles.actionBtnLabel, { color: place.website ? theme.primary : theme.textSecondary }]}>Website</ThemedText>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!place.phone) {
                  showToast('No phone number listed for this place', 'info');
                  return;
                }
                const url = `tel:${place.phone}`;
                const supported = await Linking.canOpenURL(url);
                if (supported) Linking.openURL(url);
                else showToast('Phone calls are not supported on this device', 'error');
              }}
              style={[
                styles.actionBtn,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: place.phone ? 1 : 0.45 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={place.phone ? `Call ${place.title}` : 'Phone unavailable'}
            >
              <SymbolView name="phone" size={18} tintColor={place.phone ? theme.primary : theme.textSecondary} />
              <ThemedText style={[styles.actionBtnLabel, { color: place.phone ? theme.primary : theme.textSecondary }]}>Call</ThemedText>
            </Pressable>
            <Pressable
              onPress={async () => {
                const url = place.googleMapsUri
                  ?? (place.placeId ? `https://www.google.com/maps/place/?q=place_id:${place.placeId}` : null)
                  ?? `https://www.google.com/maps/search/${encodeURIComponent(place.title + (place.destination ? ', ' + place.destination : ''))}`;
                const supported = await Linking.canOpenURL(url);
                if (supported) Linking.openURL(url);
                else showToast('Unable to open Google Maps', 'error');
              }}
              style={[styles.actionBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel={`View ${place.title} on Google Maps`}
            >
              <SymbolView name="map" size={18} tintColor={theme.primary} />
              <ThemedText style={[styles.actionBtnLabel, { color: theme.primary }]}>Google</ThemedText>
            </Pressable>
          </ScrollView>
          </View>
        {/* Mini map */}
        {place.lat != null && place.lng != null && (
          <>
            <Pressable
              onPress={() => setMapFullScreen(true)}
              style={styles.miniMapContainer}
              accessibilityRole="button"
              accessibilityLabel="Expand map"
            >
              {Platform.OS === 'web' ? (
                <WebView
                  style={styles.miniMapWebView}
                  scrollEnabled={false}
                  bounces={false}
                  originWhitelist={['*']}
                  source={{ html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><style>body,html,#map{margin:0;padding:0;width:100%;height:100%}</style></head><body><div id="map"></div><script>var m=L.map('map',{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false}).setView([${place.lat},${place.lng}],15);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(m);L.circleMarker([${place.lat},${place.lng}],{radius:8,fillColor:'#4F46E5',color:'#fff',weight:2,fillOpacity:1}).addTo(m);</script></body></html>` }}
                />
              ) : (
                <NativeMap
                  markers={[{
                    key: 'place',
                    latitude: place.lat,
                    longitude: place.lng,
                    title: place.title,
                    color: '#4F46E5',
                    svgPathData: DEFAULT_PATH_DATA,
                  }]}
                  interactive={false}
                  userInterfaceStyle="dark"
                />
              )}
              {/* Expand icon */}
              <View style={styles.miniMapExpandBtn}>
                <View style={styles.miniMapExpandInner}>
                  <SymbolView name="arrow.up.left.and.arrow.down.right" size={14} tintColor="#fff" />
                </View>
              </View>
              {/* Place count badge */}
              <View style={styles.miniMapOverlay}>
                <ThemedText style={styles.miniMapLabel}>Tap to expand</ThemedText>
              </View>
            </Pressable>

            {/* Full-screen map modal */}
            <Modal visible={mapFullScreen} animationType="slide" onRequestClose={() => setMapFullScreen(false)}>
              <View style={styles.fullMapScreen}>
                {Platform.OS === 'web' ? (
                  <WebView
                    style={StyleSheet.absoluteFill}
                    scrollEnabled
                    javaScriptEnabled
                    originWhitelist={['*']}
                    source={{ html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><style>body,html,#map{margin:0;padding:0;width:100%;height:100%}</style></head><body><div id="map"></div><script>var m=L.map('map',{zoomControl:false,attributionControl:false}).setView([${place.lat},${place.lng}],15);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(m);L.circleMarker([${place.lat},${place.lng}],{radius:8,fillColor:'#4F46E5',color:'#fff',weight:2,fillOpacity:1}).addTo(m);</script></body></html>` }}
                  />
                ) : (
                  <NativeMap
                    markers={[{
                      key: 'place',
                      latitude: place.lat,
                      longitude: place.lng,
                      title: place.title,
                      color: '#4F46E5',
                      svgPathData: DEFAULT_PATH_DATA,
                    }]}
                    userInterfaceStyle="dark"
                  />
                )}

                {/* Close button */}
                <Pressable
                  onPress={() => setMapFullScreen(false)}
                  style={styles.fullMapCloseBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Close map"
                >
                  <SymbolView name="xmark" size={16} tintColor="#fff" />
                </Pressable>

                {/* Place card at bottom — matches explore map card style */}
                <View style={styles.fullMapCardPanel}>
                  <View style={[styles.fullMapCard, { backgroundColor: '#1c1c1e' }]}>
                    {photoUrl ? (
                      <ExpoImage source={{ uri: photoUrl }} style={styles.fullMapCardPhoto} contentFit="cover" cachePolicy="memory-disk" />
                    ) : (
                      <View style={[styles.fullMapCardPhoto, { backgroundColor: '#2c2c2e' }]} />
                    )}
                    <View style={styles.fullMapCardBody}>
                      <ThemedText style={[styles.fullMapCardName, { color: '#fff' }]} numberOfLines={1}>{place.title}</ThemedText>
                      {place.rating != null && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <SymbolView name="star.fill" size={12} tintColor="#F59E0B" />
                          <ThemedText style={[styles.fullMapCardRating, { color: '#F59E0B' }]}>
                            {place.rating.toFixed(1)}
                            {place.reviewCount != null ? ` (${place.reviewCount})` : ''}
                          </ThemedText>
                        </View>
                      )}
                      {(place.shortFormattedAddress ?? place.address) && (
                        <ThemedText style={[styles.fullMapCardAddr, { color: '#aaa' }]} numberOfLines={1}>
                          {place.shortFormattedAddress ?? place.address}
                        </ThemedText>
                      )}
                      <View style={styles.fullMapCardActions}>
                        {placeBookable ? (
                          <Pressable
                            onPress={() => {
                              const links = getPlaceBookingLinks(place.title, place.category ?? '', place.destination ?? '');
                              if (links[0]) openBookingLink(links[0].url);
                            }}
                            style={[styles.fullMapCardBtn, { backgroundColor: '#fff' }]}
                            accessibilityRole="button"
                          >
                            <ThemedText style={[styles.fullMapCardBtnText, { color: '#000' }]}>{getBookableCTA(place.category ?? '')}</ThemedText>
                          </Pressable>
                        ) : (
                          <>
                            <Pressable
                              onPress={() => { setMapFullScreen(false); handleAddToTrip(); }}
                              style={[styles.fullMapCardBtn, { backgroundColor: '#fff' }]}
                              accessibilityRole="button"
                              accessibilityLabel="Add to trip"
                            >
                              <ThemedText style={[styles.fullMapCardBtnText, { color: '#000' }]}>Add to trip</ThemedText>
                            </Pressable>
                            <Pressable
                              onPress={() => { setMapFullScreen(false); setBoardPickerVisible(true); }}
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel="Save to board"
                            >
                              <SymbolView name="bookmark" size={18} tintColor="#aaa" />
                            </Pressable>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            </Modal>
          </>
        )}

        {/* Personalized match reasons */}
        {personalReasons.length > 0 && (
            <View style={[styles.matchCard, { backgroundColor: theme.primaryMuted, borderColor: theme.primary + '30' }]}>
              <ThemedText style={[styles.matchTitle, { color: theme.primary }]}>Why we recommend this</ThemedText>
              {personalReasons.map((reason, i) => (
                <ThemedText key={i} style={[styles.matchReason, { color: theme.text }]}>{'\u2022'} {reason}</ThemedText>
              ))}
            </View>
        )}

        {/* Warnings */}
        {place.warnings && place.warnings.length > 0 && (
          <View>
            <View style={[styles.warningCard, { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }]}>
              {place.warnings.map((w: string, i: number) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <SymbolView name="exclamationmark.triangle.fill" size={14} tintColor="#B45309" />
                  <ThemedText style={[styles.warningText, { flex: 1 }]}>{w}</ThemedText>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Current status */}
        {(place.busyLevel || place.estimatedWait) && (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Right now</ThemedText>
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
          </View>
        )}

        {/* Description */}
        {place.description ? (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>About</ThemedText>
              <ThemedText
                style={styles.descText}
                numberOfLines={showFullDesc ? undefined : 4}
              >
                {place.description}
              </ThemedText>
              {place.description.length > 150 && (
                <Pressable
                  onPress={() => setShowFullDesc(!showFullDesc)}
                  accessibilityRole="button"
                  accessibilityLabel={showFullDesc ? 'Show less' : 'Read more'}
                >
                  <ThemedText style={[styles.showMoreText, { color: theme.primary }]}>
                    {showFullDesc ? 'Show less' : 'Read more'}
                  </ThemedText>
                </Pressable>
              )}
            </View>
          </View>
        ) : aiDescLoading ? (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>About</ThemedText>
              <ActivityIndicator size="small" color={theme.textSecondary} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
            </View>
          </View>
        ) : null}

        {/* User notes from board */}
        {paramNotes ? (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Your notes</ThemedText>
              <ThemedText style={[styles.descText, { fontStyle: 'italic' }]}>{paramNotes}</ThemedText>
            </View>
          </View>
        ) : null}

        {/* Review summary */}
        {place.reviewSummary && (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <View style={styles.sampleLabelRow}>
                <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>What people say</ThemedText>
                {showSampleBanner && <ThemedText style={styles.sampleLabel}>Sample data</ThemedText>}
              </View>
              <ThemedText style={[styles.descText, { fontStyle: 'italic' }]}>{`\u201C${place.reviewSummary}\u201D`}</ThemedText>
              {place.bestQualities && place.bestQualities.length > 0 && (
                <View style={styles.qualitiesRow}>
                  <ThemedText style={[styles.qualitiesLabel, { color: theme.textSecondary }]}>Best for:</ThemedText>
                  <View style={styles.tagRow}>
                    {place.bestQualities.map((q: string) => (
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
                  {place.commonComplaints.map((c: string, i: number) => (
                    <ThemedText key={i} style={[styles.complaintText, { color: theme.textSecondary }]}>{'\u2022'} {c}</ThemedText>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Individual reviews */}
        {place.reviews && place.reviews.length > 0 && (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <View style={styles.sampleLabelRow}>
                <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>
                  Reviews ({place.reviews.length})
                </ThemedText>
                {showSampleBanner && <ThemedText style={styles.sampleLabel}>Sample data</ThemedText>}
              </View>
              {reviewsToShow.map((review: any, i: number) => (
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
          </View>
        )}

        {/* Atmosphere */}
        {place.atmosphere && place.atmosphere.length > 0 && (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Atmosphere</ThemedText>
              <View style={styles.tagRow}>
                {place.atmosphere.map((a: string) => (
                  <View key={a} style={[styles.atmoTag, { backgroundColor: theme.primaryMuted }]}>
                    <ThemedText style={[styles.atmoTagText, { color: theme.primary }]}>{a}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Popular dishes / menu */}
        {place.popularDishes && place.popularDishes.length > 0 && (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Popular dishes</ThemedText>
              {place.popularDishes.map((dish: string, i: number) => (
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
          </View>
        )}

        {/* Hours & availability */}
        <View>
          <View style={[styles.section, { borderColor: theme.border }]}>
            <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Hours & availability</ThemedText>
            {(place as any).openingHours && (place as any).openingHours.length > 0 ? (
              <>
                {((showAllHours ? (place as any).openingHours : (place as any).openingHours.slice(0, 3)) as string[]).map((line: string, i: number) => (
                  <ThemedText key={i} style={styles.detailValue}>{line}</ThemedText>
                ))}
                {(place as any).openingHours.length > 3 && (
                  <Pressable onPress={() => setShowAllHours(!showAllHours)} accessibilityRole="button" accessibilityLabel={showAllHours ? 'Show fewer hours' : 'Show full week hours'}>
                    <ThemedText style={[styles.showMoreText, { color: theme.primary }]}>
                      {showAllHours ? 'Show less' : 'Show full week'}
                    </ThemedText>
                  </Pressable>
                )}
              </>
            ) : place.weeklyHours ? (
              (() => {
                // Reorder days starting from today
                const todayIdx = (new Date().getDay() + 6) % 7; // JS: 0=Sun → 0=Mon
                const reordered = [...DAY_NAMES.slice(todayIdx), ...DAY_NAMES.slice(0, todayIdx)];
                const displayDays = showAllHours ? reordered : reordered.slice(0, 3);
                return (
                  <>
                    {displayDays.map((day, i) => (
                      <View key={day} style={styles.hoursRow}>
                        <ThemedText style={[styles.hoursDay, { color: theme.textSecondary, fontWeight: i === 0 ? '700' : '400' }]}>
                          {i === 0 ? `${day} (Today)` : day}
                        </ThemedText>
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
                );
              })()
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
        </View>

        {/* Experience details — only show fields from real data, never fabricated defaults */}
        {showSampleBanner && (place.crowdLevel || place.energyLevel || place.noiseLevel || place.dressCode) && (
        <View>
          <View style={[styles.section, { borderColor: theme.border }]}>
            <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Details</ThemedText>
            <View style={styles.detailGrid}>
              {place.crowdLevel && (
              <View style={styles.detailItem}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Crowds</ThemedText>
                <ThemedText style={styles.detailValue}>{crowdLabels[place.crowdLevel]}</ThemedText>
              </View>
              )}
              {place.energyLevel && (
              <View style={styles.detailItem}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Activity level</ThemedText>
                <ThemedText style={styles.detailValue}>{energyLabels[place.energyLevel]}</ThemedText>
              </View>
              )}
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
        </View>
        )}

        {/* Facilities & practical info */}
        {(place.outdoorSeating || place.rooftop || place.waterfront || place.scenicView ||
          place.wifi || place.parking || place.petFriendly || place.familyFriendly ||
          place.groupFriendly || place.takeout || place.delivery || place.dineIn ||
          place.curbsidePickup || place.liveMusic || place.restroom || place.goodForSports ||
          place.childrenMenu || place.drinksService || place.parkingDetails || place.paymentOptions) && (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Facilities</ThemedText>
              <View style={styles.facilitiesGrid}>
                {place.dineIn && <FacilityItem label="Dine-in" theme={theme} />}
                {place.takeout && <FacilityItem label="Takeout" theme={theme} />}
                {place.delivery && <FacilityItem label="Delivery" theme={theme} />}
                {place.curbsidePickup && <FacilityItem label="Curbside pickup" theme={theme} />}
                {place.outdoorSeating && <FacilityItem label="Outdoor seating" theme={theme} />}
                {place.rooftop && <FacilityItem label="Rooftop" theme={theme} />}
                {place.waterfront && <FacilityItem label="Waterfront" theme={theme} />}
                {place.scenicView && <FacilityItem label="Scenic view" theme={theme} />}
                {place.liveMusic && <FacilityItem label="Live music" theme={theme} />}
                {place.goodForSports && <FacilityItem label="Sports viewing" theme={theme} />}
                {place.wifi && <FacilityItem label="Wi-Fi" theme={theme} />}
                {place.restroom && <FacilityItem label="Restroom" theme={theme} />}
                {place.familyFriendly && <FacilityItem label="Family-friendly" theme={theme} />}
                {place.childrenMenu && <FacilityItem label="Children's menu" theme={theme} />}
                {place.groupFriendly && <FacilityItem label="Group-friendly" theme={theme} />}
                {place.petFriendly && <FacilityItem label="Pet-friendly" theme={theme} />}
                {place.parking && <FacilityItem label="Parking" theme={theme} />}
              </View>
              {place.parkingDetails && place.parkingDetails.length > 0 && (
                <View style={[styles.tagRow, { marginTop: 8 }]}>
                  {place.parkingDetails.map((p: string) => (
                    <View key={p} style={[styles.atmoTag, { backgroundColor: theme.primaryMuted }]}>
                      <ThemedText style={[styles.atmoTagText, { color: theme.primary }]}>{p}</ThemedText>
                    </View>
                  ))}
                </View>
              )}
              {place.drinksService && place.drinksService.length > 0 && (
                <View style={[styles.tagRow, { marginTop: 8 }]}>
                  {place.drinksService.map((d: string) => (
                    <View key={d} style={[styles.atmoTag, { backgroundColor: theme.primaryMuted }]}>
                      <ThemedText style={[styles.atmoTagText, { color: theme.primary }]}>{d}</ThemedText>
                    </View>
                  ))}
                </View>
              )}
              {place.paymentOptions && place.paymentOptions.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <SymbolView name="creditcard" size={14} tintColor={theme.textSecondary} />
                  <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>
                    {place.paymentOptions.join(', ')}
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Dietary options */}
        {place.dietaryOptions && place.dietaryOptions.length > 0 && (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Dietary info</ThemedText>
              <View style={styles.tagRow}>
                {place.dietaryOptions.map((d: string) => (
                  <View key={d} style={[styles.dietTag, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <ThemedText style={styles.dietTagText}>{d}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Accessibility */}
        {place.accessibility && place.accessibility.length > 0 && (
          <View>
            <View style={[styles.section, { borderColor: theme.border }]}>
              <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Accessibility</ThemedText>
              {place.accessibility.map((a: string) => (
                <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <SymbolView name="checkmark" size={12} tintColor={theme.primary} />
                  <ThemedText style={styles.accessItem}>{a}</ThemedText>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Tags */}
        {place.tags && place.tags.length > 0 && (
        <View>
          <View style={[styles.section, { borderColor: theme.border }]}>
            <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>Tags</ThemedText>
            <View style={styles.tagRow}>
              {place.tags.map((t: string) => (
                <View key={t} style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={styles.tagText}>{t}</ThemedText>
                </View>
              ))}
            </View>
          </View>
        </View>
        )}

        {/* Last updated */}
        {place.lastUpdated && (
          <View>
            <ThemedText style={[styles.lastUpdated, { color: theme.textSecondary }]}>
              Last updated {place.lastUpdated}
            </ThemedText>
          </View>
        )}
        {placeBookable && (
          <ThemedText style={[styles.affiliateDisclosure, { color: theme.textSecondary }]}>
            Booking links may earn Travonal a small commission at no extra cost to you.
          </ThemedText>
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
      {(() => {
        const cat = (place.category ?? '') as string;
        const bookable = placeBookable;
        if (bookable) {
          const bookingLinks = getPlaceBookingLinks(place.title, cat, place.destination ?? '');
          const primaryLink = bookingLinks[0];
          const label = getBookableCTA(cat) ?? getPlaceBookingSectionTitle(cat);
          const icon = cat.startsWith('stay') ? 'bed.double.fill' : cat.startsWith('food') ? 'fork.knife' : 'star';
          return (
            <View style={[styles.bottomBar, { backgroundColor: theme.background, borderTopColor: theme.border, paddingBottom: insets.bottom + 8 }]}>
              <View style={styles.bottomBarContent}>
                <Pressable
                  onPress={() => { if (primaryLink) openBookingLink(primaryLink.url); }}
                  style={({ pressed }) => [
                    styles.addButton,
                    { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={primaryLink?.label ?? label}
                >
                  <View style={styles.bottomBarBtnInner}>
                    <SymbolView name={icon} size={18} tintColor={theme.primaryText} />
                    <ThemedText style={[styles.addButtonText, { color: theme.primaryText }]}>{label}</ThemedText>
                  </View>
                </Pressable>
              </View>
            </View>
          );
        }
        return (
          <View style={[styles.bottomBar, { backgroundColor: theme.background, borderTopColor: theme.border, paddingBottom: insets.bottom + 8 }]}>
            <View style={[styles.bottomBarContent, { flexDirection: 'row', gap: 10 }]}>
              <Pressable
                onPress={handleAddToTrip}
                style={({ pressed }) => [
                  styles.addButton,
                  { backgroundColor: '#000', opacity: pressed ? 0.85 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add to trip"
              >
                <View style={styles.bottomBarBtnInner}>
                  <SymbolView name="plus.circle.fill" size={18} tintColor="#fff" />
                  <ThemedText style={[styles.addButtonText, { color: '#fff' }]}>Add to trip</ThemedText>
                </View>
              </Pressable>
              <Pressable
                onPress={() => setBoardPickerVisible(true)}
                style={({ pressed }) => [
                  styles.addButton,
                  { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', opacity: pressed ? 0.85 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Save to board"
              >
                <View style={styles.bottomBarBtnInner}>
                  <SymbolView name="bookmark" size={18} tintColor="#000" />
                  <ThemedText style={[styles.addButtonText, { color: '#000' }]}>Save to board</ThemedText>
                </View>
              </Pressable>
            </View>
          </View>
        );
      })()}

      {/* Board Picker */}
      <BoardPicker
        visible={boardPickerVisible}
        onSelect={handleSaveToBoard}
        onClose={() => setBoardPickerVisible(false)}
      />
    </View>
  );
}

function FacilityItem({ label, theme }: { label: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.facilityItem, { backgroundColor: theme.backgroundElement }]}>
      <SymbolView name="checkmark" size={12} tintColor="#22C55E" />
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
  headerSubtitle: { fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'center' },

  // Sample banner
  sampleBanner: {
    padding: 10,
    borderRadius: Radius.xs,
    borderWidth: 1,
    marginBottom: Spacing.three,
  },
  sampleBannerText: { fontSize: 12, fontWeight: '500', color: '#B45309', textAlign: 'center' },

  // Scroll
  scrollContent: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four },

  // Title
  titleSection: { gap: 4, marginBottom: Spacing.three, alignItems: 'center' },
  placeTitle: { fontSize: 26, textAlign: 'center' },
  destination: { fontSize: 14, textAlign: 'center' },
  verified: { fontSize: 12, fontWeight: '600', marginTop: 2 },

  // Rating
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.three },
  stars: { flexDirection: 'row', gap: 2 },
  star: { fontSize: 18, lineHeight: 22 },
  ratingNum: { fontSize: 16, fontWeight: '700' },
  reviewCount: { fontSize: 13 },

  // Pills
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.four },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.md },
  pillText: { fontSize: 13, fontWeight: '600' },

  // Action buttons row
  actionBtnContainer: { position: 'relative', marginBottom: Spacing.three },
  actionBtnRow: { flexDirection: 'row', gap: 10, paddingLeft: Spacing.four, paddingRight: 0 },
  actionBtn: { width: 74, borderRadius: Radius.md, borderWidth: 1, paddingVertical: 10, alignItems: 'center', gap: 4 },
  actionBtnIcon: { fontSize: 18, lineHeight: 24 },
  actionBtnLabel: { fontSize: 12, fontWeight: '600' },
  affiliateDisclosure: { fontSize: 11, marginTop: 6, lineHeight: 15, textAlign: 'center' as const },

  // Match card
  matchCard: {
    padding: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.three,
    gap: 6,
  },
  matchTitle: { fontSize: 14, fontWeight: '700' },
  matchReason: { fontSize: 14, lineHeight: 20, paddingLeft: 4 },

  // Mini map
  miniMapContainer: { height: 150, borderRadius: Radius.md, overflow: 'hidden', marginBottom: Spacing.three, position: 'relative' as const },
  miniMapWebView: { flex: 1 },
  miniMapExpandBtn: { position: 'absolute' as const, top: 8, right: 8, zIndex: 2 },
  miniMapExpandInner: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center' as const, justifyContent: 'center' as const },
  miniMapOverlay: { position: 'absolute' as const, bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  miniMapLabel: { fontSize: 11, fontWeight: '600' as const, color: '#fff' },

  // Full-screen map modal
  fullMapScreen: { flex: 1, position: 'relative' as const, backgroundColor: '#000' },
  fullMapCloseBtn: { position: 'absolute' as const, top: 54, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center' as const, justifyContent: 'center' as const, zIndex: 10 },
  fullMapCardPanel: { position: 'absolute' as const, bottom: 34, left: 16, right: 16, zIndex: 10, alignItems: 'center' as const },
  fullMapCard: { width: 272, borderRadius: 14, overflow: 'hidden' as const, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 6 },
  fullMapCardPhoto: { width: 272, height: 100, alignItems: 'center' as const, justifyContent: 'center' as const },
  fullMapCardBody: { padding: 12, gap: 3 },
  fullMapCardName: { fontSize: 14, fontWeight: '600' as const },
  fullMapCardRating: { fontSize: 12, color: '#F59E0B' },
  fullMapCardAddr: { fontSize: 11 },
  fullMapCardActions: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: 6 },
  fullMapCardBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14 },
  fullMapCardBtnText: { fontSize: 12, fontWeight: '600' as const },

  // Warning card
  warningCard: {
    padding: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
    marginBottom: Spacing.three,
    gap: 4,
  },
  warningText: { fontSize: 13, lineHeight: 20, color: '#B45309' },

  // Status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.md },
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
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  reviewHeader: { gap: 4 },
  reviewSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reviewThemeIcon: { fontSize: 14, lineHeight: 20 },
  reviewAvatar: { width: 22, height: 22, borderRadius: 11 },
  reviewSource: { fontSize: 12, fontWeight: '600' },
  reviewThemeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.xs },
  reviewThemeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  reviewMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewRating: { fontSize: 12, letterSpacing: 1 },
  reviewDate: { fontSize: 11 },
  reviewText: { fontSize: 14, lineHeight: 21 },
  showMoreText: { fontSize: 14, fontWeight: '600', marginTop: 4 },

  // Qualities
  qualitiesRow: { gap: 4, marginTop: 4 },
  qualitiesLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  qualityTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.xs },
  qualityTagText: { fontSize: 12, fontWeight: '600' },
  complaintText: { fontSize: 13, lineHeight: 20, paddingLeft: 4 },

  // Tags
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.xs },
  tagText: { fontSize: 12, fontWeight: '600' },

  // Atmosphere
  atmoTag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.md },
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
  reservationNote: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.xs, marginTop: 4 },
  reservationText: { fontSize: 13, fontWeight: '600' },

  // Diet
  dietTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.xs, borderWidth: 1 },
  dietTagText: { fontSize: 12, fontWeight: '500' },

  // Details
  detailGrid: { gap: 12 },
  detailItem: { gap: 2 },
  detailLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: 15 },

  // Facilities
  facilitiesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  facilityItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.xs },
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
    paddingHorizontal: Spacing.four,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomBarContent: {
    gap: 4,
  },
  bottomBarBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  addButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: Radius.md,
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
    borderRadius: Radius.lg,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    gap: 14,
  },
  addModalTitle: { textAlign: 'center' },
  addModalPlace: { textAlign: 'center', fontSize: 14 },
  addModalBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  addModalCancel: { flex: 1, paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center' },
  addModalConfirm: { flex: 2, paddingVertical: 14, borderRadius: Radius.md, alignItems: 'center' },
});
