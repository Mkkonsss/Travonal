import React from 'react';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemedText } from '@/components/themed-text';
import { getPlacePhotoAI, getPlacesNearbyAI, rankPlacesAI } from '@/services/ai';
import { NormalizedPlace, normalizeGooglePlace, formatGoogleTypes, priceLevelLabel } from '@/services/place-model';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing, Radius, Shadow } from '@/constants/theme';
import { useTrips, Trip } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useBoards } from '@/context/boards';
import { useInbox } from '@/context/inbox';
import { useTheme } from '@/hooks/use-theme';
import { SuitcaseIcon, BoardsIcon, BookingsIcon } from '@/components/icons';
import { TripActionSheet } from '@/components/trip-action-sheet';
import { prefetchPhotosFromCache, getCachedPhotoUrl, categoryPlaceholderColors, categoryPlaceholderEmoji } from '@/services/free-photos';

import { formatDateRange } from '@/services/trip-helpers';
import { useDestinationPhoto } from '@/hooks/use-destination-photo';

// ---------- Helpers ----------

function tripGradient(dest: string): [string, string] {
  let h = 0;
  for (const ch of dest.toLowerCase()) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return [`hsl(${hue}, 25%, 18%)`, `hsl(${(hue + 40) % 360}, 30%, 12%)`];
}

function daysUntil(dateStr: string) {
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [ty, tm, td] = dateStr.split('-').map(Number);
  const targetUtc = Date.UTC(ty, tm - 1, td);
  const diff = Math.round((targetUtc - todayUtc) / 86400000);
  if (diff < 0) return null;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}


// ---------- NextTripHero ----------

