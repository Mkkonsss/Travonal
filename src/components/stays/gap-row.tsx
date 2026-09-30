import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Image as ExpoImage } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { formatNightRange } from '@/services/trip-helpers';
import type { NormalizedPlace } from '@/services/place-model';

interface GapRowProps {
  start: number;
  end: number;
  avgPerNight?: number;
  currSymbol: string;
  suggestions?: NormalizedPlace[];
  suggestionPhotos?: Map<string, string>;
  theme: {
    primary: string;
    background: string;
    border: string;
    textSecondary: string;
  };
  onAddStay: (day: number) => void;
  onBookSuggestion?: (hotel: NormalizedPlace) => void;
}

export const GapRow = memo(function GapRow({
  start,
  end,
  avgPerNight,
  currSymbol,
  suggestions,
  suggestionPhotos,
  theme,
  onAddStay,
  onBookSuggestion,
}: GapRowProps) {
  const nightCount = end - start + 1;

  return (
    <View style={s.container}>
      <View style={[s.gapHeader, { borderColor: theme.border }]}>
        <View style={s.gapLeft}>
          <ThemedText style={[s.gapText, { color: theme.textSecondary }]}>
            {formatNightRange(start, end)} — No stay
          </ThemedText>
          {avgPerNight != null && avgPerNight > 0 && (
            <ThemedText style={[s.estimate, { color: theme.textSecondary }]}>
              ~{currSymbol}{Math.round(avgPerNight * nightCount).toLocaleString()} est.
            </ThemedText>
          )}
        </View>
        <Pressable
          onPress={() => onAddStay(start)}
          hitSlop={8}
          style={({ pressed }) => [s.addBtn, { backgroundColor: theme.primary }, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={`Add stay for ${formatNightRange(start, end)}`}
        >
          <SymbolView name="plus" size={10} tintColor={theme.background} />
          <ThemedText style={[s.addBtnText, { color: theme.background }]}>Add Stay</ThemedText>
        </Pressable>
      </View>

      {/* Gap suggestions */}
      {suggestions && suggestions.length > 0 && onBookSuggestion && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.suggestScroll}>
          {suggestions.slice(0, 3).map((hotel) => {
            const photoUrl = suggestionPhotos?.get(hotel.placeId ?? hotel.name);
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
                    <SymbolView name="building.2.fill" size={20} tintColor={theme.textSecondary} />
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
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  container: {
    marginTop: 10,
  },
  gapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radius.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  gapLeft: {
    flex: 1,
  },
  gapText: {
    fontSize: 12,
  },
  estimate: {
    fontSize: 10,
    marginTop: 2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  addBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  suggestScroll: {
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 2,
  },
  suggestCard: {
    width: 160,
    borderRadius: 12,
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
});
