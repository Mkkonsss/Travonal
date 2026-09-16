/**
 * Post-visit feedback sheet — appears after a trip day passes.
 *
 * Quick thumbs up/down per activity, with optional "Why?" follow-up
 * that maps to memory categories. Every response teaches Travonal.
 */

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/context/trips';

export type FeedbackRating = 'loved' | 'liked' | 'disliked';

interface WhyOption {
  label: string;
  icon: string;
  memoryCategory: string;
  memoryDetail: (activity: Activity) => string;
}

const POSITIVE_WHYS: WhyOption[] = [
  {
    label: 'Great atmosphere',
    icon: 'sparkles',
    memoryCategory: 'preference',
    memoryDetail: (a) => `Loved the atmosphere at "${a.title}"`,
  },
  {
    label: 'Good food',
    icon: 'fork.knife',
    memoryCategory: 'food',
    memoryDetail: (a) => `Enjoyed the food at "${a.title}"`,
  },
  {
    label: 'Worth the price',
    icon: 'dollarsign.circle.fill',
    memoryCategory: 'budget',
    memoryDetail: (a) => `"${a.title}" was worth the price`,
  },
  {
    label: 'Hidden gem',
    icon: 'diamond.fill',
    memoryCategory: 'discovery',
    memoryDetail: (a) => `"${a.title}" was a hidden gem — not crowded, authentic`,
  },
  {
    label: 'Perfect timing',
    icon: 'alarm.fill',
    memoryCategory: 'logistics',
    memoryDetail: (a) => `Timing for "${a.title}" was perfect`,
  },
];

const NEGATIVE_WHYS: WhyOption[] = [
  {
    label: 'Too crowded',
    icon: 'person.2.fill',
    memoryCategory: 'crowds',
    memoryDetail: (a) => `"${a.title}" was too crowded`,
  },
  {
    label: 'Not worth the price',
    icon: 'dollarsign.circle.fill',
    memoryCategory: 'budget',
    memoryDetail: (a) => `"${a.title}" wasn't worth the price`,
  },
  {
    label: 'Bad timing',
    icon: 'clock.fill',
    memoryCategory: 'logistics',
    memoryDetail: (a) => `Timing for "${a.title}" didn't work well`,
  },
  {
    label: 'Not my thing',
    icon: 'hand.raised.fill',
    memoryCategory: 'preference',
    memoryDetail: (a) => `Didn't enjoy "${a.title}" — not my type of ${a.type}`,
  },
  {
    label: 'Overrated',
    icon: 'hand.thumbsdown.fill',
    memoryCategory: 'quality',
    memoryDetail: (a) => `"${a.title}" was overrated`,
  },
];

interface PostVisitFeedbackProps {
  activities: Activity[];
  dayLabel: string;
  visible: boolean;
  onClose: () => void;
  /** Called for each activity feedback — parent saves to memory */
  onFeedback: (activity: Activity, rating: FeedbackRating, why?: WhyOption) => void;
}

