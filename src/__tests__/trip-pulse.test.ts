import { runTripPulse, ActivityHours } from '@/services/trip-pulse';
import { Trip, Activity } from '@/context/trips';
import { TravelProfile } from '@/context/profile';
import type { TripWeatherForecast } from '@/services/weather';
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
  test('detects hard schedule conflicts (same start time)', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00', duration: 120 }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '09:00', duration: 60 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, []);
    expect(alerts.some((a) => a.type === 'conflict')).toBe(true);
  });

  test('detects hard schedule conflicts (explicit duration overlap)', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00', duration: 120 }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '10:00', duration: 60 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, []);
    expect(alerts.some((a) => a.type === 'conflict')).toBe(true);
  });

  test('does not flag soft overlaps from default durations', () => {
    // Dinner at 19:00 with no explicit duration, walk at 19:45 — should NOT conflict
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Dinner', day: 1, time: '19:00', duration: undefined as any }),
      makeActivity({ id: '2', title: 'Walk', day: 1, time: '19:45', duration: 30 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'conflict')).toBe(false);
  });

  test('no longer flags empty days', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00' }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => (a.type as string) === 'empty_day')).toBe(false);
  });

  test('no longer flags pace mismatch', () => {
    const activities: Activity[] = Array.from({ length: 4 }, (_, i) =>
      makeActivity({ id: String(i), title: `Act${i}`, day: 1, time: `${9 + i * 2}:00` })
    );
    const trip = makeTrip(activities);
    const profile = { ...DEFAULT_PROFILE, pace: 'relaxed' as const };
    const alerts = runTripPulse(trip, profile, [], Infinity);
    expect(alerts.some((a) => (a.type as string) === 'optimization')).toBe(false);
  });

  test('no longer flags meal gaps', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Morning visit', day: 1, time: '09:00', duration: 90 }),
      makeActivity({ id: '2', title: 'Afternoon tour', day: 1, time: '14:00', duration: 120 }),
      makeActivity({ id: '3', title: 'Evening show', day: 1, time: '18:00', duration: 90 }),
      makeActivity({ id: '4', title: 'Day 2', day: 2, time: '10:00' }),
      makeActivity({ id: '5', title: 'Day 3', day: 3, time: '10:00' }),
    ];
    const trip = makeTrip(activities);
    const profile = { ...DEFAULT_PROFILE, foodImportance: 'big' as const };
    const alerts = runTripPulse(trip, profile, [], Infinity);
    expect(alerts.some((a) => (a.type as string) === 'meal_gap')).toBe(false);
  });

  test('limits alerts to 5', () => {
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
    expect(alerts.length).toBe(0);
  });

  test('detects closure from activity hours data', () => {
    // Activity scheduled on Tuesday, but hours say it is closed on Tuesdays
    // 2026-06-01 is a Monday, so day 2 (2026-06-02) is a Tuesday
    const activities: Activity[] = [
      makeActivity({ id: 'museum', title: 'Museum', day: 2, time: '10:00', duration: 120 }),
      makeActivity({ id: '2', title: 'Day 1', day: 1, time: '10:00' }),
      makeActivity({ id: '3', title: 'Day 3', day: 3, time: '10:00' }),
    ];
    const hours: ActivityHours[] = [
      {
        activityId: 'museum',
        periods: ['Mon: 9:00-17:00', 'Tue: Closed', 'Wed: 9:00-17:00'],
        confident: true,
      },
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity, null, hours);
    expect(alerts.some((a) => a.type === 'closure')).toBe(true);
    expect(alerts.find((a) => a.type === 'closure')?.severity).toBe('urgent');
  });

  test('detects weather alerts for outdoor activities', () => {
    const activities: Activity[] = [
      makeActivity({ id: 'beach', title: 'Beach Day', day: 1, time: '10:00', category: 'beach' }),
      makeActivity({ id: '2', title: 'Day 2', day: 2, time: '10:00' }),
      makeActivity({ id: '3', title: 'Day 3', day: 3, time: '10:00' }),
    ];
    const weather: TripWeatherForecast = {
      days: [
        { date: '2026-06-01', precipitationProbability: 80, weatherCode: 61, temperatureMax: 22, temperatureMin: 16 },
        { date: '2026-06-02', precipitationProbability: 10, weatherCode: 0, temperatureMax: 28, temperatureMin: 20 },
        { date: '2026-06-03', precipitationProbability: 5, weatherCode: 0, temperatureMax: 30, temperatureMin: 22 },
      ],
      fetchedAt: Date.now(),
    };
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity, weather);
    expect(alerts.some((a) => a.type === 'weather')).toBe(true);
    expect(alerts.find((a) => a.type === 'weather')?.severity).toBe('important');
  });

  test('no weather alert for indoor activities on rainy day', () => {
    const activities: Activity[] = [
      makeActivity({ id: 'museum', title: 'Museum Visit', day: 1, time: '10:00', type: 'activity', category: 'museum' }),
      makeActivity({ id: '2', title: 'Day 2', day: 2, time: '10:00' }),
      makeActivity({ id: '3', title: 'Day 3', day: 3, time: '10:00' }),
    ];
    const weather: TripWeatherForecast = {
      days: [
        { date: '2026-06-01', precipitationProbability: 90, weatherCode: 63, temperatureMax: 18, temperatureMin: 12 },
        { date: '2026-06-02', precipitationProbability: 10, weatherCode: 0, temperatureMax: 25, temperatureMin: 18 },
        { date: '2026-06-03', precipitationProbability: 5, weatherCode: 0, temperatureMax: 27, temperatureMin: 19 },
      ],
      fetchedAt: Date.now(),
    };
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity, weather);
    expect(alerts.some((a) => a.type === 'weather')).toBe(false);
  });
});

