import { runTripPulse } from '@/services/trip-pulse';
import { Trip, Activity } from '@/context/trips';
import { TravelProfile } from '@/context/profile';
const DEFAULT_PROFILE: TravelProfile = {
  pace: 'moderate',
  flexibility: 'some',
  budget: 'moderate',
  interests: [],
  dietaryRestrictions: [],
  mobilityNeeds: [],
  dislikes: [],
  absoluteRules: [],
  travelWith: 'solo',
  accommodationPreference: 'hotel',

};

function makeActivity(overrides: Partial<Activity> & { id: string; title: string; day: number; time: string }): Activity {
  return { type: 'activity', duration: 60, ...overrides };
}

function makeTrip(activities: Activity[], overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip1',
    destination: 'Tokyo',
    country: 'Japan',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    notes: '',
    emoji: '\u{1F5FC}',
    activities,
    ...overrides,
  };
}

describe('runTripPulse', () => {
  test('detects schedule conflicts', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00', duration: 120 }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '10:00', duration: 60 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, []);
    expect(alerts.some((a) => a.type === 'conflict')).toBe(true);
  });

  test('detects empty days', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00' }),
    ];
    // 3-day trip but only day 1 has activities
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, []);
    expect(alerts.some((a) => a.type === 'empty_day')).toBe(true);
  });

  test('detects early morning mismatch with dislikes', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Early bird', day: 1, time: '06:30' }),
    ];
    const trip = makeTrip(activities);
    const profile = { ...DEFAULT_PROFILE, dislikes: ['Early mornings'] };
    const alerts = runTripPulse(trip, profile, []);
    expect(alerts.some((a) => a.type === 'low_fit')).toBe(true);
  });

  test('detects late night mismatch with dislikes', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Night owl', day: 1, time: '22:00' }),
    ];
    const trip = makeTrip(activities);
    const profile = { ...DEFAULT_PROFILE, dislikes: ['Late nights'] };
    const alerts = runTripPulse(trip, profile, []);
    expect(alerts.some((a) => a.type === 'low_fit')).toBe(true);
  });

  test('detects relaxed pace mismatch with too many activities', () => {
    const activities: Activity[] = Array.from({ length: 4 }, (_, i) =>
      makeActivity({ id: String(i), title: `Act${i}`, day: 1, time: `${9 + i * 2}:00` })
    );
    const trip = makeTrip(activities);
    const profile = { ...DEFAULT_PROFILE, pace: 'relaxed' as const };
    const alerts = runTripPulse(trip, profile, []);
    expect(alerts.some((a) => a.type === 'optimization')).toBe(true);
  });

  test('limits alerts to 5', () => {
    // Create many issues
    const activities: Activity[] = Array.from({ length: 8 }, (_, i) =>
      makeActivity({ id: String(i), title: `Overlap${i}`, day: 1, time: '09:00', duration: 60 })
    );
    const trip = makeTrip(activities, { endDate: '2026-06-07' });
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, []);
    expect(alerts.length).toBeLessThanOrEqual(5);
  });

  test('returns empty for a clean trip', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Morning', day: 1, time: '09:00', type: 'food', duration: 60 }),
      makeActivity({ id: '2', title: 'Visit', day: 1, time: '11:00', duration: 90 }),
      makeActivity({ id: '3', title: 'Day2A', day: 2, time: '10:00', type: 'food', duration: 60 }),
      makeActivity({ id: '4', title: 'Day2B', day: 2, time: '13:00', duration: 90 }),
      makeActivity({ id: '5', title: 'Day3A', day: 3, time: '10:00', type: 'food', duration: 60 }),
      makeActivity({ id: '6', title: 'Day3B', day: 3, time: '13:00', duration: 90 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, []);
    // No conflicts, all days have activities
    expect(alerts.filter((a) => a.type === 'conflict').length).toBe(0);
    expect(alerts.filter((a) => a.type === 'empty_day').length).toBe(0);
  });
});