export function PostVisitFeedback({
  activities,
  dayLabel,
  visible,
  onClose,
  onFeedback,
}: PostVisitFeedbackProps) {
  const theme = useTheme();
  // Track rating per activity id
  const [ratings, setRatings] = useState<Record<string, FeedbackRating>>({});
  // Track which activity is showing the "why" follow-up
  const [whyTarget, setWhyTarget] = useState<string | null>(null);

  const feedbackActivities = activities.filter(
    (a) => a.type !== 'flight' && a.type !== 'hotel',
  );

  function handleRating(activity: Activity, rating: FeedbackRating) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRatings((prev) => ({ ...prev, [activity.id]: rating }));
    if (rating === 'liked' || rating === 'loved') {
      // Show why for positive ratings too — positive feedback is valuable
      setWhyTarget(activity.id);
    } else {
      // Show why for negative
      setWhyTarget(activity.id);
    }
  }

  function handleWhy(activity: Activity, why: WhyOption) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const rating = ratings[activity.id] ?? 'liked';
    onFeedback(activity, rating, why);
    setWhyTarget(null);
  }

  function handleSkipWhy(activity: Activity) {
    const rating = ratings[activity.id] ?? 'liked';
    onFeedback(activity, rating);
    setWhyTarget(null);
  }

  function handleDone() {
    // Submit any rated activities that haven't been submitted via "why"
    for (const act of feedbackActivities) {
      const rating = ratings[act.id];
      if (rating && whyTarget !== act.id) {
        // Already submitted through why flow — skip
      }
    }
    onClose();
  }

  if (feedbackActivities.length === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.handle} />

          <ThemedText style={styles.title}>How was {dayLabel}?</ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            Quick feedback helps Travonal learn your taste
          </ThemedText>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {feedbackActivities.map((activity) => {
              const rating = ratings[activity.id];
              const showingWhy = whyTarget === activity.id;
              const whyOptions = rating === 'disliked' ? NEGATIVE_WHYS : POSITIVE_WHYS;

              return (
                <View key={activity.id} style={[styles.activityRow, { borderBottomColor: theme.border }]}>
                  <View style={styles.activityInfo}>
                    <ThemedText style={styles.activityTitle} numberOfLines={1}>
                      {activity.title}
                    </ThemedText>
                    <ThemedText style={[styles.activityMeta, { color: theme.textSecondary }]}>
                      {activity.time}
                    </ThemedText>
                  </View>

                  {!rating && !showingWhy && (
                    <View style={styles.ratingRow}>
                      <Pressable
                        onPress={() => handleRating(activity, 'loved')}
                        style={styles.ratingBtn}
                        accessibilityLabel={`Loved ${activity.title}`}
                      >
                        <SymbolView name="heart.fill" size={28} tintColor="#EF4444" />
                      </Pressable>
                      <Pressable
                        onPress={() => handleRating(activity, 'liked')}
                        style={styles.ratingBtn}
                        accessibilityLabel={`Liked ${activity.title}`}
                      >
                        <SymbolView name="hand.thumbsup.fill" size={28} tintColor="#3B82F6" />
                      </Pressable>
                      <Pressable
                        onPress={() => handleRating(activity, 'disliked')}
                        style={styles.ratingBtn}
                        accessibilityLabel={`Disliked ${activity.title}`}
                      >
                        <SymbolView name="hand.thumbsdown.fill" size={28} tintColor="#6B7280" />
                      </Pressable>
                    </View>
                  )}

                  {rating && !showingWhy && (
                    <View style={styles.ratedIcon}>
                      <SymbolView
                        name={rating === 'loved' ? 'heart.fill' : rating === 'liked' ? 'hand.thumbsup.fill' : 'hand.thumbsdown.fill'}
                        size={24}
                        tintColor={rating === 'loved' ? '#EF4444' : rating === 'liked' ? '#3B82F6' : '#6B7280'}
                      />
                    </View>
                  )}

                  {showingWhy && (
                    <View style={styles.whySection}>
                      <ThemedText style={[styles.whyPrompt, { color: theme.textSecondary }]}>
                        Why? (optional)
                      </ThemedText>
                      <View style={styles.whyGrid}>
                        {whyOptions.map((why) => (
                          <Pressable
                            key={why.label}
                            onPress={() => handleWhy(activity, why)}
                            style={({ pressed }) => [
                              styles.whyChip,
                              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                            ]}
                          >
                            <SymbolView name={why.icon as any} size={14} tintColor={theme.text} />
                            <ThemedText style={styles.whyLabel}>{why.label}</ThemedText>
                          </Pressable>
                        ))}
                      </View>
                      <Pressable onPress={() => handleSkipWhy(activity)} style={styles.skipBtn}>
                        <ThemedText style={[styles.skipText, { color: theme.textSecondary }]}>Skip</ThemedText>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={handleDone}
              style={[styles.doneBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Done with feedback"
            >
              <ThemedText style={[styles.doneText, { color: theme.primaryText }]}>Done</ThemedText>
            </Pressable>
            <Pressable onPress={onClose} style={styles.laterBtn}>
              <ThemedText style={[styles.laterText, { color: theme.textSecondary }]}>Maybe later</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export type { WhyOption };

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five + 20,
    maxHeight: '80%',
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
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: Spacing.three,
  },
  scroll: {
    flex: 1,
  },
  activityRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  activityInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  activityMeta: {
    fontSize: 13,
    marginLeft: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
  },
  ratingBtn: {
    padding: 8,
  },
  ratingEmoji: {
    fontSize: 28,
  },
  ratedEmoji: {
    fontSize: 24,
    textAlign: 'center',
  },
  whySection: {
    marginTop: 4,
  },
  whyPrompt: {
    fontSize: 13,
    marginBottom: 8,
  },
  whyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  whyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    gap: 6,
  },
  whyIcon: {
    width: 14,
  },
  whyLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  skipBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  skipText: {
    fontSize: 13,
  },
  footer: {
    paddingTop: Spacing.three,
    gap: 8,
  },
  doneBtn: {
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  doneText: {
    fontSize: 16,
    fontWeight: '600',
  },
  laterBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  laterText: {
    fontSize: 14,
  },
});
