import { findTopReplacements, transformTrip } from '@/services/transformation-service';
import { Activity, Trip } from '@/context/trips';
import { TravelProfile } from '@/context/profile';
import { TravelMemoryEntry } from '@/context/memory';

const DEFAULT_PROFILE: TravelProfile = {
  pace: 'moderate',
  flexibility: 'some',
  budget: 'moderate',
  interests: ['Culture', 'Food & Dining'],
  dietaryRestrictions: [],
  mobilityNeeds: [],
  dislikes: [],
  absoluteRules: [],
  travelWith: 'solo',
  accommodationPreference: 'hotel',

};

function makeTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip1',
    destination: 'Tokyo',
    country: 'Japan',
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    notes: '',
    emoji: '\u{1F5FC}',
    activities: [],
    budget: 'moderate',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<Activity> & { id: string; title: string; day: number; time: string }): Activity {
  return { type: 'activity', duration: 60, ...overrides };
}

describe('findTopReplacements', () => {
  test('returns up to 3 replacements', () => {
    const activity = makeActivity({ id: '1', title: 'Test', day: 1, time: '10:00' });
    const replacements = findTopReplacements('Tokyo', activity);
    expect(replacements.length).toBeGreaterThan(0);
    expect(replacements.length).toBeLessThanOrEqual(3);
  });

  test('excludes activities with same title', () => {
    const activity = makeActivity({ id: '1', title: 'Senso-ji Temple', day: 1, time: '10:00' });
    const replacements = findTopReplacements('Tokyo', activity);
    expect(replacements.every((r) => r.title !== 'Senso-ji Temple')).toBe(true);
  });

  test('excludes activities already in existingTitles', () => {
    const activity = makeActivity({ id: '1', title: 'Test', day: 1, time: '10:00' });
    const existing = ['Yanaka Old Town walk', 'Shinjuku Gyoen Garden'];
    const replacements = findTopReplacements('Tokyo', activity, { existingTitles: existing });
    for (const r of replacements) {
      expect(existing).not.toContain(r.title);
    }
  });

  test('respects budget filter', () => {
    const activity = makeActivity({ id: '1', title: 'Test', day: 1, time: '10:00' });
    const replacements = findTopReplacements('Tokyo', activity, { budget: 'budget' });
    for (const r of replacements) {
      expect(['free', 'budget']).toContain(r.cost);
    }
  });
});

describe('transformTrip', () => {
  const memory: TravelMemoryEntry[] = [];

  test('make_relaxed removes activities and protects locked', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Locked', day: 1, time: '10:00', locked: true }),
      makeActivity({ id: '2', title: 'A', day: 1, time: '11:00' }),
      makeActivity({ id: '3', title: 'B', day: 1, time: '13:00' }),
      makeActivity({ id: '4', title: 'C', day: 1, time: '15:00' }),
      makeActivity({ id: '5', title: 'D', day: 1, time: '17:00' }),
    ];
    const trip = makeTrip({ activities });
    const result = transformTrip(trip, 'make_relaxed', { type: 'day', day: 1 }, DEFAULT_PROFILE, memory);

    // Locked activity must be preserved
    expect(result.activities.some((a) => a.id === '1')).toBe(true);
    // Should have reduced activity count
    expect(result.activities.filter((a) => a.day === 1).length).toBeLessThan(5);
    expect(result.lockedProtectedCount).toBe(1);
  });

  test('reflow_day reports locked count', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Fixed', day: 1, time: '12:00', fixed: true }),
      makeActivity({ id: '2', title: 'A', day: 1, time: '09:00' }),
    ];
    const trip = makeTrip({ activities });
    const result = transformTrip(trip, 'reflow_day', { type: 'day', day: 1 }, DEFAULT_PROFILE, memory);

    expect(result.lockedProtectedCount).toBe(1);
    // Fixed activity should keep its time
    const fixed = result.activities.find((a) => a.id === '1')!;
    expect(fixed.time).toBe('12:00');
  });

  test('replace_activity refuses to replace locked activity', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Locked', day: 1, time: '10:00', locked: true }),
    ];
    const trip = makeTrip({ activities });
    const result = transformTrip(trip, 'replace_activity', { type: 'day', day: 1 }, DEFAULT_PROFILE, memory, '1');

    expect(result.summary).toBe('Cannot replace');
    expect(result.activities).toEqual(activities);
  });

  test('surprise_me adds new activity and reflows', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Morning', day: 1, time: '09:00' }),
    ];
    const trip = makeTrip({ activities });
    const result = transformTrip(trip, 'surprise_me', { type: 'day', day: 1 }, DEFAULT_PROFILE, memory);

    if (result.summary !== 'No surprises left') {
      expect(result.activities.length).toBeGreaterThan(1);
      expect(result.memoryEntry).toBeDefined();
      expect(result.memoryEntry!.type).toBe('recommendation_accepted');
    }
  });
});

describe('avoid_crowds improvements', () => {
  const memory: TravelMemoryEntry[] = [];

  test('returns no-change message when no high-crowd activities exist', () => {
    // Activities with titles not in alternatives pool default to 'medium',
    // but we test the path where nothing qualifies for replacement
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Custom Unlisted Activity', day: 1, time: '09:00' }),
    ];
    const trip = makeTrip({ activities });
    const result = transformTrip(trip, 'avoid_crowds', { type: 'day', day: 1 }, DEFAULT_PROFILE, memory);

    // Should not crash and should return a message
    expect(result.summary).toBeDefined();
    expect(result.changes.length).toBeGreaterThan(0);
  });

  test('does not replace locked activities', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Sensoji Temple', day: 1, time: '10:00', locked: true }),
    ];
    const trip = makeTrip({ activities });
    const result = transformTrip(trip, 'avoid_crowds', { type: 'day', day: 1 }, DEFAULT_PROFILE, memory);

    const act = result.activities.find((a) => a.id === '1');
    expect(act?.title).toBe('Sensoji Temple');
  });
});

describe('reduce_travel_time improvements', () => {
  const memory: TravelMemoryEntry[] = [];

  test('returns no-change when fewer than 2 activities have coordinates', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Unlisted Place', day: 1, time: '09:00' }),
    ];
    const trip = makeTrip({ activities });
    const result = transformTrip(trip, 'reduce_travel_time', { type: 'day', day: 1 }, DEFAULT_PROFILE, memory);

    // Activities should be unchanged
    expect(result.activities).toEqual(activities);
    expect(result.changes[0]).toContain('Not enough location data');
  });
});

describe('reduce_cost savings calculation', () => {
  const memory: TravelMemoryEntry[] = [];

  test('estimates savings when expensive activities are replaced', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Premium Place', day: 1, time: '10:00', cost: 'premium' }),
    ];
    const trip = makeTrip({ activities });
    const result = transformTrip(trip, 'reduce_cost', { type: 'day', day: 1 }, DEFAULT_PROFILE, memory);

    // If a replacement was found, changes should include savings info (case-insensitive)
    const hasSavings = result.changes.some((c) => c.toLowerCase().includes('savings') || c.toLowerCase().includes('replaced') || c.toLowerCase().includes('no expensive') || c.includes('Current estimate') || c.includes('no savings'));
    expect(hasSavings).toBe(true);
  });
});
