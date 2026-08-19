import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, Modal } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useProfile } from '@/context/profile';

export type TravonalCommand =
  | 'make_relaxed'
  | 'make_adventurous'
  | 'reduce_cost'
  | 'avoid_crowds'
  | 'reduce_travel_time'
  | 'replace_activity'
  | 'surprise_me'
  | 'add_activity'
  | 'reflow_day'
  | 'fix_my_day'
  | 'move_later'
  | 'move_earlier';

interface Command {
  id: TravonalCommand;
  label: string;
  icon: string;
  description: string;
}

const COMMANDS: Command[] = [
  { id: 'make_relaxed', label: 'More relaxed', icon: '\u{1F9D8}', description: 'Reduce activities, add breathing room' },
  { id: 'make_adventurous', label: 'More adventurous', icon: '\u{26F0}\uFE0F', description: 'Swap for higher-energy options' },
  { id: 'reduce_cost', label: 'Reduce cost', icon: '\u{1F4B0}', description: 'Find budget-friendly alternatives' },
  { id: 'avoid_crowds', label: 'Avoid crowds', icon: '\u{1F30F}', description: 'Shift timing or swap for quieter spots' },
  { id: 'reduce_travel_time', label: 'Less travel time', icon: '\u{23F1}\uFE0F', description: 'Reorder by proximity' },
  { id: 'surprise_me', label: 'Surprise me', icon: '\u{2728}', description: 'Something that fits your profile' },
  { id: 'add_activity', label: 'Add an activity', icon: '\u{2795}', description: 'Add something to this day' },
  { id: 'reflow_day', label: 'Fix timing', icon: '\u{1F552}', description: 'Auto-adjust times and add buffers' },
  { id: 'fix_my_day', label: 'Fix my day', icon: '\u{1F527}', description: 'Detect problems and fix them' },
];

/**
 * Parse a free-text query into a TravonalCommand, an extracted day number, or null for unknown.
 */
export interface ParsedCommand {
  command: TravonalCommand | null;
  feedback: string;
  extractedDay?: number;
  searchTerms?: string;
  /** Parsed start-time constraint, e.g. "11:00" from "start after 11 AM" */
  startAfter?: string;
}

/**
 * Extract "day N" from text. Runs early so all command branches can access it.
 */
