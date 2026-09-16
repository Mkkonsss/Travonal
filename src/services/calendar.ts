import { Trip } from '@/context/trips';
import { getTripDayCount } from '@/services/itinerary-engine';

export type TripDayInfo = {
  state: 'past' | 'active' | 'upcoming';
  tripId: string;
  destination: string;
  emoji: string;
  dayNumber: number;
  totalDays: number;
};

export function buildTripDayMap(
  trips: Trip[],
  getTripState: (trip: Trip) => string,
  year: number,
) {
  const map = new Map<string, TripDayInfo[]>();

  for (const trip of trips) {
    const state = getTripState(trip);
    // Skip drafts and planned trips (planned have placeholder dates, not calendar-accurate)
    if (state === 'draft' || state === 'planned') continue;

    // Use the shared UTC-safe day counter so DST boundaries are handled correctly.
    const totalDays = getTripDayCount(trip.startDate, trip.endDate);

    // Iterate day-by-day using UTC midnight timestamps to avoid DST shifts.
    const [sy, sm, sd] = trip.startDate.split('-').map(Number);
    const [ey, em, ed] = trip.endDate.split('-').map(Number);
    let cursorMs = Date.UTC(sy, sm - 1, sd);
    const endMs = Date.UTC(ey, em - 1, ed);
    let dayNum = 1;

    while (cursorMs <= endMs) {
      const cursorDate = new Date(cursorMs);
      const cursorYear = cursorDate.getUTCFullYear();
      const cursorMonth = cursorDate.getUTCMonth();
      const cursorDay = cursorDate.getUTCDate();

      if (cursorYear === year) {
        const key = `${cursorMonth}-${cursorDay}`;
        const mappedState = state === 'active' ? 'active' : state === 'past' ? 'past' : 'upcoming';
        const existing = map.get(key) ?? [];
        if (!existing.some((e) => e.tripId === trip.id)) {
          existing.push({
            state: mappedState as 'past' | 'active' | 'upcoming',
            tripId: trip.id,
            destination: trip.destination,
            emoji: trip.emoji,
            dayNumber: dayNum,
            totalDays,
          });
          map.set(key, existing);
        }
      }

      cursorMs += 86400000; // exactly one UTC day
      dayNum++;
    }
  }

  return map;
}
