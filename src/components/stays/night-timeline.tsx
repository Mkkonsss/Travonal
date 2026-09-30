import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import type { StayBlock, StaysData } from '@/components/stays-section';
import { formatShortDate, computeDateForDay } from '@/services/trip-helpers';

interface NightTimelineProps {
  staysData: StaysData;
  totalDays: number;
  tripStartDate: string;
  datesKnown: boolean;
  theme: {
    primary: string;
    background: string;
    border: string;
    textSecondary: string;
    text: string;
  };
  onTapNight: (day: number, covered: boolean) => void;
}

export const NightTimeline = memo(function NightTimeline({
  staysData,
  totalDays,
  tripStartDate,
  datesKnown,
  theme,
  onTapNight,
}: NightTimelineProps) {
  const { blocks } = staysData;

  // Build coverage map: night number → status
  const nightStatus = new Map<number, 'booked' | 'pending' | 'uncovered'>();
  for (let n = 1; n <= totalDays; n++) nightStatus.set(n, 'uncovered');
  for (const block of blocks) {
    const status = block.hotel.bookingStatus === 'pending' ? 'pending' : 'booked';
    for (const n of block.nights) nightStatus.set(n, status);
  }

  const coveredCount = blocks.reduce((sum, b) => sum + b.nights.length, 0);
  const allCovered = coveredCount >= totalDays;

  const segments = Array.from({ length: totalDays }, (_, i) => i + 1);

  const content = (
    <View style={s.timelineRow}>
      {segments.map((night) => {
        const status = nightStatus.get(night) ?? 'uncovered';
        return (
          <Pressable
            key={night}
            onPress={() => onTapNight(night, status !== 'uncovered')}
            style={[
              s.segment,
              totalDays <= 14 && { flex: 1 },
              totalDays > 14 && { width: 28 },
              status === 'booked' && { backgroundColor: theme.primary },
              status === 'pending' && { backgroundColor: '#F59E0B66' },
              status === 'uncovered' && { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border },
              night === 1 && { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
              night === totalDays && { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
            ]}
            hitSlop={2}
          >
            {status === 'booked' && (
              <SymbolView name="checkmark" size={8} tintColor={theme.background} />
            )}
          </Pressable>
        );
      })}
    </View>
  );

  // Day labels at boundaries
  const labels: { position: number; text: string }[] = [];
  if (datesKnown) {
    labels.push({ position: 1, text: formatShortDate(computeDateForDay(tripStartDate, 1)) });
    if (totalDays > 1) {
      labels.push({ position: totalDays, text: formatShortDate(computeDateForDay(tripStartDate, totalDays)) });
    }
  } else {
    labels.push({ position: 1, text: 'Day 1' });
    if (totalDays > 1) labels.push({ position: totalDays, text: `Day ${totalDays}` });
  }

  return (
    <View style={s.container}>
      {totalDays > 14 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {content}
        </ScrollView>
      ) : (
        content
      )}

      {/* Day labels */}
      <View style={s.labelRow}>
        {labels.map((label) => (
          <ThemedText key={label.position} style={[s.labelText, { color: theme.textSecondary }]}>
            {label.text}
          </ThemedText>
        ))}
      </View>

      {/* Coverage summary */}
      <ThemedText style={[s.summaryText, { color: allCovered ? '#10B981' : theme.textSecondary }]}>
        {allCovered
          ? 'All nights covered'
          : `${coveredCount} of ${totalDays} night${totalDays === 1 ? '' : 's'} covered`}
      </ThemedText>
    </View>
  );
});

const s = StyleSheet.create({
  container: {
    marginTop: 10,
    marginBottom: 4,
  },
  timelineRow: {
    flexDirection: 'row',
    height: 28,
    gap: 2,
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  labelText: {
    fontSize: 10,
  },
  summaryText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
});