describe('flight conflict detection', () => {
  test('flags activity too close after arrival', () => {
    const activities: Activity[] = [
      makeActivity({ id: 'flight', title: 'Arrive Tokyo', day: 1, time: '14:00', duration: 0, type: 'flight' }),
      makeActivity({ id: 'act', title: 'City Tour', day: 1, time: '14:30', duration: 120 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'flight_conflict')).toBe(true);
    expect(alerts.find((a) => a.type === 'flight_conflict')?.severity).toBe('urgent');
  });

  test('flags activity too close before departure', () => {
    const activities: Activity[] = [
      makeActivity({ id: 'act', title: 'Last Lunch', day: 3, time: '12:00', duration: 90 }),
      makeActivity({ id: 'flight', title: 'Depart Tokyo', day: 3, time: '14:00', duration: 0, type: 'flight' }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'flight_conflict')).toBe(true);
  });

  test('no alert when activity is well after arrival', () => {
    const activities: Activity[] = [
      makeActivity({ id: 'flight', title: 'Arrive Tokyo', day: 1, time: '10:00', duration: 0, type: 'flight' }),
      makeActivity({ id: 'act', title: 'Dinner', day: 1, time: '19:00', duration: 90 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'flight_conflict')).toBe(false);
  });

  test('no alert when activity is well before departure', () => {
    const activities: Activity[] = [
      makeActivity({ id: 'act', title: 'Morning walk', day: 3, time: '08:00', duration: 60 }),
      makeActivity({ id: 'flight', title: 'Depart Tokyo', day: 3, time: '18:00', duration: 0, type: 'flight' }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'flight_conflict')).toBe(false);
  });

  test('does not flag flights against activities on different days', () => {
    const activities: Activity[] = [
      makeActivity({ id: 'flight', title: 'Arrive Tokyo', day: 1, time: '22:00', duration: 0, type: 'flight' }),
      makeActivity({ id: 'act', title: 'Breakfast', day: 2, time: '08:00', duration: 60 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'flight_conflict')).toBe(false);
  });
});

describe('sunset/sunrise mismatch detection', () => {
  test('flags sunset activity scheduled in the morning', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Sunset at Shibuya', day: 1, time: '09:00', lat: 35.66 }),
    ];
    // June 1 in Tokyo — sunset ~19:00
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'sunset_mismatch')).toBe(true);
  });

  test('does not flag sunset activity at evening time', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Sunset at Shibuya', day: 1, time: '18:30', lat: 35.66 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'sunset_mismatch')).toBe(false);
  });

  test('flags sunrise activity scheduled in the afternoon', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Sunrise hike', day: 1, time: '14:00', lat: 35.66 }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'sunset_mismatch')).toBe(true);
  });

  test('does not flag non-sunset activities', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Visit temple', day: 1, time: '09:00' }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'sunset_mismatch')).toBe(false);
  });
});

describe('duplicate activity detection', () => {
  test('flags identical titles on the same day', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Tokyo Tower', day: 1, time: '09:00' }),
      makeActivity({ id: '2', title: 'Tokyo Tower', day: 1, time: '15:00' }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'duplicate')).toBe(true);
  });

  test('flags same placeId on the same day', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Tokyo Tower Morning', day: 1, time: '09:00', placeId: 'place123' }),
      makeActivity({ id: '2', title: 'Tokyo Tower Evening', day: 1, time: '18:00', placeId: 'place123' }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'duplicate')).toBe(true);
  });

  test('does not flag same title on different days', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Morning Run', day: 1, time: '07:00' }),
      makeActivity({ id: '2', title: 'Morning Run', day: 2, time: '07:00' }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'duplicate')).toBe(false);
  });

  test('does not flag different activities on the same day', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Tokyo Tower', day: 1, time: '09:00' }),
      makeActivity({ id: '2', title: 'Senso-ji Temple', day: 1, time: '14:00' }),
    ];
    const trip = makeTrip(activities);
    const alerts = runTripPulse(trip, DEFAULT_PROFILE, [], Infinity);
    expect(alerts.some((a) => a.type === 'duplicate')).toBe(false);
  });
});

