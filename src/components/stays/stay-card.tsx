import { memo, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { Activity, Reservation } from '@/context/trips';
import type { StayBlock } from '@/components/stays-section';
import { formatShortDate, computeDateForDay } from '@/services/trip-helpers';

const FALLBACK_CARD_WIDTH = Dimensions.get('window').width - Spacing.four * 2;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 260;
const DEFAULT_HEIGHT = 180;

interface StayCardProps {
  block: StayBlock;
  tripStartDate: string;
  datesKnown: boolean;
  photoUrl?: string;
  gridMode?: boolean;
  theme: {
    primary: string;
    background: string;
    backgroundElement: string;
    border: string;
    text: string;
    textSecondary: string;
    danger: string;
  };
  onViewStay: (activity: Activity, reservation?: Reservation) => void;
}

export const StayCard = memo(function StayCard({
  block,
  tripStartDate,
  datesKnown,
  photoUrl,
  gridMode = false,
  theme,
  onViewStay,
}: StayCardProps) {
  const b = block;
  const isCancelled = b.reservation?.cancelled;
  const [cardHeight, setCardHeight] = useState(DEFAULT_HEIGHT);
  const measuredWidthRef = useRef(0);

  const booked = b.hotel.bookingStatus === 'booked' || !!b.reservation;
  const pending = b.hotel.bookingStatus === 'pending';
  const statusText = isCancelled ? 'Cancelled' : booked ? 'Booked' : pending ? 'Pending' : 'Not Booked';
  const statusColor = isCancelled ? theme.danger : booked ? '#10B981' : pending ? '#F59E0B' : '#fff';

  // Date range (only shown when booked)
  const dateRangeText = !datesKnown
    ? `Day ${b.checkInDay} → Day ${b.checkOutDay}`
    : `${formatShortDate(computeDateForDay(tripStartDate, b.checkInDay))} → ${formatShortDate(computeDateForDay(tripStartDate, b.checkOutDay))}`;

  return (
    <Pressable
      onPress={() => onViewStay(b.hotel, b.reservation)}
      onLayout={(e) => { measuredWidthRef.current = e.nativeEvent.layout.width; }}
      style={({ pressed }) => [
        s.card,
        gridMode ? s.cardGrid : { height: cardHeight },
        pressed && { opacity: 0.85 },
        isCancelled && { opacity: 0.5 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`View ${b.hotel.title}`}
    >
      {/* Full-bleed photo sized to natural aspect ratio */}
      {photoUrl ? (
        <ExpoImage
          source={{ uri: photoUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          onLoad={(e) => {
            if (gridMode) return;
            const { width: imgW, height: imgH } = e.source;
            if (imgW > 0 && imgH > 0) {
              const w = measuredWidthRef.current || FALLBACK_CARD_WIDTH;
              const natural = w / (imgW / imgH);
              setCardHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(natural))));
            }
          }}
        />
      ) : (
        <LinearGradient
          colors={[theme.primary + '30', theme.primary + '10']}
          style={[StyleSheet.absoluteFill, s.placeholder]}
        >
          <SymbolView name="building.2.fill" size={32} tintColor={theme.textSecondary} />
        </LinearGradient>
      )}

      {/* Gradient overlay for text legibility */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.6)']}
        locations={[0.35, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Status badge — top right */}
      <View style={s.statusPos}>
        <View style={[s.statusBadge, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
          {statusText !== 'Not Booked' && <View style={[s.statusDot, { backgroundColor: statusColor }]} />}
          <ThemedText style={[s.statusLabel, { color: '#fff' }]}>{statusText}</ThemedText>
        </View>
      </View>

      {/* Text overlay — bottom */}
      <View style={s.overlay}>
        <ThemedText
          style={[s.hotelName, isCancelled && { textDecorationLine: 'line-through' }]}
          numberOfLines={1}
        >
          {b.hotel.title}
        </ThemedText>
        {booked && (
          <ThemedText style={s.meta}>
            {dateRangeText} · {b.nights.length} night{b.nights.length !== 1 ? 's' : ''}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
});

const s = StyleSheet.create({
  card: {
    marginTop: 0,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  cardGrid: {
    width: '100%',
    aspectRatio: 5 / 6,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPos: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
  },
  hotelName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  meta: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
});
