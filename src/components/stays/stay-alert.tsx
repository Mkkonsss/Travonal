import { View, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';

export interface StayAlertData {
  type: 'early_activity' | 'checkout_conflict' | 'hotel_switch';
  message: string;
  icon: string;
}

interface StayAlertProps {
  alert: StayAlertData;
  theme: {
    textSecondary: string;
    border: string;
  };
}

export function StayAlert({ alert, theme }: StayAlertProps) {
  const color =
    alert.type === 'checkout_conflict' ? '#F59E0B' :
    alert.type === 'hotel_switch' ? '#3B82F6' :
    '#F59E0B';

  return (
    <View style={[s.container, { borderLeftColor: color, backgroundColor: color + '10', borderColor: theme.border }]}>
      <SymbolView name={alert.icon as any} size={12} tintColor={color} />
      <ThemedText style={[s.text, { color: theme.textSecondary }]}>{alert.message}</ThemedText>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: Radius.xs,
    borderLeftWidth: 3,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
  },
  text: {
    fontSize: 11,
    flex: 1,
    lineHeight: 15,
  },
});
