/**
 * BookingPhotoPrefetcher — background component that kicks off photo fetching
 * for all confirmed reservations as soon as trip data is available.
 *
 * Renders nothing. By the time the user opens My Bookings, the photos are
 * already cached in memory so they appear instantly instead of after a 2-3s delay.
 */

import { useMemo } from 'react';
import { useTrips } from '@/context/trips';
import { useBookings } from '@/context/bookings';
import { useActivityPhotos, ActivityNameHint } from '@/hooks/use-activity-photos';

export function BookingPhotoPrefetcher() {
  const { trips } = useTrips();
  const { standaloneBookings } = useBookings();

  const hints = useMemo((): ActivityNameHint[] => {
    const result: ActivityNameHint[] = [];
    for (const trip of trips) {
      for (const res of trip.reservations ?? []) {
        if (!res.cancelled) {
          result.push({
            key: `${res.title}::${trip.destination}`,
            name: res.title,
            destination: trip.destination,
          });
        }
      }
    }
    for (const res of standaloneBookings) {
      if (!res.cancelled) {
        result.push({
          key: `${res.title}::standalone`,
          name: res.title,
          destination: res.address || undefined,
        });
      }
    }
    return result;
  }, [trips, standaloneBookings]);

  // Calling the hook triggers the fetch + cache side-effect; return value unused.
  useActivityPhotos([], undefined, hints);

  return null;
}
