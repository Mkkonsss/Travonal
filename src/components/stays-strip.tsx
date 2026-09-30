import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Activity, Reservation, Trip } from '@/context/trips';
import type { StaysData } from '@/components/stays-section';
import type { NormalizedPlace } from '@/services/place-model';

import { StayCard } from '@/components/stays/stay-card';

export interface StaysStripProps {
  trip: Trip;
  staysData: StaysData;
  totalDays: number;
  hotelSuggestions: NormalizedPlace[];
  hotelPhotoUrls: Map<string, string>;
  activityPhotos: Map<string, string>;
  onAddStay: (prefilledDay?: number) => void;
  onViewStay: (activity: Activity, reservation?: Reservation) => void;
  onBookSuggestion: (hotel: NormalizedPlace) => void;
  onBrowseMore: () => void;
}

export const StaysStrip = memo(function StaysStrip({
  trip,
  staysData,
  totalDays,
  hotelSuggestions,
  hotelPhotoUrls,
  activityPhotos,
  onAddStay,
  onViewStay,
  onBookSuggestion,
  onBrowseMore,
}: StaysStripProps) {
  const theme = useTheme();
  const { blocks, hasAnyStay } = staysData;
  const datesKnown = trip.datesKnown !== false;

  // ── Add button (reused in header) ──
  const addButton = (
    <Pressable
      onPress={() => onAddStay()}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Add stay"
    >
      <SymbolView name="plus" size={14} tintColor={theme.text} />
    </Pressable>
  );

  // ── EMPTY STATE ──
  if (!hasAnyStay) {
    return (
      <Animated.View entering={FadeInDown.duration(300)} style={s.container}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            <ThemedText style={s.headerTitle}>Stays</ThemedText>
            <ThemedText style={[s.headerMeta, { color: theme.textSecondary }]}>
              No stays yet
            </ThemedText>
          </View>
          {addButton}
        </View>

        {hotelSuggestions.length > 0 && (
          <View style={s.suggestionsBlock}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.suggestScroll}>
              {hotelSuggestions.map((hotel) => {
                const photoUrl = hotelPhotoUrls.get(hotel.placeId ?? hotel.name);
                return (
                  <Pressable
                    key={hotel.placeId ?? hotel.name}
                    onPress={() => onBookSuggestion(hotel)}
                    style={[s.suggestCard, { backgroundColor: theme.background, borderColor: theme.border }]}
                  >
                    {photoUrl ? (
                      <ExpoImage source={{ uri: photoUrl }} style={s.suggestPhoto} contentFit="cover" cachePolicy="memory-disk" />
                    ) : (
                      <View style={[s.suggestPhoto, { backgroundColor: theme.border, alignItems: 'center', justifyContent: 'center' }]}>
                        <SymbolView name="building.2.fill" size={22} tintColor={theme.textSecondary} />
                      </View>
                    )}
                    <View style={s.suggestInfo}>
                      <ThemedText numberOfLines={1} style={s.suggestName}>{hotel.name}</ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        {hotel.rating != null && (
                          <>
                            <SymbolView name="star.fill" size={10} tintColor="#F59E0B" />
                            <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>{hotel.rating.toFixed(1)}</ThemedText>
                          </>
                        )}
                        {hotel.priceLevel != null && (
                          <ThemedText style={{ fontSize: 11, color: theme.textSecondary, marginLeft: 2 }}>
                            {'$'.repeat(hotel.priceLevel)}
                          </ThemedText>
                        )}
                      </View>
                      <View style={[s.bookBtn, { backgroundColor: theme.primary }]}>
                        <ThemedText style={{ color: theme.background, fontSize: 11, fontWeight: '600' }}>Book</ThemedText>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={onBrowseMore}
                style={[s.suggestCard, { backgroundColor: theme.background, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }]}
              >
                <SymbolView name="magnifyingglass" size={18} tintColor={theme.primary} />
                <ThemedText style={{ color: theme.primary, fontSize: 11, fontWeight: '600', marginTop: 4 }}>Browse more</ThemedText>
              </Pressable>
            </ScrollView>
          </View>
        )}
      </Animated.View>
    );
  }

  // ── POPULATED STATE ──
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={s.container}>
      {/* Header — matches day header style */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <ThemedText style={s.headerTitle}>Stays</ThemedText>
          <ThemedText style={[s.headerMeta, { color: theme.textSecondary }]}>
            · {blocks.length} {blocks.length === 1 ? 'stay' : 'stays'}
          </ThemedText>
        </View>
        <View style={s.headerRight}>
          {addButton}
        </View>
      </View>

      {/* Stay cards */}
      <View style={{ gap: 10 }}>
      {blocks.map((b) => {
        const photoUrl = b.hotel.placeId
          ? activityPhotos.get(b.hotel.placeId)
          : hotelPhotoUrls.get(b.hotel.title);
        return (
          <StayCard
            key={b.hotel.id}
            block={b}
            tripStartDate={trip.startDate}
            datesKnown={datesKnown}
            photoUrl={photoUrl}
            theme={theme}
            onViewStay={onViewStay}
          />
        );
      })}
      </View>
    </Animated.View>
  );
});


const s = StyleSheet.create({
  container: {
    marginBottom: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerMeta: {
    fontSize: 13,
    fontWeight: '500',
  },
  // ── Suggestions ──
  suggestionsBlock: {
    marginTop: 10,
  },
  suggestScroll: {
    gap: 8,
    paddingHorizontal: 1,
  },
  suggestCard: {
    width: 160,
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
  suggestPhoto: {
    width: 160,
    height: 72,
  },
  suggestInfo: {
    padding: 6,
    gap: 2,
  },
  suggestName: {
    fontSize: 12,
    fontWeight: '600',
  },
  bookBtn: {
    marginTop: 3,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
});
