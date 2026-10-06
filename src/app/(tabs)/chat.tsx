import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';
import React, { useCallback, useEffect, memo, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
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
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';

import { ThemedText } from '@/components/themed-text';
import { ChatMarkdown } from '@/components/chat-markdown';
import { BoardPicker } from '@/components/board-picker';
import { Radius, Spacing } from '@/constants/theme';
import { useProfile } from '@/context/profile';
import { useTrips, getLastViewedTripId } from '@/context/trips';
import { useBoards } from '@/context/boards';
import { useInbox } from '@/context/inbox';
import { useMemory } from '@/context/memory';
import { useTheme } from '@/hooks/use-theme';
import { loadChatMessages, saveChatMessages, loadChatThreads, saveChatThreads } from '@/services/storage';
import { pushChatThreads, pullChatThreads } from '@/services/sync';
import { chatAI, type TripAction, type ChatPlace } from '@/services/ai';
import { ChatPlaceCard, placeStyles } from '@/components/chat-place-card';
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
): { icon: string; text: string }[] {
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
      if (!hasHotel) chips.push({ icon: 'bed.double.fill', text: 'Where to stay?' });
      return chips;
    }
    if (!hasHotel) {
      return [
        { icon: 'bed.double.fill', text: 'Where to stay?' },
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
      { icon: 'arrow.triangle.swap', text: 'Similar destination' },
      { icon: 'mappin.and.ellipse', text: 'Where to go?' },
    ];
  }

  return [
    { icon: 'airplane', text: 'Plan my first trip' },
    { icon: 'mappin.and.ellipse', text: 'Where should I go?' },
    { icon: 'sparkles', text: 'Surprise me' },
  ];
}

const TRAVEL_GREETINGS = [
  'Where to today',
  "What's the plan",
  'Ready to explore',
  "Where are we headed",
  "What's next",
  "Let's go somewhere",
  'Where to next',
  'What are we doing',
];

// Stable per-session random index
const _greetingIndex = Math.floor(Math.random() * TRAVEL_GREETINGS.length);

function getGreeting(
  name: string,
  trips: ReturnType<typeof useTrips>['trips'],
  getTripState: ReturnType<typeof useTrips>['getTripState'],
): string {
  const activeTrips = trips.filter((t) => getTripState(t) === 'active');
  const upcomingTrips = trips.filter((t) => getTripState(t) === 'upcoming').sort((a, b) => a.startDate.localeCompare(b.startDate));

  if (activeTrips.length > 0) {
    const dest = activeTrips[0].destination.split(',')[0];
    return `How's ${dest}, ${name}?`;
  }
  if (upcomingTrips.length > 0) {
    const t = upcomingTrips[0];
    const daysUntil = Math.ceil((new Date(t.startDate).getTime() - Date.now()) / 86400000);
    const dest = t.destination.split(',')[0];
    if (daysUntil <= 1) return `${dest} is tomorrow, ${name}!`;
    if (daysUntil <= 7) return `${dest} in ${daysUntil} days, ${name}!`;
    return `Planning ${dest}, ${name}?`;
  }

  return `${TRAVEL_GREETINGS[_greetingIndex]}, ${name}?`;
}

