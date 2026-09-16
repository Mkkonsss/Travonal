import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Spacing, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PulseAlert, PulseSeverity } from '@/services/trip-pulse';
import { PulseHistoryEntry } from '@/services/storage';

function useAlertColor(type: PulseAlert['type'], theme: ReturnType<typeof useTheme>): string {
  switch (type) {
    case 'conflict':
    case 'closure':
    case 'flight_conflict':
      return theme.danger;
    case 'weather':
    case 'sunset_mismatch':
    case 'duplicate':
    default:
      return theme.primary;
  }
}

const TYPE_ICONS: Record<PulseAlert['type'], string> = {
  conflict: 'exclamationmark.triangle.fill',
  closure: 'nosign',
  weather: 'cloud.rain.fill',
  flight_conflict: 'airplane',
  sunset_mismatch: 'sunset.fill',
  duplicate: 'doc.on.doc.fill',
};

const SEVERITY_LABELS: Record<PulseSeverity, string> = {
  urgent: 'Urgent',
  important: 'Good to know',
};

const SEVERITY_ORDER: PulseSeverity[] = ['urgent', 'important'];

interface PulseBannerProps {
  alerts: PulseAlert[];
  onAction: (alert: PulseAlert) => void;
  onDismiss: (alertId: string) => void;
  dismissedAlerts?: PulseAlert[];
  resolvedHistory?: PulseHistoryEntry[];
  newIssueCount?: number;
  onOpen?: () => void;
  externalOpen?: boolean;
  onExternalClose?: () => void;
  /** Check if a prepared AI solution exists for an alert */
  hasSolution?: (alertId: string) => boolean;
  /** Check if a solution is currently being prepared */
  isPreparing?: (alertId: string) => boolean;
}

