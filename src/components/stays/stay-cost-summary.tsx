import { memo } from 'react';
import { View, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import type { StayBlock } from '@/components/stays-section';

interface StayCostSummaryProps {
  blocks: StayBlock[];
  totalDays: number;
  budgetTotal?: number;
  budgetCurrency: string;
  getCurrSymbol: (cur: string) => string;
  theme: {
    primary: string;
    background: string;
    backgroundElement: string;
    border: string;
    text: string;
    textSecondary: string;
  };
}

export const StayCostSummary = memo(function StayCostSummary({
  blocks,
  totalDays,
  budgetTotal,
  budgetCurrency,
  getCurrSymbol,
  theme,
}: StayCostSummaryProps) {
  // Only show if at least one stay has pricing
  const pricedBlocks = blocks.filter((b) => b.reservation?.price && b.reservation.price > 0);
  if (pricedBlocks.length === 0) return null;

  const totalCost = pricedBlocks.reduce((sum, b) => sum + (b.reservation!.price ?? 0), 0);
  const totalNights = pricedBlocks.reduce((sum, b) => sum + b.nights.length, 0);
  const perNight = totalNights > 0 ? Math.round(totalCost / totalNights) : 0;
  const currency = pricedBlocks[0].reservation?.currency ?? budgetCurrency;
  const sym = getCurrSymbol(currency);
  const budgetPct = budgetTotal && budgetTotal > 0 ? Math.round((totalCost / budgetTotal) * 100) : null;

  return (
    <View style={[s.container, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={s.row}>
        <View style={s.stat}>
          <ThemedText style={[s.statLabel, { color: theme.textSecondary }]}>Total</ThemedText>
          <ThemedText style={s.statValue}>{sym}{totalCost.toLocaleString()}</ThemedText>
        </View>
        <View style={[s.divider, { backgroundColor: theme.border }]} />
        <View style={s.stat}>
          <ThemedText style={[s.statLabel, { color: theme.textSecondary }]}>Per night</ThemedText>
          <ThemedText style={s.statValue}>{sym}{perNight.toLocaleString()}</ThemedText>
        </View>
        {budgetPct != null && (
          <>
            <View style={[s.divider, { backgroundColor: theme.border }]} />
            <View style={s.stat}>
              <ThemedText style={[s.statLabel, { color: theme.textSecondary }]}>Of budget</ThemedText>
              <ThemedText style={s.statValue}>{budgetPct}%</ThemedText>
            </View>
          </>
        )}
      </View>

      {/* Budget proportion bar */}
      {budgetPct != null && (
        <View style={[s.barTrack, { backgroundColor: theme.border }]}>
          <View
            style={[
              s.barFill,
              {
                backgroundColor: budgetPct > 60 ? '#F59E0B' : theme.primary,
                width: `${Math.min(budgetPct, 100)}%`,
              },
            ]}
          />
        </View>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  container: {
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  divider: {
    width: 1,
    height: 28,
  },
  barTrack: {
    height: 3,
    borderRadius: 1.5,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: 3,
    borderRadius: 1.5,
  },
});
