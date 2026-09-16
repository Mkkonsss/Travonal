import { Pressable, ScrollView, StyleSheet, View, Modal } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { TimePickerButton, formatTimeDisplay } from '@/components/time-picker';
import { Spacing, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ChangePreview, formatModifiedDescription } from '@/services/itinerary-engine';

interface ChangePreviewModalProps {
  visible: boolean;
  preview: ChangePreview | null;
  summary: string;
  changes: string[];
  whyFits?: string;
  lockedProtectedCount?: number;
  /** If true, Apply is disabled and a conflict warning is shown */
  hasConflicts?: boolean;
  onApply: () => void;
  onDismiss: () => void;
  /** Let users adjust the proposed time for a modified activity before applying. */
  onModifyTime?: (activityId: string, newTime: string) => void;
  /** If provided, show memory section */
  memoryEntry?: {
    type: string;
    category: string;
    detail: string;
  };
  onRememberPreference?: () => void;
  onRememberTripOnly?: () => void;
}

export function TransformationReveal({
  visible,
  preview,
  summary,
  changes,
  whyFits,
  lockedProtectedCount,
  hasConflicts,
  onApply,
  onDismiss,
  onModifyTime,
  memoryEntry,
  onRememberPreference,
  onRememberTripOnly,
}: ChangePreviewModalProps) {
  const theme = useTheme();

  if (!visible) return null;

  const addedCount = preview?.added.length ?? 0;
  const removedCount = preview?.removed.length ?? 0;
  const modifiedCount = preview?.modified.length ?? 0;
  const unchangedCount = preview?.unchanged.length ?? 0;
  const protectedCount = preview?.protectedLocked.length ?? lockedProtectedCount ?? 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Close preview">
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="button" accessibilityLabel="Preview sheet"
        >
          <View style={styles.handle} />

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent} contentContainerStyle={{ paddingBottom: 8 }}>
            <ThemedText style={styles.summary}>{summary}</ThemedText>

            {/* Stats row */}
            <View style={styles.statsRow}>
              {addedCount > 0 && (
                <View style={[styles.statBadge, { backgroundColor: 'rgba(34,197,94,0.1)' }]}>
                  <ThemedText style={[styles.statNumber, { color: '#16A34A' }]}>{addedCount}</ThemedText>
                  <ThemedText style={[styles.statLabel, { color: '#16A34A' }]}>Added</ThemedText>
                </View>
              )}
              {removedCount > 0 && (
                <View style={[styles.statBadge, { backgroundColor: 'rgba(220,38,38,0.08)' }]}>
                  <ThemedText style={[styles.statNumber, { color: '#DC2626' }]}>{removedCount}</ThemedText>
                  <ThemedText style={[styles.statLabel, { color: '#DC2626' }]}>Removed</ThemedText>
                </View>
              )}
              {modifiedCount > 0 && (
                <View style={[styles.statBadge, { backgroundColor: theme.primaryMuted }]}>
                  <ThemedText style={[styles.statNumber, { color: theme.primary }]}>{modifiedCount}</ThemedText>
                  <ThemedText style={[styles.statLabel, { color: theme.primary }]}>Modified</ThemedText>
                </View>
              )}
              {unchangedCount > 0 && (
                <View style={[styles.statBadge, { backgroundColor: 'rgba(128,128,128,0.08)' }]}>
                  <ThemedText style={styles.statNumber}>{unchangedCount}</ThemedText>
                  <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Unchanged</ThemedText>
                </View>
              )}
              {protectedCount > 0 && (
                <View style={[styles.statBadge, { backgroundColor: 'rgba(128,128,128,0.08)' }]}>
                  <ThemedText style={styles.statNumber}>{protectedCount}</ThemedText>
                  <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Protected</ThemedText>
                </View>
              )}
            </View>

            {/* Added */}
            {preview && preview.added.length > 0 && (
              <View style={styles.section}>
                <ThemedText style={[styles.sectionTitle, { color: '#16A34A' }]}>Added</ThemedText>
                {preview.added.map((a, i) => (
                  <View key={a.id + '-add-' + i} style={styles.activityRow}>
                    <ThemedText style={[styles.activityBullet, { color: '#16A34A' }]}>+</ThemedText>
                    <ThemedText style={styles.activityLabel}>{a.title}</ThemedText>
                  </View>
                ))}
              </View>
            )}

            {/* Removed */}
            {preview && preview.removed.length > 0 && (
              <View style={styles.section}>
                <ThemedText style={[styles.sectionTitle, { color: '#DC2626' }]}>Removed</ThemedText>
                {preview.removed.map((a, i) => (
                  <View key={a.id + '-rem-' + i} style={styles.activityRow}>
                    <ThemedText style={[styles.activityBullet, { color: '#DC2626' }]}>{'\u2212'}</ThemedText>
                    <ThemedText style={styles.activityLabel}>{a.title}</ThemedText>
                  </View>
                ))}
              </View>
            )}

            {/* Modified */}
            {preview && preview.modified.length > 0 && (
              <View style={styles.section}>
                <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>Modified</ThemedText>
                {preview.modified.map((mod, i) => (
                  <View key={mod.activity.id + '-mod-' + i} style={styles.activityRow}>
                    <SymbolView name="pencil" size={12} tintColor={theme.primary} />
                    <View style={{ flex: 1 }}>
                      <ThemedText style={styles.activityLabel}>{mod.activity.title}</ThemedText>
                      {mod.newTime && onModifyTime ? (
                        <View style={styles.modifiedTimeRow}>
                          <ThemedText style={[styles.modifiedDetail, { color: theme.textSecondary }]}>
                            {mod.oldTime ? `${formatTimeDisplay(mod.oldTime)} \u2192 ` : ''}
                          </ThemedText>
                          <TimePickerButton
                            value={mod.newTime}
                            onChange={(t) => onModifyTime(mod.activity.id, t)}
                          />
                          {mod.oldDay != null && mod.newDay != null && (
                            <ThemedText style={[styles.modifiedDetail, { color: theme.textSecondary }]}>
                              {` Day ${mod.oldDay} \u2192 Day ${mod.newDay}`}
                            </ThemedText>
                          )}
                        </View>
                      ) : (
                        <ThemedText style={[styles.modifiedDetail, { color: theme.textSecondary }]}>
                          {formatModifiedDescription(mod)}
                        </ThemedText>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Unchanged */}
            {preview && preview.unchanged.length > 0 && (
              <View style={styles.section}>
                <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>Unchanged</ThemedText>
                {preview.unchanged.map((a, i) => (
                  <View key={a.id + '-unc-' + i} style={styles.activityRow}>
                    <ThemedText style={[styles.activityBullet, { color: theme.textSecondary }]}>{'\u2022'}</ThemedText>
                    <ThemedText style={[styles.activityLabel, { color: theme.textSecondary }]}>{a.title}</ThemedText>
                  </View>
                ))}
              </View>
            )}

            {/* Protected */}
            {preview && preview.protectedLocked.length > 0 && (
              <View style={styles.section}>
                <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>Protected</ThemedText>
                {preview.protectedLocked.map((a, i) => (
                  <View key={a.id + '-prot-' + i} style={styles.activityRow}>
                    <SymbolView name="lock.fill" size={12} tintColor={theme.textSecondary} />
                    <ThemedText style={[styles.activityLabel, { color: theme.textSecondary }]}>{a.title}</ThemedText>
                  </View>
                ))}
              </View>
            )}

            {/* Change details */}
            {changes.length > 0 && (
            <View style={styles.changesList}>
              {changes.map((change, i) => (
                <View key={i} style={styles.changeRow}>
                  <SymbolView name={"checkmark" as any} size={12} tintColor={theme.primary} />
                  <ThemedText style={styles.changeText}>{change}</ThemedText>
                </View>
              ))}
            </View>
            )}

            {whyFits && (
              <View style={[styles.whySection, { backgroundColor: theme.primaryMuted }]}>
                <ThemedText style={[styles.whyLabel, { color: theme.textSecondary }]}>Why this change</ThemedText>
                <ThemedText style={styles.whyText}>{whyFits}</ThemedText>
              </View>
            )}

          </ScrollView>

          {/* Action buttons outside ScrollView — always reachable */}
          {hasConflicts && (
            <View style={[styles.conflictWarning, { backgroundColor: 'rgba(220,38,38,0.08)', borderColor: 'rgba(220,38,38,0.2)' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <SymbolView name={"exclamationmark.triangle.fill" as any} size={14} tintColor="#DC2626" />
                <ThemedText style={[styles.conflictText, { color: '#DC2626' }]}>
                  Time conflict \u2014 adjust the times above to resolve before applying
                </ThemedText>
              </View>
            </View>
          )}
          <View style={styles.actionRow}>
            <Pressable
              onPress={hasConflicts ? undefined : onApply}
              style={[styles.applyBtn, { backgroundColor: theme.primary, opacity: hasConflicts ? 0.4 : 1 }]}
              accessibilityRole="button" accessibilityLabel="Apply change"
            >
              <ThemedText style={[styles.applyText, { color: theme.primaryText }]}>Apply change</ThemedText>
            </Pressable>
            <Pressable
              onPress={onDismiss}
              style={[styles.dismissBtn, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button" accessibilityLabel="Keep current plan"
            >
              <ThemedText style={styles.dismissText}>Keep current plan</ThemedText>
            </Pressable>
          </View>

          {/* Memory section */}
          {memoryEntry && onRememberPreference && (
            <View style={styles.rememberSection}>
              <ThemedText style={[styles.rememberLabel, { color: theme.textSecondary }]}>Remember this preference?</ThemedText>
              <View style={styles.rememberActions}>
                <Pressable
                  onPress={onRememberPreference}
                  style={[styles.rememberBtn, { backgroundColor: theme.primary }]}
                  accessibilityRole="button" accessibilityLabel="Remember preference"
                >
                  <ThemedText style={[styles.rememberText, { color: theme.primaryText }]}>Yes, remember</ThemedText>
                </Pressable>
                {onRememberTripOnly && (
                  <Pressable
                    onPress={onRememberTripOnly}
                    style={[styles.rememberBtn, { borderColor: theme.border, borderWidth: 1 }]}
                    accessibilityRole="button" accessibilityLabel="Remember for this trip only"
                  >
                    <ThemedText style={styles.rememberText}>Just this trip</ThemedText>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Smart Replace picker — shows 3 alternatives for user to choose from
 */
interface SmartReplacePickerProps {
  visible: boolean;
  alternatives: {
    title: string;
    description: string;
    cost: string;
    crowdLevel: string;
    duration: number;
    whyFits: string;
  }[];
  onPick: (index: number) => void;
  onDismiss: () => void;
}

export function SmartReplacePicker({
  visible,
  alternatives,
  onPick,
  onDismiss,
}: SmartReplacePickerProps) {
  const theme = useTheme();

  if (!visible || alternatives.length === 0) return null;

  function formatDuration(mins: number): string {
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }

  const crowdLabel: Record<string, string> = {
    low: 'Quiet',
    medium: 'Moderate crowds',
    high: 'Busy',
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Close picker">
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="button" accessibilityLabel="Replacement picker"
        >
          <View style={styles.handle} />
          <ThemedText style={styles.summary}>Choose a replacement</ThemedText>
          <ThemedText style={[styles.pickSubtext, { color: theme.textSecondary }]}>
            Pick one of these alternatives
          </ThemedText>

          <View style={styles.altList}>
            {alternatives.map((alt, i) => (
              <Animated.View key={i} entering={FadeIn.delay(i * 100).duration(200)}>
                <Pressable
                  onPress={() => onPick(i)}
                  style={({ pressed }) => [
                    styles.altCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                  ]}
                  accessibilityRole="button" accessibilityLabel={`Pick ${alt.title}`}
                >
                  <ThemedText style={styles.altTitle}>{alt.title}</ThemedText>
                  <ThemedText style={[styles.altDesc, { color: theme.textSecondary }]}>{alt.description}</ThemedText>
                  <View style={styles.altMeta}>
                    <ThemedText style={[styles.altMetaText, { color: theme.textSecondary }]}>{alt.cost}</ThemedText>
                    <ThemedText style={[styles.altMetaText, { color: theme.textSecondary }]}>{'\u00B7'}</ThemedText>
                    <ThemedText style={[styles.altMetaText, { color: theme.textSecondary }]}>{crowdLabel[alt.crowdLevel] ?? alt.crowdLevel}</ThemedText>
                    <ThemedText style={[styles.altMetaText, { color: theme.textSecondary }]}>{'\u00B7'}</ThemedText>
                    <ThemedText style={[styles.altMetaText, { color: theme.textSecondary }]}>{formatDuration(alt.duration)}</ThemedText>
                  </View>
                  <ThemedText style={[styles.altWhy, { color: theme.primary }]}>{alt.whyFits}</ThemedText>
                </Pressable>
              </Animated.View>
            ))}
          </View>

          <Pressable
            onPress={onDismiss}
            style={[styles.dismissBtn, { backgroundColor: theme.backgroundElement, marginTop: 8 }]}
            accessibilityRole="button" accessibilityLabel="Cancel"
          >
            <ThemedText style={styles.dismissText}>Cancel</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Move modal — pick where to move an activity
 */
interface MoveModalProps {
  visible: boolean;
  activityTitle: string;
  totalDays: number;
  currentDay: number;
  currentTime: string;
  onMoveLaterToday: () => void;
  onMoveToDay: (day: number, time: string) => void;
  onDismiss: () => void;
}

export function MoveModal({
  visible,
  activityTitle,
  totalDays,
  currentDay,
  currentTime,
  onMoveLaterToday,
  onMoveToDay,
  onDismiss,
}: MoveModalProps) {
  const theme = useTheme();

  if (!visible) return null;

  const otherDays = Array.from({ length: totalDays }, (_, i) => i + 1).filter((d) => d !== currentDay);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Close move modal">
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="button" accessibilityLabel="Move activity sheet"
        >
          <View style={styles.handle} />
          <ThemedText style={styles.summary}>{`Move \u201C${activityTitle}\u201D`}</ThemedText>

          <View style={styles.moveOptions}>
            <Pressable
              onPress={onMoveLaterToday}
              style={({ pressed }) => [
                styles.moveOption,
                {
                  backgroundColor: pressed ? theme.primaryMuted : theme.backgroundElement,
                },
              ]}
              accessibilityRole="button" accessibilityLabel="Move later today"
            >
              <ThemedText style={styles.moveOptionLabel}>Later today</ThemedText>
              <ThemedText style={[styles.moveOptionDesc, { color: theme.textSecondary }]}>Move 1 hour later</ThemedText>
            </Pressable>

            {otherDays.length > 0 && (
              <View>
                <ThemedText style={[styles.moveSectionLabel, { color: theme.textSecondary }]}>Another day</ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.moveDayRow}
                >
                  {otherDays.map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => onMoveToDay(d, currentTime)}
                      style={({ pressed }) => [
                        styles.moveDayPill,
                        {
                          backgroundColor: pressed ? theme.primaryMuted : theme.backgroundElement,
                          borderColor: theme.border,
                          borderWidth: 1,
                        },
                      ]}
                      accessibilityRole="button" accessibilityLabel={`Move to Day ${d}`}
                    >
                      <ThemedText style={styles.moveDayText}>Day {d}</ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <Pressable
            onPress={onDismiss}
            style={[styles.dismissBtn, { backgroundColor: theme.backgroundElement, marginTop: Spacing.three }]}
            accessibilityRole="button" accessibilityLabel="Cancel move"
          >
            <ThemedText style={styles.dismissText}>Cancel</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

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
  scrollContent: {
    flexGrow: 0,
  },
  summary: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: Spacing.three,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  statNumber: {
    fontSize: 14,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
  },

  // Sections
  section: {
    marginBottom: Spacing.three,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  activityBullet: {
    fontSize: 12,
  },
  activityLabel: {
    fontSize: 14,
  },
  modifiedDetail: {
    fontSize: 12,
    marginTop: 2,
  },
  modifiedTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },

  // Changes
  changesList: { gap: 6, marginBottom: Spacing.three },
  changeRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  changeBullet: { fontSize: 14, fontWeight: '700', marginTop: 1 },
  changeText: { fontSize: 14, flex: 1, lineHeight: 20 },

  // Why
  whySection: {
    marginBottom: Spacing.three,
    padding: 12,
    borderRadius: Radius.sm,
  },
  whyLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  whyText: { fontSize: 14, lineHeight: 20 },

  // Actions
  actionRow: {
    gap: 8,
    marginBottom: Spacing.three,
  },
  conflictWarning: {
    padding: 10,
    borderRadius: Radius.xs,
    borderWidth: 1,
    marginBottom: 8,
  },
  conflictText: { fontSize: 13, fontWeight: '500', textAlign: 'center' },
  applyBtn: {
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  applyText: { fontSize: 15, fontWeight: '700' },
  dismissBtn: {
    paddingVertical: 12,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  dismissText: { fontSize: 14, fontWeight: '600' },

  // Remember
  rememberSection: {
    gap: 8,
    marginBottom: Spacing.three,
  },
  rememberLabel: { fontSize: 14, fontWeight: '600' },
  rememberActions: { flexDirection: 'row', gap: 8 },
  rememberBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  rememberText: { fontSize: 13, fontWeight: '600' },

  // Smart Replace Picker
  pickSubtext: {
    fontSize: 13,
    marginBottom: Spacing.three,
  },
  altList: {
    gap: 10,
  },
  altCard: {
    padding: 14,
    borderRadius: Radius.md,
    gap: 4,
  },
  altTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  altDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  altMeta: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  altMetaText: {
    fontSize: 12,
  },
  altWhy: {
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
    marginTop: 4,
  },

  // Move Modal
  moveOptions: {
    gap: 12,
  },
  moveOption: {
    padding: 14,
    borderRadius: Radius.md,
    gap: 2,
  },
  moveOptionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  moveOptionDesc: {
    fontSize: 13,
  },
  moveSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  moveDayRow: {
    gap: 8,
  },
  moveDayPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  moveDayText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
