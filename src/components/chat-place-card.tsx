import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getPlacePhotoAI, type ChatPlace } from '@/services/ai';
import { formatGoogleTypes } from '@/services/place-model';

export { type ChatPlace } from '@/services/ai';

export function usePlacePhoto(ref: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    getPlacePhotoAI({ reference: ref, maxWidth: 400 }).then(({ url: u }) => {
      if (!cancelled) setUrl(u);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ref]);
  return url;
}

export const ChatPlaceCard = memo(function ChatPlaceCard({
  place,
  onAddToTrip,
  onSaveToBoard,
  isPrimary,
}: {
  place: ChatPlace;
  onAddToTrip: () => void;
  onSaveToBoard: () => void;
  isPrimary?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const photoUrl = usePlacePhoto(place.photoRefs?.[0]);

  function openDetail() {
    let url = `/place-detail?name=${encodeURIComponent(place.name)}`;
    if (place.placeId) url += `&placeId=${encodeURIComponent(place.placeId)}`;
    if (place.address) url += `&address=${encodeURIComponent(place.address)}`;
    if (place.rating != null) url += `&rating=${place.rating}`;
    if (place.ratingCount != null) url += `&reviewCount=${place.ratingCount}`;
    if (place.lat != null) url += `&lat=${place.lat}`;
    if (place.lng != null) url += `&lng=${place.lng}`;
    router.push(url as any);
  }

  const typeLabel = place.primaryTypeLabel || formatGoogleTypes(place.types);

  return (
    <Pressable
      onPress={openDetail}
      style={({ pressed }) => [
        placeStyles.card,
        isPrimary && placeStyles.cardPrimary,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`View ${place.name}`}
    >
      {photoUrl ? (
        <ExpoImage source={{ uri: photoUrl }} style={[placeStyles.cardImage, isPrimary && placeStyles.cardImagePrimary]} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[placeStyles.cardImage, isPrimary && placeStyles.cardImagePrimary, { backgroundColor: theme.border }]}>
          <SymbolView name="mappin" size={22} tintColor={theme.textSecondary} />
        </View>
      )}
      <View style={placeStyles.cardInfo}>
        <ThemedText style={placeStyles.cardName} numberOfLines={2}>{place.name}</ThemedText>
        <View style={placeStyles.cardMeta}>
          {place.rating != null && (
            <View style={placeStyles.ratingRow}>
              <SymbolView name="star.fill" size={10} tintColor="#F59E0B" />
              <ThemedText style={placeStyles.ratingText}>{place.rating.toFixed(1)}</ThemedText>
            </View>
          )}
          {typeLabel ? (
            <ThemedText style={[placeStyles.typeText, { color: theme.textSecondary }]} numberOfLines={1}>
              {typeLabel}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <View style={[placeStyles.actionRow, { borderTopColor: theme.border }]}>
        <Pressable
          onPress={(e) => { e.stopPropagation(); onAddToTrip(); }}
          hitSlop={4}
          style={({ pressed }) => [placeStyles.actionBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${place.name} to trip`}
        >
          <SymbolView name="plus.circle" size={14} tintColor={theme.primary} />
        </Pressable>
        <View style={[placeStyles.actionDivider, { backgroundColor: theme.border }]} />
        <Pressable
          onPress={(e) => { e.stopPropagation(); onSaveToBoard(); }}
          hitSlop={4}
          style={({ pressed }) => [placeStyles.actionBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`Save ${place.name} to board`}
        >
          <SymbolView name="bookmark" size={14} tintColor={theme.primary} />
        </Pressable>
      </View>
    </Pressable>
  );
});

export const placeStyles = StyleSheet.create({
  card: {
    width: 180,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardPrimary: {
    width: 220,
  },
  cardImage: {
    width: '100%',
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImagePrimary: {
    height: 110,
  },
  cardInfo: {
    padding: 10,
    gap: 3,
  },
  cardName: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '600',
  },
  typeText: {
    fontSize: 11,
  },
  actionRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
  },
  actionDivider: {
    width: StyleSheet.hairlineWidth,
  },
  cardsScroll: {
    marginTop: 8,
    marginBottom: 10,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  cardsContainer: {
    gap: 10,
    paddingRight: 4,
  },
});