function NextTripHero({ trip, onDelete }: { trip: Trip; onDelete: (trip: Trip) => void }) {
  const router = useRouter();
  const photoQuery = `${trip.destination}, ${trip.country}`;
  const photoUrl = useDestinationPhoto(photoQuery);
  const imgOpacity = useSharedValue(0);
  const imgStyle = useAnimatedStyle(() => ({ opacity: imgOpacity.value }));
  const [gradStart, gradEnd] = tripGradient(trip.destination);
  const countdown = trip.datesKnown !== false ? daysUntil(trip.startDate) : null;
  const activityCount = trip.activities.length;
  const [menuVisible, setMenuVisible] = useState(false);

  return (
    <Animated.View entering={FadeInDown.delay(60).springify()}>
      <Pressable
        onPress={() => router.push(`/trip/${trip.id}` as any)}
        style={({ pressed }) => [styles.heroCard, { opacity: pressed ? 0.93 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={`Next trip: ${trip.title ?? trip.destination}${countdown ? `, ${countdown}` : ''}`}
      >
        <LinearGradient
          colors={[gradStart, gradEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: Radius.lg }]}
        />
        {photoUrl && (
          <Animated.View style={[StyleSheet.absoluteFill, imgStyle, { borderRadius: Radius.lg, overflow: 'hidden' }]}>
            <ExpoImage
              source={{ uri: photoUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              onLoad={() => { imgOpacity.value = withTiming(1, { duration: 500 }); }}
            />
          </Animated.View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.7)']}
          locations={[0, 0.35, 1]}
          style={[StyleSheet.absoluteFill, { borderRadius: Radius.lg }]}
        />

        <View style={styles.heroCardContent}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            {countdown ? (
              <View style={styles.heroCountdownPill}>
                <ThemedText style={styles.heroCountdownText}>{countdown}</ThemedText>
              </View>
            ) : <View />}
            <Pressable
              onPress={(e) => { e.stopPropagation(); setMenuVisible(true); }}
              style={{ padding: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Trip menu for ${trip.destination}`}
              hitSlop={8}
            >
              <SymbolView name="ellipsis" size={18} tintColor="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>

          <View style={styles.heroCardBottom}>
            <ThemedText style={styles.heroDestination}>
              {trip.title ?? trip.destination}
            </ThemedText>
            <ThemedText style={styles.heroDate}>
              {formatDateRange(trip.startDate, trip.endDate, trip.datesKnown)}
            </ThemedText>
            {activityCount > 0 && (
              <ThemedText style={styles.heroActivities}>
                {activityCount} {activityCount === 1 ? 'activity' : 'activities'} planned
              </ThemedText>
            )}
          </View>
        </View>
      </Pressable>
      <TripActionSheet
        visible={menuVisible}
        title={trip.title ?? trip.destination}
        onOpen={() => router.push(`/trip/${trip.id}` as any)}
        onEdit={() => router.push(`/trip/${trip.id}?openEdit=1` as any)}
        onDelete={() => onDelete(trip)}
        onClose={() => setMenuVisible(false)}
      />
    </Animated.View>
  );
}

// ---------- TripCardCarousel ----------

function TripCardCarousel({ trips: cardTrips, onDelete }: { trips: Trip[]; onDelete: (trip: Trip) => void }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const cardWidth = width - Spacing.four * 2;
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <View style={styles.carouselContainer}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + 12}
        contentContainerStyle={{ gap: 12 }}
        onScroll={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / (cardWidth + 12));
          setActiveIndex(idx);
        }}
        scrollEventThrottle={16}
      >
        {cardTrips.map((trip) => (
          <View key={trip.id} style={{ width: cardWidth }}>
            <NextTripHero trip={trip} onDelete={onDelete} />
          </View>
        ))}
      </ScrollView>
      {cardTrips.length > 1 && (
        <View style={styles.carouselDots}>
          {cardTrips.map((_, i) => (
            <View
              key={i}
              style={[
                styles.carouselDot,
                { backgroundColor: i === activeIndex ? theme.primary : theme.border },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}


// ---------- Worth a visit nearby Inspiration ----------

// ── Persistent caches (module-level, survive re-renders) ──────────────────────

const NY_PLACES_KEY = '@toveli_near_you_places_v2';
const NY_PHOTOS_KEY = '@toveli_near_you_photos_v1';
const NY_PLACES_TTL = 30 * 60 * 1000; // 30 min

// Photo URL cache — loaded from AsyncStorage once, then kept in memory
const nyPhotoCache = new Map<string, string | null>();
const nyPhotoCacheReady: Promise<void> = AsyncStorage.getItem(NY_PHOTOS_KEY)
  .then((raw) => {
    if (!raw) return;
    try {
      const entries: [string, string | null][] = JSON.parse(raw);
      for (const [k, v] of entries) nyPhotoCache.set(k, v);
    } catch {}
  })
  .catch(() => {});

function persistNyPhotos() {
  const entries = Array.from(nyPhotoCache.entries()).filter(([, v]) => v !== null);
  AsyncStorage.setItem(NY_PHOTOS_KEY, JSON.stringify(entries)).catch(() => {});
}

async function loadCachedNyPlaces(): Promise<NormalizedPlace[] | null> {
  try {
    const raw = await AsyncStorage.getItem(NY_PLACES_KEY);
    if (!raw) return null;
    const { places, ts }: { places: NormalizedPlace[]; ts: number } = JSON.parse(raw);
    if (Date.now() - ts > NY_PLACES_TTL) return null;
    return places;
  } catch { return null; }
}

function saveCachedNyPlaces(places: NormalizedPlace[]) {
  AsyncStorage.setItem(NY_PLACES_KEY, JSON.stringify({ places, ts: Date.now() })).catch(() => {});
}

// ── Keyword builder ───────────────────────────────────────────────────────────

// Chains and generic businesses to filter out
const BORING_NAMES = new Set([
  'walmart', 'costco', 'target', 'walgreens', 'cvs', 'rite aid',
  'mcdonald\'s', 'burger king', 'wendy\'s', 'taco bell', 'kfc',
  'chick-fil-a', 'popeyes', 'subway', 'dunkin\'', 'dunkin',
  'starbucks', 'panda express', 'chipotle', 'five guys',
  'domino\'s', 'pizza hut', 'papa john\'s', 'little caesars',
  'sonic', 'arby\'s', 'jack in the box', 'whataburger',
  'dollar tree', 'dollar general', 'family dollar',
  'home depot', 'lowe\'s', 'autozone', 'o\'reilly',
  'shell', 'chevron', 'bp', 'exxon', '7-eleven', 'circle k',
  'bank of america', 'chase', 'wells fargo', 'us bank',
  'fedex', 'ups', 'usps',
]);

const BORING_TYPES = new Set([
  'gas_station', 'convenience_store', 'supermarket', 'grocery_store',
  'pharmacy', 'drugstore', 'department_store', 'discount_store',
  'hardware_store', 'auto_repair', 'car_wash', 'car_dealer',
  'bank', 'atm', 'insurance_agency', 'laundry', 'storage',
  'post_office', 'moving_company', 'locksmith',
]);

function isInterestingPlace(place: NormalizedPlace, relaxed = false): boolean {
  const nameLower = place.name.toLowerCase();
  if (BORING_NAMES.has(nameLower)) return false;
  // Also catch partial matches for common chains (skip very short names to avoid false positives like "bp" matching "bpm")
  for (const chain of BORING_NAMES) {
    if (chain.length >= 4 && nameLower.startsWith(chain)) return false;
  }
  // Only filter if the primary type (first) is boring — secondary types like "atm" on a museum shouldn't disqualify
  const primaryType = place.googleTypes?.[0];
  if (primaryType && BORING_TYPES.has(primaryType)) return false;
  // Prefer places with decent ratings (relaxed mode lowers the bar)
  if (place.rating != null && place.rating < (relaxed ? 3.0 : 3.5)) return false;
  return true;
}

function buildNearYouKeyword(profile: import('@/context/profile').TravelProfile): string {
  const interestMap: Record<string, string> = {
    '🍽️ Food & restaurants': 'local restaurant food',
    '🌿 Nature & scenery': 'park nature scenic',
    '🏖️ Beaches': 'beach waterfront coastal',
    '🏛️ Museums & history': 'museum historic landmark',
    '🎨 Art & culture': 'art gallery cultural',
    '🏗️ Architecture': 'architectural landmark building',
    '🛍️ Shopping': 'boutique market shop',
    '🌃 Nightlife': 'bar live music cocktail',
    '🧗 Adventure & outdoors': 'hiking trail outdoor adventure',
    '🧘 Wellness & relaxation': 'spa wellness yoga',
    '🌍 Local experiences': 'neighborhood local authentic',
    '📍 Famous landmarks': 'landmark monument historic',
    '💎 Hidden gems': 'hidden gem local cafe',
    '☕ Cafés': 'specialty coffee artisan cafe',
    '🎵 Live music & entertainment': 'live music venue entertainment',
    '🏟️ Sports & events': 'sports stadium recreation',
  };

  const parts: string[] = [];
  for (const interest of profile.interests.slice(0, 3)) {
    const kw = interestMap[interest];
    if (kw) {
      parts.push(kw);
    } else {
      // Custom interest — strip emoji prefix and use the text directly as a keyword
      const text = interest.replace(/^\p{Emoji}\s*/u, '').trim();
      if (text) parts.push(text);
    }
  }

  // Crowd prefix steers Google toward quieter/local places
  const crowdPrefix =
    profile.crowdTolerance === 'avoid' ? 'hidden local neighborhood ' :
    profile.crowdTolerance === 'moderate' ? 'local ' : '';

  // Decision priority modifiers
  const priorityKws: string[] = [];
  for (const p of profile.decisionPriorities ?? []) {
    if (p.includes('local & authentic')) priorityKws.push('authentic local');
    else if (p.includes('beautiful')) priorityKws.push('scenic');
    else if (p.includes('unique')) priorityKws.push('unique');
    else if (p.includes('memorable')) priorityKws.push('unique experience');
    else if (p.includes('popular for a reason')) priorityKws.push('popular');
  }

  if (parts.length === 0) {
    const fallback =
      profile.pace === 'relaxed' ? 'scenic park artisan cafe' :
      profile.pace === 'active' ? 'hiking trail outdoor adventure' :
      'landmark unique restaurant scenic';
    return crowdPrefix + fallback;
  }

  return crowdPrefix + [...parts, ...priorityKws].join(' ');
}

// ── Per-card photo hook (uses persistent module-level cache) ──────────────────

function useNearYouPhoto(ref: string | undefined) {
  const [url, setUrl] = useState<string | null>(() => ref ? (nyPhotoCache.get(ref) ?? null) : null);

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    (async () => {
      await nyPhotoCacheReady;
      if (cancelled) return;
      if (nyPhotoCache.has(ref)) {
        setUrl(nyPhotoCache.get(ref) ?? null);
        return;
      }
      try {
        const { url: photoUrl } = await getPlacePhotoAI({ reference: ref, maxWidth: 600 });
        if (!cancelled) {
          nyPhotoCache.set(ref, photoUrl);
          persistNyPhotos();
          setUrl(photoUrl);
        }
      } catch {
        if (!cancelled) nyPhotoCache.set(ref, null);
      }
    })();
    return () => { cancelled = true; };
  }, [ref]);

  return url;
}

// ── Card ──────────────────────────────────────────────────────────────────────

function NearYouCard({ place, onPress }: { place: NormalizedPlace; onPress: () => void }) {
  const theme = useTheme();
  const photoUrl = useNearYouPhoto(place.photos?.[0]?.reference);

  const rawCat = formatGoogleTypes(place.googleTypes);
  const catLabel = rawCat ? rawCat.split(' \u00B7 ')[0] : place.category.split('/').pop() ?? '';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.nearYouCard, { opacity: pressed ? 0.88 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={place.name}
    >
      {photoUrl ? (
        <ExpoImage source={{ uri: photoUrl }} style={[StyleSheet.absoluteFill, { borderRadius: Radius.lg }]} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <LinearGradient
          colors={categoryPlaceholderColors(place.category)}
          style={[StyleSheet.absoluteFill, { borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' }]}
        >
          <SymbolView name={categoryPlaceholderEmoji(place.category)} size={36} tintColor="rgba(255,255,255,0.5)" />
        </LinearGradient>
      )}

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.75)']}
        locations={[0, 0.4, 1]}
        style={[StyleSheet.absoluteFill, { borderRadius: Radius.lg }]}
      />

      <View style={styles.nearYouCardBottom}>
        <ThemedText style={styles.nearYouCardName} numberOfLines={2}>{place.name}</ThemedText>
        <View style={styles.nearYouCardMetaRow}>
          {place.rating != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <SymbolView name="star.fill" size={12} tintColor="#F59E0B" />
              <ThemedText style={styles.nearYouCardRating}>{place.rating.toFixed(1)}</ThemedText>
            </View>
          )}
          {catLabel ? <ThemedText style={styles.nearYouCardCat}>{catLabel}</ThemedText> : null}
        </View>
        {place.matchReasons?.[0] ? (
          <ThemedText style={styles.nearYouCardReason} numberOfLines={1}>
            {place.matchReasons[0]}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function NearYouSection() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, loaded: profileLoaded } = useProfile();

  // Stable key for recommendation-relevant fields — changes trigger a fresh fetch
  const profileKey = profile.interests.join('|') + '::' + (profile.crowdTolerance ?? '');

  const [places, setPlaces] = useState<NormalizedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);

  // Invalidate the 30-min cache whenever the profile's recommendation-relevant fields change
  const prevProfileKeyRef = useRef('');
  useEffect(() => {
    if (prevProfileKeyRef.current && prevProfileKeyRef.current !== profileKey) {
      AsyncStorage.removeItem(NY_PLACES_KEY).catch(() => {});
    }
    prevProfileKeyRef.current = profileKey;
  }, [profileKey]);

  useEffect(() => {
    if (!profileLoaded) return; // wait for profile to load from storage/Supabase
    let cancelled = false;

    async function run() {
      // 1. Serve from cache immediately if fresh
      const cached = await loadCachedNyPlaces();
      if (!cancelled && cached && cached.length > 0) {
        setPlaces(cached);
        setLoading(false);
        return; // Cache still valid — skip network fetch
      }

      // 2. Need fresh data — request location first
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;

      if (status !== 'granted') {
        setLocationGranted(false);
        setLoading(false);
        return;
      }
      setLocationGranted(true);

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (cancelled) return;

      const { latitude: lat, longitude: lng } = loc.coords;
      const keyword = buildNearYouKeyword(profile);
      const MAX_DISTANCE_KM = 10;

      // Haversine distance in km
      function distKm(lat2?: number, lng2?: number) {
        if (lat2 == null || lng2 == null) return Infinity;
        const toRad = (d: number) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat);
        const dLng = toRad(lng2 - lng);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      // 3. Fetch with progressive radius expansion (same pattern as explore tab)
      //    Use shorter, focused keywords instead of one long concatenated string
      const personalizedKeywords = keyword.split(' ').reduce<string[]>((acc, w, i) => {
        const idx = Math.floor(i / 3);
        acc[idx] = (acc[idx] ? acc[idx] + ' ' : '') + w;
        return acc;
      }, []).slice(0, 3);
      const queries = [
        ...personalizedKeywords,
        'things to do tourist attraction',
        'best restaurants cafes',
        'park museum viewpoint',
      ];

      async function fetchWithExpansion(q: string): Promise<Record<string, unknown>[]> {
        for (const radius of [5000, 15000, 30000]) {
          try {
            const result = await getPlacesNearbyAI({ lat, lng, radius, keyword: q });
            const places = result.places ?? [];
            if (places.length > 0) return places;
          } catch { /* try next radius */ }
        }
        return [];
      }

      const allResults = await Promise.all(queries.map(fetchWithExpansion));
      if (cancelled) return;

      const raw = allResults.flat();

      const seen = new Set<string>();
      const deduped = raw.filter((p) => {
        const id = p.id as string | undefined;
        if (!id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const allPlaces = deduped.map(normalizeGooglePlace);
      const withinRange = allPlaces.filter((p) => distKm(p.lat, p.lng) <= MAX_DISTANCE_KM);

      // Try strict filter first, fall back to relaxed if too few results
      let normalized = withinRange.filter((p) => isInterestingPlace(p) && p.photos?.[0]?.reference).slice(0, 12);
      if (normalized.length < 3) {
        normalized = withinRange.filter((p) => isInterestingPlace(p, true) && p.photos?.[0]?.reference).slice(0, 12);
      }

      if (!cancelled) {
        setPlaces(normalized);
        setLoading(false);
        saveCachedNyPlaces(normalized);
        // Background AI ranking — reorder by score and add reasons
        if (normalized.length > 1) {
          rankPlacesAI({ places: normalized as Record<string, unknown>[], profile })
            .then(({ ranked }) => {
              if (cancelled) return;
              const withReasons = normalized.map((p, i) => {
                const r = ranked.find((x) => x.index === i);
                return r ? { ...p, matchReasons: [r.reason] } : p;
              });
              const reordered = ranked
                .slice()
                .sort((a, b) => b.score - a.score)
                .filter((r) => r.index >= 0 && r.index < withReasons.length)
                .map((r) => withReasons[r.index]);
              if (!cancelled && reordered.length > 0) {
                setPlaces(reordered);
                saveCachedNyPlaces(reordered);
              }
            })
            .catch(() => {}); // silent — places already shown without reasons
        }
      }
    }

    run().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey, profileLoaded]);

  if (loading) {
    return (
      <View style={styles.nearYouSection}>
        <ThemedText style={[styles.sectionLabel, { color: theme.text }]}>Worth a visit nearby</ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nearYouScroll} scrollEnabled={false}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.nearYouCard, { backgroundColor: theme.backgroundElement, opacity: 0.45 }]} />
          ))}
        </ScrollView>
      </View>
    );
  }

  if (locationGranted === false) {
    return (
      <Pressable
        onPress={() => Linking.openSettings()}
        style={({ pressed }) => [
          styles.nearYouLocationPrompt,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Enable location for nearby recommendations"
      >
        <SymbolView name="mappin.and.ellipse" size={22} tintColor={theme.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold">See places near you</ThemedText>
          <ThemedText style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}>
            Enable location for personalized nearby picks
          </ThemedText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <ThemedText style={{ color: theme.primary, fontSize: 13, fontWeight: '600' }}>Enable</ThemedText>
          <SymbolView name="chevron.right" size={12} tintColor={theme.primary} />
        </View>
      </Pressable>
    );
  }

  if (places.length === 0) return null;

  return (
    <View style={styles.nearYouSection}>
      <ThemedText style={[styles.sectionLabel, { color: theme.text }]}>Worth a visit nearby</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nearYouScroll}>
        {places.map((place, idx) => (
          <NearYouCard
            key={place.placeId ?? String(idx)}
            place={place}
            onPress={() => {
              let url = `/place-detail?name=${encodeURIComponent(place.name)}`;
              if (place.placeId) url += `&placeId=${encodeURIComponent(place.placeId)}`;
              if (place.address) url += `&address=${encodeURIComponent(place.address)}`;
              if (place.description) url += `&description=${encodeURIComponent(place.description)}`;
              if (place.rating != null) url += `&rating=${place.rating}`;
              if (place.reviewCount != null) url += `&reviewCount=${place.reviewCount}`;
              if (place.lat != null) url += `&lat=${place.lat}`;
              if (place.lng != null) url += `&lng=${place.lng}`;
              if (place.category) url += `&category=${encodeURIComponent(place.category)}`;
              if (place.website) url += `&website=${encodeURIComponent(place.website)}`;
              if (place.phone) url += `&phone=${encodeURIComponent(place.phone)}`;
              if (place.openingHours && place.openingHours.length > 0) {
                url += `&hours=${encodeURIComponent(JSON.stringify(place.openingHours))}`;
              }
              if (place.priceLevel != null) url += `&priceLevel=${place.priceLevel}`;
              if (place.googleMapsUri) url += `&googleMapsUri=${encodeURIComponent(place.googleMapsUri)}`;
              if (place.openNow != null) url += `&openNow=${place.openNow}`;
              if (place.photos?.[0]?.reference) url += `&photoRef=${encodeURIComponent(place.photos[0].reference)}`;
              router.push(url as any);
            }}
          />
        ))}
      </ScrollView>
      <Pressable
        onPress={() => router.push('/(tabs)/explore' as any)}
        style={({ pressed }) => [
          styles.discoverBtn,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Explore the discovery feed"
      >
        <ThemedText style={[styles.discoverText, { color: theme.textSecondary }]}>Discover more places {'\u203A'}</ThemedText>
      </Pressable>
    </View>
  );
}

// ---------- Board Cover (collage) ----------

function HomeBoardCover({ board, resolvedPhotos, size }: { board: { items: Array<{ mediaUri?: string; mediaType?: string; placeId?: string }> }; resolvedPhotos: Record<string, string>; size: number }) {
  const theme = useTheme();
  const imageUris: string[] = [];
  for (const item of board.items) {
    if (imageUris.length >= 3) break;
    const uri = (item.mediaUri && item.mediaType === 'image')
      ? item.mediaUri
      : (item.placeId ? resolvedPhotos[item.placeId] : undefined);
    if (uri && !imageUris.includes(uri)) imageUris.push(uri);
  }
  const count = imageUris.length;

  if (count === 0) {
    return (
      <View style={[homeBoardStyles.coverEmpty, { backgroundColor: theme.backgroundElement }]}>
        <BoardsIcon size={24} color={theme.textSecondary} />
      </View>
    );
  }
  if (count === 1) {
    return <ExpoImage source={{ uri: imageUris[0] }} style={{ flex: 1 }} contentFit="cover" cachePolicy="memory-disk" />;
  }
  if (count === 2) {
    return (
      <View style={homeBoardStyles.coverRow}>
        <ExpoImage source={{ uri: imageUris[0] }} style={{ flex: 1 }} contentFit="cover" cachePolicy="memory-disk" />
        <ExpoImage source={{ uri: imageUris[1] }} style={{ flex: 1 }} contentFit="cover" cachePolicy="memory-disk" />
      </View>
    );
  }
  return (
    <View style={homeBoardStyles.coverPinterest}>
      <ExpoImage source={{ uri: imageUris[0] }} style={{ flex: 2 }} contentFit="cover" cachePolicy="memory-disk" />
      <View style={homeBoardStyles.coverStack}>
        <ExpoImage source={{ uri: imageUris[1] }} style={{ flex: 1 }} contentFit="cover" cachePolicy="memory-disk" />
        <ExpoImage source={{ uri: imageUris[2] }} style={{ flex: 1 }} contentFit="cover" cachePolicy="memory-disk" />
      </View>
    </View>
  );
}

const homeBoardStyles = StyleSheet.create({
  coverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverRow: { flex: 1, flexDirection: 'row', gap: 2 },
  coverPinterest: { flex: 1, flexDirection: 'row', gap: 2 },
  coverStack: { flex: 1, gap: 2 },
});

// ---------- Main Screen ----------

export default function HomeScreen() {
  const { trips, getTripState, deleteTrip } = useTrips();
  const { profile } = useProfile();
  const { items: inboxItems, savedPlaces } = useInbox();
  const { boards } = useBoards();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  // Resolve board cover photos
  const [resolvedPhotos, setResolvedPhotos] = useState<Record<string, string>>({});
  useEffect(() => {
    const placeIds: string[] = [];
    for (const board of boards) {
      for (const item of board.items) {
        if (item.placeId && !item.mediaUri && !placeIds.includes(item.placeId)) {
          placeIds.push(item.placeId);
        }
      }
    }
    if (placeIds.length === 0) return;
    prefetchPhotosFromCache(placeIds).then(() => {
      const urls: Record<string, string> = {};
      for (const id of placeIds) {
        const url = getCachedPhotoUrl(id);
        if (url) urls[id] = url;
      }
      if (Object.keys(urls).length > 0) setResolvedPhotos(urls);
    });
  }, [boards]);

  const boardCardSize = (screenWidth - Spacing.four * 2 - 12) / 2;

  // Group saved places by destination — show "Start planning" prompts for destinations with 2+ items
  const savedByDest = savedPlaces.reduce<Record<string, number>>((acc, p) => {
    if (p.destination) acc[p.destination] = (acc[p.destination] ?? 0) + 1;
    return acc;
  }, {});
  // All destination groups with 2+ items, filtered to exclude destinations that already have a trip
  const allSavedDestGroups = Object.entries(savedByDest)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .filter(([dest]) => !trips.some((t) => t.destination.toLowerCase() === dest.toLowerCase()));

  // Categorize trips
  const categorized = trips.map((t) => ({ trip: t, state: getTripState(t) }));
  const activeTrips = categorized.filter((c) => c.state === 'active').map((c) => c.trip);
  const upcomingTrips = categorized
    .filter((c) => c.state === 'upcoming')
    .map((c) => c.trip)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const plannedTrips = categorized.filter((c) => c.state === 'planned').map((c) => c.trip);
  const draftTrips = categorized.filter((c) => c.state === 'draft').map((c) => c.trip);
  const pastTrips = categorized
    .filter((c) => c.state === 'past')
    .map((c) => c.trip)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const hasTrips = trips.length > 0;
  const [showPastTrips, setShowPastTrips] = useState(false);

  function handleDeleteTrip(trip: Trip) {
    Alert.alert(
      'Delete trip?',
      `Are you sure you want to delete your trip to ${trip.title ?? trip.destination}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteTrip(trip.id) },
      ]
    );
  }



  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + 80 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!hasTrips ? (
          <>
            {/* Header — Bookings | Logo | Boards */}
            <View style={styles.headerRow}>
              <Pressable
                onPress={() => router.push('/bookings' as any)}
                style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="My bookings"
                hitSlop={10}
              >
                <BookingsIcon size={28} color={theme.text} />
              </Pressable>
              <Image
                source={theme.background === '#FFFFFF'
                  ? require('@/assets/images/logo-dark.png')
                  : require('@/assets/images/logo-light.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <Pressable
                onPress={() => router.push('/inbox' as any)}
                style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Open boards"
                hitSlop={10}
              >
                <BoardsIcon size={24} color={theme.text} />
              </Pressable>
            </View>

            {/* ========== Empty state: no trips ========== */}
            <View style={styles.dashboard}>
              {/* Get started block */}
              <Animated.View entering={FadeIn.duration(500)} style={styles.emptyHeroBlock}>
                <ThemedText style={[styles.getStartedLabel, { color: theme.text }]}>Get started</ThemedText>
                <View style={styles.ctaGrid}>
                  {([
                    { label: 'Plan a trip', image: require('@/assets/images/sign-up-hero.png'), route: '/add-trip', rotate: '0deg' },
                    { label: 'Make a board', image: require('@/assets/images/icon-boards-empty.png'), route: '/inbox', rotate: '0deg' },
                    { label: 'My bookings', image: require('@/assets/images/onboarding-slide-2.png'), route: '/bookings', rotate: '12deg' },
                  ] as const).map(({ label, image, route, rotate }, i) => (
                    <React.Fragment key={label}>
                      {i > 0 && <View style={[styles.ctaDivider, { backgroundColor: '#000' }]} />}
                      <Pressable
                        onPress={() => router.push(route as any)}
                        style={({ pressed }) => [styles.ctaSquare, { opacity: pressed ? 0.7 : 1 }]}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                      >
                        <ExpoImage source={image} style={{ width: 52, height: 52, transform: [{ rotate }] }} contentFit="contain" />
                        <ThemedText style={[styles.ctaSquareLabel, { color: theme.text }]}>{label}</ThemedText>
                      </Pressable>
                    </React.Fragment>
                  ))}
                </View>
              </Animated.View>

            {/* Board cards */}
            {boards.filter(b => b.items.length > 0).length > 0 && (
              <View style={styles.boardGrid}>
                {boards.filter(b => b.items.length > 0).map((board, i) => (
                  <Animated.View key={board.id} entering={FadeInDown.delay(160 + i * 60).springify()}>
                    <Pressable
                      onPress={() => router.push(`/board-detail?boardId=${board.id}` as any)}
                      style={({ pressed }) => [
                        { width: boardCardSize, opacity: pressed ? 0.88 : 1 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${board.name} board`}
                    >
                      <View style={[styles.boardCover, { height: boardCardSize * 0.85, backgroundColor: theme.border }]}>
                        <HomeBoardCover board={board} resolvedPhotos={resolvedPhotos} size={boardCardSize} />
                      </View>
                      <ThemedText style={styles.boardName} numberOfLines={1}>{board.name}</ThemedText>
                      <ThemedText style={[styles.boardCount, { color: theme.textSecondary }]}>
                        {board.items.length} {board.items.length === 1 ? 'place' : 'places'}
                      </ThemedText>
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            )}

            {/* Nearby inspiration */}
            <Animated.View entering={FadeInDown.delay(240).springify()}>
              <NearYouSection />
            </Animated.View>

            </View>
          </>
        ) : (
          <>
            {/* Header — Bookings | Logo | Boards */}
            <View style={styles.headerRow}>
              <Pressable
                onPress={() => router.push('/bookings' as any)}
                style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="My bookings"
                hitSlop={10}
              >
                <BookingsIcon size={28} color={theme.text} />
              </Pressable>
              <Image
                source={theme.background === '#FFFFFF'
                  ? require('@/assets/images/logo-dark.png')
                  : require('@/assets/images/logo-light.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <Pressable
                onPress={() => router.push('/inbox' as any)}
                style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Open boards"
                hitSlop={10}
              >
                <BoardsIcon size={24} color={theme.text} />
              </Pressable>
            </View>

            {/* ========== Has trips ========== */}
            <View style={styles.dashboard}>
            {/* Active trips */}
            {activeTrips.length > 0 && (
              <View style={{ gap: 10 }}>
                <ThemedText style={[styles.tripSectionTitle, { color: theme.text }]}>In progress</ThemedText>
                <TripCardCarousel trips={activeTrips} onDelete={handleDeleteTrip} />
              </View>
            )}

            {/* Upcoming trips */}
            {upcomingTrips.length > 0 && (
              <View style={{ gap: 10 }}>
                <ThemedText style={[styles.tripSectionTitle, { color: theme.text }]}>Upcoming</ThemedText>
                <TripCardCarousel trips={upcomingTrips} onDelete={handleDeleteTrip} />
              </View>
            )}

            {/* Planned trips (dates TBD) */}
            {plannedTrips.length > 0 && (
              <View style={{ gap: 10 }}>
                <ThemedText style={[styles.tripSectionTitle, { color: theme.text }]}>Planned</ThemedText>
                <TripCardCarousel trips={plannedTrips} onDelete={handleDeleteTrip} />
              </View>
            )}

            {/* Draft trips */}
            {draftTrips.length > 0 && (
              <View style={{ gap: 10 }}>
                <ThemedText style={[styles.tripSectionTitle, { color: theme.text }]}>Drafts</ThemedText>
                <TripCardCarousel trips={draftTrips} onDelete={handleDeleteTrip} />
              </View>
            )}

            {/* Past trips — collapsible */}
            {pastTrips.length > 0 && (
              <View style={{ gap: 10 }}>
                <Pressable
                  onPress={() => setShowPastTrips(!showPastTrips)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={showPastTrips ? 'Hide past trips' : 'Show past trips'}
                >
                  <ThemedText style={[styles.tripSectionTitle, { color: theme.text }]}>
                    Past ({pastTrips.length})
                  </ThemedText>
                  <SymbolView name={showPastTrips ? 'chevron.up' : 'chevron.down'} size={12} tintColor={theme.text} />
                </Pressable>
                {showPastTrips && (
                  <TripCardCarousel trips={pastTrips} onDelete={handleDeleteTrip} />
                )}
              </View>
            )}

            {/* Board cards */}
            {boards.filter(b => b.items.length > 0).length > 0 && (
              <View style={styles.boardGrid}>
                {boards.filter(b => b.items.length > 0).map((board, i) => (
                  <Animated.View key={board.id} entering={FadeInDown.delay(100 + i * 60).springify()}>
                    <Pressable
                      onPress={() => router.push(`/board-detail?boardId=${board.id}` as any)}
                      style={({ pressed }) => [
                        { width: boardCardSize, opacity: pressed ? 0.88 : 1 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${board.name} board`}
                    >
                      <View style={[styles.boardCover, { height: boardCardSize * 0.85, backgroundColor: theme.border }]}>
                        <HomeBoardCover board={board} resolvedPhotos={resolvedPhotos} size={boardCardSize} />
                      </View>
                      <ThemedText style={styles.boardName} numberOfLines={1}>{board.name}</ThemedText>
                      <ThemedText style={[styles.boardCount, { color: theme.textSecondary }]}>
                        {board.items.length} {board.items.length === 1 ? 'place' : 'places'}
                      </ThemedText>
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            )}

            {/* Worth a visit nearby */}
            <NearYouSection />
          </View>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four },

  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 },
  headerLogo: { height: 44, width: 132 },
  headerBtn: { width: 36, height: 36, alignItems: 'center' as const, justifyContent: 'center' as const },

  // Dashboard
  dashboard: { gap: 40 },

  // Get started
  emptyHeroBlock: { gap: 12 },
  getStartedLabel: { fontSize: 18, fontWeight: '700', marginTop: 20 },
  sectionLabel: { fontSize: 18, fontWeight: '700' },
  ctaGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  ctaSquare: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
    borderRadius: Radius.md,
  },
  ctaSquareLabel: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  ctaDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },

  // Board cards
  boardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  boardCover: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  boardName: { fontSize: 14, fontWeight: '700', marginTop: 8 },
  boardCount: { fontSize: 12, marginTop: 1 },

  // Next trip hero
  heroCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    height: 240,
    ...Shadow.medium,
    shadowColor: '#000000',
  },
  heroCardContent: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  heroCountdownPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.xl,
  },
  heroCountdownText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  heroCardBottom: { gap: 3 },
  heroDestination: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    fontFamily: Fonts!.sans,
    lineHeight: 28,
  },
  heroDate: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
  },
  heroActivities: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
  },

  // Trip card carousel
  tripSectionTitle: { fontSize: 14, fontWeight: '600', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  carouselContainer: { gap: 10 },
  carouselDots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  carouselDot: { width: 6, height: 6, borderRadius: 3 },

  // Worth a visit nearby
  nearYouSection: { gap: 12, marginTop: 10 },
  nearYouScroll: { gap: 12, paddingVertical: 4, paddingRight: 4 },
  nearYouCard: {
    width: 180,
    height: 245,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  nearYouCardBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
    gap: 4,
  },
  nearYouCardName: { fontSize: 14, fontWeight: '700', color: '#fff', lineHeight: 19 },
  nearYouCardMetaRow: { flexDirection: 'row' as const, gap: 6, alignItems: 'center' as const },
  nearYouCardRating: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  nearYouCardCat: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  nearYouCardReason: { fontSize: 10, fontStyle: 'italic' as const, color: 'rgba(255,255,255,0.65)', lineHeight: 14 },
  nearYouLocationPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 14,
  },
  discoverBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  discoverText: { fontSize: 14, fontWeight: '600' },

});
