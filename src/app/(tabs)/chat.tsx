import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, memo, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { ChatMarkdown } from '@/components/chat-markdown';
import { BoardPicker } from '@/components/board-picker';
import { Radius, Spacing } from '@/constants/theme';
import { useProfile } from '@/context/profile';
import { useTrips } from '@/context/trips';
import { useBoards } from '@/context/boards';
import { useInbox } from '@/context/inbox';
import { useMemory } from '@/context/memory';
import { useTheme } from '@/hooks/use-theme';
import { loadChatMessages, saveChatMessages, loadChatThreads, saveChatThreads } from '@/services/storage';
import { chatAI, getPlacePhotoAI, type TripAction, type ChatPlace } from '@/services/ai';
import { normalizeTimeTo24 } from '@/services/ai-utils';
import { compareByTime } from '@/services/itinerary-engine';
import { useGate } from '@/hooks/use-gate';
import { useAuth } from '@/context/auth';
import { useSubscription } from '@/context/subscription';
import { UsageBadge } from '@/components/upgrade-prompt';

interface ActionResult {
  label: string;
  detail?: string;
  route?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  places?: ChatPlace[];
  suggestions?: string[];
  context?: string;
  actionResults?: ActionResult[];
  pendingActions?: TripAction[];
  /** ID mapping from safe actions that ran before confirmation was requested. */
  pendingIdMap?: Record<string, string>;
  /** Original user message to re-send after they pick a trip. */
  tripPickerMessage?: string;
  timestamp?: number;
  failed?: boolean;
}

// ---------- Chat Thread ----------

interface ChatThread {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  pinned?: boolean;
}

// ---------- Contextual Suggestions ----------

function getContextualSuggestions(
  trips: ReturnType<typeof useTrips>['trips'],
  getTripState: ReturnType<typeof useTrips>['getTripState'],
  boards: ReturnType<typeof useBoards>['boards'],
  selectedTripId?: string,
): { icon: string; text: string }[] {
  // If a specific trip is selected, tailor suggestions to it
  if (selectedTripId) {
    const trip = trips.find((t) => t.id === selectedTripId);
    if (trip) {
      const state = getTripState(trip);
      const dest = trip.destination;
      const hasHotel = trip.activities.some((a) => a.type === 'hotel');
      if (state === 'active') {
        return [
          { icon: 'fork.knife', text: `Dinner in ${dest}` },
          { icon: 'sparkles', text: 'What to do tonight?' },
          { icon: 'arrow.triangle.swap', text: "Change tomorrow" },
        ];
      }
      if (state === 'upcoming') {
        if (trip.activities.length === 0) {
          const chips = [
            { icon: 'sparkles', text: `Plan ${dest}` },
            { icon: 'fork.knife', text: 'Add restaurants' },
            { icon: 'mappin.and.ellipse', text: 'Hidden gems' },
          ];
          if (!hasHotel) chips.push({ icon: 'bed.double.fill', text: `Where to stay in ${dest}?` });
          return chips;
        }
        const chips = !hasHotel
          ? [
              { icon: 'bed.double.fill', text: `Where to stay in ${dest}?` },
              { icon: 'checklist', text: 'Review itinerary' },
              { icon: 'mappin.and.ellipse', text: 'Hidden gems' },
            ]
          : [
              { icon: 'checklist', text: 'Review itinerary' },
              { icon: 'cloud.rain', text: 'Backup for rain' },
              { icon: 'mappin.and.ellipse', text: 'Hidden gems' },
            ];
        return chips;
      }
      if (state === 'past') {
        return [
          { icon: 'airplane', text: `Like ${dest}` },
          { icon: 'sparkles', text: 'What did I miss?' },
          { icon: 'mappin.and.ellipse', text: 'Plan next trip' },
        ];
      }
    }
  }

  const activeTrips = trips.filter((t) => getTripState(t) === 'active');
  const upcomingTrips = trips.filter((t) => getTripState(t) === 'upcoming');
  const pastTrips = trips.filter((t) => getTripState(t) === 'past');
  const boardsWithItems = boards.filter(b => b.items.length > 0);

  if (activeTrips.length > 0) {
    const dest = activeTrips[0].destination;
    return [
      { icon: 'fork.knife', text: `Dinner in ${dest}` },
      { icon: 'sparkles', text: 'What to do tonight?' },
      { icon: 'arrow.triangle.swap', text: "Change tomorrow" },
    ];
  }

  if (upcomingTrips.length > 0) {
    const trip = upcomingTrips[0];
    const hasHotel = trip.activities.some((a) => a.type === 'hotel');
    const emptyDays = trip.activities.length === 0;
    if (emptyDays) {
      const chips = [
        { icon: 'sparkles', text: `Plan ${trip.destination}` },
        { icon: 'fork.knife', text: 'Add restaurants' },
        { icon: 'mappin.and.ellipse', text: 'Hidden gems' },
      ];
      if (!hasHotel) chips.push({ icon: 'bed.double.fill', text: `Where to stay in ${trip.destination}?` });
      return chips;
    }
    if (!hasHotel) {
      return [
        { icon: 'bed.double.fill', text: `Where to stay in ${trip.destination}?` },
        { icon: 'checklist', text: 'Review itinerary' },
        { icon: 'mappin.and.ellipse', text: 'Hidden gems' },
      ];
    }
    return [
      { icon: 'checklist', text: 'Review itinerary' },
      { icon: 'cloud.rain', text: 'Backup for rain' },
      { icon: 'mappin.and.ellipse', text: 'Hidden gems' },
    ];
  }

  if (boardsWithItems.length > 0) {
    return [
      { icon: 'square.grid.2x2', text: 'Sort saved places' },
      { icon: 'airplane', text: 'Trip from boards' },
      { icon: 'mappin.and.ellipse', text: 'Recommend a spot' },
    ];
  }

  if (pastTrips.length > 0) {
    const lastDest = pastTrips[0].destination;
    return [
      { icon: 'airplane', text: 'Plan next trip' },
      { icon: 'arrow.triangle.swap', text: `Like ${lastDest}` },
      { icon: 'mappin.and.ellipse', text: 'Where to go?' },
    ];
  }

  return [
    { icon: 'airplane', text: 'Plan my first trip' },
    { icon: 'mappin.and.ellipse', text: 'Where to go?' },
    { icon: 'fork.knife', text: 'Find a restaurant' },
  ];
}

function getGreeting(name: string): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return `Good morning, ${name}`;
  if (hour >= 12 && hour < 17) return `Good afternoon, ${name}`;
  if (hour >= 17 && hour < 24) return `Good evening, ${name}`;
  return `Still planning, ${name}?`;
}

