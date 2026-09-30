/**
 * MemoryTracker — background component that auto-creates destination-level
 * memory entries when trips transition to "past" status.
 *
 * Mounted in _layout.tsx alongside AppPulseEvaluator.
 */

import { useEffect, useRef } from 'react';
import { useTrips } from '@/context/trips';
import { useMemory } from '@/context/memory';
import { useToast } from '@/context/toast';
import { getTripDayCount } from '@/services/itinerary-engine';

export function MemoryTracker() {
  const { trips, getTripState } = useTrips();
  const { entries, addEntry, setOnFirstEntry, loaded: memoryLoaded } = useMemory();
  const { showToast } = useToast();
  const trackedTrips = useRef(new Set<string>());

  // Register first-memory onboarding toast
  useEffect(() => {
    setOnFirstEntry(() => {
      showToast('Noted — Tripseek will remember this for future trips', 'info');
    });
    return () => setOnFirstEntry(null);
  }, [setOnFirstEntry, showToast]);

  useEffect(() => {
    if (!memoryLoaded) return;

    // Build set of trips that already have destination memory entries
    if (trackedTrips.current.size === 0) {
      for (const e of entries) {
        if (e.type === 'preference_saved' && e.category === 'destination' && e.tripId) {
          trackedTrips.current.add(e.tripId);
        }
      }
    }

    for (const trip of trips) {
      if (trackedTrips.current.has(trip.id)) continue;

      const state = getTripState(trip);
      if (state !== 'past') continue;
      if (trip.activities.length === 0) continue;

      const days = getTripDayCount(trip.startDate, trip.endDate);
      const topTypes = trip.activities
        .filter((a) => a.type === 'activity')
        .reduce((acc, a) => {
          const cat = a.category ?? 'exploring';
          acc.set(cat, (acc.get(cat) ?? 0) + 1);
          return acc;
        }, new Map<string, number>());
      const topCategory = [...topTypes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([cat]) => cat)
        .join(' & ') || 'exploring';

      addEntry({
        type: 'preference_saved',
        category: 'destination',
        detail: `Visited ${trip.destination} (${trip.country}), ${days} days — focused on ${topCategory}`,
        tripId: trip.id,
        isGlobal: true,
        origin: 'Trip completed',
        destination: trip.destination,
      });

      trackedTrips.current.add(trip.id);
    }
  }, [trips, memoryLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