function PulseAlertCard({
  alert,
  onAction,
  onDismiss,
  resolved,
  hasSolution,
  isPreparing,
}: {
  alert: PulseAlert;
  onAction: (alert: PulseAlert) => void;
  onDismiss: (alertId: string) => void;
  resolved?: boolean;
  hasSolution?: boolean;
  isPreparing?: boolean;
}) {
  const theme = useTheme();
  const color = useAlertColor(alert.type, theme);
  const actionText = hasSolution ? 'Review changes' : alert.actionLabel;

  return (
    <View style={[styles.alertCardOuter, resolved && { opacity: 0.45 }]}>
      <View style={[styles.alertBorderStrip, { backgroundColor: resolved ? theme.textSecondary : color }]} />
      <Pressable
        onPress={() => { if (!resolved) onAction(alert); }}
        style={({ pressed }) => [
          styles.alertCard,
          {
            backgroundColor: theme.backgroundElement,
            transform: [{ scale: pressed && !resolved ? 0.98 : 1 }],
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${alert.title}: ${alert.message}`}
      >
        <View style={styles.alertContent}>
          <View style={styles.alertTitleRow}>
            <SymbolView name={TYPE_ICONS[alert.type] ?? 'sparkles'} size={18} tintColor={color} />
            <ThemedText style={[styles.alertTitle, resolved && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{alert.title}</ThemedText>
            {isPreparing && !hasSolution && (
              <View style={[styles.preparingDot, { backgroundColor: color }]} />
            )}
          </View>
          <ThemedText style={[styles.alertMessage, { color: theme.textSecondary }]} numberOfLines={2}>{alert.message}</ThemedText>
          {alert.day != null && (
            <ThemedText style={[styles.alertDay, { color: theme.textSecondary }]}>Day {alert.day}</ThemedText>
          )}
          {!resolved && (
            <View style={styles.alertActions}>
              <Pressable
                onPress={() => onAction(alert)}
                style={[styles.actionBtn, { backgroundColor: hasSolution ? color + '30' : color + '20' }]}
                accessibilityRole="button"
                accessibilityLabel={actionText}
              >
                <ThemedText style={[styles.actionText, { color }]}>
                  {isPreparing && !hasSolution ? 'Preparing...' : actionText}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => onDismiss(alert.id)}
                style={styles.dismissBtn}
                accessibilityRole="button"
                accessibilityLabel="Dismiss alert"
              >
                <ThemedText style={[styles.dismissText, { color: theme.textSecondary }]}>Dismiss</ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

function groupBySeverity(alerts: PulseAlert[]): Map<PulseSeverity, PulseAlert[]> {
  const map = new Map<PulseSeverity, PulseAlert[]>();
  for (const severity of SEVERITY_ORDER) {
    const group = alerts.filter((a) => a.severity === severity);
    if (group.length > 0) {
      map.set(severity, group);
    }
  }
  return map;
}

/**
 * Convert persistent history entries into PulseAlert-shaped objects for rendering.
 * History entries store display fields (title, message, alertType, severity) so they
 * survive even after the pulse engine stops generating them.
 */
function historyToAlerts(entries: PulseHistoryEntry[]): PulseAlert[] {
  return entries
    .filter((e) => e.title && e.message)
    .map((e) => ({
      id: e.occurrenceId ?? e.alertId,
      type: (e.alertType ?? 'conflict') as PulseAlert['type'],
      severity: (e.severity ?? 'important') as PulseSeverity,
      title: e.title!,
      message: e.message!,
      actionLabel: 'Resolved',
    }));
}

export function PulseBanner({ alerts, onAction, onDismiss, dismissedAlerts, resolvedHistory, newIssueCount, onOpen, externalOpen, onExternalClose, hasSolution, isPreparing }: PulseBannerProps) {
  const theme = useTheme();
  const [internalOpen, setInternalOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  // Modal is visible if opened internally or externally
  const modalVisible = internalOpen || !!externalOpen;

  function closeModal() {
    setInternalOpen(false);
    onExternalClose?.();
  }

  // Prefer persistent history for resolved section; fall back to legacy dismissedAlerts
  const resolvedAlerts = resolvedHistory && resolvedHistory.length > 0
    ? historyToAlerts(resolvedHistory)
    : (dismissedAlerts ?? []);

  if (alerts.length === 0 && resolvedAlerts.length === 0) return null;

  const badgeCount = newIssueCount ?? 0;
  const grouped = groupBySeverity(alerts);
  const resolvedGrouped = groupBySeverity(resolvedAlerts);

  function handleOpen() {
    onOpen?.();
    setInternalOpen(true);
  }

  return (
    <>
      <Animated.View entering={FadeIn.duration(300)} style={styles.container}>
        <Pressable
          onPress={handleOpen}
          style={({ pressed }) => [
            styles.compactRow,
            {
              backgroundColor: theme.backgroundElement,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Trip Insights: ${alerts.length} ${alerts.length === 1 ? 'thing' : 'things'} to check. Tap to view.`}
        >
          <SymbolView name="bolt.fill" size={16} tintColor={theme.text} />
          <ThemedText style={styles.compactText}>
            {alerts.length} {alerts.length === 1 ? 'thing' : 'things'} to check
          </ThemedText>
          <ThemedText style={[styles.compactChevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
        </Pressable>
      </Animated.View>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeModal} accessibilityRole="button" accessibilityLabel="Close Trip Insights">
          <Pressable
            style={[styles.modalSheet, { backgroundColor: theme.background }]}
            onPress={(e) => e.stopPropagation()}
            accessibilityRole="button" accessibilityLabel="Trip Insights details"
          >
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Trip Insights</ThemedText>
              <Pressable
                onPress={closeModal}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close Trip Insights"
              >
                <SymbolView name={"xmark" as any} size={16} tintColor={theme.textSecondary} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll}>
              {alerts.length === 0 ? (
                <View style={styles.emptyState}>
                  <SymbolView name="checkmark.seal.fill" size={36} tintColor={theme.primary} />
                  <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                    Nothing to flag -- your trip looks great!
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.alertList}>
                  {SEVERITY_ORDER.map((severity) => {
                    const group = grouped.get(severity);
                    if (!group) return null;
                    // Sub-group by day within each severity
                    const byDay = new Map<number | undefined, PulseAlert[]>();
                    for (const alert of group) {
                      const key = alert.day;
                      const existing = byDay.get(key) ?? [];
                      existing.push(alert);
                      byDay.set(key, existing);
                    }
                    const dayKeys = [...byDay.keys()].sort((a, b) => (a ?? 999) - (b ?? 999));
                    return (
                      <View key={severity}>
                        <ThemedText style={[styles.severityHeader, { color: severity === 'urgent' ? theme.danger : severity === 'important' ? theme.primary : theme.textSecondary }]}>
                          {SEVERITY_LABELS[severity]}
                        </ThemedText>
                        {dayKeys.map((dayKey) => {
                          const dayAlerts = byDay.get(dayKey)!;
                          return (
                            <View key={`${severity}-day-${dayKey ?? 'general'}`}>
                              {dayKey != null && dayKeys.length > 1 && (
                                <ThemedText style={[styles.daySubheader, { color: theme.textSecondary }]}>Day {dayKey}</ThemedText>
                              )}
                              {dayAlerts.map((alert) => (
                                <PulseAlertCard
                                  key={alert.id}
                                  alert={alert}
                                  onAction={(a) => {
                                    closeModal();
                                    onAction(a);
                                  }}
                                  onDismiss={onDismiss}
                                  hasSolution={hasSolution?.(alert.id)}
                                  isPreparing={isPreparing?.(alert.id)}
                                />
                              ))}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Show resolved toggle */}
              {resolvedAlerts.length > 0 && (
                <View style={styles.resolvedSection}>
                  <View style={styles.resolvedToggleRow}>
                    <ThemedText style={[styles.resolvedToggleLabel, { color: theme.textSecondary }]}>
                      Show resolved ({resolvedAlerts.length})
                    </ThemedText>
                    <Switch
                      value={showResolved}
                      onValueChange={setShowResolved}
                      trackColor={{ false: theme.border, true: theme.primary }}
                    />
                  </View>
                  {showResolved && (
                    <View style={styles.alertList}>
                      {SEVERITY_ORDER.map((severity) => {
                        const group = resolvedGrouped.get(severity);
                        if (!group) return null;
                        return (
                          <View key={`resolved-${severity}`}>
                            <ThemedText style={[styles.severityHeader, { color: theme.textSecondary }]}>
                              {SEVERITY_LABELS[severity]} (resolved)
                            </ThemedText>
                            {group.map((alert) => (
                              <PulseAlertCard
                                key={`resolved-${alert.id}`}
                                alert={alert}
                                onAction={onAction}
                                onDismiss={onDismiss}
                                resolved
                              />
                            ))}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.sm,
    gap: 8,
  },
  compactIcon: { width: 16, height: 16 },
  compactText: { fontSize: 14, fontWeight: '600', flex: 1 },
  compactChevron: { fontSize: 20, fontWeight: '300' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    maxHeight: '80%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: Spacing.three,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalClose: { fontSize: 18, fontWeight: '300', padding: 4 },
  modalScroll: { flexGrow: 0 },
  alertList: { gap: 10, paddingBottom: 20 },

  // Severity headers
  severityHeader: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 6,
  },
  daySubheader: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 4,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyIcon: { width: 36, height: 36 },
  emptyText: { fontSize: 15, textAlign: 'center' },

  // Resolved section
  resolvedSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  resolvedToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  resolvedToggleLabel: {
    fontSize: 14,
    fontWeight: '500',
  },

  // Alert cards
  alertCardOuter: {
    flexDirection: 'row',
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  alertBorderStrip: {
    width: 4,
  },
  alertCard: {
    flex: 1,
    borderTopRightRadius: Radius.sm,
    borderBottomRightRadius: Radius.sm,
    overflow: 'hidden',
  },
  alertContent: {
    padding: 14,
    gap: 6,
  },
  alertTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  preparingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.6,
  },
  alertIcon: { width: 18, height: 18 },
  alertTitle: { fontSize: 14, fontWeight: '700', flex: 1 },
  alertMessage: { fontSize: 13, lineHeight: 18 },
  alertDay: { fontSize: 12, fontWeight: '600' },
  alertActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.md,
  },
  actionText: { fontSize: 13, fontWeight: '600' },
  dismissBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  dismissText: { fontSize: 13, fontWeight: '500' },
});