function getSubtitle(
  trips: ReturnType<typeof useTrips>['trips'],
  getTripState: ReturnType<typeof useTrips>['getTripState'],
  boards: ReturnType<typeof useBoards>['boards'],
  selectedTripId?: string,
): string {
  // If a specific trip is selected, show its status
  if (selectedTripId) {
    const trip = trips.find((t) => t.id === selectedTripId);
    if (trip) {
      const state = getTripState(trip);
      if (state === 'active') {
        const start = new Date(trip.startDate);
        const today = new Date();
        const dayNum = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
        const totalDays = Math.floor((new Date(trip.endDate).getTime() - start.getTime()) / 86400000) + 1;
        return `Day ${dayNum} of ${totalDays} in ${trip.destination}. How's it going?`;
      }
      if (state === 'upcoming') {
        const daysUntil = Math.ceil((new Date(trip.startDate).getTime() - Date.now()) / 86400000);
        if (daysUntil <= 1) return `${trip.destination} is tomorrow. Need anything last-minute?`;
        return `${daysUntil} days until ${trip.destination}. Need help with anything?`;
      }
      if (state === 'past') {
        return `Your ${trip.destination} trip is complete. Want to reminisce?`;
      }
      return `Planning ${trip.destination}. How can I help?`;
    }
  }

  const activeTrips = trips.filter((t) => getTripState(t) === 'active');
  const upcomingTrips = trips.filter((t) => getTripState(t) === 'upcoming').sort((a, b) => a.startDate.localeCompare(b.startDate));

  if (activeTrips.length > 0) {
    const t = activeTrips[0];
    const start = new Date(t.startDate);
    const today = new Date();
    const dayNum = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
    const totalDays = Math.floor((new Date(t.endDate).getTime() - start.getTime()) / 86400000) + 1;
    return `Day ${dayNum} of ${totalDays} in ${t.destination}. How's it going?`;
  }

  if (upcomingTrips.length > 0) {
    const t = upcomingTrips[0];
    const daysUntil = Math.ceil((new Date(t.startDate).getTime() - Date.now()) / 86400000);
    if (daysUntil <= 1) return `${t.destination} is tomorrow. Need anything last-minute?`;
    return `${daysUntil} days until ${t.destination}. Need help with anything?`;
  }

  if (boards.filter(b => b.items.length > 0).length > 0) {
    return "You've saved some places. Let's put them to use.";
  }

  return "Let's plan your next adventure.";
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- Place Photo Hook ----------

function usePlacePhoto(ref: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    getPlacePhotoAI({ reference: ref, maxWidth: 400 }).then(({ url: u }) => {
      if (!cancelled) setUrl(u);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ref]);
  return url;
}

// ---------- Place Card ----------

const ChatPlaceCard = memo(function ChatPlaceCard({
  place,
  onAddToTrip,
  onSaveToBoard,
  isPrimary,
}: {
  place: ChatPlace;
  onAddToTrip: () => void;
  onSaveToBoard: () => void;
  isPrimary?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const photoUrl = usePlacePhoto(place.photoRefs?.[0]);

  function openDetail() {
    let url = `/place-detail?name=${encodeURIComponent(place.name)}`;
    if (place.placeId) url += `&placeId=${encodeURIComponent(place.placeId)}`;
    if (place.address) url += `&address=${encodeURIComponent(place.address)}`;
    if (place.rating != null) url += `&rating=${place.rating}`;
    if (place.ratingCount != null) url += `&reviewCount=${place.ratingCount}`;
    if (place.lat != null) url += `&lat=${place.lat}`;
    if (place.lng != null) url += `&lng=${place.lng}`;
    router.push(url as any);
  }

  const typeLabel = place.types?.[0]?.replace(/_/g, ' ') ?? '';

  return (
    <Pressable
      onPress={openDetail}
      style={({ pressed }) => [
        placeStyles.card,
        isPrimary && placeStyles.cardPrimary,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`View ${place.name}`}
    >
      {photoUrl ? (
        <ExpoImage source={{ uri: photoUrl }} style={[placeStyles.cardImage, isPrimary && placeStyles.cardImagePrimary]} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[placeStyles.cardImage, isPrimary && placeStyles.cardImagePrimary, { backgroundColor: theme.border }]}>
          <SymbolView name="mappin" size={22} tintColor={theme.textSecondary} />
        </View>
      )}
      <View style={placeStyles.cardInfo}>
        <ThemedText style={placeStyles.cardName} numberOfLines={2}>{place.name}</ThemedText>
        <View style={placeStyles.cardMeta}>
          {place.rating != null && (
            <View style={placeStyles.ratingRow}>
              <SymbolView name="star.fill" size={10} tintColor="#F59E0B" />
              <ThemedText style={placeStyles.ratingText}>{place.rating.toFixed(1)}</ThemedText>
            </View>
          )}
          {typeLabel ? (
            <ThemedText style={[placeStyles.typeText, { color: theme.textSecondary }]} numberOfLines={1}>
              {typeLabel}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <View style={[placeStyles.actionRow, { borderTopColor: theme.border }]}>
        <Pressable
          onPress={(e) => { e.stopPropagation(); onAddToTrip(); }}
          hitSlop={4}
          style={({ pressed }) => [placeStyles.actionBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${place.name} to trip`}
        >
          <SymbolView name="plus.circle" size={14} tintColor={theme.primary} />
        </Pressable>
        <View style={[placeStyles.actionDivider, { backgroundColor: theme.border }]} />
        <Pressable
          onPress={(e) => { e.stopPropagation(); onSaveToBoard(); }}
          hitSlop={4}
          style={({ pressed }) => [placeStyles.actionBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`Save ${place.name} to board`}
        >
          <SymbolView name="bookmark" size={14} tintColor={theme.primary} />
        </Pressable>
      </View>
    </Pressable>
  );
});

const placeStyles = StyleSheet.create({
  card: {
    width: 180,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardPrimary: {
    width: 220,
  },
  cardImage: {
    width: '100%',
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImagePrimary: {
    height: 110,
  },
  cardInfo: {
    padding: 10,
    gap: 3,
  },
  cardName: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '600',
  },
  typeText: {
    fontSize: 11,
    textTransform: 'capitalize',
  },
  actionRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
  },
  actionDivider: {
    width: StyleSheet.hairlineWidth,
  },
});

// ---------- Typing Indicator ----------

function TypingIndicator({ userMessage }: { userMessage?: string }) {
  const theme = useTheme();
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const opacity = useSharedValue(1);

  const isTripCreation = useMemo(() => {
    const msg = (userMessage || '').toLowerCase();
    return msg.includes('create') || msg.includes('plan') || msg.includes('build') || msg.includes('generate') || msg.includes('trip');
  }, [userMessage]);

  const phrases = useMemo(() => {
    const msg = (userMessage || '').toLowerCase();
    if (msg.includes('restaurant') || msg.includes('food') || msg.includes('eat') || msg.includes('dinner') || msg.includes('lunch') || msg.includes('breakfast') || msg.includes('cafe') || msg.includes('coffee'))
      return ['Finding great spots...', 'Browsing local favorites...', 'Checking reviews...', 'Narrowing it down...', 'Personalizing picks...', 'Matching your taste...'];
    if (msg.includes('hotel') || msg.includes('stay') || msg.includes('sleep') || msg.includes('accommodation') || msg.includes('airbnb'))
      return ['Searching stays...', 'Comparing options...', 'Checking availability...', 'Finding the best match...', 'Reviewing amenities...', 'Narrowing it down...'];
    if (isTripCreation)
      return ['Planning your trip...', 'Building the itinerary...', 'Picking activities...', 'Organizing your days...', 'Adding the details...', 'Putting it all together...', 'Selecting the best spots...', 'Filling in each day...'];
    if (msg.includes('change') || msg.includes('move') || msg.includes('update') || msg.includes('swap') || msg.includes('replace') || msg.includes('edit'))
      return ['Making changes...', 'Updating your plan...', 'Rearranging things...', 'Adjusting the schedule...', 'Working on it...', 'Refining the details...'];
    if (msg.includes('recommend') || msg.includes('suggest') || msg.includes('find') || msg.includes('where') || msg.includes('what should') || msg.includes('best'))
      return ['Searching for you...', 'Exploring options...', 'Curating picks...', 'Finding hidden gems...', 'Personalizing results...', 'Weighing the options...'];
    if (msg.includes('delete') || msg.includes('remove') || msg.includes('cancel'))
      return ['Processing your request...', 'Working on that...', 'Handling it now...', 'One moment...'];
    if (msg.includes('book') || msg.includes('reserve') || msg.includes('reservation'))
      return ['Looking into bookings...', 'Checking details...', 'Working on it...', 'Getting that set up...', 'Pulling up info...', 'One moment...'];
    return ['Thinking...', 'Working on it...', 'Putting it together...', 'One moment...', 'Still working...', 'Hang tight...', 'Processing...', 'Pulling things together...'];
  }, [userMessage, isTripCreation]);

  // Track elapsed seconds to show slow-loading message for trip creation
  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((p) => (p + 1) % phrases.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [phrases.length]);

  // After 15s for trip creation, show a reassuring slow-loading message
  const slowMessage = isTripCreation && elapsed >= 15
    ? 'This can take up to a minute for longer trips — hang tight!'
    : null;

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.5, { duration: 800 }), -1, true);
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={[typingStyles.container, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Animated.View style={animStyle}>
        <ThemedText style={[typingStyles.text, { color: theme.textSecondary }]}>{slowMessage ?? phrases[phase]}</ThemedText>
      </Animated.View>
      {slowMessage && (
        <ThemedText style={[typingStyles.subtext, { color: theme.textSecondary }]}>{phrases[phase]}</ThemedText>
      )}
    </View>
  );
}

const typingStyles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    marginLeft: Spacing.four,
  },
  text: {
    fontSize: 14,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  subtext: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
    opacity: 0.7,
  },
});

// ---------- Action Result Card ----------

const ActionResultCard = memo(function ActionResultCard({ result, theme }: { result: ActionResult; theme: ReturnType<typeof useTheme> }) {
  const router = useRouter();
  return (
    <View style={[actionStyles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={actionStyles.cardRow}>
        <SymbolView name="checkmark.circle.fill" size={16} tintColor="#34C759" />
        <ThemedText style={actionStyles.cardLabel}>{result.label}</ThemedText>
      </View>
      {result.detail && (
        <ThemedText style={[actionStyles.cardDetail, { color: theme.textSecondary }]}>{result.detail}</ThemedText>
      )}
      {result.route && (
        <Pressable
          onPress={() => router.push(result.route as any)}
          style={({ pressed }) => [actionStyles.cardLink, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
        >
          <ThemedText style={[actionStyles.cardLinkText, { color: theme.primary }]}>View trip</ThemedText>
          <SymbolView name="chevron.right" size={11} tintColor={theme.primary} />
        </Pressable>
      )}
    </View>
  );
});

// ---------- Confirmation Card ----------

function ConfirmationCard({
  message,
  actions,
  theme,
  onConfirm,
  onCancel,
}: {
  message: string;
  actions: TripAction[];
  theme: ReturnType<typeof useTheme>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const labels = actions.map((a) => {
    if (a.type === 'delete_trip') return 'Delete trip';
    if (a.type === 'swap_days') return `Swap Day ${a.day1} and Day ${a.day2}`;
    return a.type.replace(/_/g, ' ');
  });
  return (
    <View style={[actionStyles.confirmCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={actionStyles.cardRow}>
        <SymbolView name="exclamationmark.triangle.fill" size={16} tintColor="#F59E0B" />
        <ThemedText style={actionStyles.cardLabel}>Confirm action</ThemedText>
      </View>
      <ThemedText style={[actionStyles.cardDetail, { color: theme.textSecondary }]}>
        {message || labels.join(', ')}
      </ThemedText>
      <View style={actionStyles.confirmBtnRow}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [actionStyles.confirmBtn, { backgroundColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <ThemedText style={actionStyles.confirmBtnText}>Cancel</ThemedText>
        </Pressable>
        <Pressable
          onPress={onConfirm}
          style={({ pressed }) => [actionStyles.confirmBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Confirm"
        >
          <ThemedText style={[actionStyles.confirmBtnText, { color: '#fff' }]}>Confirm</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const actionStyles = StyleSheet.create({
  card: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 12,
    gap: 6,
    marginTop: 8,
    maxWidth: '82%',
    alignSelf: 'flex-start',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardDetail: {
    fontSize: 12,
    marginLeft: 24,
  },
  cardLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 24,
    marginTop: 2,
  },
  cardLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  confirmCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 12,
    gap: 8,
    marginTop: 8,
    maxWidth: '82%',
    alignSelf: 'flex-start',
  },
  confirmBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginLeft: 24,
  },
  confirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },
  confirmBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

// ---------- Trip Picker Card ----------

function TripPickerCard({
  trips,
  theme,
  onSelect,
}: {
  trips: { id: string; title?: string; destination: string; country: string; emoji?: string; startDate?: string; endDate?: string }[];
  theme: ReturnType<typeof useTheme>;
  onSelect: (tripId: string) => void;
}) {
  return (
    <View style={{
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.backgroundElement,
      padding: 12,
      marginTop: 8,
      width: '92%',
      alignSelf: 'flex-start',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <SymbolView name="mappin.and.ellipse" size={16} tintColor={theme.primary} />
        <ThemedText style={{ fontSize: 14, fontWeight: '600' }}>Which trip?</ThemedText>
      </View>
      {trips.map((t) => {
        const label = t.title || t.destination;
        const sub = t.startDate ? `${t.destination} · ${t.startDate}` : t.destination;
        return (
          <Pressable
            key={t.id}
            onPress={() => onSelect(t.id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: Radius.sm,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.border : 'transparent',
              marginBottom: 6,
            })}
            accessibilityRole="button"
            accessibilityLabel={`Select ${label}`}
          >
            <ThemedText style={{ fontSize: 18 }}>{t.emoji || '✈️'}</ThemedText>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText style={{ fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{label}</ThemedText>
              {t.title && (
                <ThemedText style={{ fontSize: 12, color: theme.textSecondary }} numberOfLines={1}>{sub}</ThemedText>
              )}
            </View>
            <SymbolView name="chevron.right" size={12} tintColor={theme.textSecondary} />
          </Pressable>
        );
      })}
    </View>
  );
}

function formatUserName(email?: string): string {
  if (!email) return 'Traveler';
  const prefix = email.split('@')[0];
  return prefix
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\d+$/, '')
    .trim() || 'Traveler';
}

function buildContext(
  trips: ReturnType<typeof useTrips>['trips'],
  getTripState: ReturnType<typeof useTrips>['getTripState'],
  profile: ReturnType<typeof useProfile>['profile'],
  memoryEntries: ReturnType<typeof useMemory>['getActiveEntries'] extends () => infer R ? R : never,
  boards: ReturnType<typeof useBoards>['boards'],
  savedPlaces: ReturnType<typeof useInbox>['savedPlaces'],
  userName: string,
) {
  const activeTrips = trips.filter((t) => getTripState(t) === 'active');
  const upcomingTrips = trips.filter((t) => getTripState(t) === 'upcoming');
  const plannedTrips = trips.filter((t) => getTripState(t) === 'planned' || getTripState(t) === 'draft');
  const pastTrips = trips.filter((t) => getTripState(t) === 'past');

  const lines: string[] = [];

  // Identity & time
  lines.push(`User: ${userName}`);
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  const hr = now.getHours(), mn = now.getMinutes();
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const hr12 = hr % 12 || 12;
  lines.push(`Current time: ${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())} ${hr12}:${pad2(mn)} ${ampm} (${days[now.getDay()]})`);

  // Full profile
  const profileParts = [`pace=${profile.pace}`];
  if (profile.flexibility) profileParts.push(`flexibility=${profile.flexibility}`);
  if (profile.budget) profileParts.push(`budget=${profile.budget}`);
  lines.push(`\nTraveler profile: ${profileParts.join(', ')}`);
  if (profile.accommodationPreference) lines.push(`Accommodation preference: ${profile.accommodationPreference}`);
  if (profile.interests.length) lines.push(`Interests: ${profile.interests.join(', ')}`);
  if (profile.dislikes.length) lines.push(`Dislikes: ${profile.dislikes.join(', ')}`);
  if (profile.dietaryRestrictions.length) {
    const dietLine = profile.dietaryRestrictions.join(', ');
    lines.push(`Dietary: ${dietLine}${profile.dietaryNote ? ` (Note: ${profile.dietaryNote})` : ''}`);
  } else if (profile.dietaryNote) {
    lines.push(`Dietary note: ${profile.dietaryNote}`);
  }
  if (profile.mobilityNeeds.length) lines.push(`Mobility needs: ${profile.mobilityNeeds.join(', ')}`);
  if (profile.crowdTolerance) lines.push(`Crowd tolerance: ${profile.crowdTolerance}`);
  if (profile.foodImportance) lines.push(`Food importance: ${profile.foodImportance}`);
  if (profile.spendingPriorities?.length) lines.push(`Spending priorities: ${profile.spendingPriorities.join(', ')}`);
  if (profile.decisionPriorities?.length) lines.push(`Decision priorities: ${profile.decisionPriorities.join(', ')}`);
  if (profile.recommendationStyle) lines.push(`Recommendation style: ${profile.recommendationStyle}`);
  if (profile.absoluteRules?.length) lines.push(`Absolute rules: ${profile.absoluteRules.join(', ')}`);
  if (profile.travelWith) lines.push(`Traveling with: ${profile.travelWith}`);
  if (profile.anythingElse) lines.push(`Additional notes: ${profile.anythingElse}`);

  // Enriched activity renderer (with IDs for AI actions)
  function renderActivities(t: (typeof trips)[0]) {
    if (!t.activities.length) { lines.push('  (no activities yet)'); return; }
    const sorted = [...t.activities].sort((a, b) => a.day - b.day || compareByTime(a, b));
    for (const a of sorted) {
      const parts: string[] = [a.type];
      if (a.category) parts.push(a.category);
      if (a.cost) parts.push(a.cost);
      if (a.duration) parts.push(`${a.duration}min`);
      const meta = parts.length > 1 ? `[${parts.join(', ')}]` : `(${a.type})`;
      const flags: string[] = [];
      if (a.locked) flags.push('LOCKED');
      if (a.fixed) flags.push('FIXED');
      if ((a as any).bookingStatus === 'booked') flags.push('BOOKED');
      const flagStr = flags.length ? ` [${flags.join(',')}]` : '';
      const rating = a.rating ? ` ★${a.rating.toFixed(1)}` : '';
      const addr = a.address ? ` @${a.address.split(',')[0].trim()}` : '';
      const notes = a.notes ? ` "${a.notes}"` : '';
      lines.push(`  [id:${a.id}] Day${a.day} ${a.time} — ${a.title} ${meta}${rating}${addr}${flagStr}${notes}`);
    }
    const res = ((t as any).reservations ?? []).filter((r: any) => !r.cancelled);
    if (res.length) {
      lines.push('  Reservations:');
      for (const r of res) {
        const when = r.day ? `Day${r.day}` : (r.date ?? '');
        const time = r.time ? ` ${r.time}` : '';
        const conf = r.confirmationNumber ? ` #${r.confirmationNumber}` : '';
        lines.push(`    [resId:${r.id}] ${r.type}: ${r.title}${when ? ' ' + when : ''}${time}${conf}`);
      }
    }
  }

  // Trip header with title and ID
  function tripHeader(t: (typeof trips)[0]) {
    const title = t.title ? `"${t.title}" — ` : '';
    return `- [tripId:${t.id}] ${title}${t.destination}, ${t.country} (${t.startDate} to ${t.endDate})`;
  }

  // Active trips — full detail
  if (activeTrips.length) {
    lines.push('\nActive trips:');
    for (const t of activeTrips) {
      lines.push(tripHeader(t));
      renderActivities(t);
    }
  }

  // Upcoming — full detail
  if (upcomingTrips.length) {
    lines.push('\nUpcoming trips:');
    for (const t of upcomingTrips) {
      lines.push(tripHeader(t));
      renderActivities(t);
    }
  }

  // Planned/draft trips — full detail with IDs so AI can reference them
  if (plannedTrips.length) {
    lines.push('\nPlanned trips (dates TBD):');
    for (const t of plannedTrips) {
      lines.push(tripHeader(t));
      renderActivities(t);
    }
  }

  // Past
  if (pastTrips.length) {
    lines.push('\nPast trips:');
    for (const t of pastTrips) {
      lines.push(`- ${t.destination}, ${t.country}`);
    }
  }

  // Boards — saved research (with IDs for AI actions)
  const populatedBoards = boards.filter(b => b.items.length > 0).slice(0, 5);
  if (populatedBoards.length) {
    lines.push('\nSaved boards:');
    for (const board of populatedBoards) {
      lines.push(`[boardId:${board.id}] Board "${board.name}" (${board.items.length} places):`);
      for (const item of board.items.slice(0, 8)) {
        const parts: string[] = [item.type];
        if (item.cost) parts.push(item.cost);
        if (item.destination) parts.push(item.destination);
        const rating = item.rating ? ` ★${item.rating.toFixed(1)}` : '';
        const planned = item.plannedTripId ? ' [on trip]' : '';
        lines.push(`  [itemId:${item.id}] ${item.title} (${parts.join(', ')})${rating}${planned}`);
      }
    }
  }

  // Saved places (unsorted)
  if (savedPlaces.length) {
    const capped = savedPlaces.slice(0, 10);
    lines.push('\nSaved places (unsorted):');
    for (const p of capped) {
      const parts: string[] = [];
      if (p.destination) parts.push(p.destination);
      if ((p as any).activityType) parts.push((p as any).activityType);
      const bestTime = (p as any).bestTime ? ` "${(p as any).bestTime}"` : '';
      lines.push(`  - ${p.title}${parts.length ? ` (${parts.join(', ')})` : ''}${bestTime}`);
    }
  }

  // Memory
  if (memoryEntries.length) {
    lines.push('\nTravel preferences learned:');
    for (const e of memoryEntries) {
      lines.push(`- ${e.detail}`);
    }
  }

  return lines.join('\n');
}

/**
 * Find which trip (if any) the user is referring to.
 * Priority: selected trip > name match > last-acted trip > sole trip > undefined.
 */
function resolveMentionedTrip(
  userMessage: string,
  trips: ReturnType<typeof useTrips>['trips'],
  getTripState: ReturnType<typeof useTrips>['getTripState'],
  selectedTripId?: string,
  lastActedTripId?: string,
): (typeof trips)[0] | undefined {
  // If there's an explicitly selected trip (from selector UI), use it
  if (selectedTripId) {
    return trips.find((t) => t.id === selectedTripId);
  }

  const lower = userMessage.toLowerCase();
  // Include all non-past trips: active, upcoming, planned (TBD dates), and draft
  const relevantTrips = trips.filter((t) => {
    const state = getTripState(t);
    return state !== 'past';
  });

  // Check if the message mentions any trip by title, destination, or country
  for (const trip of relevantTrips) {
    const candidates = [
      trip.title,
      trip.destination,
      trip.country,
    ].filter(Boolean).map((s) => s!.toLowerCase());
    if (candidates.some((c) => c.length > 1 && lower.includes(c))) return trip;
  }

  // If the user just acted on a trip (created, modified), continue with that one
  if (lastActedTripId) {
    const lastActed = relevantTrips.find((t) => t.id === lastActedTripId);
    if (lastActed) return lastActed;
  }

  // Only one non-past trip — use it unambiguously
  if (relevantTrips.length === 1) return relevantTrips[0];

  // Multiple trips, no explicit mention — don't guess
  return undefined;
}


export default function ChatScreen() {
  const { context: placeContext, tripId: initialTripId, message: initialMessage, autoFocus: autoFocusParam } = useLocalSearchParams<{ context?: string; tripId?: string; message?: string; autoFocus?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { trips, getTripState, getTrip, addActivity, removeActivity, updateActivity, moveActivity, replaceActivity, setTripActivities, addTripWithActivities, updateTrip, deleteTrip, addReservation, updateReservation, removeReservation, toggleLock } = useTrips();
  const { profile, updateProfile } = useProfile();
  const { getActiveEntries } = useMemory();
  const { boards, addItemToBoard, createBoard, deleteBoard, renameBoard, removeItemFromBoard, markItemPlanned } = useBoards();
  const { savedPlaces } = useInbox();
  const { user } = useAuth();
  const userName = formatUserName(user?.email);

  const chatGate = useGate('chat');
  const { refresh: refreshSubscription } = useSubscription();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | undefined>(initialTripId);
  const [showTripSelector, setShowTripSelector] = useState(false);
  const [boardPickerVisible, setBoardPickerVisible] = useState(false);
  const [pendingBoardPlace, setPendingBoardPlace] = useState<ChatPlace | null>(null);
  const [lastActedTripId, setLastActedTripId] = useState<string | undefined>();
  // Chat threads
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showThreadList, setShowThreadList] = useState(false);
  const [threadOptionsId, setThreadOptionsId] = useState<string | null>(null);
  const [renameThreadId, setRenameThreadId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const listRef = useRef<FlatList>(null);
  const chatInputRef = useRef<TextInput>(null);
  const tripsRef = useRef(trips);
  useEffect(() => { tripsRef.current = trips; }, [trips]);
  const boardsRef = useRef(boards);
  useEffect(() => { boardsRef.current = boards; }, [boards]);
  // Track scroll position for smart auto-scroll (only scroll to bottom if user is near bottom)
  const isNearBottom = useRef(true);
  // Track how many messages were loaded from storage so we skip entrance animations for them
  const loadedMsgCount = useRef(0);

  const isEmptyState = messages.length === 0;

  function handleSaveToBoard(place: ChatPlace) {
    setPendingBoardPlace(place);
    setBoardPickerVisible(true);
  }

  function handleBoardSelected(boardId: string) {
    if (pendingBoardPlace) {
      addItemToBoard(boardId, {
        title: pendingBoardPlace.name,
        type: 'activity',
        sourceType: 'explore',
        placeId: pendingBoardPlace.placeId,
        address: pendingBoardPlace.address,
        lat: pendingBoardPlace.lat ?? undefined,
        lng: pendingBoardPlace.lng ?? undefined,
        rating: pendingBoardPlace.rating ?? undefined,
      });
    }
    setPendingBoardPlace(null);
    setBoardPickerVisible(false);
  }

  function handleAddToTrip(place: ChatPlace) {
    let url = `/place-detail?name=${encodeURIComponent(place.name)}`;
    if (place.placeId) url += `&placeId=${encodeURIComponent(place.placeId)}`;
    if (place.address) url += `&address=${encodeURIComponent(place.address)}`;
    if (place.rating != null) url += `&rating=${place.rating}`;
    if (place.ratingCount != null) url += `&reviewCount=${place.ratingCount}`;
    if (place.lat != null) url += `&lat=${place.lat}`;
    if (place.lng != null) url += `&lng=${place.lng}`;
    router.push(url as any);
  }

  function handleNewConversation() {
    // Save current thread before starting new
    if (messages.length > 0 && activeThreadId) {
      saveCurrentThread();
    }
    loadedMsgCount.current = 0;
    setMessages([]);
    setActiveThreadId(null);

    setShowThreadList(false);
  }

  function formatThreadTitle(text: string): string {
    let t = text.trim().replace(/\n.*/s, '');
    // Strip greetings
    t = t.replace(/^(hey|hi|hello|yo|ok|okay|so)\s*,?\s*/i, '');
    // Strip question/request starters
    t = t.replace(/^(can you|could you|would you|please|i want to|i'd like to|i need to|i want|i need|i'm looking for|what are|what's|where can i find|where should i|find me|show me|give me|tell me about|recommend|suggest)\s+/i, '');
    // Strip filler words
    t = t.replace(/\b(some|the best|really good|good|great|nice|really|very|around here|for me|for us|for tonight|for today|for tomorrow|nearby|in the area)\b/gi, '');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (t.length > 30) {
      t = t.slice(0, 30).replace(/\s+\S*$/, '') + '\u2026';
    }
    return t || 'New chat';
  }

  function saveCurrentThread() {
    const id = activeThreadId || generateId();

    setThreads((prev) => {
      const existing = prev.find((t) => t.id === id);
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const autoTitle = firstUserMsg ? formatThreadTitle(firstUserMsg.text) : 'New chat';
      const thread: ChatThread = {
        id,
        title: autoTitle,
        messages,
        updatedAt: Date.now(),
        pinned: existing?.pinned,
      };
      const filtered = prev.filter((t) => t.id !== id);
      const updated = [thread, ...filtered].slice(0, 50);
      saveChatThreads(updated);
      return updated;
    });
    if (!activeThreadId) setActiveThreadId(id);
  }

  function loadThread(thread: ChatThread) {
    // Save current thread first
    if (messages.length > 0 && activeThreadId) {
      saveCurrentThread();
    }
    loadedMsgCount.current = thread.messages.length;
    setMessages(thread.messages);
    setActiveThreadId(thread.id);
    setIsTyping(false);

    setShowThreadList(false);
    // Scroll to bottom after thread loads
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }

  function deleteThread(threadId: string) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setThreads((prev) => {
      const updated = prev.filter((t) => t.id !== threadId);
      saveChatThreads(updated);
      return updated;
    });
    if (activeThreadId === threadId) {
      loadedMsgCount.current = 0;
      setMessages([]);
      setActiveThreadId(null);
    }
    setThreadOptionsId(null);
  }

  function togglePinThread(threadId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setThreads((prev) => {
      const updated = prev.map((t) => t.id === threadId ? { ...t, pinned: !t.pinned } : t);
      saveChatThreads(updated);
      return updated;
    });
    setThreadOptionsId(null);
  }

  function startRenameThread(threadId: string) {
    const thread = threads.find((t) => t.id === threadId);
    if (thread) {
      setRenameText(thread.title);
      setRenameThreadId(threadId);
      setThreadOptionsId(null);
    }
  }

  function confirmRename() {
    if (!renameThreadId || !renameText.trim()) return;
    const newTitle = renameText.trim();
    setThreads((prev) => {
      const updated = prev.map((t) => t.id === renameThreadId ? { ...t, title: newTitle } : t);
      saveChatThreads(updated);
      return updated;
    });
    setRenameThreadId(null);
    setRenameText('');
  }

  // Track keyboard for input bar padding
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Load persisted threads — resume most recent on app reopen
  useEffect(() => {
    loadChatThreads<ChatThread[]>([]).then((savedThreads) => {
      setThreads(savedThreads);
      if (!placeContext && savedThreads.length > 0) {
        const mostRecent = savedThreads[0]; // already sorted by updatedAt desc
        loadedMsgCount.current = mostRecent.messages.length;
        setMessages(mostRecent.messages);
        setActiveThreadId(mostRecent.id);
      }
      setLoaded(true);
    });
  }, [placeContext]);

  // Auto-focus input when navigating from the Ask bar — wait for transition to finish
  useEffect(() => {
    if (loaded && autoFocusParam) {
      const timer = setTimeout(() => chatInputRef.current?.focus(), 500);
      return () => clearTimeout(timer);
    }
  }, [loaded, autoFocusParam]);

  // Persist messages when they change
  useEffect(() => {
    if (loaded && messages.length > 0) {
      saveChatMessages(messages);
      // Auto-save thread after each message
      const id = activeThreadId || generateId();
      if (!activeThreadId) setActiveThreadId(id);
      setThreads((prev) => {
        const existing = prev.find((t) => t.id === id);
        const firstUserMsg = messages.find((m) => m.role === 'user');
        const autoTitle = firstUserMsg ? formatThreadTitle(firstUserMsg.text) : 'New chat';
        const thread: ChatThread = {
          id,
          title: autoTitle,
          messages,
          updatedAt: Date.now(),
          pinned: existing?.pinned,
        };
        const filtered = prev.filter((t) => t.id !== id);
        const updated = [thread, ...filtered].slice(0, 50);
        saveChatThreads(updated);
        return updated;
      });
    }
  }, [messages, loaded, activeThreadId]);

  const context = buildContext(trips, getTripState, profile, getActiveEntries(), boards, savedPlaces, userName);

  function applyTripAction(action: TripAction, idMap?: Map<string, string>, justUnlocked?: Set<string>): { ok: boolean; reason?: string } {
    switch (action.type) {
      // --- Activity operations ---
      case 'add_activity': {
        const activity = { ...action.activity, time: normalizeTimeTo24(action.activity.time) };
        const ok = addActivity(action.tripId, activity);
        if (!ok) return { ok: false, reason: `Add failed — trip not found` };
        return { ok: true };
      }
      case 'remove_activity': {
        const skip = justUnlocked?.has(action.activityId) ?? false;
        const ok = removeActivity(action.tripId, action.activityId, skip);
        if (!ok) return { ok: false, reason: `Remove failed — activity not found, locked, or trip missing` };
        return { ok: true };
      }
      case 'update_activity': {
        const skip = justUnlocked?.has(action.activityId) ?? false;
        const updates = action.updates.time
          ? { ...action.updates, time: normalizeTimeTo24(action.updates.time) }
          : action.updates;
        const ok = updateActivity(action.tripId, action.activityId, updates, skip);
        if (!ok) return { ok: false, reason: `Update failed — activity not found, locked, or trip missing` };
        return { ok: true };
      }
      case 'move_activity': {
        const skip = justUnlocked?.has(action.activityId) ?? false;
        const ok = moveActivity(action.tripId, action.activityId, action.newDay, normalizeTimeTo24(action.newTime), skip);
        if (!ok) return { ok: false, reason: 'Move failed — activity not found, locked, or trip missing' };
        return { ok: true };
      }
      case 'replace_activity': {
        const skip = justUnlocked?.has(action.oldActivityId) ?? false;
        const newActivity = { ...action.newActivity, time: normalizeTimeTo24(action.newActivity.time) };
        const ok = replaceActivity(action.tripId, action.oldActivityId, newActivity, skip);
        if (!ok) return { ok: false, reason: 'Replace failed — activity not found, locked, or trip missing' };
        return { ok: true };
      }
      case 'swap_days': {
        const trip = getTrip(action.tripId);
        if (!trip) return { ok: false, reason: 'Trip not found' };
        const swapped = trip.activities.map((a) => {
          if (a.locked || a.fixed) return a; // Lock protection: locked activities stay on their day
          if (a.day === action.day1) return { ...a, day: action.day2 };
          if (a.day === action.day2) return { ...a, day: action.day1 };
          return a;
        });
        setTripActivities(action.tripId, swapped, `Swapped Day ${action.day1} and Day ${action.day2}`);
        return { ok: true };
      }

      // --- Trip management ---
      case 'create_trip': {
        const newId = addTripWithActivities(action.trip, action.activities);
        if (!newId) return { ok: false, reason: 'Could not create trip' };
        // Track the new trip ID so subsequent actions can reference it
        if (idMap && (action as any).tripId) {
          idMap.set((action as any).tripId, newId);
        }
        if (idMap) {
          idMap.set('__last_created_trip__', newId);
        }
        return { ok: true };
      }
      case 'update_trip': {
        const trip = getTrip(action.tripId);
        if (!trip) {
          // Debug: log what the AI tried vs what exists
          const knownIds = trips.map((t) => t.id.slice(0, 8)).join(', ');
          return { ok: false, reason: `Trip not found (tried: ${(action.tripId || 'none').slice(0, 8)}… known: ${knownIds})` };
        }
        updateTrip(action.tripId, action.updates);
        return { ok: true };
      }
      case 'delete_trip': {
        const trip = getTrip(action.tripId);
        if (!trip) return { ok: false, reason: 'Trip not found' };
        deleteTrip(action.tripId);
        // Sync ref so subsequent actions don't find deleted trip
        tripsRef.current = tripsRef.current.filter((t) => t.id !== action.tripId);
        return { ok: true };
      }

      // --- Reservations ---
      case 'add_reservation': {
        const trip = getTrip(action.tripId);
        if (!trip) return { ok: false, reason: 'Trip not found' };
        addReservation(action.tripId, action.reservation as any);
        return { ok: true };
      }
      case 'remove_reservation': {
        const trip = getTrip(action.tripId);
        if (!trip) return { ok: false, reason: 'Trip not found' };
        removeReservation(action.tripId, action.reservationId);
        return { ok: true };
      }
      case 'update_reservation': {
        const trip = getTrip(action.tripId);
        if (!trip) return { ok: false, reason: 'Trip not found' };
        const existing = (trip.reservations ?? []).find((r) => r.id === action.reservationId);
        if (!existing) return { ok: false, reason: 'Reservation not found' };
        updateReservation(action.tripId, { ...existing, ...action.updates } as any);
        return { ok: true };
      }

      // --- Activity lock ---
      case 'toggle_lock': {
        const trip = getTrip(action.tripId);
        if (!trip) return { ok: false, reason: 'Trip not found' };
        const target = trip.activities.find((a) => a.id === action.activityId);
        if (!target) return { ok: false, reason: 'Activity not found' };
        // Track if we're unlocking so subsequent actions on this activity can skip lock check
        if (target.locked && justUnlocked) {
          justUnlocked.add(action.activityId);
        }
        toggleLock(action.tripId, action.activityId);
        return { ok: true };
      }

      // --- Boards ---
      case 'save_to_board': {
        // Resolve board ID — AI may use a made-up ID for a board it just created
        let boardId = action.boardId;
        // If the boardId doesn't match any existing board, check if we just created one
        const knownBoard = boardsRef.current.find((b) => b.id === boardId);
        if (!knownBoard && idMap) {
          const mapped = idMap.get(boardId) || idMap.get('__last_created_board__');
          if (mapped) boardId = mapped;
        }
        addItemToBoard(boardId, action.item as any);
        return { ok: true };
      }
      case 'create_board': {
        const newBoardId = createBoard(action.name);
        // Sync ref immediately so subsequent actions can find this board
        const now = Date.now();
        boardsRef.current = [...boardsRef.current, { id: newBoardId, name: action.name, items: [], createdAt: now, updatedAt: now }];
        // Map any AI-invented board ID to the real one so subsequent save_to_board actions work
        if (idMap && (action as any).boardId) {
          idMap.set((action as any).boardId, newBoardId);
        }
        // Also map the board name as a fallback key — the AI may use the name as an ID
        if (idMap) {
          idMap.set(action.name, newBoardId);
          idMap.set('__last_created_board__', newBoardId);
        }
        return { ok: true };
      }
      case 'rename_board': {
        const board = boardsRef.current.find((b) => b.id === action.boardId);
        if (!board) return { ok: false, reason: 'Board not found' };
        renameBoard(action.boardId, action.name);
        return { ok: true };
      }
      case 'delete_board': {
        let delBoardId = action.boardId;
        let board = boardsRef.current.find((b) => b.id === delBoardId);
        // Fallback: if board not found by ID, try idMap's __last_created_board__
        if (!board && idMap) {
          const mapped = idMap.get(delBoardId) || idMap.get('__last_created_board__');
          if (mapped) {
            delBoardId = mapped;
            board = boardsRef.current.find((b) => b.id === delBoardId);
          }
        }
        // Last resort: try matching by board name from the action
        if (!board && (action as any).name) {
          board = boardsRef.current.find((b) => b.name.toLowerCase() === String((action as any).name).toLowerCase());
          if (board) delBoardId = board.id;
        }
        if (!board) return { ok: false, reason: 'Board not found' };
        deleteBoard(delBoardId);
        boardsRef.current = boardsRef.current.filter((b) => b.id !== delBoardId);
        return { ok: true };
      }
      case 'remove_board_item': {
        const board = boardsRef.current.find((b) => b.id === action.boardId);
        if (!board) return { ok: false, reason: 'Board not found' };
        const item = board.items.find((i) => i.id === action.itemId);
        if (!item) return { ok: false, reason: 'Item not found in board' };
        removeItemFromBoard(action.boardId, action.itemId);
        return { ok: true };
      }
      case 'move_board_to_trip': {
        const board = boardsRef.current.find((b) => b.id === action.boardId);
        if (!board) return { ok: false, reason: 'Board not found' };
        const trip = getTrip(action.tripId);
        if (!trip) return { ok: false, reason: 'Trip not found' };
        for (const itemId of action.itemIds) {
          const item = board.items.find((i) => i.id === itemId);
          if (item) {
            addActivity(action.tripId, {
              title: item.title,
              day: 1,
              time: '10:00',
              type: item.type,
              category: item.category,
              placeId: item.placeId,
              address: item.address,
              lat: item.lat,
              lng: item.lng,
              rating: item.rating,
              cost: item.cost,
            });
            markItemPlanned(action.boardId, itemId, action.tripId);
          }
        }
        return { ok: true };
      }

      // --- Profile ---
      case 'update_profile': {
        updateProfile(action.updates);
        return { ok: true };
      }

      // --- Navigation ---
      case 'navigate': {
        router.push(action.route as any);
        return { ok: true };
      }

      default:
        return { ok: false, reason: 'Unknown action type: ' + (action as any).type };
    }
  }

  function buildActionResult(action: TripAction, idMap?: Map<string, string>): ActionResult | null {
    // Helper to get trip name and route (use refs for latest state after mutations)
    const tripInfo = (tripId: string) => {
      const t = tripsRef.current.find((tr) => tr.id === tripId);
      const name = t?.title || t?.destination || 'trip';
      return { name, route: `/(tabs)/trip/${tripId}` };
    };

    switch (action.type) {
      case 'create_trip': {
        const dest = action.trip.destination;
        const createdId = idMap?.get('__last_created_trip__');
        const route = createdId ? `/(tabs)/trip/${createdId}` : `/(tabs)/trips`;
        return { label: 'Trip created', detail: `${action.trip.title || dest} — ${action.activities.length} activities`, route };
      }
      case 'update_trip': {
        const ti = tripInfo(action.tripId);
        return { label: 'Trip updated', detail: `${ti.name} — ${Object.keys(action.updates).join(', ')}`, route: ti.route };
      }
      case 'delete_trip':
        return { label: 'Trip deleted' };
      case 'add_activity': {
        const ti = tripInfo(action.tripId);
        return { label: 'Activity added', detail: `${action.activity.title} · Day ${action.activity.day} at ${action.activity.time}\n${ti.name}`, route: ti.route };
      }
      case 'remove_activity': {
        const ti = tripInfo(action.tripId);
        return { label: 'Activity removed', route: ti.route };
      }
      case 'update_activity': {
        const ti = tripInfo(action.tripId);
        return { label: 'Activity updated', route: ti.route };
      }
      case 'move_activity': {
        const ti = tripInfo(action.tripId);
        return { label: 'Activity moved', detail: `Day ${action.newDay} at ${action.newTime} · ${ti.name}`, route: ti.route };
      }
      case 'replace_activity': {
        const ti = tripInfo(action.tripId);
        return { label: 'Activity replaced', detail: `${action.newActivity.title} · ${ti.name}`, route: ti.route };
      }
      case 'swap_days': {
        const ti = tripInfo(action.tripId);
        return { label: 'Days swapped', detail: `Day ${action.day1} ↔ Day ${action.day2} · ${ti.name}`, route: ti.route };
      }
      case 'add_reservation': {
        const ti = tripInfo(action.tripId);
        const r = action.reservation;
        const when = r.day ? `Day ${r.day}` : '';
        const time = r.time ? ` at ${r.time}` : '';
        return { label: 'Reservation added', detail: `${r.title}${when ? ' · ' + when : ''}${time}\n${ti.name}`, route: ti.route };
      }
      case 'remove_reservation': {
        const ti = tripInfo(action.tripId);
        return { label: 'Reservation removed', route: ti.route };
      }
      case 'update_reservation': {
        const ti = tripInfo(action.tripId);
        return { label: 'Reservation updated', detail: `${Object.keys(action.updates).join(', ')} · ${ti.name}`, route: ti.route };
      }
      case 'toggle_lock': {
        const ti = tripInfo(action.tripId);
        const act = tripsRef.current.find((t) => t.id === action.tripId)?.activities.find((a) => a.id === action.activityId);
        // State hasn't updated yet, so locked value is pre-toggle — invert the label
        const wasLocked = act?.locked;
        return { label: wasLocked ? 'Activity unlocked' : 'Activity locked', detail: `${act?.title ?? ''} · ${ti.name}`, route: ti.route };
      }
      case 'save_to_board': {
        const board = boardsRef.current.find((b) => b.id === action.boardId);
        return { label: 'Saved to board', detail: `${action.item.title} → ${board?.name || 'board'}` };
      }
      case 'create_board':
        return { label: 'Board created', detail: action.name };
      case 'rename_board': {
        return { label: 'Board renamed', detail: action.name };
      }
      case 'delete_board': {
        return { label: 'Board deleted' };
      }
      case 'remove_board_item': {
        const board = boardsRef.current.find((b) => b.id === action.boardId);
        return { label: 'Item removed from board', detail: board?.name || 'board' };
      }
      case 'move_board_to_trip': {
        const ti = tripInfo(action.tripId);
        return { label: 'Added to trip', detail: `${action.itemIds.length} place${action.itemIds.length > 1 ? 's' : ''} → ${ti.name}`, route: ti.route };
      }
      case 'update_profile':
        return { label: 'Profile updated', detail: Object.keys(action.updates).join(', ') };
      case 'navigate':
        return null;
      default:
        return null;
    }
  }

  function handleConfirmAction(msgId: string) {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msgId);
      if (idx < 0) return prev;
      const msg = prev[idx];
      if (!msg.pendingActions?.length) return prev;

      // Reconstruct idMap from safe actions that ran before confirmation
      const idMap = msg.pendingIdMap ? new Map(Object.entries(msg.pendingIdMap)) : new Map<string, string>();

      const results: ActionResult[] = [...(msg.actionResults ?? [])];
      const justUnlocked = new Set<string>();
      const failures: string[] = [];
      for (const action of msg.pendingActions) {
        // Remap IDs from earlier safe actions (e.g., board created then deleted)
        if ('boardId' in action && action.boardId && idMap.has(action.boardId)) {
          (action as any).boardId = idMap.get(action.boardId);
        }
        if ('tripId' in action && action.tripId && idMap.has(action.tripId)) {
          (action as any).tripId = idMap.get(action.tripId);
        }
        const r = applyTripAction(action, idMap, justUnlocked);
        if (!r.ok && r.reason) {
          failures.push(r.reason);
        } else {
          const ar = buildActionResult(action, idMap);
          if (ar) results.push(ar);
        }
      }

      const updated = { ...msg, pendingActions: undefined, pendingIdMap: undefined, actionResults: results.length > 0 ? results : undefined };
      if (failures.length > 0) {
        updated.text += '\n\n' + failures.join('; ');
      }
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleCancelAction(msgId: string) {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msgId);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...prev[idx], pendingActions: undefined };
      return next;
    });
  }

  function handleTripPick(msgId: string, tripId: string) {
    // Find the original message, clear the picker, then re-send with selected trip
    const msg = messages.find((m) => m.id === msgId);
    const originalText = msg?.tripPickerMessage ?? '';
    const trip = trips.find((t) => t.id === tripId);
    const tripLabel = trip?.title || trip?.destination || 'trip';

    // Clear the picker card
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msgId);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...prev[idx], tripPickerMessage: undefined, text: `Got it — ${tripLabel}!` };
      return next;
    });

    // Update selected trip for future messages
    setSelectedTripId(tripId);

    // Re-send with the trip ID passed directly (don't rely on state update)
    if (originalText) {
      sendMessage(originalText, tripId);
    }
  }

  async function sendMessage(text: string, overrideTripId?: string, retryCount = 0) {
    if (!text.trim()) return;
    if (isTyping && retryCount === 0) return;
    // Gate check — show limit message inline if blocked
    if (!chatGate.allowed) {
      const limitMsg: Message = {
        id: generateId(),
        role: 'assistant',
        text: chatGate.isPlus
          ? 'You\u2019ve used all 50 AI messages this month. Your allowance resets next billing cycle.'
          : 'You\u2019ve used your 10 free messages this month. Upgrade to Travonal+ for 50 messages per month.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, { id: generateId(), role: 'user', text: text.trim(), timestamp: Date.now() }, limitMsg]);
      setInput('');
      return;
    }

    // On first attempt, add user message and haptic; on retry, skip (already shown)
    if (retryCount === 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const userMsg: Message = { id: generateId(), role: 'user', text: text.trim(), timestamp: Date.now() };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
    }
    setIsTyping(true);

    // Build conversation history (last 10 messages for context)
    const history = messages.slice(-10).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.text,
    }));

    // Resolve the trip most relevant to this message
    const effectiveTripId = overrideTripId || selectedTripId;
    const mentionedTrip = resolveMentionedTrip(text, trips, getTripState, effectiveTripId, lastActedTripId);

    // If multiple trips and none resolved, ask the user to pick before calling AI
    const relevantTrips = trips.filter((t) => {
      const s = getTripState(t);
      return s !== 'past';
    });
    if (!mentionedTrip && relevantTrips.length > 1) {
      const pickerMsg: Message = {
        id: generateId(),
        role: 'assistant',
        text: "Sure! Which trip is this for?",
        tripPickerMessage: text.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, pickerMsg]);
      setIsTyping(false);
      return;
    }

    try {
      const result = await chatAI({
        message: text.trim(),
        history,
        tripContext: context,
        profile,
        activeTripId: mentionedTrip?.id,
        activeTrip: mentionedTrip,
      });

      // Fix up tripIds: if the AI used a tripId that doesn't match any real trip,
      // substitute the resolved mentionedTrip's ID (the AI often fabricates or picks wrong IDs).
      // Also fix actions that have NO tripId at all (AI omitted it).
      if (result.actions) {
        const fallbackTripId = mentionedTrip?.id || lastActedTripId;
        for (const action of result.actions) {
          if (action.type === 'create_trip') continue;
          const needsTripId = ['add_activity', 'remove_activity', 'update_activity', 'move_activity', 'replace_activity', 'swap_days', 'update_trip', 'delete_trip', 'add_reservation', 'update_reservation', 'remove_reservation', 'toggle_lock', 'move_board_to_trip'];
          if (!needsTripId.includes(action.type)) continue;
          const currentTripId = (action as any).tripId;
          if (!currentTripId && fallbackTripId) {
            // AI omitted tripId entirely — inject fallback
            (action as any).tripId = fallbackTripId;
          } else if (currentTripId) {
            const exists = trips.some((t) => t.id === currentTripId);
            if (!exists && fallbackTripId) {
              (action as any).tripId = fallbackTripId;
            }
          }
        }
      }

      // Separate destructive actions that need confirmation
      const destructiveTypes = new Set(['delete_trip', 'swap_days', 'delete_board']);
      const safeActions = (result.actions ?? []).filter((a) => !destructiveTypes.has(a.type));
      const dangerousActions = (result.actions ?? []).filter((a) => destructiveTypes.has(a.type));

      // Execute safe actions immediately
      // Track ID mappings for newly created resources so subsequent actions can reference them
      const idMap = new Map<string, string>();
      const justUnlocked = new Set<string>();
      const failures: string[] = [];
      const results: ActionResult[] = [];
      for (const action of safeActions) {
        // Remap IDs: if the AI used a placeholder board/trip ID that we created earlier, swap it
        if ('boardId' in action && action.boardId && idMap.has(action.boardId)) {
          (action as any).boardId = idMap.get(action.boardId);
        }
        if ('tripId' in action && action.tripId && idMap.has(action.tripId)) {
          (action as any).tripId = idMap.get(action.tripId);
        }
        const r = applyTripAction(action, idMap, justUnlocked);
        if (!r.ok && r.reason) {
          failures.push(r.reason);
        } else {
          const ar = buildActionResult(action, idMap);
          if (ar) results.push(ar);
        }
      }

      // Track the last trip that was acted on so follow-up messages resolve to it
      const actedTripId = safeActions.find((a) => 'tripId' in a && a.tripId)?.tripId
        || (idMap.size > 0 ? Array.from(idMap.values()).pop() : undefined);
      if (actedTripId) setLastActedTripId(actedTripId);

      if (failures.length > 0) {
        const failMsg: Message = {
          id: generateId(),
          role: 'assistant',
          text: result.message + "\n\nSome actions couldn't be completed: " + failures.join('; ') + '.',
          actionResults: results.length > 0 ? results : undefined,
          suggestions: result.suggestions,
          context: result.context,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, failMsg]);
      } else if (dangerousActions.length > 0) {
        // Show confirmation card for destructive actions
        // Strip "done" language from message since destructive actions haven't run yet
        let adjustedMessage = result.message;
        const pendingLabels = dangerousActions.map((a) => {
          if (a.type === 'delete_trip') return 'delete the trip';
          if (a.type === 'delete_board') return 'delete the board';
          if (a.type === 'swap_days') return 'swap the days';
          return a.type;
        });
        if (results.length > 0) {
          // Safe actions ran but destructive ones are pending — clarify what's waiting
          adjustedMessage = adjustedMessage.replace(/(?:done|completed|finished)[!.]?\s*/i, '');
          adjustedMessage += '\n\nAwaiting your confirmation to ' + pendingLabels.join(' and ') + '.';
        }
        const assistantMsg: Message = {
          id: generateId(),
          role: 'assistant',
          text: adjustedMessage,
          places: result.places,
          actionResults: results.length > 0 ? results : undefined,
          pendingActions: dangerousActions,
          pendingIdMap: idMap.size > 0 ? Object.fromEntries(idMap) : undefined,
          suggestions: result.suggestions,
          context: result.context,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const assistantMsg: Message = {
          id: generateId(),
          role: 'assistant',
          text: result.message,
          places: result.places,
          actionResults: results.length > 0 ? results : undefined,
          suggestions: result.suggestions,
          context: result.context,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }

      // Legacy command routing removed — actions are now handled via AI action system
    } catch (err) {
      const isUsageLimit = (err as any)?.code === 'USAGE_LIMIT';
      const errorDetail = err instanceof Error ? err.message : String(err);
      const errMsg: Message = {
        id: generateId(),
        role: 'assistant',
        text: isUsageLimit
          ? String((err as any).message ?? 'Message limit reached. Upgrade to Travonal+ for more.')
          : "Something went wrong — trying again...",
        timestamp: Date.now(),
        failed: !isUsageLimit,
      };
      if (isUsageLimit) {
        setMessages((prev) => [...prev, errMsg]);
        refreshSubscription();
      } else if (retryCount < 1) {
        // Auto-retry once on transient errors
        console.warn('[chat] Retrying after error:', errorDetail);
        setIsTyping(false);
        sendMessage(text, overrideTripId, retryCount + 1);
        return;
      } else {
        console.error('[chat] Failed after retry:', errorDetail);
        errMsg.text = "Sorry, I couldn't complete that action. Please try again.";
        setMessages((prev) => [...prev, errMsg]);
      }
    } finally {
      setIsTyping(false);
    }
  }

  function retryLastMessage() {
    // Find the last user message, remove the failed response, and re-send
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    const lastUserText = messages[lastUserIdx].text;
    // Remove the failed assistant message(s) after the last user message
    setMessages((prev) => prev.slice(0, lastUserIdx));
    sendMessage(lastUserText);
  }

  // Auto-send initial message from home screen
  const initialSent = useRef(false);
  useEffect(() => {
    if (loaded && initialMessage && !initialSent.current) {
      initialSent.current = true;
      sendMessage(initialMessage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, initialMessage]);

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isUser = item.role === 'user';
    // Only animate messages that were added after initial load
    const shouldAnimate = index >= loadedMsgCount.current;
    const timeStr = item.timestamp
      ? new Date(item.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : null;
    const isLastAssistant = !isUser && index === messages.length - 1;

    const content = (
      <>
        <View
          style={[
            styles.messageBubble,
            isUser
              ? [styles.userBubble, { backgroundColor: theme.primary }]
              : [styles.assistantBubble, { backgroundColor: theme.backgroundElement, borderColor: theme.border }],
          ]}
        >
          {!isUser && (
            <ThemedText style={styles.assistantLabel}>Travonal</ThemedText>
          )}
          <ChatMarkdown text={item.text} isUser={isUser} />
        </View>
        {timeStr && (
          <ThemedText style={[styles.messageTime, { color: theme.textSecondary }, isUser && styles.messageTimeUser]}>
            {timeStr}
          </ThemedText>
        )}

        {/* Retry button for failed messages */}
        {item.failed && (
          <Pressable
            onPress={retryLastMessage}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Retry message"
          >
            <SymbolView name="arrow.clockwise" size={13} tintColor="#E53935" />
            <ThemedText style={styles.retryText}>Tap to retry</ThemedText>
          </Pressable>
        )}

        {/* Place cards — horizontal carousel */}
        {!isUser && item.places && item.places.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.placeCardsContainer}
            style={styles.placeCardsScroll}
          >
            {item.places.slice(0, 5).map((place, i) => (
              <ChatPlaceCard
                key={place.placeId || `p${i}`}
                place={place}
                isPrimary={i === 0}
                onAddToTrip={() => handleAddToTrip(place)}
                onSaveToBoard={() => handleSaveToBoard(place)}
              />
            ))}
          </ScrollView>
        )}

        {/* Action result cards */}
        {!isUser && item.actionResults && item.actionResults.length > 0 && (
          <View style={styles.placeCardsContainer}>
            {item.actionResults.map((ar, i) => (
              <ActionResultCard key={`ar${i}`} result={ar} theme={theme} />
            ))}
          </View>
        )}

        {/* Confirmation card for destructive actions */}
        {!isUser && item.pendingActions && item.pendingActions.length > 0 && (
          <ConfirmationCard
            message=""
            actions={item.pendingActions}
            theme={theme}
            onConfirm={() => handleConfirmAction(item.id)}
            onCancel={() => handleCancelAction(item.id)}
          />
        )}

        {/* Trip picker card — shown when user needs to pick a trip first */}
        {!isUser && item.tripPickerMessage && (
          <TripPickerCard
            trips={trips.filter((t) => getTripState(t) !== 'past')}
            theme={theme}
            onSelect={(tripId) => handleTripPick(item.id, tripId)}
          />
        )}

        {/* Follow-up suggestion chips — only on the last assistant message */}
        {isLastAssistant && item.suggestions && item.suggestions.length > 0 && !isTyping && (
          <View style={styles.followUpChipsWrap}>
            <View style={styles.followUpChipsRow}>
              {item.suggestions.slice(0, 4).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => sendMessage(s)}
                  style={({ pressed }) => [
                    styles.followUpChip,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={s}
                >
                  <ThemedText style={[styles.followUpChipText, { color: theme.primary }]}>{s}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </>
    );

    if (shouldAnimate) {
      return <Animated.View entering={FadeInDown.duration(200).delay(index === 0 ? 0 : 50)}>{content}</Animated.View>;
    }
    return <View>{content}</View>;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, messages.length, isTyping]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header — outside KAV so keyboard offset is accurate */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable
          onPress={() => {
            setMessages([]);
            setActiveThreadId(null);
            setInput('');
            setIsTyping(false);
          }}
          style={styles.backButton}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="New chat"
        >
          <SymbolView name="square.and.pencil" size={20} tintColor={theme.primary} />
        </Pressable>
        <Pressable
          onPress={() => {
            const relevant = trips.filter((t) => getTripState(t) !== 'past');
            if (relevant.length >= 1) setShowTripSelector((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityLabel="Select trip context"
          style={styles.headerTitleBtn}
        >
          <ThemedText style={styles.headerTitle} numberOfLines={1}>
            {activeThreadId ? (threads.find((t) => t.id === activeThreadId)?.title ?? 'Ask Travonal') : 'Ask Travonal'}
          </ThemedText>
          {(() => {
            const sel = selectedTripId ? trips.find((t) => t.id === selectedTripId) : undefined;
            const relevant = trips.filter((t) => getTripState(t) !== 'past');
            return sel ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <ThemedText style={[styles.headerSubtitle, { color: theme.primary }]}>
                  {sel.destination}
                </ThemedText>
                <SymbolView name="chevron.down" size={10} tintColor={theme.primary} />
              </View>
            ) : relevant.length >= 1 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <ThemedText style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
                  All trips
                </ThemedText>
                <SymbolView name="chevron.down" size={10} tintColor={theme.textSecondary} />
              </View>
            ) : null;
          })()}
        </Pressable>
        <Pressable
          onPress={() => setShowThreadList(true)}
          style={styles.newChatButton}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Chat history"
        >
          <SymbolView name="line.3.horizontal" size={24} tintColor={theme.primary} />
        </Pressable>
      </View>

      {/* Trip selector dropdown */}
      {showTripSelector && (
        <>
          <Pressable
            style={styles.tripSelectorBackdrop}
            onPress={() => setShowTripSelector(false)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss trip selector"
          />
          <Animated.View entering={FadeIn.duration(150)} style={[styles.tripSelector, { backgroundColor: theme.backgroundElement, borderColor: theme.border, top: insets.top + 52 }]}>
            <Pressable
              onPress={() => { setSelectedTripId(undefined); setShowTripSelector(false); }}
              style={[styles.tripSelectorRow, { borderBottomColor: theme.border }]}
            >
              <ThemedText style={[styles.tripSelectorText, !selectedTripId && { color: theme.primary, fontWeight: '700' }]}>
                All trips
              </ThemedText>
            </Pressable>
            {trips.filter((t) => getTripState(t) !== 'past').map((t) => (
              <Pressable
                key={t.id}
                onPress={() => { setSelectedTripId(t.id); setShowTripSelector(false); }}
                style={[styles.tripSelectorRow, { borderBottomColor: theme.border }]}
              >
                <ThemedText style={[styles.tripSelectorText, selectedTripId === t.id && { color: theme.primary, fontWeight: '700' }]}>
                  {t.destination}
                </ThemedText>
              </Pressable>
            ))}
          </Animated.View>
        </>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Message list + input shrink together when keyboard appears */}
        <View style={{ flex: 1 }}>
          {/* Empty state or message thread */}
          {isEmptyState && loaded ? (() => {
            const suggestions = getContextualSuggestions(trips, getTripState, boards, selectedTripId);
            return (
            <Pressable style={styles.emptyState} onPress={() => Keyboard.dismiss()}>
              <Animated.View entering={FadeIn.duration(400)} style={styles.emptyContent}>
                <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
                  {getGreeting(userName)}
                </ThemedText>
                <ThemedText style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                  {getSubtitle(trips, getTripState, boards, selectedTripId)}
                </ThemedText>

                <Animated.View entering={FadeInDown.delay(100).duration(300)} style={styles.emptySuggestionsWrap}>
                  <View style={styles.emptySuggestionsRow}>
                    {suggestions.slice(0, 2).map((s) => (
                      <Pressable
                        key={s.text}
                        onPress={() => sendMessage(s.text)}
                        style={({ pressed }) => [
                          styles.emptySuggestionPill,
                          { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={s.text}
                      >
                        <ThemedText style={[styles.emptySuggestionText, { color: theme.primary }]}>{s.text}</ThemedText>
                      </Pressable>
                    ))}
                  </View>
                  {suggestions[2] && (
                  <View style={styles.emptySuggestionsRow}>
                    <Pressable
                      onPress={() => sendMessage(suggestions[2].text)}
                      style={({ pressed }) => [
                        styles.emptySuggestionPill,
                        { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={suggestions[2].text}
                    >
                      <ThemedText style={[styles.emptySuggestionText, { color: theme.primary }]}>{suggestions[2].text}</ThemedText>
                    </Pressable>
                  </View>
                  )}
                </Animated.View>
              </Animated.View>
            </Pressable>
            );
          })() : (
            <FlatList
              ref={listRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              contentContainerStyle={[styles.messageList, { paddingBottom: 20 }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                isNearBottom.current = (contentSize.height - contentOffset.y - layoutMeasurement.height) < 150;
              }}
              scrollEventThrottle={100}
              onContentSizeChange={() => {
                if (isNearBottom.current) listRef.current?.scrollToEnd({ animated: true });
              }}
              onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
              removeClippedSubviews={Platform.OS !== 'web'}
              windowSize={10}
              maxToRenderPerBatch={8}
              initialNumToRender={15}
              ListFooterComponent={isTyping ? (
                <Animated.View entering={FadeIn.duration(200)} style={styles.typingRow}>
                  <TypingIndicator userMessage={messages.filter((m) => m.role === 'user').pop()?.text} />
                </Animated.View>
              ) : null}
            />
          )}


          {/* Input bar */}
          <View style={[styles.inputBar, { borderTopColor: theme.border, paddingBottom: keyboardVisible ? 8 : insets.bottom + 8 }]}>
          <TextInput
            ref={chatInputRef}
            style={[styles.textInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything about your trips..."
            placeholderTextColor={theme.textSecondary}
            multiline
            blurOnSubmit={false}
          />
          <Pressable
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || isTyping}
            style={({ pressed }) => [
              styles.sendButton,
              {
                backgroundColor: theme.primary,
                opacity: (!input.trim() || isTyping) ? 0.4 : pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <SymbolView name="arrow.up" size={18} tintColor={theme.primaryText} />
          </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Chat history modal */}
      <Modal visible={showThreadList} transparent animationType="fade" onRequestClose={() => setShowThreadList(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.threadBackdrop} onPress={() => setShowThreadList(false)} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Pressable
            style={[styles.threadSheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 }]}
            onPress={(e) => e.stopPropagation()}
            accessibilityRole="button"
            accessibilityLabel="Chat history"
          >
            <View style={[styles.threadHandle, { backgroundColor: theme.border }]} />
            <ThemedText type="subtitle" style={styles.threadSheetTitle}>Your chats</ThemedText>

            {/* New chat button */}
            <Pressable
              onPress={handleNewConversation}
              style={({ pressed }) => [styles.threadNewBtn, { backgroundColor: theme.primaryMuted, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
            >
              <SymbolView name="plus" size={16} tintColor={theme.primary} />
              <ThemedText style={[styles.threadNewBtnText, { color: theme.primary }]}>New chat</ThemedText>
            </Pressable>

            <ScrollView style={styles.threadList} showsVerticalScrollIndicator={false}>
              {threads.length === 0 && (
                <ThemedText style={[styles.threadEmpty, { color: theme.textSecondary }]}>No previous chats</ThemedText>
              )}
              {[...threads].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).map((thread) => {
                const isExpanded = threadOptionsId === thread.id;
                const isRenaming = renameThreadId === thread.id;
                return (
                <View
                  key={thread.id}
                  style={[
                    styles.threadCard,
                    { backgroundColor: activeThreadId === thread.id ? theme.primaryMuted : theme.backgroundElement, borderColor: theme.border },
                  ]}
                >
                  {/* Row: icon + title + date + dots */}
                  <View style={styles.threadRow}>
                    <Pressable
                      onPress={() => loadThread(thread)}
                      style={({ pressed }) => [styles.threadRowContent, { opacity: pressed ? 0.7 : 1 }]}
                      accessibilityRole="button"
                      accessibilityLabel={thread.title}
                    >
                      <SymbolView name={thread.pinned ? 'pin.fill' : 'bubble.left'} size={16} tintColor={thread.pinned ? theme.primary : theme.textSecondary} />
                      <View style={styles.threadRowText}>
                        <ThemedText style={styles.threadTitle} numberOfLines={1}>{thread.title}</ThemedText>
                        <ThemedText style={[styles.threadDate, { color: theme.textSecondary }]}>
                          {new Date(thread.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </ThemedText>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => setThreadOptionsId(isExpanded ? null : thread.id)}
                      style={styles.threadDotsBtn}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Chat options"
                    >
                      <SymbolView name="ellipsis" size={18} tintColor={theme.textSecondary} />
                    </Pressable>
                  </View>

                  {/* Options inside the card */}
                  {isExpanded && (
                    <Animated.View entering={FadeIn.duration(150)}>
                      <View style={[styles.threadOptionDivider, { backgroundColor: theme.border }]} />
                      <Pressable
                        onPress={() => startRenameThread(thread.id)}
                        style={({ pressed }) => [styles.threadOptionBtn, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                      >
                        <SymbolView name="pencil" size={15} tintColor={theme.text} />
                        <ThemedText style={styles.threadOptionText}>Rename</ThemedText>
                      </Pressable>
                      <View style={[styles.threadOptionDivider, { backgroundColor: theme.border }]} />
                      <Pressable
                        onPress={() => togglePinThread(thread.id)}
                        style={({ pressed }) => [styles.threadOptionBtn, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                      >
                        <SymbolView name={thread.pinned ? 'pin.slash' : 'pin'} size={15} tintColor={theme.text} />
                        <ThemedText style={styles.threadOptionText}>{thread.pinned ? 'Unpin' : 'Pin'}</ThemedText>
                      </Pressable>
                      <View style={[styles.threadOptionDivider, { backgroundColor: theme.border }]} />
                      <Pressable
                        onPress={() => {
                          Alert.alert('Delete chat?', `"${thread.title}"`, [
                            { text: 'Cancel', style: 'cancel', onPress: () => setThreadOptionsId(null) },
                            { text: 'Delete', style: 'destructive', onPress: () => deleteThread(thread.id) },
                          ]);
                        }}
                        style={({ pressed }) => [styles.threadOptionBtn, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                      >
                        <SymbolView name="trash" size={15} tintColor="#E53935" />
                        <ThemedText style={[styles.threadOptionText, { color: '#E53935' }]}>Delete</ThemedText>
                      </Pressable>
                    </Animated.View>
                  )}

                  {/* Rename inline input inside the card */}
                  {isRenaming && (
                    <Animated.View entering={FadeIn.duration(150)}>
                      <View style={[styles.threadOptionDivider, { backgroundColor: theme.border }]} />
                      <View style={styles.threadRenameRow}>
                        <TextInput
                          value={renameText}
                          onChangeText={setRenameText}
                          style={[styles.threadRenameInput, { color: theme.text }]}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={confirmRename}
                          selectTextOnFocus
                        />
                        <Pressable onPress={confirmRename} disabled={!renameText.trim()} accessibilityRole="button">
                          <SymbolView name="checkmark.circle.fill" size={26} tintColor={renameText.trim() ? theme.primary : theme.border} />
                        </Pressable>
                        <Pressable onPress={() => { setRenameThreadId(null); setRenameText(''); }} accessibilityRole="button">
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

      <BoardPicker
        visible={boardPickerVisible}
        onSelect={handleBoardSelected}
        onClose={() => { setBoardPickerVisible(false); setPendingBoardPlace(null); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: 44, alignItems: 'flex-start' as const },
  newChatButton: { width: 44, alignItems: 'flex-end' as const },
  headerTitleBtn: { alignItems: 'center', flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSubtitle: { fontSize: 12, marginTop: 1 },
  tripSelectorBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99,
  },
  tripSelector: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 100,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tripSelectorRow: {
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tripSelectorText: { fontSize: 15 },

  // Messages
  messageList: {
    paddingHorizontal: Spacing.four,
    paddingTop: 16,
    gap: 12,
  },
  messageBubble: {
    maxWidth: '82%',
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  assistantLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.5,
  },
  messageTime: {
    fontSize: 10,
    marginTop: 3,
    alignSelf: 'flex-start',
    marginLeft: 4,
  },
  messageTimeUser: {
    alignSelf: 'flex-end',
    marginLeft: 0,
    marginRight: 4,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginLeft: Spacing.four,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#E53935',
  },
  // Place cards
  placeCardsScroll: {
    marginTop: 8,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  placeCardsContainer: {
    gap: 10,
    paddingRight: 4,
  },

  // Context label
  contextLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
    marginLeft: 4,
  },
  contextLabelText: {
    fontSize: 11,
    fontWeight: '500',
    fontStyle: 'italic',
  },

  // Follow-up suggestion chips
  followUpChipsWrap: {
    marginTop: 10,
    alignSelf: 'flex-start',
    maxWidth: '92%',
  },
  followUpChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  followUpChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.xl,
    borderWidth: 1,
  },
  followUpChipText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Typing
  typingRow: {
    paddingTop: 8,
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: '25%',
  },
  emptyContent: {
    alignItems: 'center',
    gap: 6,
    overflow: 'visible',
  },
  emptyTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 34,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    marginBottom: 20,
    paddingHorizontal: Spacing.four,
    textAlign: 'center',
  },
  emptySuggestionsWrap: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  emptySuggestionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: Spacing.four,
  },
  emptySuggestionPill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.xl,
    borderWidth: 1,
  },
  emptySuggestionText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Thread list
  threadBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  threadSheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: 12,
    paddingHorizontal: Spacing.four,
    maxHeight: '70%',
  },
  threadHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  threadSheetTitle: {
    textAlign: 'center',
    marginBottom: 16,
  },
  threadNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: Radius.md,
    marginBottom: 12,
  },
  threadNewBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  threadList: {
    maxHeight: 400,
  },
  threadCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden',
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  threadRowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 4,
  },
  threadDotsBtn: {
    padding: 12,
  },
  threadRowText: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  threadTitle: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  threadDate: {
    fontSize: 12,
  },
  threadEmpty: {
    textAlign: 'center',
    paddingVertical: 24,
    fontSize: 14,
  },
  threadOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  threadOptionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  threadOptionDivider: {
    height: StyleSheet.hairlineWidth,
  },
  threadRenameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  threadRenameInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 4,
  },

  // Input
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.four,
    paddingTop: 10,
    gap: 10,
  },
  textInput: {
    flex: 1,
    borderRadius: Radius.sheet,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    fontSize: 18,
    fontWeight: '700',
  },
});
