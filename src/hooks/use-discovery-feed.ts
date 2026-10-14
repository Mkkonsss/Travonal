/**
 * Hook that coordinates the discovery feed algorithm, tracking, and UI state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExploreLocation } from '@/services/explore-service';
import {
  DiscoveryCard,
  initDiscoveryFeed,
  getNextCards,
  resetDiscoveryFeed,
} from '@/services/discovery-feed';
import {
  recordInteraction,
  markDismissed,
} from '@/services/discovery-tracking';
import { useProfile } from '@/context/profile';

const BATCH_SIZE = 5;

export function useDiscoveryFeed(location: ExploreLocation | null) {
  const { profile } = useProfile();
  const [cards, setCards] = useState<DiscoveryCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const fetchingRef = useRef(false);
  const locationRef = useRef<string | null>(null);

  // Initialize feed when location changes
  useEffect(() => {
    if (!location) return;

    const locKey = `${location.type}:${location.label}`;
    if (locKey === locationRef.current) return;
    locationRef.current = locKey;

    setCards([]);
    setInitialLoading(true);
    fetchingRef.current = false;

    (async () => {
      await initDiscoveryFeed(location, profile);
      const initial = await getNextCards(BATCH_SIZE);
      setCards(initial);
      setInitialLoading(false);
    })().catch((e) => {
      if (__DEV__) console.warn('[DiscoveryFeed] Init error:', e);
      setInitialLoading(false);
    });

    return () => {
      resetDiscoveryFeed();
    };
  }, [location?.type, location?.label, profile]);

  // Fetch more cards when nearing the end
  const fetchMore = useCallback(async () => {
    if (fetchingRef.current || !location) return;
    fetchingRef.current = true;
    setLoading(true);

    try {
      const more = await getNextCards(BATCH_SIZE);
      if (more.length > 0) {
        setCards((prev) => [...prev, ...more]);
      }
    } catch (e) {
      if (__DEV__) console.warn('[DiscoveryFeed] Fetch more error:', e);
    }

    setLoading(false);
    fetchingRef.current = false;
  }, [location]);

  const onCardViewed = useCallback((index: number) => {
    const card = cards[index];
    if (card?.place.placeId) {
      recordInteraction(card.place.placeId, 'skip', card.place.category);
    }
  }, [cards]);

  const onSave = useCallback((card: DiscoveryCard) => {
    if (card.place.placeId) {
      recordInteraction(card.place.placeId, 'save', card.place.category);
    }
  }, []);

  const onAddToTrip = useCallback((card: DiscoveryCard) => {
    if (card.place.placeId) {
      recordInteraction(card.place.placeId, 'add_to_trip', card.place.category);
    }
  }, []);

  const onViewDetail = useCallback((card: DiscoveryCard) => {
    if (card.place.placeId) {
      recordInteraction(card.place.placeId, 'view_detail', card.place.category);
    }
  }, []);

  const onDismiss = useCallback((card: DiscoveryCard) => {
    if (card.place.placeId) {
      markDismissed(card.place.placeId);
      recordInteraction(card.place.placeId, 'dismiss', card.place.category);
    }
    setCards((prev) => prev.filter((c) => c.place.placeId !== card.place.placeId));
  }, []);

  return {
    cards,
    loading,
    initialLoading,
    fetchMore,
    onCardViewed,
    onSave,
    onAddToTrip,
    onViewDetail,
    onDismiss,
  };
}
