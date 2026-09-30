import { View } from 'react-native';

import { PulseAlert } from '@/services/trip-pulse';
import {
  PulseAlertCard,
  sharedStyles,
} from '@/components/pulse-alert-shared';

interface PulseAlertListProps {
  alerts: PulseAlert[];
  onAction: (alert: PulseAlert) => void;
  onDismiss: (alertId: string) => void;
}

function sortByDay(alerts: PulseAlert[]): PulseAlert[] {
  return [...alerts].sort((a, b) => (a.day ?? 999) - (b.day ?? 999));
}

export function PulseAlertList({ alerts, onAction, onDismiss }: PulseAlertListProps) {
  const sorted = sortByDay(alerts);

  return (
    <View style={sharedStyles.alertList}>
      {sorted.map((alert) => (
        <PulseAlertCard
          key={alert.id}
          alert={alert}
          onAction={onAction}
          onDismiss={onDismiss}
        />
      ))}
    </View>
  );
}
