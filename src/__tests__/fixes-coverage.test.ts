/**
 * Targeted regression tests covering specific fixes in this project.
 * Each test imports and exercises real production functions.
 */

import { parseTextToCommand, extractStartTime } from '@/components/ask-travonal';
import {
  resolveCountry,
  sortTripsForPicker,
  isPulseDismissed,
  makePulseDismissalKey,
  findUndoableChange,
} from '@/services/trip-helpers';
import { generateItinerary } from '@/services/mock-generator';
import { loadTripsSafe } from '@/services/storage';
import { Trip, ChangeRecord, Activity } from '@/context/trips';
import { TravelProfile } from '@/context/profile';
import { transformTrip, TransformScope } from '@/services/transformation-service';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------- shared helpers ----------

function makeTrip(overrides: Partial<Trip> & { id: string; startDate: string; endDate: string }): Trip {
  return {
    destination: 'Tokyo',
    country: 'Japan',
    notes: '',
    emoji: '🗼',
    activities: [],
    status: 'planned',
    ...overrides,
  };
}

const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

const BASE_PROFILE: TravelProfile = {
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

// ============================================================
// 1. parseTextToCommand (ask-travonal.tsx)
// ============================================================

describe('parseTextToCommand — unknown input returns null, not a default command', () => {
  // "xyzzy planner mode" does not match any keyword in parseTextToCommand
  const UNKNOWN_TEXT = 'xyzzy planner mode';

  test('completely unknown text returns command: null', () => {
    const result = parseTextToCommand(UNKNOWN_TEXT);
    expect(result.command).toBeNull();
  });

  test('unknown text returns a non-empty helpful feedback message', () => {
    const result = parseTextToCommand(UNKNOWN_TEXT);
    expect(result.feedback.length).toBeGreaterThan(0);
    expect(result.feedback).toMatch(/try/i);
  });

  test('unknown text does NOT return make_relaxed', () => {
    const result = parseTextToCommand(UNKNOWN_TEXT);
    expect(result.command).not.toBe('make_relaxed');
  });

  test('"Make it cheaper" returns reduce_cost', () => {
    const result = parseTextToCommand('Make it cheaper');
    expect(result.command).toBe('reduce_cost');
  });

  test('"Make day 3 cheaper" returns reduce_cost with extractedDay: 3', () => {
    const result = parseTextToCommand('Make day 3 cheaper');
    expect(result.command).toBe('reduce_cost');
    expect(result.extractedDay).toBe(3);
  });

  test('"save money" returns reduce_cost', () => {
    const result = parseTextToCommand('save money');
    expect(result.command).toBe('reduce_cost');
  });

  test('"I want adventure" returns make_adventurous', () => {
    const result = parseTextToCommand('I want adventure');
    expect(result.command).toBe('make_adventurous');
  });

  test('"relax the schedule" returns make_relaxed', () => {
    const result = parseTextToCommand('relax the schedule');
    expect(result.command).toBe('make_relaxed');
  });

  test('empty string returns null', () => {
    const result = parseTextToCommand('   ');
    expect(result.command).toBeNull();
  });
});

// ============================================================
// 2. resolveCountry (trip-helpers.ts)
// ============================================================

describe('resolveCountry — LA alias removed, substring safety', () => {
  test('"LA" no longer resolves (dangerous 2-char alias removed)', () => {
    // "LA" was removed because it matched inside unrelated strings.
    // It is not in the map and is too short to match as a substring (< 4 chars).
    expect(resolveCountry('LA')).toBeNull();
  });

  test('"Los Angeles" resolves to United States', () => {
    expect(resolveCountry('Los Angeles')).toBe('United States');
  });

  test('"goa" exact match resolves to India', () => {
    // "goa" is in the map as an exact key — length 3, so only exact match applies
    expect(resolveCountry('goa')).toBe('India');
  });

  test('"Lagos" does NOT resolve to India via "goa" substring', () => {
    // "goa" is only 3 chars — substring matching requires city key >= 4 chars
    expect(resolveCountry('Lagos')).toBeNull();
  });

  test('"New York City" resolves to United States via substring', () => {
    // "new york" is 8 chars so substring matching applies
    expect(resolveCountry('New York City')).toBe('United States');
  });

  test('case-insensitive exact match for "GOA"', () => {
    expect(resolveCountry('GOA')).toBe('India');
  });

  test('"Springfield" returns null', () => {
    expect(resolveCountry('Springfield')).toBeNull();
  });

  test('empty string returns null', () => {
    expect(resolveCountry('')).toBeNull();
  });
});

// ============================================================
// 3. parseStartHourFromRules via generateItinerary (mock-generator.ts)
// ============================================================

describe('generateItinerary — parseStartHourFromRules respects absoluteRules', () => {
  function makeGenTrip(destination: string): Trip {
    return {
      id: 'gen-1',
      destination,
      country: 'France',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      notes: '',
      emoji: '✈️',
      activities: [],
      status: 'planned',
    };
  }

  test('rule "Never schedule before 9 AM" produces no activities before 09:00', () => {
    const profile: TravelProfile = {
      ...BASE_PROFILE,
      absoluteRules: ['Never schedule before 9 AM'],
    };
    const activities = generateItinerary({
      trip: makeGenTrip('Paris'),
      profile,
      memory: [],
    });
    // Every activity must start at 09:00 or later
    for (const act of activities) {
      const [h, m] = act.time.split(':').map(Number);
      const totalMins = h * 60 + m;
      expect(totalMins).toBeGreaterThanOrEqual(9 * 60);
    }
  });

  test('rule "start after 10 AM" produces no activities before 10:00', () => {
    const profile: TravelProfile = {
      ...BASE_PROFILE,
      absoluteRules: ['start after 10 AM'],
    };
    const activities = generateItinerary({
      trip: makeGenTrip('Paris'),
      profile,
      memory: [],
    });
    const dayOneActivities = activities.filter((a) => a.day === 1);
    expect(dayOneActivities.length).toBeGreaterThan(0);
    const firstStart = dayOneActivities[0].time;
    const [h] = firstStart.split(':').map(Number);
    expect(h).toBeGreaterThanOrEqual(10);
  });

  test('no absoluteRules with moderate pace defaults to 09:xx start', () => {
    const activities = generateItinerary({
      trip: makeGenTrip('Paris'),
      profile: { ...BASE_PROFILE, pace: 'moderate' },
      memory: [],
    });
    const day1 = activities.filter((a) => a.day === 1);
    expect(day1.length).toBeGreaterThan(0);
    const [h] = day1[0].time.split(':').map(Number);
    // moderate pace default is 9; bestTime may push it slightly forward
    expect(h).toBeGreaterThanOrEqual(9);
  });
});

// ============================================================
// 4. Storage — StorageLoadResult shape
// ============================================================

describe('StorageLoadResult — loadTripsSafe returns typed result', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('missing key returns { ok: true, data: fallback }', async () => {
    (AsyncStorage as any).getItem = jest.fn().mockResolvedValue(null);
    const result = await loadTripsSafe([] as any[]);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  test('missing key result has no error property', async () => {
    (AsyncStorage as any).getItem = jest.fn().mockResolvedValue(null);
    const result = await loadTripsSafe([] as any[]);
    expect(result.ok).toBe(true);
    // When ok=true there is no error property
    expect('error' in result).toBe(false);
  });

  test('valid JSON returns ok=true with parsed data', async () => {
    const trips = [{ id: 'abc', destination: 'Paris' }];
    (AsyncStorage as any).getItem = jest.fn().mockResolvedValue(JSON.stringify(trips));
    const result = await loadTripsSafe([] as any[]);
    expect(result.ok).toBe(true);
    expect((result.data as any[])[0].id).toBe('abc');
  });

  test('disk error returns ok=false with fallback data', async () => {
    (AsyncStorage as any).getItem = jest.fn().mockRejectedValue(new Error('I/O error'));
    const result = await loadTripsSafe([] as any[]);
    expect(result.ok).toBe(false);
    expect(result.data).toEqual([]);
  });

  test('ok=false result contains an error property', async () => {
    (AsyncStorage as any).getItem = jest.fn().mockRejectedValue(new Error('fail'));
    const result = await loadTripsSafe([] as any[]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
    }
  });
});

// ============================================================
// 5. sortTripsForPicker (trip-helpers.ts)
// ============================================================

describe('sortTripsForPicker — active before past, destination hint', () => {
  test('active trip (today in range) sorts before past trip', () => {
    const active = makeTrip({
      id: 'active',
      destination: 'Tokyo',
      startDate: addDays(today, -1),
      endDate: addDays(today, 1),
    });
    const past = makeTrip({
      id: 'past',
      destination: 'Rome',
      startDate: addDays(today, -30),
      endDate: addDays(today, -20),
    });
    const sorted = sortTripsForPicker([past, active]);
    expect(sorted[0].id).toBe('active');
    expect(sorted[1].id).toBe('past');
  });

  test('upcoming trip sorts before past trip', () => {
    const upcoming = makeTrip({
      id: 'upcoming',
      destination: 'Berlin',
      startDate: addDays(today, 10),
      endDate: addDays(today, 15),
    });
    const past = makeTrip({
      id: 'past',
      destination: 'Paris',
      startDate: addDays(today, -30),
      endDate: addDays(today, -20),
    });
    const sorted = sortTripsForPicker([past, upcoming]);
    expect(sorted[0].id).toBe('upcoming');
  });

  test('destination hint floats matching trip to front within its group', () => {
    const barcelona = makeTrip({
      id: 'bcn',
      destination: 'Barcelona',
      startDate: addDays(today, 5),
      endDate: addDays(today, 10),
    });
    const tokyo = makeTrip({
      id: 'tky',
      destination: 'Tokyo',
      startDate: addDays(today, 5),
      endDate: addDays(today, 10),
    });
    const sorted = sortTripsForPicker([barcelona, tokyo], 'Tokyo');
    expect(sorted[0].id).toBe('tky');
  });

  test('destination hint does not promote across groups (active stays first)', () => {
    const active = makeTrip({
      id: 'active',
      destination: 'Madrid',
      startDate: addDays(today, -1),
      endDate: addDays(today, 2),
    });
    const upcomingMatch = makeTrip({
      id: 'upcoming',
      destination: 'Tokyo',
      startDate: addDays(today, 10),
      endDate: addDays(today, 15),
    });
    const sorted = sortTripsForPicker([upcomingMatch, active], 'Tokyo');
    expect(sorted[0].id).toBe('active');
  });

  test('past trips sort newest first (descending startDate)', () => {
    const older = makeTrip({
      id: 'older',
      destination: 'London',
      startDate: addDays(today, -60),
      endDate: addDays(today, -50),
    });
    const recent = makeTrip({
      id: 'recent',
      destination: 'Paris',
      startDate: addDays(today, -20),
      endDate: addDays(today, -10),
    });
    const sorted = sortTripsForPicker([older, recent]);
    expect(sorted[0].id).toBe('recent');
    expect(sorted[1].id).toBe('older');
  });

  test('upcoming trips sort soonest first (ascending startDate)', () => {
    const far = makeTrip({
      id: 'far',
      destination: 'Seoul',
      startDate: addDays(today, 40),
      endDate: addDays(today, 45),
    });
    const soon = makeTrip({
      id: 'soon',
      destination: 'Bali',
      startDate: addDays(today, 5),
      endDate: addDays(today, 10),
    });
    const sorted = sortTripsForPicker([far, soon]);
    expect(sorted[0].id).toBe('soon');
  });
});

// ============================================================
// 6. isPulseDismissed (trip-helpers.ts)
// ============================================================

describe('isPulseDismissed — dismissed/undismissed alerts, empty_day stable keys', () => {
  test('a dismissed alert returns true', () => {
    const dismissed = new Set(['trip1:conflict-1:rev3']);
    expect(isPulseDismissed(dismissed, 'trip1', 'conflict-1', 3)).toBe(true);
  });

  test('an undismissed alert returns false', () => {
    const dismissed = new Set<string>();
    expect(isPulseDismissed(dismissed, 'trip1', 'conflict-1', 3)).toBe(false);
  });

  test('dismissal at different revision is false (expires with revision change)', () => {
    const dismissed = new Set([makePulseDismissalKey('trip1', 'conflict-1', 3)]);
    expect(isPulseDismissed(dismissed, 'trip1', 'conflict-1', 4)).toBe(false);
  });

  test('dismissal in trip B does not affect trip A', () => {
    const dismissed = new Set([makePulseDismissalKey('tripB', 'conflict-1', 0)]);
    expect(isPulseDismissed(dismissed, 'tripA', 'conflict-1', 0)).toBe(false);
    expect(isPulseDismissed(dismissed, 'tripB', 'conflict-1', 0)).toBe(true);
  });

  test('empty_day alerts use stable key (no revision suffix)', () => {
    const key0 = makePulseDismissalKey('trip1', 'empty-3', 0);
    const key99 = makePulseDismissalKey('trip1', 'empty-3', 99);
    // Both should produce the same key so the dismissal persists across revisions
    expect(key0).toBe(key99);
    expect(key0).toContain('stable');
  });

  test('empty_day dismissal persists when revision changes', () => {
    const dismissed = new Set([makePulseDismissalKey('trip1', 'empty-3', 0)]);
    // Revision advanced — dismissal should STILL hold for empty_day
    expect(isPulseDismissed(dismissed, 'trip1', 'empty-3', 10)).toBe(true);
  });

  test('non-empty_day alert key contains rev prefix', () => {
    const key = makePulseDismissalKey('trip1', 'conflict-2', 5);
    expect(key).toBe('trip1:conflict-2:rev5');
  });
});

// ============================================================
// 7. findUndoableChange (trip-helpers.ts)
// ============================================================

describe('findUndoableChange — most recent non-undone change', () => {
  function makeRecord(id: string, tripId: string, undone?: boolean): ChangeRecord {
    return {
      id,
      tripId,
      description: `change ${id}`,
      timestamp: id,
      previousActivities: [],
      undone,
    };
  }

  test('returns the most recent non-undone change (first in newest-first history)', () => {
    const history: ChangeRecord[] = [
      makeRecord('3', 'trip1'),       // newest, not undone — should be returned
      makeRecord('2', 'trip1'),
      makeRecord('1', 'trip1'),
    ];
    const result = findUndoableChange(history, 'trip1');
    expect(result).toBeDefined();
    expect(result!.id).toBe('3');
  });

  test('skips undone changes and returns next non-undone', () => {
    const history: ChangeRecord[] = [
      makeRecord('3', 'trip1', true), // undone
      makeRecord('2', 'trip1'),        // not undone — should be returned
      makeRecord('1', 'trip1'),
    ];
    const result = findUndoableChange(history, 'trip1');
    expect(result!.id).toBe('2');
  });

  test('returns undefined when all changes are undone', () => {
    const history: ChangeRecord[] = [
      makeRecord('2', 'trip1', true),
      makeRecord('1', 'trip1', true),
    ];
    expect(findUndoableChange(history, 'trip1')).toBeUndefined();
  });

  test('returns undefined when history is empty', () => {
    expect(findUndoableChange([], 'trip1')).toBeUndefined();
  });

  test('ignores changes for other trips', () => {
    const history: ChangeRecord[] = [
      makeRecord('5', 'trip2'),
      makeRecord('4', 'trip2'),
      makeRecord('3', 'trip1'), // only trip1 record, not undone
    ];
    const result = findUndoableChange(history, 'trip1');
    expect(result!.id).toBe('3');
  });

  test('returns undefined when no changes exist for the given tripId', () => {
    const history: ChangeRecord[] = [
      makeRecord('1', 'trip2'),
      makeRecord('2', 'trip2'),
    ];
    expect(findUndoableChange(history, 'trip1')).toBeUndefined();
  });
});

// ============================================================
// 8. extractStartTime — time parsing from free-text
// ============================================================

describe('extractStartTime — parses time constraints from text', () => {
  test('"start after 11 AM" returns 11:00', () => {
    expect(extractStartTime('start after 11 AM')).toBe('11:00');
  });

  test('"start after 11:30 AM" returns 11:30', () => {
    expect(extractStartTime('start after 11:30 AM')).toBe('11:30');
  });

  test('"before 9 AM" returns 09:00', () => {
    expect(extractStartTime('before 9 AM')).toBe('09:00');
  });

  test('"at noon" returns 12:00', () => {
    expect(extractStartTime('at noon')).toBe('12:00');
  });

  test('"noon" returns 12:00', () => {
    expect(extractStartTime('noon')).toBe('12:00');
  });

  test('"10:30 PM" returns 22:30', () => {
    expect(extractStartTime('schedule at 10:30 PM')).toBe('22:30');
  });

  test('"12 AM" returns 00:00', () => {
    expect(extractStartTime('after 12 AM')).toBe('00:00');
  });

  test('"after 3" assumes PM (< 6 rule)', () => {
    expect(extractStartTime('after 3')).toBe('15:00');
  });

  test('"after 9" stays 09:00 (>= 6 rule)', () => {
    expect(extractStartTime('after 9')).toBe('09:00');
  });

  test('no time constraint returns undefined', () => {
    expect(extractStartTime('make it more relaxed')).toBeUndefined();
  });
});

// ============================================================
// 9. parseTextToCommand — day extraction runs FIRST
// ============================================================

describe('parseTextToCommand — day extraction before command matching', () => {
  test('"Make Day 3 more relaxed" returns extractedDay: 3', () => {
    const result = parseTextToCommand('Make Day 3 more relaxed');
    expect(result.command).toBe('make_relaxed');
    expect(result.extractedDay).toBe(3);
  });

  test('"Make Day 2 more adventurous" returns extractedDay: 2', () => {
    const result = parseTextToCommand('Make Day 2 more adventurous');
    expect(result.command).toBe('make_adventurous');
    expect(result.extractedDay).toBe(2);
  });

  test('"Avoid crowds on Day 1" returns extractedDay: 1', () => {
    const result = parseTextToCommand('Avoid crowds on Day 1');
    expect(result.command).toBe('avoid_crowds');
    expect(result.extractedDay).toBe(1);
  });

  test('"more food" returns surprise_me with searchTerms food', () => {
    const result = parseTextToCommand('more restaurant');
    expect(result.command).toBe('surprise_me');
    expect(result.searchTerms).toBe('food');
  });

  test('"add more art museums" extracts searchTerms', () => {
    const result = parseTextToCommand('add more art museums');
    expect(result.command).toBe('surprise_me');
    expect(result.searchTerms).toBe('art museums');
  });

  test('"start after 11 AM" returns reflow_day with startAfter', () => {
    const result = parseTextToCommand('start after 11 AM');
    expect(result.command).toBe('reflow_day');
    expect(result.startAfter).toBe('11:00');
  });

  test('"Don\'t schedule before 9" returns reflow_day with startAfter', () => {
    const result = parseTextToCommand("Don't schedule before 9");
    expect(result.command).toBe('reflow_day');
    expect(result.startAfter).toBe('09:00');
  });
});

// ============================================================
// 10. transformTrip — activity-scope transformation
// ============================================================

describe('transformTrip — activity-scope handling', () => {
  const activity1: Activity = {
    id: 'act-1',
    title: 'Visit Museum',
    type: 'activity',
    day: 1,
    time: '10:00',
    duration: 120,
    category: 'culture',
    cost: 'moderate',
  };
  const activity2: Activity = {
    id: 'act-2',
    title: 'Temple Visit',
    type: 'activity',
    day: 1,
    time: '14:00',
    duration: 90,
    category: 'culture',
    cost: 'budget',
  };
  const lockedActivity: Activity = {
    id: 'act-locked',
    title: 'Fixed Hotel',
    type: 'hotel',
    day: 1,
    time: '20:00',
    duration: 480,
    locked: true,
  };

  const trip: Trip = {
    id: 'trip-test',
    destination: 'Tokyo',
    country: 'Japan',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    notes: '',
    emoji: '',
    activities: [activity1, activity2, lockedActivity],
    status: 'planned',
  };

  test('activity scope with locked activity returns cannot-modify message', () => {
    const scope: TransformScope = { type: 'activity', activityId: 'act-locked', day: 1 };
    const result = transformTrip(trip, 'make_relaxed', scope, BASE_PROFILE, []);
    expect(result.summary).toBe('Cannot modify');
    expect(result.changes[0]).toContain('locked');
  });

  test('activity scope with missing activityId returns not-found message', () => {
    const scope: TransformScope = { type: 'activity', activityId: 'nonexistent', day: 1 };
    const result = transformTrip(trip, 'make_relaxed', scope, BASE_PROFILE, []);
    expect(result.summary).toBe('Activity not found');
  });

  test('activity scope does not modify other activities', () => {
    const scope: TransformScope = { type: 'activity', activityId: 'act-1', day: 1 };
    const result = transformTrip(trip, 'reduce_cost', scope, BASE_PROFILE, []);
    // act-2 should be unchanged
    const act2 = result.activities.find((a) => a.id === 'act-2');
    expect(act2?.title).toBe('Temple Visit');
    // locked activity should be unchanged
    const locked = result.activities.find((a) => a.id === 'act-locked');
    expect(locked?.title).toBe('Fixed Hotel');
  });
});
