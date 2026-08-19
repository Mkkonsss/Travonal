import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useProfile } from '@/context/profile';
import { useTrips } from '@/context/trips';
import { useMemory } from '@/context/memory';
import { useTheme } from '@/hooks/use-theme';
import { parseTextToCommand } from '@/components/ask-travonal';
import { loadChatMessages, saveChatMessages } from '@/services/storage';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTIONS = [
  'What should I do on my trip?',
  'Find me a hidden gem',
  'What\u2019s the best time to visit?',
  'Suggest a day plan',
  'Any food recommendations?',
  'Help me pack',
];

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function buildContext(
  trips: ReturnType<typeof useTrips>['trips'],
  getTripState: ReturnType<typeof useTrips>['getTripState'],
  profile: ReturnType<typeof useProfile>['profile'],
  memoryEntries: ReturnType<typeof useMemory>['getActiveEntries'] extends () => infer R ? R : never,
) {
  const activeTrips = trips.filter((t) => getTripState(t) === 'active');
  const upcomingTrips = trips.filter((t) => getTripState(t) === 'upcoming');
  const pastTrips = trips.filter((t) => getTripState(t) === 'past');

  const lines: string[] = [];

  // Profile
  lines.push(`Traveler profile: pace=${profile.pace}, budget=${profile.budget}`);
  if (profile.interests.length) lines.push(`Interests: ${profile.interests.join(', ')}`);
  if (profile.dislikes.length) lines.push(`Dislikes: ${profile.dislikes.join(', ')}`);
  if (profile.dietaryRestrictions.length) lines.push(`Dietary: ${profile.dietaryRestrictions.join(', ')}`);
  if (profile.mobilityNeeds.length) lines.push(`Mobility needs: ${profile.mobilityNeeds.join(', ')}`);
  if (profile.travelWith) lines.push(`Traveling with: ${profile.travelWith}`);

  // Active trips
  if (activeTrips.length) {
    lines.push('\nActive trips:');
    for (const t of activeTrips) {
      lines.push(`- ${t.emoji} ${t.destination}, ${t.country} (${t.startDate} to ${t.endDate})`);
      lines.push(`  Activities: ${t.activities.length}`);
    }
  }

  // Upcoming
  if (upcomingTrips.length) {
    lines.push('\nUpcoming trips:');
    for (const t of upcomingTrips) {
      lines.push(`- ${t.emoji} ${t.destination}, ${t.country} (${t.startDate} to ${t.endDate})`);
    }
  }

  // Past
  if (pastTrips.length) {
    lines.push('\nPast trips:');
    for (const t of pastTrips) {
      lines.push(`- ${t.emoji} ${t.destination}, ${t.country}`);
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
 * Simulated AI response based on user message and travel context.
 */
/**
 * Find which trip (if any) the user explicitly mentioned by name/destination/country.
 * Returns the matched trip, or falls back to the first active/upcoming trip.
 */
function resolveMentionedTrip(
  userMessage: string,
  trips: ReturnType<typeof useTrips>['trips'],
  getTripState: ReturnType<typeof useTrips>['getTripState'],
): (typeof trips)[0] | undefined {
  const lower = userMessage.toLowerCase();
  const relevantTrips = trips.filter((t) => {
    const state = getTripState(t);
    return state === 'active' || state === 'upcoming';
  });

  // Check if the message mentions any trip by title, destination, or country
  for (const trip of relevantTrips) {
    const candidates = [
      trip.title,
      trip.destination,
      trip.country,
    ].filter(Boolean).map((s) => s!.toLowerCase());
    if (candidates.some((c) => lower.includes(c))) return trip;
  }

  // No explicit mention — fall back to first active/upcoming trip
  return relevantTrips[0];
}

function generateResponse(userMessage: string, context: string, activeTripName?: string): string {
  const lower = userMessage.toLowerCase();

  // Parse context for trip info
  const hasActiveTrip = context.includes('Active trips:');
  const hasUpcomingTrip = context.includes('Upcoming trips:');
  const dest = activeTripName ?? null;

  if (/pack|packing|luggage|bring|suitcase/.test(lower)) {
    const items = ['comfortable walking shoes', 'a light rain jacket', 'a portable charger', 'your travel adapter'];
    const pace = context.includes('pace=relaxed') ? 'Since you prefer a relaxed pace, bring a good book too.' : '';
    return `Here\u2019s my packing checklist:\n\n${items.map((i) => `\u2022 ${i}`).join('\n')}\n\n${pace}`.trim();
  }

  if (/food|eat|restaurant|cuisine|dining|meal/.test(lower)) {
    const dietary = context.match(/Dietary: (.+)/)?.[1];
    const dietaryNote = dietary ? `\nI\u2019ll keep in mind your dietary needs (${dietary}).` : '';
    const destNote = dest ? ` in ${dest}` : ' for your trip';
    return `I\u2019d recommend exploring local street food markets and asking locals for their favorite spots \u2014 those are usually the best finds.${dietaryNote}\n\nWant me to suggest specific restaurants${destNote}?`;
  }

  if (/hidden gem|off.?beat|secret|local/.test(lower)) {
    return 'I love finding hidden gems! Here are some tips:\n\n\u2022 Visit neighborhoods where tourists rarely go\n\u2022 Ask hotel staff for their personal favorites\n\u2022 Check local event listings for pop-ups and markets\n\u2022 Walk side streets in the early morning\n\nWant me to tailor this to a specific destination?';
  }

  if (/day plan|itinerary|schedule|plan my day/.test(lower)) {
    if (hasActiveTrip) {
      const tripLabel = dest ? `your ${dest} trip` : 'your current trip';
      return `Based on ${tripLabel}, here\u2019s a suggested day:\n\n\u2022 Morning: Start with a local breakfast spot\n\u2022 Mid-morning: Visit a cultural attraction\n\u2022 Lunch: Try a neighborhood restaurant\n\u2022 Afternoon: Explore on foot or relax\n\u2022 Evening: Sunset viewpoint, then dinner\n\nI can adjust this based on what you\u2019ve already planned!`;
    }
    return 'I can help plan your day! Which trip would you like me to plan for?';
  }

  if (/best time|when.*visit|season|weather/.test(lower)) {
    return 'The best time to visit depends on your destination! Generally:\n\n\u2022 Spring (Mar\u2013May): Great for Europe and Japan\n\u2022 Fall (Sep\u2013Nov): Perfect for most destinations, fewer crowds\n\u2022 Winter (Dec\u2013Feb): Ideal for tropical getaways\n\nWhich destination are you curious about?';
  }

  if (/budget|cost|cheap|expensive|money|afford/.test(lower)) {
    const budgetPref = context.match(/budget=(\w+)/)?.[1] ?? 'moderate';
    return `Based on your ${budgetPref} budget preference, here are tips:\n\n\u2022 Book accommodations in advance for better rates\n\u2022 Eat where locals eat \u2014 cheaper and better\n\u2022 Use public transit instead of taxis\n\u2022 Look for free walking tours and museum days\n\nWant specific budget tips for a destination?`;
  }

  if (/what should i do|suggest|recommend|idea/.test(lower)) {
    if (hasActiveTrip || hasUpcomingTrip) {
      const interests = context.match(/Interests: (.+)/)?.[1] ?? 'exploring';
      const tripLabel = dest ? ` for ${dest}` : '';
      return `Based on your love of ${interests}, here are some ideas${tripLabel}:\n\n\u2022 Seek out local experiences that match your interests\n\u2022 Mix planned activities with spontaneous discoveries\n\u2022 Leave room for serendipity \u2014 some of the best moments are unplanned\n\nWant me to get more specific for one of your trips?`;
    }
    return 'I\u2019d love to help! Start by planning a trip, then I can give personalized suggestions based on your destination and travel style.';
  }

  if (/hello|hi|hey|greet/.test(lower)) {
    const greeting = hasActiveTrip
      ? 'I see you\u2019re currently traveling \u2014 how can I help make your trip better?'
      : hasUpcomingTrip
      ? 'You\u2019ve got a trip coming up! Want to talk through your plans?'
      : 'Ready to help you plan your next adventure!';
    return `Hey there! \u{1F44B} ${greeting}`;
  }

  if (/thank|thanks/.test(lower)) {
    return 'You\u2019re welcome! Let me know if you need anything else for your travels. \u2708\uFE0F';
  }

  // Default response
  if (hasActiveTrip) {
    const tripLabel = dest ? `your ${dest} trip` : 'your current trip';
    return `I\u2019m here to help with ${tripLabel}! I can suggest activities, help with timing, find restaurants, or adjust your itinerary. What would you like to do?`;
  }
  if (hasUpcomingTrip) {
    return 'I can help you prepare for your upcoming trip! Ask me about packing, day plans, local tips, or anything else you\u2019re curious about.';
  }
  return 'I\u2019m Travonal, your personal travel assistant! I know your travel style and preferences. Ask me anything about travel planning, destinations, or trip ideas.';
}

export default function ChatScreen() {
  const { context: placeContext } = useLocalSearchParams<{ context?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { trips, getTripState } = useTrips();
  const { profile } = useProfile();
  const { getActiveEntries } = useMemory();

  const welcomeText = placeContext
    ? `I see you\u2019re looking at "${placeContext}"! I can tell you more about it, help you decide if it fits your trip, or suggest similar places. What would you like to know?`
    : 'Hey! I\u2019m Travonal, your travel assistant. I know your trips, preferences, and travel style. Ask me anything!';

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: welcomeText,
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ tripId: string; command: string; extractedDay?: number; searchTerms?: string; startAfter?: string } | null>(null);
  const listRef = useRef<FlatList>(null);

  // Track keyboard for input bar padding
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Load persisted messages
  useEffect(() => {
    loadChatMessages<Message[]>([]).then((saved) => {
      if (saved.length > 0 && !placeContext) {
        setMessages(saved);
      }
      setLoaded(true);
    });
  }, [placeContext]);

  // Persist messages when they change
  useEffect(() => {
    if (loaded && messages.length > 1) {
      saveChatMessages(messages);
    }
  }, [messages, loaded]);

  const context = buildContext(trips, getTripState, profile, getActiveEntries());

  function sendMessage(text: string) {
    if (!text.trim()) return;

    const userMsg: Message = { id: generateId(), role: 'user', text: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Check if this is an actionable command for a trip
    const { command, extractedDay, searchTerms, startAfter } = parseTextToCommand(text);
    const mentionedTrip = resolveMentionedTrip(text, trips, getTripState);

    // Simulate response delay
    setTimeout(() => {
      const activeTripName = mentionedTrip
        ? (mentionedTrip.title ?? mentionedTrip.destination)
        : undefined;
      let response = generateResponse(text, context, activeTripName);

      // If we detected a command and there's a trip to act on, offer to navigate
      if (mentionedTrip && command != null) {
        const actionable: string[] = ['reduce_cost', 'avoid_crowds', 'fix_my_day', 'reflow_day', 'reduce_travel_time', 'make_adventurous', 'make_relaxed', 'surprise_me'];
        if (actionable.includes(command)) {
          const tripName = mentionedTrip.title ?? mentionedTrip.destination;
          response += `\n\nI can apply this to your ${tripName} trip right now. Tap "Apply" below to preview the changes.`;
          // Store the pending action for the apply button — preserve all parsed context
          setPendingAction({ tripId: mentionedTrip.id, command, extractedDay, searchTerms, startAfter });
        }
      }

      const assistantMsg: Message = { id: generateId(), role: 'assistant', text: response };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    }, 1000);
  }

  function renderMessage({ item, index }: { item: Message; index: number }) {
    const isUser = item.role === 'user';

    return (
      <Animated.View
        entering={FadeInDown.duration(200).delay(index === 0 ? 0 : 50)}
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
        <ThemedText
          style={[
            styles.messageText,
            isUser && { color: theme.primaryText },
          ]}
        >
          {item.text}
        </ThemedText>
      </Animated.View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header — outside KAV so keyboard offset is accurate */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <ThemedText style={[styles.backText, { color: theme.primary }]}>{'\u2190'} Back</ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>Ask Travonal</ThemedText>
        <View style={styles.backButton} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Message list + input shrink together when keyboard appears */}
        <View style={{ flex: 1 }}>
          {/* Messages */}
          <FlatList
            ref={listRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.messageList, { paddingBottom: 20 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          />

          {/* Typing indicator */}
          {isTyping && (
            <Animated.View entering={FadeIn.duration(200)} style={styles.typingRow}>
              <ThemedText style={[styles.typingText, { color: theme.textSecondary }]}>
                Travonal is thinking...
              </ThemedText>
            </Animated.View>
          )}

          {/* Suggestions (only when few messages) */}
          {messages.length <= 2 && (
            <Animated.View entering={FadeIn.duration(300)}>
              <View style={styles.suggestionsRow}>
                {SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => sendMessage(s)}
                    style={[styles.suggestionChip, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                    accessibilityRole="button"
                    accessibilityLabel={s}
                  >
                    <ThemedText style={[styles.suggestionText, { color: theme.primary }]}>{s}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Apply action button */}
          {pendingAction && (
            <Animated.View entering={FadeIn.duration(200)}>
              <Pressable
                onPress={() => {
                  let url = `/trip/${pendingAction.tripId}?applyCommand=${pendingAction.command}`;
                  if (pendingAction.extractedDay != null) url += `&applyDay=${pendingAction.extractedDay}`;
                  if (pendingAction.searchTerms) url += `&applySearch=${encodeURIComponent(pendingAction.searchTerms)}`;
                  if (pendingAction.startAfter) url += `&applyStartAfter=${encodeURIComponent(pendingAction.startAfter)}`;
                  router.push(url as any);
                  setPendingAction(null);
                }}
                style={[styles.applyBtn, { backgroundColor: theme.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Apply changes to trip"
              >
                <ThemedText style={[styles.applyBtnText, { color: theme.primaryText }]}>Apply to trip</ThemedText>
              </Pressable>
            </Animated.View>
          )}

          {/* Input bar */}
          <View style={[styles.inputBar, { borderTopColor: theme.border, paddingBottom: keyboardVisible ? 8 : insets.bottom + 8 }]}>
          <TextInput
            style={[styles.textInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything about your trips..."
            placeholderTextColor={theme.textSecondary}
            onSubmitEditing={() => sendMessage(input)}
            returnKeyType="send"
            multiline
          />
          <Pressable
            onPress={() => sendMessage(input)}
            disabled={!input.trim()}
            style={({ pressed }) => [
              styles.sendButton,
              {
                backgroundColor: theme.primary,
                opacity: !input.trim() ? 0.4 : pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <ThemedText style={[styles.sendText, { color: theme.primaryText }]}>{'\u2191'}</ThemedText>
          </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  backButton: { width: 60 },
  backText: { fontSize: 16, fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '700' },

  // Messages
  messageList: {
    paddingHorizontal: Spacing.four,
    paddingTop: 16,
    gap: 12,
  },
  messageBubble: {
    maxWidth: '82%',
    borderRadius: 16,
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
    borderWidth: 1,
  },
  assistantLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.5,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },

  // Typing
  typingRow: {
    paddingHorizontal: Spacing.four,
    paddingVertical: 8,
  },
  typingText: {
    fontSize: 13,
    fontStyle: 'italic',
  },

  // Suggestions
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
  },
  suggestionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  suggestionText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Input
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.four,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  textInput: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    fontSize: 18,
    fontWeight: '700',
  },
  applyBtn: {
    marginHorizontal: Spacing.four,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
  applyBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
});
