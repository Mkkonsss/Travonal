import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PulseAlert, PulseSeverity } from '@/services/trip-pulse';
import { PulseHistoryEntry } from '@/services/storage';

export const TYPE_ICONS: Record<PulseAlert['type'], string> = {
  conflict: 'clock.badge.exclamationmark',
  closure: 'door.left.hand.closed',
  weather: 'cloud.rain',
  flight_conflict: 'airplane',
  sunset_mismatch: 'sunset.fill',
  duplicate: 'doc.on.doc',
  preference_mismatch: 'hand.thumbsdown',
};

export const SEVERITY_LABELS: Record<PulseSeverity, string> = {
  urgent: 'Urgent',
  important: 'Important',
};

export const SEVERITY_ORDER: PulseSeverity[] = ['urgent', 'important'];

export function groupBySeverity(alerts: PulseAlert[]): Map<PulseSeverity, PulseAlert[]> {
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
export function historyToAlerts(entries: PulseHistoryEntry[]): PulseAlert[] {
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

export function PulseAlertCard({
  alert,
  onAction,
  onDismiss,
  resolved,
}: {
  alert: PulseAlert;
  onAction: (alert: PulseAlert) => void;
  onDismiss: (alertId: string) => void;
  resolved?: boolean;
}) {
  const theme = useTheme();
  const iconColor = theme.textSecondary;

  return (
    <View style={[sharedStyles.alertCardOuter, { borderColor: theme.border }, resolved && { opacity: 0.45 }]}>
      <Pressable
        onPress={() => { if (!resolved) onAction(alert); }}
        style={({ pressed }) => [
          sharedStyles.alertCard,
          {
            backgroundColor: theme.backgroundElement,
            transform: [{ scale: pressed && !resolved ? 0.98 : 1 }],
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${alert.title}: ${alert.message}`}
      >
        <View style={sharedStyles.alertContent}>
          <View style={sharedStyles.alertTitleRow}>
            <SymbolView name={TYPE_ICONS[alert.type] ?? 'sparkles'} size={16} tintColor={iconColor} />
            <ThemedText style={[sharedStyles.alertTitle, resolved && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{alert.title}</ThemedText>
            {!resolved && (
              <Pressable
                onPress={() => onDismiss(alert.id)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Dismiss notification"
              >
                <SymbolView name={"xmark" as any} size={14} tintColor={theme.textSecondary} />
              </Pressable>
            )}
          </View>
          <ThemedText style={[sharedStyles.alertMessage, { color: theme.textSecondary }]} numberOfLines={2}>{alert.message}</ThemedText>
          {!resolved && (
            <View style={sharedStyles.alertActions}>
              <Pressable
                onPress={() => onAction(alert)}
                accessibilityRole="button"
                accessibilityLabel={alert.actionLabel}
              >
                <ThemedText style={[sharedStyles.actionText, { color: theme.primary }]}>
                  {alert.actionLabel}
                </ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

export const sharedStyles = StyleSheet.create({
  alertCardOuter: {
    borderRadius: Radius.sm,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  alertCard: {
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  alertContent: {
    padding: 14,
    gap: 6,
  },
  alertTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertTitle: { fontSize: 14, fontWeight: '600', flex: 1 },
  alertMessage: { fontSize: 13, lineHeight: 18 },
  alertActions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 6,
  },
  actionText: { fontSize: 13, fontWeight: '500' },
  alertList: { gap: 10, paddingBottom: 20 },
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
});