function getSubtitle(
  trips: ReturnType<typeof useTrips>['trips'],
  getTripState: ReturnType<typeof useTrips>['getTripState'],
  boards: ReturnType<typeof useBoards>['boards'],
): string {
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
    return "You've got places saved. Ask me anything — I know your boards, trips, and preferences.";
  }

  return "Ask me anything about travel. I know your whole account.";
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}


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

  // Full profile — only include fields the user explicitly set in the survey
  const profileParts: string[] = [];
  if (profile.budget) profileParts.push(`budget=${profile.budget}`);
  if (profileParts.length) lines.push(`\nTraveler profile: ${profileParts.join(', ')}`);
  else lines.push(`\nTraveler profile:`);
  // Note: pace, flexibility, accommodationPreference are legacy fields not shown in survey — omit from AI context
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
  if (profile.decisionPriorities?.length) lines.push(`What they look for in a place: ${profile.decisionPriorities.join(', ')}`);
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

  // Memory — grouped by category for stronger signal
  if (memoryEntries.length) {
    lines.push('\nTravel preferences learned:');
    const grouped = new Map<string, string[]>();
    for (const e of memoryEntries) {
      const key = e.category ?? 'general';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(e.detail);
    }
    for (const [category, details] of grouped) {
      lines.push(`[${category}] (${details.length} signal${details.length > 1 ? 's' : ''}):`);
      for (const d of details) {
        lines.push(`  - ${d}`);
      }
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
  _unused?: string,
  lastActedTripId?: string,
): (typeof trips)[0] | undefined {
  const lower = userMessage.toLowerCase();
  // Include all non-past trips: active, upcoming, planned (TBD dates), and draft
  const relevantTrips = trips.filter((t) => {
    const state = getTripState(t);
    return state !== 'past';
  });

  // Check if the message mentions any trip by title, destination, or country.
  // Also try the city portion of destination (before first comma) so "Paris"
  // matches a destination stored as "Paris, France".
  for (const trip of relevantTrips) {
    const cityPart = trip.destination?.split(',')[0]?.trim();
    const candidates = [
      trip.title,
      trip.destination,
      trip.country,
      cityPart,
    ].filter(Boolean).map((s) => s!.toLowerCase());
    if (candidates.some((c) => c.length > 1 && lower.includes(c))) return trip;
  }

  // If the user just acted on a trip (created, modified), continue with that one
  if (lastActedTripId) {
    const lastActed = relevantTrips.find((t) => t.id === lastActedTripId);
    if (lastActed) return lastActed;
  }

  // Fall back to the last trip the user was viewing (e.g. switched from trip page)
  const lastViewedId = getLastViewedTripId();
  if (lastViewedId) {
    const lastViewed = relevantTrips.find((t) => t.id === lastViewedId);
    if (lastViewed) return lastViewed;
  }

  // Only one non-past trip — use it unambiguously
  if (relevantTrips.length === 1) return relevantTrips[0];

  // Multiple trips, no explicit mention — don't guess
  return undefined;
}


export default function ChatScreen() {
  const { context: placeContext, message: initialMessage, autoFocus: autoFocusParam } = useLocalSearchParams<{ context?: string; tripId?: string; message?: string; autoFocus?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { trips, getTripState, getTrip, addActivity, removeActivity, updateActivity, moveActivity, replaceActivity, setTripActivities, addTripWithActivities, updateTrip, deleteTrip, addReservation, updateReservation, removeReservation, toggleLock } = useTrips();
  const { profile, updateProfile } = useProfile();
  const { getActiveEntries, addEntry: addMemoryEntry } = useMemory();
  const { boards, addItemToBoard, createBoard, deleteBoard, renameBoard, removeItemFromBoard, markItemPlanned } = useBoards();
  const { savedPlaces } = useInbox();
  const { user } = useAuth();
  const userName = (user?.user_metadata?.full_name as string | undefined) || formatUserName(user?.email);

  const chatGate = useGate('chat');
  const { refresh: refreshSubscription } = useSubscription();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; city?: string } | undefined>();
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
  const [threadOptionsRenaming, setThreadOptionsRenaming] = useState(false);
  const listRef = useRef<FlatList>(null);
  const chatInputRef = useRef<TextInput>(null);
  const chatSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tripsRef = useRef(trips);
  useEffect(() => { tripsRef.current = trips; }, [trips]);
  const boardsRef = useRef(boards);
  useEffect(() => { boardsRef.current = boards; }, [boards]);
  // Track scroll position for smart auto-scroll (only scroll to bottom if user is near bottom)
  const isNearBottom = useRef(true);
  // Track how many messages were loaded from storage so we skip entrance animations for them
  const loadedMsgCount = useRef(0);

  const isEmptyState = messages.length === 0;

  // Derive header title directly from first user message (raw truncation, no stripping)
  const headerTitle = useMemo(() => {
    const firstUserMsg = messages.find((m) => m.role === 'user');
    if (firstUserMsg) {
      const t = firstUserMsg.text.trim().replace(/\n[\s\S]*/s, '');
      return t.length > 32 ? t.slice(0, 32).replace(/\s+\S*$/, '') + '\u2026' : t;
    }
    return 'Ask Tripseek';
  }, [messages]);

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

  function saveAndPushThreads(updated: ChatThread[]) {
    saveChatThreads(updated);
    if (!user?.id) return;
    const userId = user.id;
    if (chatSyncTimerRef.current) clearTimeout(chatSyncTimerRef.current);
    chatSyncTimerRef.current = setTimeout(() => {
      pushChatThreads(userId, updated);
    }, 1500);
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
      saveAndPushThreads(updated);
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
      saveAndPushThreads(updated);
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
      saveAndPushThreads(updated);
      return updated;
    });
    setThreadOptionsId(null);
  }

  function startRenameThread(threadId: string) {
    const thread = threads.find((t) => t.id === threadId);
    if (thread) {
      setRenameText(thread.title);
      setRenameThreadId(threadId);
      setThreadOptionsRenaming(true);
    }
  }

  function confirmRename() {
    if (!renameThreadId || !renameText.trim()) return;
    const newTitle = renameText.trim();
    setThreads((prev) => {
      const updated = prev.map((t) => t.id === renameThreadId ? { ...t, title: newTitle } : t);
      saveAndPushThreads(updated);
      return updated;
    });
    setRenameThreadId(null);
    setRenameText('');
    setThreadOptionsRenaming(false);
    setThreadOptionsId(null);
  }

  // Track keyboard for input bar padding
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Fetch user location (best-effort, no prompt if already denied)
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(async ({ status }) => {
      if (status !== 'granted') return;
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude: lat, longitude: lng } = pos.coords;
        // Reverse-geocode to get city name
        const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        const city = geo?.city || geo?.subregion || geo?.region || undefined;
        setUserLocation({ lat, lng, city });
      } catch {
        // Location unavailable — silently skip
      }
    });
  }, []);

  // Load persisted threads — always start fresh, previous chats accessible via history
  useEffect(() => {
    loadChatThreads<ChatThread[]>([]).then(async (savedThreads) => {
      let merged = savedThreads;

      if (user?.id) {
        const remote = await pullChatThreads(user.id);
        if (remote && remote.length > 0) {
          const localIds = new Set(savedThreads.map((t) => t.id));
          const newFromRemote = remote.filter((t) => !localIds.has(t.id));
          if (newFromRemote.length > 0) {
            merged = [...savedThreads, ...newFromRemote].sort((a, b) => b.updatedAt - a.updatedAt);
            saveChatThreads(merged);
          }
        }
      }

      setThreads(merged);
      // Always open a fresh chat — previous threads are in history
      setLoaded(true);
    });
  }, [placeContext]);

  // Clear to a new chat when app comes back from background (closed then reopened)
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      // Only clear when transitioning from background/inactive → active
      if (nextState === 'active' && (prev === 'background' || prev === 'inactive')) {
        // Save current thread before clearing
        if (messages.length > 0 && activeThreadId) {
          saveCurrentThread();
        }
        loadedMsgCount.current = 0;
        setMessages([]);
        setActiveThreadId(null);
        setIsTyping(false);
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        saveAndPushThreads(updated);
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
          : 'You\u2019ve used your 10 free messages this month. Upgrade to Tripseek+ for 50 messages per month.',
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
    const mentionedTrip = resolveMentionedTrip(text, trips, getTripState, undefined, lastActedTripId);

    try {
      const result = await chatAI({
        message: text.trim(),
        history,
        tripContext: context,
        profile,
        activeTripId: mentionedTrip?.id,
        activeTrip: mentionedTrip,
        userLocation,
      });

      // Process memory signals extracted by AI from the conversation
      if (result.memorySignals && result.memorySignals.length > 0) {
        for (const signal of result.memorySignals) {
          addMemoryEntry({
            type: (signal.type || 'preference_saved') as any,
            category: (signal.category || 'preference') as any,
            detail: signal.detail,
            tripId: mentionedTrip?.id ?? '',
            isGlobal: true,
            origin: 'Chat conversation',
          });
        }
      }

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
          ? String((err as any).message ?? 'Message limit reached. Upgrade to Tripseek+ for more.')
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
        <View style={isUser ? styles.userRow : styles.assistantRow}>
          {!isUser && (
            <View style={[styles.avatarCircle, { backgroundColor: theme.text }]}>
              <ThemedText style={[styles.avatarLabel, { color: theme.background }]}>TS</ThemedText>
            </View>
          )}
          <View
            style={[
              styles.messageBubble,
              isUser
                ? [styles.userBubble, { backgroundColor: theme.primary }]
                : [styles.assistantBubble, { backgroundColor: theme.backgroundElement, borderColor: theme.border }],
            ]}
          >
            <ChatMarkdown text={item.text} isUser={isUser} />
          </View>
          {isUser && (
            <View style={[styles.avatarCircle, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={[styles.avatarLabel, { color: theme.primary }]}>
                {((user?.user_metadata?.full_name as string | undefined)?.[0] ?? user?.email?.[0] ?? 'U').toUpperCase()}
              </ThemedText>
            </View>
          )}
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
            contentContainerStyle={placeStyles.cardsContainer}
            style={placeStyles.cardsScroll}
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
          <View style={placeStyles.cardsContainer}>
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
        <View style={styles.headerTitleBtn}>
          <ThemedText style={styles.headerTitle} numberOfLines={1}>
            {headerTitle}
          </ThemedText>
        </View>
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Message list + input shrink together when keyboard appears */}
        <View style={{ flex: 1 }}>
          {/* Empty state or message thread */}
          {isEmptyState && loaded ? (() => {
            const suggestions = getContextualSuggestions(trips, getTripState, boards);
            return (
            <ScrollView
              style={styles.emptyState}
              contentContainerStyle={styles.emptyStateContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Pressable onPress={() => Keyboard.dismiss()}>
              <Animated.View entering={FadeIn.duration(400)} style={styles.emptyContent}>
                <ExpoImage
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require('@/assets/images/icon-chat-empty.png')}
                  style={{ width: 120, height: 120, marginBottom: 8 }}
                  contentFit="contain"
                />
                <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
                  {getGreeting(userName, trips, getTripState)}
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
            </ScrollView>
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
                  <View style={[styles.avatarCircle, { backgroundColor: theme.text }]}>
                    <ThemedText style={[styles.avatarLabel, { color: theme.background }]}>TS</ThemedText>
                  </View>
                  <TypingIndicator userMessage={messages.filter((m) => m.role === 'user').pop()?.text} />
                </Animated.View>
              ) : null}
            />
          )}


          {/* Input bar */}
          <View style={[styles.inputBar, { borderTopColor: theme.border, paddingBottom: keyboardVisible ? 2 : insets.bottom - 4 }]}>
          <TextInput
            ref={chatInputRef}
            style={[styles.textInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask me anything..."
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
                      onPress={() => { setThreadOptionsRenaming(false); setRenameText(''); setRenameThreadId(null); setThreadOptionsId(thread.id); }}
                      style={styles.threadDotsBtn}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Chat options"
                    >
                      <SymbolView name="ellipsis" size={18} tintColor={theme.textSecondary} />
                    </Pressable>
                  </View>

                </View>
              );})}
            </ScrollView>

            {/* Thread options overlay — rendered inside this modal so it appears on top */}
            {threadOptionsId && (() => {
              const optThread = threads.find((t) => t.id === threadOptionsId);
              if (!optThread) return null;
              const dismiss = () => { setThreadOptionsId(null); setThreadOptionsRenaming(false); setRenameThreadId(null); setRenameText(''); };
              return (
                <Pressable style={styles.optionsBackdrop} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss">
                  <Pressable style={[styles.optionsCard, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()} accessibilityRole="button">
                    {/* Chat name header */}
                    <ThemedText style={[styles.optionsTitle, { color: theme.textSecondary }]} numberOfLines={1}>{optThread.title}</ThemedText>
                    <View style={[styles.optionsDivider, { backgroundColor: theme.border }]} />

                    {threadOptionsRenaming ? (
                      /* Rename input */
                      <View style={styles.optionsRenameRow}>
                        <TextInput
                          value={renameText}
                          onChangeText={setRenameText}
                          style={[styles.optionsRenameInput, { color: theme.text, borderColor: theme.border }]}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={confirmRename}
                          selectTextOnFocus
                          placeholder="Chat name"
                          placeholderTextColor={theme.textSecondary}
                        />
                        <Pressable
                          onPress={confirmRename}
                          disabled={!renameText.trim()}
                          style={({ pressed }) => [styles.optionsRenameConfirm, { backgroundColor: theme.primary, opacity: !renameText.trim() ? 0.4 : pressed ? 0.8 : 1 }]}
                          accessibilityRole="button"
                        >
                          <ThemedText style={[styles.optionsRenameConfirmText, { color: theme.primaryText }]}>Save</ThemedText>
                        </Pressable>
                      </View>
                    ) : (
                      /* Action rows */
                      <>
                        <Pressable
                          onPress={() => startRenameThread(optThread.id)}
                          style={({ pressed }) => [styles.optionsRow, pressed && { opacity: 0.6 }]}
                          accessibilityRole="button"
                        >
                          <SymbolView name="pencil" size={18} tintColor={theme.text} />
                          <ThemedText style={styles.optionsRowText}>Rename</ThemedText>
                        </Pressable>
                        <View style={[styles.optionsDivider, { backgroundColor: theme.border }]} />
                        <Pressable
                          onPress={() => togglePinThread(optThread.id)}
                          style={({ pressed }) => [styles.optionsRow, pressed && { opacity: 0.6 }]}
                          accessibilityRole="button"
                        >
                          <SymbolView name={optThread.pinned ? 'pin.slash' : 'pin'} size={18} tintColor={theme.text} />
                          <ThemedText style={styles.optionsRowText}>{optThread.pinned ? 'Unpin' : 'Pin'}</ThemedText>
                        </Pressable>
                        <View style={[styles.optionsDivider, { backgroundColor: theme.border }]} />
                        <Pressable
                          onPress={() => {
                            Alert.alert('Delete chat?', `"${optThread.title}"`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: () => deleteThread(optThread.id) },
                            ]);
                          }}
                          style={({ pressed }) => [styles.optionsRow, pressed && { opacity: 0.6 }]}
                          accessibilityRole="button"
                        >
                          <SymbolView name="trash" size={18} tintColor="#E53935" />
                          <ThemedText style={[styles.optionsRowText, { color: '#E53935' }]}>Delete</ThemedText>
                        </Pressable>
                      </>
                    )}

                    <View style={[styles.optionsDivider, { backgroundColor: theme.border }]} />
                    <Pressable
                      onPress={dismiss}
                      style={({ pressed }) => [styles.optionsRow, styles.optionsCancel, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                    >
                      <ThemedText style={[styles.optionsRowText, { fontWeight: '600' }]}>Cancel</ThemedText>
                    </Pressable>
                  </Pressable>
                </Pressable>
              );
            })()}
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
  // Messages
  messageList: {
    paddingHorizontal: Spacing.four,
    paddingTop: 16,
    gap: 12,
  },
  userRow: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    alignItems: 'flex-end' as const,
    gap: 8,
  },
  assistantRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 8,
  },
  avatarCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexShrink: 0,
  },
  avatarLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  messageBubble: {
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '78%',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    // flex: 1 fills the row after the avatar, giving list-item text a defined width
    // to wrap against — prevents the "tall and narrow" collapse bug
    flex: 1,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
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
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 8,
  },

  // Empty state
  emptyState: {
    flex: 1,
  },
  emptyStateContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingTop: '15%',
    paddingBottom: 24,
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

  // Thread options centered modal
  optionsBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    zIndex: 100,
  },
  optionsCard: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  optionsTitle: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  optionsDivider: {
    height: StyleSheet.hairlineWidth,
  },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  optionsCancel: {
    justifyContent: 'center',
  },
  optionsRowText: {
    fontSize: 16,
  },
  optionsRenameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionsRenameInput: {
    flex: 1,
    fontSize: 15,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionsRenameConfirm: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  optionsRenameConfirmText: {
    fontSize: 15,
    fontWeight: '600',
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