function extractDay(text: string): number | undefined {
  const m = text.match(/\bday\s+(\d+)\b/);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Extract a time constraint from text like "start after 11 AM", "before 9",
 * "don't schedule anything before 9", "start the day at noon".
 * Returns HH:MM in 24h format or undefined.
 */
export function extractStartTime(text: string): string | undefined {
  const lower = text.toLowerCase();
  // "noon"
  if (/\b(?:at\s+)?noon\b/.test(lower)) return '12:00';
  // "11:30 AM", "10:30 PM", "9 AM", "11AM"
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (timeMatch[3] === 'pm' && h < 12) h += 12;
    if (timeMatch[3] === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  // bare number after "after/before/at": "after 9", "before 11", "at 10"
  const bareMatch = lower.match(/(?:after|before|at|from)\s+(\d{1,2})\b/);
  if (bareMatch) {
    let h = parseInt(bareMatch[1], 10);
    if (h < 6) h += 12; // assume PM for small numbers
    return `${String(h).padStart(2, '0')}:00`;
  }
  return undefined;
}

export function parseTextToCommand(text: string): ParsedCommand {
  const lower = text.toLowerCase().trim();

  // Extract day and time context FIRST — available to all command branches
  const extractedDay = extractDay(lower);
  const startAfter = extractStartTime(lower);

  // Time-specific commands: "start after 11 AM", "don't schedule before 9"
  if (/\b(?:start|begin|schedule|morning)\b.*\b(?:after|from|at)\b|\bbefore\b.*\bschedule\b|\bdon.t.*before\b/.test(lower) && startAfter) {
    return { command: 'reflow_day', feedback: `Adjusting schedule to start at ${startAfter}...`, extractedDay, startAfter };
  }

  if (/relax|slower|calm|easy|chill/.test(lower)) {
    return { command: 'make_relaxed', feedback: 'Making things more relaxed...', extractedDay };
  }
  if (/adventure|adventurous|exciting|thrill|adrenaline/.test(lower)) {
    return { command: 'make_adventurous', feedback: 'Adding more adventure...', extractedDay };
  }
  if (/cheap|budget|cost|save|money|afford/.test(lower)) {
    return { command: 'reduce_cost', feedback: 'Finding budget-friendly options...', extractedDay };
  }
  if (/crowd|quiet|peaceful|secluded|empty/.test(lower)) {
    return { command: 'avoid_crowds', feedback: 'Finding quieter alternatives...', extractedDay };
  }
  if (/fix|repair|problem|issue|broken|wrong/.test(lower)) {
    return { command: 'fix_my_day', feedback: 'Checking for problems...', extractedDay };
  }
  // "move this earlier" / "push earlier" / "earlier time"
  if (/\b(?:move|push|shift|slide)\b.*\bearlier\b|\bearlier\b.*\b(?:time|slot)\b/.test(lower)) {
    return { command: 'move_earlier', feedback: 'Moving earlier...', extractedDay, startAfter };
  }
  // "move this later" / "push later" / "later time" — must come before generic 'later' match
  if (/\b(?:move|push|shift|slide)\b.*\blater\b|\blater\b.*\b(?:time|slot)\b/.test(lower)) {
    return { command: 'move_later', feedback: 'Moving later...', extractedDay, startAfter };
  }
  if (/later|timing|schedule/.test(lower)) {
    return { command: 'reflow_day', feedback: 'Adjusting the schedule...', extractedDay, startAfter };
  }
  if (/food|eat|restaurant|lunch|dinner|breakfast|meal|more restaurant/.test(lower)) {
    return { command: 'surprise_me', feedback: 'Finding something delicious...', extractedDay, searchTerms: 'food' };
  }
  if (/travel time|commute|distance|closer/.test(lower)) {
    return { command: 'reduce_travel_time', feedback: 'Optimizing routes...', extractedDay };
  }
  // "add more art museums" / "add a walking tour" — extract search terms
  const addMatch = lower.match(/add\s+(?:more\s+|an?\s+)?(.+)/);
  if (addMatch) {
    const terms = addMatch[1].replace(/\bday\s+\d+\b/g, '').replace(/\bto\b/g, '').trim();
    if (terms.length > 0) {
      return { command: 'surprise_me', feedback: `Finding "${terms}"...`, extractedDay, searchTerms: terms };
    }
    return { command: 'add_activity', feedback: 'Adding an activity...', extractedDay };
  }
  if (/surprise|random|something new/.test(lower)) {
    return { command: 'surprise_me', feedback: 'Finding something fun...', extractedDay };
  }

  // Unknown / ambiguous
  return { command: null, feedback: "I'm not sure how to do that. Try: More Relaxed, More Adventurous, Reduce Cost, Avoid Crowds, Less Travel Time, or Surprise Me." };
}

interface AskTravonalProps {
  visible: boolean;
  onClose: () => void;
  onCommand: (command: TravonalCommand, extractedDay?: number, searchTerms?: string, startAfter?: string) => void;
  currentDay?: number;
  tripDestination?: string;
}

export function AskTravonal({ visible, onClose, onCommand, currentDay, tripDestination }: AskTravonalProps) {
  const theme = useTheme();
  const { profile } = useProfile();
  const [textQuery, setTextQuery] = useState('');

  const [errorMessage, setErrorMessage] = useState('');

  function handleTextSubmit() {
    if (!textQuery.trim()) return;
    const { command, feedback, extractedDay, searchTerms, startAfter } = parseTextToCommand(textQuery);
    if (command === null) {
      setErrorMessage(feedback);
      return;
    }
    setTextQuery('');
    setErrorMessage('');
    onCommand(command, extractedDay, searchTerms, startAfter);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.kavContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close customization">
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background }]}
            onPress={(e) => e.stopPropagation()}
            accessibilityRole="none"
          >
            <View style={styles.handle} />
            <ThemedText style={styles.title}>Customize trip</ThemedText>
            {(currentDay != null || tripDestination) && (
              <ThemedText style={[styles.context, { color: theme.textSecondary }]}>
                {tripDestination ? `${tripDestination}` : ''}
                {tripDestination && currentDay != null ? ' \u00B7 ' : ''}
                {currentDay != null ? `Day ${currentDay}` : ''}
                {profile.interests.length > 0 ? ` \u00B7 tailored to your interests` : ''}
              </ThemedText>
            )}

            {/* Text input */}
            <View style={[styles.textInputRow, { borderColor: theme.border }]}>
              <TextInput
                style={[styles.textInput, { color: theme.text }]}
                value={textQuery}
                onChangeText={setTextQuery}
                placeholder="Describe what you want..."
                placeholderTextColor={theme.textSecondary}
                onSubmitEditing={handleTextSubmit}
                returnKeyType="go"
                accessibilityLabel="Describe what you want"
              />
              {textQuery.trim().length > 0 && (
                <Pressable
                  onPress={handleTextSubmit}
                  style={[styles.textSendBtn, { backgroundColor: theme.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel="Submit customization"
                >
                  <ThemedText style={[styles.textSendText, { color: theme.primaryText }]}>Go</ThemedText>
                </Pressable>
              )}
            </View>

            {errorMessage.length > 0 && (
              <ThemedText style={[styles.errorMessage, { color: theme.danger }]}>
                {errorMessage}
              </ThemedText>
            )}

            <ThemedText style={[styles.orLabel, { color: theme.textSecondary }]}>or pick a command</ThemedText>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.commandScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.commands}>
                {COMMANDS.map((cmd) => (
                  <Pressable
                    key={cmd.id}
                    onPress={() => {
                      setTextQuery('');
                      setErrorMessage('');
                      onCommand(cmd.id);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.commandRow,
                      { backgroundColor: pressed ? theme.primaryMuted : theme.backgroundElement },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={cmd.label}
                    accessibilityHint={cmd.description}
                  >
                    <ThemedText style={styles.commandIcon}>{cmd.icon}</ThemedText>
                    <View style={styles.commandText}>
                      <ThemedText style={styles.commandLabel}>{cmd.label}</ThemedText>
                      <ThemedText style={[styles.commandDesc, { color: theme.textSecondary }]}>{cmd.description}</ThemedText>
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kavContainer: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: Spacing.three,
  },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  context: { fontSize: 13, marginBottom: Spacing.two },

  // Text input
  textInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: Spacing.two,
    gap: 8,
  },
  textInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
  },
  textSendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  textSendText: {
    fontSize: 13,
    fontWeight: '700',
  },
  errorMessage: {
    fontSize: 13,
    marginBottom: Spacing.two,
    lineHeight: 18,
  },
  orLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: Spacing.two,
  },

  commandScroll: {
    flexGrow: 0,
  },
  commands: { gap: 8 },
  commandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    gap: 12,
  },
  commandIcon: { fontSize: 24 },
  commandText: { flex: 1 },
  commandLabel: { fontSize: 15, fontWeight: '600' },
  commandDesc: { fontSize: 13, marginTop: 1 },
});
