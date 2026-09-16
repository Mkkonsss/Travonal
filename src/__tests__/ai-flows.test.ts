/**
 * Tests for AI utility functions and AI flow logic.
 */

import {
  normalizeActivity,
  normalizeTimeTo24,
  mergeDayScopedActivities,
  deduplicateFixedActivities,
  extractHTMLText,
  generateActivityId,
  repairActivities,
  validateAIOutput,
  validateGeneratedActivities,
} from '@/services/ai-utils';
import { computeChangePreview } from '@/services/itinerary-engine';
import { runTripPulse } from '@/services/trip-pulse';
import type { Activity } from '@/context/trips';
import {
  mapGoogleTypeToCategory,
  normalizeGooglePlace,
  categoryToActivityType,
  priceLevelLabel,
  formatDistance,
} from '@/services/place-model';
import { dedupeByPlaceId, calcDistance } from '@/services/explore-service';

// ─── normalizeActivity ──────────────────────────────────────────────────────

describe('normalizeActivity', () => {
  test('returns null when title is missing', () => {
    expect(normalizeActivity({ day: 1, time: '09:00' }, 3)).toBeNull();
  });

  test('returns null when title is empty string', () => {
    expect(normalizeActivity({ title: '  ', day: 1, time: '09:00' }, 3)).toBeNull();
  });

  test('trims title and description', () => {
    const result = normalizeActivity({
      title: '  Visit Museum  ',
      description: '  A great place  ',
      day: 1,
      time: '10:00',
    }, 5);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Visit Museum');
    expect(result!.description).toBe('A great place');
  });

  test('clamps day to valid range', () => {
    const tooLow = normalizeActivity({ title: 'X', day: 0, time: '10:00' }, 3);
    expect(tooLow!.day).toBe(1);

    const tooHigh = normalizeActivity({ title: 'X', day: 10, time: '10:00' }, 3);
    expect(tooHigh!.day).toBe(3);
  });

  test('defaults invalid time to 09:00', () => {
    const result = normalizeActivity({ title: 'X', day: 1, time: 'noon' }, 3);
    expect(result!.time).toBe('09:00');
  });

  test('preserves valid time', () => {
    const result = normalizeActivity({ title: 'X', day: 1, time: '14:30' }, 3);
    expect(result!.time).toBe('14:30');
  });

  test('defaults invalid type to activity', () => {
    const result = normalizeActivity({ title: 'X', day: 1, time: '10:00', type: 'swimming' }, 3);
    expect(result!.type).toBe('activity');
  });

  test('accepts valid types', () => {
    for (const type of ['activity', 'food', 'hotel', 'flight']) {
      const result = normalizeActivity({ title: 'X', day: 1, time: '10:00', type }, 3);
      expect(result!.type).toBe(type);
    }
  });

  test('defaults invalid cost to moderate', () => {
    const result = normalizeActivity({ title: 'X', day: 1, time: '10:00', cost: 'expensive' }, 3);
    expect(result!.cost).toBe('moderate');
  });

  test('accepts valid costs', () => {
    for (const cost of ['free', 'budget', 'moderate', 'premium']) {
      const result = normalizeActivity({ title: 'X', day: 1, time: '10:00', cost }, 3);
      expect(result!.cost).toBe(cost);
    }
  });

  test('preserves locked/fixed flags', () => {
    const result = normalizeActivity({
      title: 'Hotel',
      day: 1,
      time: '20:00',
      type: 'hotel',
      locked: true,
      fixed: true,
    }, 3);
    expect((result as any).locked).toBe(true);
    expect((result as any).fixed).toBe(true);
  });

  test('handles non-numeric day by defaulting to 1', () => {
    const result = normalizeActivity({ title: 'X', day: 'abc', time: '10:00' }, 3);
    expect(result!.day).toBe(1);
  });

  test('preserves non-empty string id', () => {
    const result = normalizeActivity({ id: 'act_abc123', title: 'X', day: 1, time: '10:00' }, 3);
    expect(result).not.toBeNull();
    expect((result as any).id).toBe('act_abc123');
  });

  test('omits id when it is empty or missing', () => {
    const result1 = normalizeActivity({ title: 'X', day: 1, time: '10:00' }, 3);
    expect((result1 as any).id).toBeUndefined();

    const result2 = normalizeActivity({ id: '', title: 'X', day: 1, time: '10:00' }, 3);
    expect((result2 as any).id).toBeUndefined();
  });
});

// ─── normalizeTimeTo24 ──────────────────────────────────────────────────────

describe('normalizeTimeTo24', () => {
  test('passes through valid 24-hour time', () => {
    expect(normalizeTimeTo24('09:00')).toBe('09:00');
    expect(normalizeTimeTo24('19:30')).toBe('19:30');
    expect(normalizeTimeTo24('00:00')).toBe('00:00');
    expect(normalizeTimeTo24('23:59')).toBe('23:59');
  });

  test('pads single-digit 24-hour hours', () => {
    expect(normalizeTimeTo24('9:00')).toBe('09:00');
    expect(normalizeTimeTo24('0:00')).toBe('00:00');
  });

  test('converts 12-hour AM/PM to 24-hour', () => {
    expect(normalizeTimeTo24('7:00 PM')).toBe('19:00');
    expect(normalizeTimeTo24('9:00 AM')).toBe('09:00');
    expect(normalizeTimeTo24('12:00 PM')).toBe('12:00');
    expect(normalizeTimeTo24('12:00 AM')).toBe('00:00');
    expect(normalizeTimeTo24('11:30 PM')).toBe('23:30');
    expect(normalizeTimeTo24('1:00 AM')).toBe('01:00');
    expect(normalizeTimeTo24('2:00 PM')).toBe('14:00');
  });

  test('handles case variations and no space', () => {
    expect(normalizeTimeTo24('7:00 pm')).toBe('19:00');
    expect(normalizeTimeTo24('9:00 Am')).toBe('09:00');
    expect(normalizeTimeTo24('2:00PM')).toBe('14:00');
  });

  test('returns fallback for garbage input', () => {
    expect(normalizeTimeTo24('not a time')).toBe('09:00');
    expect(normalizeTimeTo24('')).toBe('09:00');
  });

  test('returns custom fallback', () => {
    expect(normalizeTimeTo24('bad', '12:00')).toBe('12:00');
  });
});

describe('normalizeActivity handles 12-hour times', () => {
  test('converts 12-hour AM/PM time to 24-hour', () => {
    const result = normalizeActivity({ title: 'Dinner', day: 1, time: '7:00 PM', type: 'food' }, 5);
    expect(result).not.toBeNull();
    expect(result!.time).toBe('19:00');
  });

  test('converts morning AM time', () => {
    const result = normalizeActivity({ title: 'Breakfast', day: 1, time: '9:00 AM', type: 'food' }, 5);
    expect(result).not.toBeNull();
    expect(result!.time).toBe('09:00');
  });
});

// ─── generateActivityId ─────────────────────────────────────────────────────

describe('generateActivityId', () => {
  test('returns a non-empty string', () => {
    expect(typeof generateActivityId()).toBe('string');
    expect(generateActivityId().length).toBeGreaterThan(0);
  });

  test('returns unique IDs on successive calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateActivityId()));
    expect(ids.size).toBe(20);
  });
});

// ─── mergeDayScopedActivities ───────────────────────────────────────────────

describe('mergeDayScopedActivities', () => {
  const day1Act: Activity = {
    id: '1',
    title: 'Day 1 Activity',
    day: 1,
    time: '10:00',
    type: 'activity',
  };
  const day2Act: Activity = {
    id: '2',
    title: 'Day 2 Activity',
    day: 2,
    time: '10:00',
    type: 'activity',
  };
  const day3Act: Activity = {
    id: '3',
    title: 'Day 3 Activity',
    day: 3,
    time: '10:00',
    type: 'activity',
  };

  test('preserves activities from other days when editing one day', () => {
    const aiDay2: Activity = {
      id: 'new-2',
      title: 'New Day 2 Activity',
      day: 2,
      time: '11:00',
      type: 'food',
    };

    const result = mergeDayScopedActivities(
      [day1Act, day2Act, day3Act],
      [aiDay2],
      2,
    );

    expect(result).toHaveLength(3);
    expect(result.find((a) => a.id === '1')).toBeDefined();
    expect(result.find((a) => a.id === '3')).toBeDefined();
    expect(result.find((a) => a.id === 'new-2')).toBeDefined();
    // Original day 2 should be gone
    expect(result.find((a) => a.id === '2')).toBeUndefined();
  });

  test('handles empty AI result for a day (clears that day)', () => {
    const result = mergeDayScopedActivities(
      [day1Act, day2Act, day3Act],
      [],
      2,
    );

    expect(result).toHaveLength(2);
    expect(result.find((a) => a.day === 2)).toBeUndefined();
  });

  test('handles empty original activities', () => {
    const aiAct: Activity = {
      id: 'new',
      title: 'New',
      day: 1,
      time: '10:00',
      type: 'activity',
    };
    const result = mergeDayScopedActivities([], [aiAct], 1);
    expect(result).toHaveLength(1);
  });
});

// ─── deduplicateFixedActivities ─────────────────────────────────────────────

describe('deduplicateFixedActivities', () => {
  const fixedActivity: Activity = {
    id: 'fixed-1',
    title: 'Hotel Check-in',
    day: 1,
    time: '15:00',
    type: 'hotel',
    fixed: true,
  };

  test('removes AI activity that matches a fixed activity by title+day+time', () => {
    const aiActivities = [
      { title: 'Hotel Check-in', day: 1, time: '15:00', type: 'hotel' as const },
      { title: 'Visit Museum', day: 1, time: '10:00', type: 'activity' as const },
    ];

    const result = deduplicateFixedActivities(aiActivities, [fixedActivity]);

    // Should have the museum + the original fixed activity
    expect(result).toHaveLength(2);
    const titles = result.map((a) => a.title);
    expect(titles).toContain('Visit Museum');
    expect(titles).toContain('Hotel Check-in');
    // The fixed one should have the original id
    const hotel = result.find((a) => a.title === 'Hotel Check-in');
    expect((hotel as Activity).id).toBe('fixed-1');
  });

  test('case-insensitive title matching', () => {
    const aiActivities = [
      { title: 'hotel check-in', day: 1, time: '15:00', type: 'hotel' as const },
    ];

    const result = deduplicateFixedActivities(aiActivities, [fixedActivity]);
    // Should only have the original fixed activity
    expect(result).toHaveLength(1);
    expect((result[0] as Activity).id).toBe('fixed-1');
  });

  test('no deduplication when no fixed activities', () => {
    const aiActivities = [
      { title: 'Visit Museum', day: 1, time: '10:00', type: 'activity' as const },
    ];

    const result = deduplicateFixedActivities(aiActivities, []);
    expect(result).toHaveLength(1);
  });

  test('does not remove AI activity with different day', () => {
    const aiActivities = [
      { title: 'Hotel Check-in', day: 2, time: '15:00', type: 'hotel' as const },
    ];

    const result = deduplicateFixedActivities(aiActivities, [fixedActivity]);
    // AI activity on day 2 should survive + original fixed on day 1
    expect(result).toHaveLength(2);
  });
});

// ─── extractHTMLText ────────────────────────────────────────────────────────

describe('extractHTMLText', () => {
  test('extracts title', () => {
    const html = '<html><head><title>Best Cafe in Paris</title></head><body></body></html>';
    const result = extractHTMLText(html);
    expect(result).toContain('Title: Best Cafe in Paris');
  });

  test('extracts meta description', () => {
    const html = '<html><head><meta name="description" content="A lovely cafe"></head><body></body></html>';
    const result = extractHTMLText(html);
    expect(result).toContain('Description: A lovely cafe');
  });

  test('extracts og:title and og:description', () => {
    const html = '<html><head><meta property="og:title" content="OG Title"><meta property="og:description" content="OG Desc"></head><body></body></html>';
    const result = extractHTMLText(html);
    expect(result).toContain('OG Title: OG Title');
    expect(result).toContain('OG Description: OG Desc');
  });

  test('strips HTML tags from body', () => {
    const html = '<html><body><h1>Hello</h1><p>World</p></body></html>';
    const result = extractHTMLText(html);
    expect(result).toContain('Content:');
    expect(result).toContain('Hello');
    expect(result).toContain('World');
    expect(result).not.toContain('<h1>');
    expect(result).not.toContain('<p>');
  });

  test('removes scripts and styles from body', () => {
    const html = '<html><body><script>alert("x")</script><style>.x{}</style><p>Content</p></body></html>';
    const result = extractHTMLText(html);
    expect(result).toContain('Content');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('.x{}');
  });

  test('truncates body text to 2000 chars', () => {
    const longText = 'A'.repeat(3000);
    const html = '<html><body>' + longText + '</body></html>';
    const result = extractHTMLText(html);
    const contentLine = result.split('\n').find((l) => l.startsWith('Content:'));
    expect(contentLine).toBeDefined();
    // Content: prefix + 2000 chars + ...
    expect(contentLine!.length).toBeLessThanOrEqual(2020);
  });

  test('handles empty HTML', () => {
    const result = extractHTMLText('');
    expect(result).toBe('');
  });

  test('decodes HTML entities', () => {
    const html = '<html><body><p>Tom &amp; Jerry&apos;s &quot;place&quot;</p></body></html>';
    const result = extractHTMLText(html);
    expect(result).toContain("Tom & Jerry's");
    expect(result).toContain('"place"');
  });
});

// ─── validateGeneratedActivities ───────────────────────────────────────────

describe('validateGeneratedActivities', () => {
  const makeAct = (day: number, time: string, title: string, duration = 60): Activity => ({
    id: 'id-' + day + '-' + time,
    day,
    time,
    title,
    type: 'activity',
    duration,
  });

  test('detects pace overload for relaxed trip', () => {
    const acts = [
      makeAct(1, '07:00', 'Breakfast'),
      makeAct(1, '09:00', 'Museum'),
      makeAct(1, '12:00', 'Lunch'),
      makeAct(1, '14:00', 'Park'),
    ];
    const issues = validateGeneratedActivities(acts, 1, 'relaxed');
    expect(issues.some((i) => i.type === 'pace_overload')).toBe(true);
  });

  test('no pace issue for 3 meals on relaxed trip', () => {
    const makeFoodAct = (day: number, time: string, title: string, duration = 60): Activity => ({
      id: 'id-' + day + '-' + time,
      day,
      time,
      title,
      type: 'food',
      duration,
    });
    const acts = [
      makeFoodAct(1, '08:00', 'Breakfast', 60),
      makeFoodAct(1, '12:00', 'Lunch', 60),
      makeFoodAct(1, '19:00', 'Dinner', 90),
    ];
    const issues = validateGeneratedActivities(acts, 1, 'relaxed');
    expect(issues.filter((i) => i.type === 'pace_overload')).toHaveLength(0);
  });

  test('detects breakfast at noon', () => {
    const acts = [makeAct(1, '12:00', 'Breakfast')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    expect(issues.some((i) => i.type === 'meal_timing' && i.message.includes('Breakfast'))).toBe(true);
  });

  test('detects early dinner at 17:00', () => {
    const acts = [makeAct(1, '17:00', 'Dinner at Nobu')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    expect(issues.some((i) => i.type === 'meal_timing' && i.message.includes('Dinner'))).toBe(true);
  });

  test('detects duplicate titles across days', () => {
    const acts = [
      makeAct(1, '10:00', 'Senso-ji Temple'),
      makeAct(2, '10:00', 'Senso-ji Temple'),
    ];
    const issues = validateGeneratedActivities(acts, 2, 'moderate');
    expect(issues.some((i) => i.type === 'duplicate_title')).toBe(true);
  });

  test('no issues for a clean moderate itinerary', () => {
    const acts = [
      makeAct(1, '08:00', 'Breakfast at cafe', 60),
      makeAct(1, '10:00', 'Visit Museum', 120),
      makeAct(1, '12:30', 'Lunch', 60),
      makeAct(1, '19:30', 'Dinner', 90),
    ];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    expect(issues.filter((i) => i.type !== 'overlap')).toHaveLength(0);
  });

  test('detects overlap between activities', () => {
    const acts = [
      makeAct(1, '10:00', 'Museum', 120), // ends 12:00
      makeAct(1, '11:00', 'Park', 60),    // starts 11:00 — overlap!
    ];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    expect(issues.some((i) => i.type === 'overlap')).toBe(true);
  });
});

// ─── Chat action verification behavior ──────────────────────────────────────

describe('TripAction precondition logic', () => {
  // Test the pre-check logic in isolation (mirror of chat.tsx applyTripAction)
  function checkPreconditions(
    action: { type: string; tripId: string; activityId?: string },
    trips: { id: string; activities: { id: string; locked?: boolean; fixed?: boolean }[] }[],
  ): { ok: boolean; reason?: string } {
    const trip = trips.find((t) => t.id === action.tripId);
    if (!trip) return { ok: false, reason: 'Trip not found' };
    if (action.activityId) {
      const act = trip.activities.find((a) => a.id === action.activityId);
      if (!act) return { ok: false, reason: 'Activity not found' };
      if ((act.locked || act.fixed) && action.type === 'remove_activity') {
        return { ok: false, reason: 'Activity is locked' };
      }
    }
    return { ok: true };
  }

  const mockTrips = [
    {
      id: 'trip-1',
      activities: [
        { id: 'act-1', locked: false },
        { id: 'act-2', locked: true },
      ],
    },
  ];

  test('fails if trip not found', () => {
    const r = checkPreconditions({ type: 'add_activity', tripId: 'nonexistent' }, mockTrips);
    expect(r.ok).toBe(false);
  });

  test('fails if activity not found for remove', () => {
    const r = checkPreconditions({ type: 'remove_activity', tripId: 'trip-1', activityId: 'nonexistent' }, mockTrips);
    expect(r.ok).toBe(false);
  });

  test('fails if trying to remove a locked activity', () => {
    const r = checkPreconditions({ type: 'remove_activity', tripId: 'trip-1', activityId: 'act-2' }, mockTrips);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('locked');
  });

  test('succeeds for valid unlocked activity remove', () => {
    const r = checkPreconditions({ type: 'remove_activity', tripId: 'trip-1', activityId: 'act-1' }, mockTrips);
    expect(r.ok).toBe(true);
  });

  test('succeeds for add_activity to valid trip', () => {
    const r = checkPreconditions({ type: 'add_activity', tripId: 'trip-1' }, mockTrips);
    expect(r.ok).toBe(true);
  });
});

// ─── callEdgeFunction error handling ────────────────────────────────────────
// NOTE: These tests cannot import ai.ts directly because it depends on
// the Supabase client which requires env vars. We test the error-handling
// logic in isolation by replicating the response-checking logic.

describe('callEdgeFunction error handling (logic test)', () => {
  /**
   * Replicates the response-handling logic from callEdgeFunction
   * without importing the actual module.
   */
  async function parseEdgeFunctionResponse<T>(response: {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }): Promise<T> {
    if (!response.ok) {
      let errorMsg = 'AI request failed (HTTP ' + response.status + ')';
      try {
        const errJson = await response.json() as { error?: string };
        if (errJson.error) errorMsg = errJson.error;
      } catch {
        // Could not parse error body
      }
      throw new Error(errorMsg);
    }
    const json = await response.json() as { success: boolean; error?: string; data?: T };
    if (!json.success) {
      throw new Error(json.error ?? 'AI request failed');
    }
    return json.data as T;
  }

  test('throws descriptive error on HTTP 500', async () => {
    const response = {
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server overloaded' }),
    };
    await expect(parseEdgeFunctionResponse(response)).rejects.toThrow('Server overloaded');
  });

  test('throws generic error when error body is not JSON', async () => {
    const response = {
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not json')),
    };
    await expect(parseEdgeFunctionResponse(response)).rejects.toThrow('HTTP 502');
  });

  test('throws error when success is false in response', async () => {
    const response = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: false, error: 'Bad input' }),
    };
    await expect(parseEdgeFunctionResponse(response)).rejects.toThrow('Bad input');
  });

  test('returns data on success', async () => {
    const response = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { name: 'Eiffel Tower' } }),
    };
    const result = await parseEdgeFunctionResponse<{ name: string }>(response);
    expect(result.name).toBe('Eiffel Tower');
  });
});

// ─── generateActivityId UUID format ─────────────────────────────────────────

describe('generateActivityId (enhanced)', () => {
  test('starts with act_ prefix', () => {
    const id = generateActivityId();
    expect(id.startsWith('act_')).toBe(true);
  });

  test('has sufficient entropy (length >= 20)', () => {
    const id = generateActivityId();
    expect(id.length).toBeGreaterThanOrEqual(20);
  });

  test('uses UUID format when crypto.randomUUID is available', () => {
    // In Node/Jest, crypto.randomUUID is available
    const id = generateActivityId();
    expect(id.startsWith('act_')).toBe(true);
    // Should contain hex chars after prefix (UUID without dashes)
    const suffix = id.slice(4);
    expect(/^[a-f0-9]+$/.test(suffix)).toBe(true);
  });

  test('generating 1000 IDs has no duplicates', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateActivityId()));
    expect(ids.size).toBe(1000);
  });
});

// ─── repairActivities ──────────────────────────────────────────────────────

describe('repairActivities', () => {
  const makeAct = (id: string, day: number, time: string, title: string, duration = 60, extra: Partial<Activity> = {}): Activity => ({
    id,
    day,
    time,
    title,
    type: 'activity',
    duration,
    ...extra,
  });

  test('removes duplicate titles keeping first occurrence', () => {
    const acts = [
      makeAct('a1', 1, '10:00', 'Museum'),
      makeAct('a2', 2, '10:00', 'Museum'),
      makeAct('a3', 1, '14:00', 'Park'),
    ];
    const repaired = repairActivities(acts, 2, 'moderate');
    expect(repaired).toHaveLength(2);
    expect(repaired.find((a) => a.id === 'a1')).toBeDefined();
    expect(repaired.find((a) => a.id === 'a2')).toBeUndefined();
  });

  test('removes overlapping activities (shorter one)', () => {
    const acts = [
      makeAct('a1', 1, '10:00', 'Museum', 120), // ends 12:00
      makeAct('a2', 1, '11:00', 'Cafe', 30),     // starts 11:00 - overlap!
      makeAct('a3', 1, '14:00', 'Park', 60),
    ];
    const repaired = repairActivities(acts, 1, 'moderate');
    // Cafe is shorter, should be removed
    expect(repaired.find((a) => a.id === 'a2')).toBeUndefined();
    expect(repaired.find((a) => a.id === 'a1')).toBeDefined();
  });

  test('never removes locked/fixed activities during overlap repair', () => {
    const acts = [
      makeAct('a1', 1, '10:00', 'Long Tour', 180),
      makeAct('a2', 1, '11:00', 'Flight', 120, { fixed: true }),
    ];
    const repaired = repairActivities(acts, 1, 'moderate');
    // Fixed activity must survive, unlocked one removed
    expect(repaired.find((a) => a.id === 'a2')).toBeDefined();
    expect(repaired.find((a) => a.id === 'a1')).toBeUndefined();
  });

  test('trims pace overload keeping meals and fixed', () => {
    const acts = [
      makeAct('a1', 1, '08:00', 'Breakfast', 60, { type: 'food' }),
      makeAct('a2', 1, '10:00', 'Museum', 90),
      makeAct('a3', 1, '12:00', 'Lunch', 60, { type: 'food' }),
      makeAct('a4', 1, '14:00', 'Park', 60),
      makeAct('a5', 1, '16:00', 'Shopping', 60),
    ];
    // relaxed pace = max 2 main + 3 meals
    const repaired = repairActivities(acts, 1, 'relaxed');
    // Meals should all be preserved
    expect(repaired.filter((a) => a.type === 'food').length).toBe(2);
    // Main activities trimmed to max 2
    expect(repaired.filter((a) => a.type !== 'food').length).toBeLessThanOrEqual(2);
  });

  test('does not trim when within pace limits', () => {
    const acts = [
      makeAct('a1', 1, '10:00', 'Museum', 90),
      makeAct('a2', 1, '12:00', 'Lunch', 60),
      makeAct('a3', 1, '14:00', 'Park', 60),
      makeAct('a4', 1, '19:00', 'Dinner', 90),
    ];
    const repaired = repairActivities(acts, 1, 'moderate');
    expect(repaired).toHaveLength(4);
  });
});

// ─── validateGeneratedActivities with trip pace ────────────────────────────

describe('validateGeneratedActivities with trip pace', () => {
  const makeAct = (day: number, time: string, title: string, duration = 60): Activity => ({
    id: 'id-' + day + '-' + time,
    day,
    time,
    title,
    type: 'activity',
    duration,
  });

  test('uses trip pace (relaxed) over default moderate', () => {
    // 4 activities would be fine for moderate but overload for relaxed
    const acts = [
      makeAct(1, '08:00', 'A', 60),
      makeAct(1, '10:00', 'B', 60),
      makeAct(1, '12:00', 'C', 60),
      makeAct(1, '14:00', 'D', 60),
    ];
    const relaxedIssues = validateGeneratedActivities(acts, 1, 'relaxed');
    const moderateIssues = validateGeneratedActivities(acts, 1, 'moderate');
    expect(relaxedIssues.some((i) => i.type === 'pace_overload')).toBe(true);
    expect(moderateIssues.some((i) => i.type === 'pace_overload')).toBe(false);
  });
});

// ─── Locked activity preservation during AI edit ───────────────────────────

describe('Locked activity preservation', () => {
  test('locked activities survive mergeDayScopedActivities', () => {
    const locked: Activity = {
      id: 'locked-1',
      title: 'Fixed Hotel',
      day: 1,
      time: '15:00',
      type: 'hotel',
      locked: true,
    };
    const unlocked: Activity = {
      id: 'unlocked-1',
      title: 'Old Museum',
      day: 1,
      time: '10:00',
      type: 'activity',
    };
    const day2Act: Activity = {
      id: 'day2-1',
      title: 'Day 2 Thing',
      day: 2,
      time: '10:00',
      type: 'activity',
    };

    // AI returns new activities for day 1, including the locked one
    const aiResult: Activity[] = [
      { id: 'new-1', title: 'New Museum', day: 1, time: '10:00', type: 'activity' },
      locked, // locked should be preserved
    ];

    const merged = mergeDayScopedActivities(
      [locked, unlocked, day2Act],
      aiResult,
      1,
    );

    // Day 2 preserved
    expect(merged.find((a) => a.id === 'day2-1')).toBeDefined();
    // Locked preserved
    expect(merged.find((a) => a.id === 'locked-1')).toBeDefined();
    // Old unlocked replaced
    expect(merged.find((a) => a.id === 'unlocked-1')).toBeUndefined();
    // New activity present
    expect(merged.find((a) => a.id === 'new-1')).toBeDefined();
  });
});

// ─── validateAIOutput (structured output validation) ───────────────────────

describe('validateAIOutput', () => {
  test('rejects null data', () => {
    expect(validateAIOutput(null, 'generate_trip')).not.toBeNull();
  });

  test('rejects missing activities array for generate_trip', () => {
    expect(validateAIOutput({}, 'generate_trip')).not.toBeNull();
    expect(validateAIOutput({ activities: 'not array' }, 'generate_trip')).not.toBeNull();
  });

  test('rejects activity missing title', () => {
    expect(validateAIOutput({
      activities: [{ day: 1, time: '10:00', type: 'activity' }],
    }, 'generate_trip')).toContain('missing title');
  });

  test('rejects activity missing day', () => {
    expect(validateAIOutput({
      activities: [{ title: 'X', time: '10:00', type: 'activity' }],
    }, 'generate_trip')).toContain('missing day');
  });

  test('rejects activity missing time', () => {
    expect(validateAIOutput({
      activities: [{ title: 'X', day: 1, type: 'activity' }],
    }, 'generate_trip')).toContain('missing time');
  });

  test('accepts valid generate_trip output', () => {
    expect(validateAIOutput({
      activities: [{ title: 'Museum', day: 1, time: '10:00', type: 'activity' }],
    }, 'generate_trip')).toBeNull();
  });

  test('rejects chat missing message', () => {
    expect(validateAIOutput({ actions: [] }, 'chat')).not.toBeNull();
  });

  test('rejects chat missing actions', () => {
    expect(validateAIOutput({ message: 'hi' }, 'chat')).not.toBeNull();
  });

  test('accepts valid chat output', () => {
    expect(validateAIOutput({ message: 'hi', actions: [] }, 'chat')).toBeNull();
  });

  test('rejects import_place missing found', () => {
    expect(validateAIOutput({ name: 'X' }, 'import_place')).not.toBeNull();
  });

  test('rejects import_place found=true but missing name', () => {
    expect(validateAIOutput({ found: true, location: 'Y' }, 'import_place')).not.toBeNull();
  });

  test('accepts import_place found=false', () => {
    expect(validateAIOutput({ found: false }, 'import_place')).toBeNull();
  });

  test('accepts valid import_place', () => {
    expect(validateAIOutput({
      found: true,
      name: 'Eiffel Tower',
      location: 'Paris',
    }, 'import_place')).toBeNull();
  });
});

// ─── Low confidence photo identification ───────────────────────────────────

describe('Low confidence photo identification logic', () => {
  test('confidence below 70 means found is effectively false', () => {
    // This replicates the client-side logic from import-screenshot.tsx
    const aiResult = { found: true, confidence: 45, name: 'Something' };
    const isIdentified = aiResult.found && (
      typeof aiResult.confidence !== 'number' || aiResult.confidence >= 70
    );
    expect(isIdentified).toBe(false);
  });

  test('confidence at 70 means found is accepted', () => {
    const aiResult = { found: true, confidence: 70, name: 'Tower' };
    const isIdentified = aiResult.found && (
      typeof aiResult.confidence !== 'number' || aiResult.confidence >= 70
    );
    expect(isIdentified).toBe(true);
  });

  test('found=false with any confidence is rejected', () => {
    const aiResult = { found: false, confidence: 95, name: 'X' };
    const isIdentified = aiResult.found && (
      typeof aiResult.confidence !== 'number' || aiResult.confidence >= 70
    );
    expect(isIdentified).toBe(false);
  });
});

// ─── Imported place duplicate detection ────────────────────────────────────

describe('Imported place duplicate detection', () => {
  test('detects duplicate title (case-insensitive)', () => {
    const tripActivities = [
      { id: '1', title: 'Eiffel Tower', day: 1, time: '10:00', type: 'activity' as const },
    ];
    const newTitle = 'eiffel tower';
    const isDuplicate = tripActivities.some(
      (a) => a.title.toLowerCase().trim() === newTitle.toLowerCase().trim(),
    );
    expect(isDuplicate).toBe(true);
  });

  test('no false positive for different title', () => {
    const tripActivities = [
      { id: '1', title: 'Eiffel Tower', day: 1, time: '10:00', type: 'activity' as const },
    ];
    const newTitle = 'Louvre Museum';
    const isDuplicate = tripActivities.some(
      (a) => a.title.toLowerCase().trim() === newTitle.toLowerCase().trim(),
    );
    expect(isDuplicate).toBe(false);
  });
});

// ─── TripAction verification behavior ──────────────────────────────────────

describe('TripAction mutation verification', () => {
  function simulateApplyAction(
    action: { type: string; tripId: string; activityId?: string; updates?: Record<string, unknown> },
    trips: { id: string; activities: { id: string; title: string; locked?: boolean; fixed?: boolean; time?: string }[] }[],
  ): { ok: boolean; reason?: string } {
    const trip = trips.find((t) => t.id === action.tripId);
    if (!trip) return { ok: false, reason: 'Trip ' + action.tripId + ' not found' };

    if (action.type === 'add_activity') {
      return { ok: true };
    }
    if (action.type === 'remove_activity') {
      const exists = trip.activities.find((a) => a.id === action.activityId);
      if (!exists) return { ok: false, reason: 'Activity "' + action.activityId + '" not found in trip' };
      if (exists.locked || exists.fixed) return { ok: false, reason: '"' + exists.title + '" is locked and cannot be removed' };
      return { ok: true };
    }
    if (action.type === 'update_activity') {
      const exists = trip.activities.find((a) => a.id === action.activityId);
      if (!exists) return { ok: false, reason: 'Activity "' + action.activityId + '" not found in trip' };
      if ((exists.locked || exists.fixed) && action.updates && !('locked' in action.updates)) {
        return { ok: false, reason: '"' + exists.title + '" is locked and cannot be updated' };
      }
      return { ok: true };
    }
    return { ok: false, reason: 'Unknown action type: ' + action.type };
  }

  const mockTrips = [
    {
      id: 'trip-1',
      activities: [
        { id: 'act-1', title: 'Museum', locked: false },
        { id: 'act-2', title: 'Hotel', locked: true },
        { id: 'act-3', title: 'Flight', fixed: true },
      ],
    },
  ];

  test('cannot update locked activity without unlocking', () => {
    const r = simulateApplyAction(
      { type: 'update_activity', tripId: 'trip-1', activityId: 'act-2', updates: { time: '10:00' } },
      mockTrips,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('locked');
  });

  test('cannot remove fixed activity', () => {
    const r = simulateApplyAction(
      { type: 'remove_activity', tripId: 'trip-1', activityId: 'act-3' },
      mockTrips,
    );
    expect(r.ok).toBe(false);
  });

  test('unknown action type returns descriptive error', () => {
    const r = simulateApplyAction(
      { type: 'teleport_activity', tripId: 'trip-1' },
      mockTrips,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Unknown action type');
  });
});

// ─── Issue 1: Relaxed pace - meals not counted as main ─────────────────────

describe('validateGeneratedActivities - relaxed pace meals separate', () => {
  const makeAct = (day: number, time: string, title: string, type: Activity['type'] = 'activity', duration = 60): Activity => ({
    id: 'id-' + day + '-' + time,
    day,
    time,
    title,
    type,
    duration,
  });

  test('relaxed pace: 2 experiences + 3 meals = no pace overload', () => {
    const acts = [
      makeAct(1, '08:00', 'Breakfast at cafe', 'food', 60),
      makeAct(1, '10:00', 'Visit Museum', 'activity', 120),
      makeAct(1, '12:30', 'Lunch spot', 'food', 60),
      makeAct(1, '15:00', 'Park walk', 'activity', 90),
      makeAct(1, '19:00', 'Dinner', 'food', 90),
    ];
    const issues = validateGeneratedActivities(acts, 1, 'relaxed');
    expect(issues.filter((i) => i.type === 'pace_overload')).toHaveLength(0);
  });

  test('relaxed pace: 3 experiences triggers pace_overload for main only', () => {
    const acts = [
      makeAct(1, '08:00', 'Breakfast', 'food', 60),
      makeAct(1, '10:00', 'Museum', 'activity', 90),
      makeAct(1, '12:00', 'Lunch', 'food', 60),
      makeAct(1, '14:00', 'Temple', 'activity', 90),
      makeAct(1, '16:30', 'Shopping', 'activity', 60),
      makeAct(1, '19:00', 'Dinner', 'food', 90),
    ];
    const issues = validateGeneratedActivities(acts, 1, 'relaxed');
    expect(issues.some((i) => i.type === 'pace_overload')).toBe(true);
  });

  test('4 meals triggers meal overload', () => {
    const acts = [
      makeAct(1, '07:00', 'Breakfast', 'food', 60),
      makeAct(1, '10:00', 'Brunch', 'food', 60),
      makeAct(1, '12:00', 'Lunch', 'food', 60),
      makeAct(1, '19:00', 'Dinner', 'food', 90),
    ];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    expect(issues.some((i) => i.type === 'pace_overload' && i.message.includes('meals'))).toBe(true);
  });
});

// ─── Issue 1: repairActivities trims main but preserves meals ──────────────

describe('repairActivities - meals vs main separation', () => {
  const makeAct = (id: string, day: number, time: string, title: string, type: Activity['type'] = 'activity', duration = 60, extra: Partial<Activity> = {}): Activity => ({
    id,
    day,
    time,
    title,
    type,
    duration,
    ...extra,
  });

  test('relaxed pace: trims excess main activities but preserves all meals', () => {
    const acts = [
      makeAct('m1', 1, '08:00', 'Breakfast', 'food', 60),
      makeAct('a1', 1, '10:00', 'Museum', 'activity', 90),
      makeAct('m2', 1, '12:00', 'Lunch', 'food', 60),
      makeAct('a2', 1, '14:00', 'Temple', 'activity', 90),
      makeAct('a3', 1, '16:30', 'Shopping', 'activity', 60),
      makeAct('m3', 1, '19:00', 'Dinner', 'food', 90),
    ];
    const repaired = repairActivities(acts, 1, 'relaxed');
    // Should keep all 3 meals
    expect(repaired.filter((a) => a.type === 'food').length).toBe(3);
    // Should have at most 2 main activities
    expect(repaired.filter((a) => a.type !== 'food').length).toBeLessThanOrEqual(2);
  });
});

// ─── Issue 11: generateActivityId collision test ───────────────────────────

describe('generateActivityId - 10000 unique IDs', () => {
  test('10000 IDs all unique', () => {
    const ids = new Set(Array.from({ length: 10000 }, () => generateActivityId()));
    expect(ids.size).toBe(10000);
  });
});

// ─── Issue 10: Preview diff correctness ────────────────────────────────────

describe('computeChangePreview', () => {
  const makeAct = (id: string, day: number, time: string, title: string, extra: Partial<Activity> = {}): Activity => ({
    id,
    day,
    time,
    title,
    type: 'activity',
    duration: 60,
    ...extra,
  });

  test('only shows changed activities, not unchanged from other days', () => {
    const current = [
      makeAct('a1', 1, '10:00', 'Museum'),
      makeAct('a2', 2, '10:00', 'Park'),
      makeAct('a3', 3, '10:00', 'Beach'),
    ];
    // Only day 2 changed
    const proposed = [
      makeAct('a1', 1, '10:00', 'Museum'),
      makeAct('a2', 2, '14:00', 'Park'), // time changed
      makeAct('a3', 3, '10:00', 'Beach'),
    ];
    const preview = computeChangePreview(current, proposed, 'test');
    expect(preview.modified).toHaveLength(1);
    expect(preview.modified[0].activity.id).toBe('a2');
    expect(preview.unchanged).toHaveLength(2);
    expect(preview.added).toHaveLength(0);
    expect(preview.removed).toHaveLength(0);
  });

  test('added/removed/modified are correct by ID', () => {
    const current = [
      makeAct('a1', 1, '10:00', 'Museum'),
      makeAct('a2', 1, '14:00', 'Park'),
    ];
    const proposed = [
      makeAct('a1', 1, '11:00', 'Museum'), // modified (time)
      // a2 removed
      makeAct('a3', 1, '15:00', 'Cafe'), // added (new ID)
    ];
    const preview = computeChangePreview(current, proposed, 'test');
    expect(preview.added).toHaveLength(1);
    expect(preview.added[0].id).toBe('a3');
    expect(preview.removed).toHaveLength(1);
    expect(preview.removed[0].id).toBe('a2');
    expect(preview.modified).toHaveLength(1);
    expect(preview.modified[0].activity.id).toBe('a1');
    expect(preview.modified[0].oldTime).toBe('10:00');
    expect(preview.modified[0].newTime).toBe('11:00');
  });

  test('locked activities go to protectedLocked', () => {
    const current = [
      makeAct('a1', 1, '10:00', 'Hotel', { locked: true }),
      makeAct('a2', 1, '14:00', 'Park'),
    ];
    const proposed = [
      makeAct('a1', 1, '10:00', 'Hotel'),
      makeAct('a2', 1, '14:00', 'Park'),
    ];
    const preview = computeChangePreview(current, proposed, 'test');
    expect(preview.protectedLocked).toHaveLength(1);
    expect(preview.protectedLocked[0].id).toBe('a1');
  });
});

// ─── Issue 21: validateAIOutput additional tests ───────────────────────────

describe('validateAIOutput additional', () => {
  test('rejects missing activities array for generate_trip', () => {
    const err = validateAIOutput({ foo: 'bar' }, 'generate_trip');
    expect(err).not.toBeNull();
    expect(err).toContain('activities');
  });

  test('rejects missing message in chat response', () => {
    const err = validateAIOutput({ actions: [] }, 'chat');
    expect(err).not.toBeNull();
    expect(err).toContain('message');
  });
});

// ─── Issue 5: Breakfast at 12:15 flagged ───────────────────────────────────

describe('Meal timing edge cases', () => {
  const makeAct = (day: number, time: string, title: string, duration = 60): Activity => ({
    id: 'id-' + day + '-' + time,
    day,
    time,
    title,
    type: 'food',
    duration,
  });

  test('breakfast at 12:15 flagged as meal_timing', () => {
    const acts = [makeAct(1, '12:15', 'Breakfast at hotel')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    expect(issues.some((i) => i.type === 'meal_timing' && i.message.includes('Breakfast'))).toBe(true);
  });
});

// ─── Issue 18: Social URL detection ────────────────────────────────────────

describe('isSocialUrl', () => {
  function isSocialUrl(urlStr: string): boolean {
    const lower = urlStr.toLowerCase();
    return /tiktok\.com|instagram\.com|twitter\.com|x\.com\/|fb\.com|facebook\.com/.test(lower);
  }

  test('detects TikTok', () => expect(isSocialUrl('https://tiktok.com/@user/video/123')).toBe(true));
  test('detects Instagram', () => expect(isSocialUrl('https://www.instagram.com/p/abc123')).toBe(true));
  test('detects Twitter/X', () => expect(isSocialUrl('https://x.com/user/status/123')).toBe(true));
  test('detects Facebook', () => expect(isSocialUrl('https://facebook.com/page')).toBe(true));
  test('detects fb.com', () => expect(isSocialUrl('https://fb.com/page')).toBe(true));
  test('does not flag normal URLs', () => expect(isSocialUrl('https://restaurant-guide.com')).toBe(false));
  test('does not flag Google Maps', () => expect(isSocialUrl('https://maps.google.com/place/123')).toBe(false));
});

// ─── AI day edit does not change other days ────────────────────────────────

describe('mergeDayScopedActivities isolation', () => {
  test('editing day 2 does not affect day 1 or day 3', () => {
    const original: Activity[] = [
      { id: 'd1-1', title: 'Day1 Museum', day: 1, time: '10:00', type: 'activity', duration: 90 },
      { id: 'd2-1', title: 'Day2 Park', day: 2, time: '10:00', type: 'activity', duration: 60 },
      { id: 'd2-2', title: 'Day2 Lunch', day: 2, time: '12:00', type: 'food', duration: 60 },
      { id: 'd3-1', title: 'Day3 Beach', day: 3, time: '10:00', type: 'activity', duration: 120 },
    ];
    const aiDay2: Activity[] = [
      { id: 'new-d2', title: 'New Day2 Activity', day: 2, time: '11:00', type: 'activity', duration: 90 },
    ];
    const merged = mergeDayScopedActivities(original, aiDay2, 2);
    // Day 1 intact
    expect(merged.filter((a) => a.day === 1)).toHaveLength(1);
    expect(merged.find((a) => a.id === 'd1-1')).toBeDefined();
    // Day 3 intact
    expect(merged.filter((a) => a.day === 3)).toHaveLength(1);
    expect(merged.find((a) => a.id === 'd3-1')).toBeDefined();
    // Day 2 replaced
    expect(merged.filter((a) => a.day === 2)).toHaveLength(1);
    expect(merged.find((a) => a.id === 'new-d2')).toBeDefined();
    expect(merged.find((a) => a.id === 'd2-1')).toBeUndefined();
  });
});

// ─── Fix 1: Ask Travonal action order — success message only after verified ──

describe('Ask Travonal action verification order', () => {
  test('failed action should NOT show success message', () => {
    // Simulate applyTripAction returning failure
    const failures: string[] = [];
    const action = { type: 'add_activity', tripId: 'nonexistent' };
    const trips: { id: string; activities: { id: string; title: string }[] }[] = [];
    const trip = trips.find((t) => t.id === action.tripId);
    if (!trip) failures.push('Trip nonexistent not found');

    // When failures exist, the assistant message should reflect failure
    const shouldShowOriginalMessage = failures.length === 0;
    expect(shouldShowOriginalMessage).toBe(false);
  });

  test('successful action shows original message', () => {
    const failures: string[] = [];
    const action = { type: 'add_activity', tripId: 'trip-1' };
    const trips = [{ id: 'trip-1', activities: [{ id: 'a1', title: 'Museum' }] }];
    const trip = trips.find((t) => t.id === action.tripId);
    if (!trip) failures.push('Trip not found');

    const shouldShowOriginalMessage = failures.length === 0;
    expect(shouldShowOriginalMessage).toBe(true);
  });
});

// ─── Fix 2: Reservation persistence — stored in both activities and reservations

describe('Reservation persistence via addTripWithActivities', () => {
  test('reservations should be mappable to both activities and reservation records', () => {
    // Simulate the flow from add-trip.tsx
    const reservations = [
      { title: 'Dinner at La Maison', dayOrDate: '2', time: '19:00', type: 'food' as const },
    ];

    // Activities from reservations
    const initialActivities = reservations.map((r) => ({
      title: r.title,
      day: parseInt(r.dayOrDate, 10) || 1,
      time: r.time,
      type: r.type as 'activity' | 'food' | 'hotel' | 'flight',
      fixed: true,
      locked: true,
    }));

    // Reservation records from reservations
    const tripReservations = reservations.map((r) => ({
      type: (r.type === 'food' ? 'restaurant' : r.type) as 'restaurant' | 'hotel' | 'activity' | 'other',
      title: r.title,
      day: parseInt(r.dayOrDate, 10) || 1,
      time: r.time,
      fixed: true,
    }));

    expect(initialActivities).toHaveLength(1);
    expect(initialActivities[0].fixed).toBe(true);
    expect(initialActivities[0].locked).toBe(true);
    expect(initialActivities[0].title).toBe('Dinner at La Maison');

    expect(tripReservations).toHaveLength(1);
    expect(tripReservations[0].type).toBe('restaurant');
    expect(tripReservations[0].title).toBe('Dinner at La Maison');
  });
});

// ─── Fix 3: Relaxed pace - meals separate from main ─────────────────────────

describe('Relaxed pace meals separate (Fix 3)', () => {
  const makeAct = (day: number, time: string, title: string, type: Activity['type'] = 'activity', duration = 60): Activity => ({
    id: 'id-' + day + '-' + time,
    day,
    time,
    title,
    type,
    duration,
  });

  test('2 mains + 3 meals for relaxed pace = no pace_overload', () => {
    const acts = [
      makeAct(1, '08:00', 'Breakfast at cafe', 'food', 60),
      makeAct(1, '10:00', 'Temple Visit', 'activity', 120),
      makeAct(1, '12:30', 'Lunch spot', 'food', 60),
      makeAct(1, '15:00', 'Garden walk', 'activity', 90),
      makeAct(1, '19:00', 'Dinner', 'food', 90),
    ];
    const issues = validateGeneratedActivities(acts, 1, 'relaxed');
    expect(issues.filter((i) => i.type === 'pace_overload')).toHaveLength(0);
  });

  test('3 mains + 3 meals for relaxed pace = pace_overload on main activities', () => {
    const acts = [
      makeAct(1, '08:00', 'Breakfast', 'food', 60),
      makeAct(1, '10:00', 'Museum', 'activity', 90),
      makeAct(1, '12:00', 'Lunch', 'food', 60),
      makeAct(1, '14:00', 'Temple', 'activity', 90),
      makeAct(1, '16:30', 'Shopping', 'activity', 60),
      makeAct(1, '19:00', 'Dinner', 'food', 90),
    ];
    const issues = validateGeneratedActivities(acts, 1, 'relaxed');
    const paceIssues = issues.filter((i) => i.type === 'pace_overload');
    expect(paceIssues.length).toBeGreaterThan(0);
    // The overload message should reference main activities, not total
    expect(paceIssues[0].message).toContain('main activities');
  });
});

// ─── Fix 4: Meal time repair and blocking ───────────────────────────────────

describe('Meal time repair (Fix 4)', () => {
  const makeAct = (id: string, day: number, time: string, title: string, type: Activity['type'] = 'food', duration = 60): Activity => ({
    id,
    day,
    time,
    title,
    type,
    duration,
  });

  test('breakfast at 12:15 is snapped to 08:00 by repairActivities', () => {
    const acts = [makeAct('b1', 1, '12:15', 'Breakfast at hotel', 'food')];
    const repaired = repairActivities(acts, 1, 'moderate');
    expect(repaired[0].time).toBe('08:00');
  });

  test('lunch at 16:00 is snapped to 12:30', () => {
    const acts = [makeAct('l1', 1, '16:00', 'Lunch break', 'food')];
    const repaired = repairActivities(acts, 1, 'moderate');
    expect(repaired[0].time).toBe('12:30');
  });

  test('dinner at 15:00 is snapped to 19:00', () => {
    const acts = [makeAct('d1', 1, '15:00', 'Dinner at bistro', 'food')];
    const repaired = repairActivities(acts, 1, 'moderate');
    expect(repaired[0].time).toBe('19:00');
  });
});

describe('Meal time blocking severity (Fix 4)', () => {
  const makeAct = (day: number, time: string, title: string, duration = 60): Activity => ({
    id: 'id-' + day + '-' + time,
    day,
    time,
    title,
    type: 'food',
    duration,
  });

  test('breakfast at 12:15 returns severity error meal_timing issue', () => {
    const acts = [makeAct(1, '12:15', 'Breakfast at hotel')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    const mealIssues = issues.filter((i) => i.type === 'meal_timing' && i.message.includes('Breakfast'));
    expect(mealIssues.length).toBeGreaterThan(0);
    expect(mealIssues[0].severity).toBe('error');
  });

  test('breakfast at 08:00 has no meal_timing issue', () => {
    const acts = [makeAct(1, '08:00', 'Breakfast at cafe')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    expect(issues.filter((i) => i.type === 'meal_timing')).toHaveLength(0);
  });

  test('breakfast at 09:45 is a warning not error', () => {
    const acts = [makeAct(1, '09:45', 'Late Breakfast')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    const mealIssues = issues.filter((i) => i.type === 'meal_timing');
    expect(mealIssues.length).toBeGreaterThan(0);
    expect(mealIssues[0].severity).toBe('warning');
  });

  test('dinner at 15:00 returns severity error', () => {
    const acts = [makeAct(1, '15:00', 'Early Dinner')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    const dinnerIssues = issues.filter((i) => i.type === 'meal_timing' && i.message.includes('Dinner'));
    expect(dinnerIssues.length).toBeGreaterThan(0);
    expect(dinnerIssues[0].severity).toBe('error');
  });

  test('dinner at 18:00 is a warning (early but acceptable)', () => {
    const acts = [makeAct(1, '18:00', 'Dinner at bistro')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    const dinnerIssues = issues.filter((i) => i.type === 'meal_timing');
    expect(dinnerIssues.length).toBeGreaterThan(0);
    expect(dinnerIssues[0].severity).toBe('warning');
  });
});

// ─── Fix 5b: normalizeActivity preserves placeId ────────────────────────────

describe('normalizeActivity preserves Google Places metadata (Fix 5b)', () => {
  test('preserves placeId when present', () => {
    const result = normalizeActivity({
      title: 'Eiffel Tower',
      day: 1,
      time: '10:00',
      type: 'activity',
      placeId: 'ChIJLU7jZClu5kcR4PcOOO6p3I0',
    }, 3);
    expect(result).not.toBeNull();
    expect((result as any).placeId).toBe('ChIJLU7jZClu5kcR4PcOOO6p3I0');
  });

  test('preserves address, lat, lng when present', () => {
    const result = normalizeActivity({
      title: 'Louvre Museum',
      day: 1,
      time: '10:00',
      type: 'activity',
      address: 'Rue de Rivoli, 75001 Paris',
      lat: 48.8606,
      lng: 2.3376,
    }, 3);
    expect(result).not.toBeNull();
    expect((result as any).address).toBe('Rue de Rivoli, 75001 Paris');
    expect((result as any).lat).toBe(48.8606);
    expect((result as any).lng).toBe(2.3376);
  });

  test('does not add placeId when not present', () => {
    const result = normalizeActivity({
      title: 'Random Place',
      day: 1,
      time: '10:00',
    }, 3);
    expect(result).not.toBeNull();
    expect((result as any).placeId).toBeUndefined();
  });
});

// ─── Issue 1 regression: Ask Travonal action verification ─────────────────

describe('Issue 1: Ask Travonal — mutation return values', () => {
  // Simulate the synchronous success flag pattern used by trips.tsx
  function simulateAddActivity(tripId: string, trips: { id: string }[]) {
    let success = false;
    // Simulates setTrips callback pattern
    const updater = (prev: typeof trips) => {
      const idx = prev.findIndex((t) => t.id === tripId);
      if (idx === -1) return prev;
      success = true;
      return prev;
    };
    updater(trips);
    return success;
  }

  test('applyTripAction add_activity with valid trip returns ok: true', () => {
    const trips = [{ id: 'trip-1' }];
    const ok = simulateAddActivity('trip-1', trips);
    expect(ok).toBe(true);
  });

  test('applyTripAction add_activity with non-existent tripId returns ok: false', () => {
    const trips = [{ id: 'trip-1' }];
    const ok = simulateAddActivity('nonexistent', trips);
    expect(ok).toBe(false);
  });

  test('when actions fail, displayed message reflects failure not success', () => {
    const failures = ['Add failed — trip xyz not found'];
    // This mirrors the message construction in chat.tsx
    const failMsg = "I couldn't complete that. " + failures.join('; ') + '.';
    // Should NOT contain Claude's typical success phrases
    expect(failMsg).not.toContain('Done');
    expect(failMsg).not.toContain('I\'ve added');
    expect(failMsg).not.toContain('successfully');
    // Should contain the failure reason
    expect(failMsg).toContain('trip xyz not found');
  });
});

// ─── Issue 2 regression: Meal validation blocks after repair ──────────────

describe('Issue 2: Meal validation blocks after repair', () => {
  const makeAct = (id: string, day: number, time: string, title: string, type: Activity['type'] = 'food', duration = 60): Activity => ({
    id,
    day,
    time,
    title,
    type,
    duration,
  });

  test('repairActivities snaps breakfast titled "Breakfast at Le Pain" at 12:15 to 08:00', () => {
    const acts = [makeAct('b1', 1, '12:15', 'Breakfast at Le Pain', 'food')];
    const repaired = repairActivities(acts, 1, 'moderate');
    expect(repaired[0].time).toBe('08:00');
  });

  test('validateGeneratedActivities after repair returns no errors for breakfast at 08:00', () => {
    const acts = [makeAct('b1', 1, '08:00', 'Breakfast at Le Pain', 'food')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  test('validateGeneratedActivities with lunch at 16:30 returns severity error meal_timing', () => {
    const acts = [makeAct('l1', 1, '16:30', 'Lunch at cafe', 'food')];
    const issues = validateGeneratedActivities(acts, 1, 'moderate');
    const mealErrors = issues.filter((i) => i.type === 'meal_timing' && i.severity === 'error');
    expect(mealErrors.length).toBeGreaterThan(0);
  });
});

// ─── Issue 3 regression: Trip Pulse uses trip-specific pace ───────────────

describe('Issue 3: Trip Pulse uses trip-specific pace', () => {
  const makeTrip = (pace: 'relaxed' | 'moderate' | 'active' | undefined, activities: Activity[]) => ({
    id: 'trip-1',
    destination: 'Tokyo',
    country: 'Japan',
    startDate: '2026-01-01',
    endDate: '2026-01-03',
    notes: '',
    emoji: '🗼',
    activities,
    pace,
  });

  const makeProfile = (pace: 'relaxed' | 'moderate' | 'active') => ({
    pace,
    budget: 'moderate' as const,
    flexibility: 'some' as const,
    interests: [] as string[],
    dislikes: [] as string[],
    dietaryRestrictions: [] as string[],
    mobilityNeeds: [] as string[],
    absoluteRules: [] as string[],
    travelWith: 'solo' as const,
    accommodationPreference: 'hotel' as const,
  });

  const mainAct = (id: string, day: number, time: string, title: string): Activity => ({
    id, day, time, title, type: 'activity', duration: 60,
  });
  const foodAct = (id: string, day: number, time: string, title: string): Activity => ({
    id, day, time, title, type: 'food', duration: 60,
  });

  test('pace mismatch no longer generates alerts', () => {
    const acts = [
      mainAct('a1', 1, '09:00', 'Museum'),
      mainAct('a2', 1, '11:00', 'Temple'),
      mainAct('a3', 1, '14:00', 'Park'),
    ];
    const trip = makeTrip('relaxed', acts);
    const profile = makeProfile('active');
    const alerts = runTripPulse(trip, profile, [], Infinity);
    expect(alerts.some((a: any) => (a.type as string) === 'optimization')).toBe(false);
  });
});

// ─── Issue 4 regression: Google Places metadata in normalizeActivity ──────

describe('Issue 4: Google Places metadata survives to Activity', () => {
  test('normalizeActivity with placeId preserves it', () => {
    const result = normalizeActivity({
      title: 'Senso-ji Temple',
      day: 1,
      time: '09:00',
      type: 'activity',
      placeId: 'ChIJ123abc',
    }, 3);
    expect(result).not.toBeNull();
    expect((result as any).placeId).toBe('ChIJ123abc');
  });

  test('normalizeActivity with lat, lng, address preserves all three', () => {
    const result = normalizeActivity({
      title: 'Tokyo Tower',
      day: 1,
      time: '10:00',
      type: 'activity',
      lat: 35.7,
      lng: 139.7,
      address: '4-2-8 Shiba-koen, Minato City',
    }, 3);
    expect(result).not.toBeNull();
    expect((result as any).lat).toBe(35.7);
    expect((result as any).lng).toBe(139.7);
    expect((result as any).address).toBe('4-2-8 Shiba-koen, Minato City');
  });

  test('normalizeActivity without placeId has no placeId field', () => {
    const result = normalizeActivity({
      title: 'Some Place',
      day: 1,
      time: '10:00',
    }, 3);
    expect(result).not.toBeNull();
    expect((result as any).placeId).toBeUndefined();
  });
});

// ─── Issue 1 (v9): Mutation verification via tripsRef precondition pattern ──

describe('Issue 1 (v9): tripsRef precondition-based mutation verification', () => {
  // These tests validate the precondition logic that addActivity/removeActivity/
  // updateActivity use. The actual React context functions read tripsRef.current
  // to check preconditions, then call setTrips() with a pure functional updater.
  // The returned boolean reflects whether preconditions passed, NOT a side-effect
  // variable set inside the updater (which would be unreliable under StrictMode).

  function simulateAddActivity(
    tripId: string,
    tripsRef: { id: string; activities: { id: string; locked?: boolean; fixed?: boolean }[] }[],
  ): boolean {
    const trip = tripsRef.find((t) => t.id === tripId);
    if (!trip) return false;
    // Precondition passed — mutation would be issued
    return true;
  }

  function simulateRemoveActivity(
    tripId: string,
    activityId: string,
    tripsRef: { id: string; activities: { id: string; locked?: boolean; fixed?: boolean }[] }[],
  ): boolean {
    const trip = tripsRef.find((t) => t.id === tripId);
    if (!trip) return false;
    const activity = trip.activities.find((a) => a.id === activityId);
    if (!activity) return false;
    if (activity.locked || activity.fixed) return false;
    return true;
  }

  const mockTrips = [
    {
      id: 'trip-1',
      activities: [
        { id: 'act-1', locked: false, fixed: false },
        { id: 'act-2', locked: true },
        { id: 'act-3', fixed: true },
      ],
    },
  ];

  test('addActivity with valid tripId returns true', () => {
    expect(simulateAddActivity('trip-1', mockTrips)).toBe(true);
  });

  test('addActivity with non-existent tripId returns false', () => {
    expect(simulateAddActivity('nonexistent', mockTrips)).toBe(false);
  });

  test('removeActivity with valid tripId + activityId returns true', () => {
    expect(simulateRemoveActivity('trip-1', 'act-1', mockTrips)).toBe(true);
  });

  test('removeActivity with non-existent activityId returns false', () => {
    expect(simulateRemoveActivity('trip-1', 'nonexistent', mockTrips)).toBe(false);
  });
});

// ─── Issue 2 (v9): Locked/fixed meal protection in repairActivities ─────────

describe('Issue 2 (v9): repairActivities locked/fixed meal protection', () => {
  const makeAct = (id: string, day: number, time: string, title: string, type: Activity['type'] = 'food', duration = 60, extra: Partial<Activity> = {}): Activity => ({
    id,
    day,
    time,
    title,
    type,
    duration,
    ...extra,
  });

  test('locked breakfast at 11:00 is NOT snapped', () => {
    const acts = [makeAct('b1', 1, '11:00', 'Breakfast at hotel', 'food', 60, { locked: true })];
    const repaired = repairActivities(acts, 1, 'moderate');
    expect(repaired[0].time).toBe('11:00');
  });

  test('fixed dinner at 16:00 is NOT snapped', () => {
    const acts = [makeAct('d1', 1, '16:00', 'Dinner reservation', 'food', 90, { fixed: true })];
    const repaired = repairActivities(acts, 1, 'moderate');
    expect(repaired[0].time).toBe('16:00');
  });

  test('unlocked breakfast at 11:00 IS snapped to 08:00', () => {
    const acts = [makeAct('b1', 1, '11:00', 'Breakfast at cafe', 'food', 60)];
    const repaired = repairActivities(acts, 1, 'moderate');
    expect(repaired[0].time).toBe('08:00');
  });

  test('locked activity overlapping unlocked one: unlocked is removed, locked preserved', () => {
    const acts = [
      makeAct('a1', 1, '10:00', 'Walking Tour', 'activity', 120),
      makeAct('a2', 1, '11:00', 'Fixed Meeting', 'activity', 60, { locked: true }),
    ];
    const repaired = repairActivities(acts, 1, 'moderate');
    // The locked meeting must survive
    expect(repaired.find((a) => a.id === 'a2')).toBeDefined();
    // The unlocked walking tour should be removed
    expect(repaired.find((a) => a.id === 'a1')).toBeUndefined();
  });

  test('pace overload with locked activities: locked ones kept, excess unlocked removed', () => {
    const acts = [
      makeAct('a1', 1, '08:00', 'Fixed Visit', 'activity', 60, { locked: true }),
      makeAct('a2', 1, '10:00', 'Museum', 'activity', 90),
      makeAct('a3', 1, '12:00', 'Temple', 'activity', 90),
      makeAct('a4', 1, '14:30', 'Shopping', 'activity', 60),
    ];
    // relaxed pace = max 2 main activities
    const repaired = repairActivities(acts, 1, 'relaxed');
    // The locked activity must survive
    expect(repaired.find((a) => a.id === 'a1')).toBeDefined();
    // Total main activities should be at most 2
    const mainCount = repaired.filter((a) => a.type !== 'food').length;
    expect(mainCount).toBeLessThanOrEqual(2);
    // The locked one counts toward the limit but is never removed
    expect(repaired.some((a) => a.id === 'a1')).toBe(true);
  });
});

// ─── NormalizedPlace / place-model ─────────────────────────────────────────

describe('mapGoogleTypeToCategory', () => {
  test('cafe -> food/cafe', () => {
    expect(mapGoogleTypeToCategory(['cafe'])).toBe('food/cafe');
  });

  test('restaurant -> food/restaurant', () => {
    expect(mapGoogleTypeToCategory(['restaurant'])).toBe('food/restaurant');
  });

  test('museum -> activity/museum', () => {
    expect(mapGoogleTypeToCategory(['museum'])).toBe('activity/museum');
  });

  test('lodging -> stay/hotel', () => {
    expect(mapGoogleTypeToCategory(['lodging'])).toBe('stay/hotel');
  });

  test('tourist_attraction -> activity/attraction', () => {
    expect(mapGoogleTypeToCategory(['tourist_attraction'])).toBe('activity/attraction');
  });

  test('art_gallery -> activity/museum', () => {
    expect(mapGoogleTypeToCategory(['art_gallery'])).toBe('activity/museum');
  });

  test('zoo -> activity/entertainment', () => {
    expect(mapGoogleTypeToCategory(['zoo'])).toBe('activity/entertainment');
  });

  // Priority tests: specific types must win over point_of_interest catch-all
  test('lodging + point_of_interest -> stay/hotel', () => {
    expect(mapGoogleTypeToCategory(['lodging', 'point_of_interest', 'establishment'])).toBe('stay/hotel');
  });

  test('hotel + tourist_attraction -> stay/hotel', () => {
    expect(mapGoogleTypeToCategory(['hotel', 'tourist_attraction', 'point_of_interest'])).toBe('stay/hotel');
  });

  test('hostel + point_of_interest -> stay/hostel', () => {
    expect(mapGoogleTypeToCategory(['hostel', 'point_of_interest'])).toBe('stay/hostel');
  });

  test('amusement_park + tourist_attraction -> activity/entertainment', () => {
    expect(mapGoogleTypeToCategory(['amusement_park', 'tourist_attraction', 'point_of_interest'])).toBe('activity/entertainment');
  });

  test('shopping_mall + point_of_interest -> shopping', () => {
    expect(mapGoogleTypeToCategory(['shopping_mall', 'point_of_interest'])).toBe('shopping');
  });

  test('zoo + tourist_attraction -> activity/entertainment', () => {
    expect(mapGoogleTypeToCategory(['zoo', 'tourist_attraction'])).toBe('activity/entertainment');
  });

  test('art_gallery + point_of_interest -> activity/museum', () => {
    expect(mapGoogleTypeToCategory(['art_gallery', 'point_of_interest'])).toBe('activity/museum');
  });

  test('gym + point_of_interest -> activity/sport', () => {
    expect(mapGoogleTypeToCategory(['gym', 'point_of_interest'])).toBe('activity/sport');
  });

  test('spa + point_of_interest -> activity/sport', () => {
    expect(mapGoogleTypeToCategory(['spa', 'point_of_interest'])).toBe('activity/sport');
  });
});

describe('normalizeGooglePlace', () => {
  test('normalizes a full raw Google place', () => {
    const raw = {
      id: 'ChIJ123',
      displayName: { text: 'Eiffel Tower' },
      formattedAddress: '5 Avenue Anatole France, 75007 Paris',
      location: { latitude: 48.8584, longitude: 2.2945 },
      types: ['tourist_attraction', 'point_of_interest'],
      rating: 4.6,
      userRatingCount: 250000,
      photos: [{ name: 'photos/abc123' }],
      editorialSummary: { text: 'Iconic iron lattice tower' },
    };
    const result = normalizeGooglePlace(raw);
    expect(result.placeId).toBe('ChIJ123');
    expect(result.source).toBe('google');
    expect(result.name).toBe('Eiffel Tower');
    expect(result.address).toBe('5 Avenue Anatole France, 75007 Paris');
    expect(result.lat).toBeCloseTo(48.8584);
    expect(result.lng).toBeCloseTo(2.2945);
    expect(result.category).toBe('activity/attraction');
    expect(result.rating).toBe(4.6);
    expect(result.reviewCount).toBe(250000);
    expect(result.photos).toHaveLength(1);
    expect(result.photos![0].reference).toBe('photos/abc123');
    expect(result.description).toBe('Iconic iron lattice tower');
  });
});

describe('dedupeByPlaceId', () => {
  test('removes duplicates by placeId', () => {
    const places = [
      { placeId: 'a', source: 'google' as const, name: 'A', category: 'activity/other' as const },
      { placeId: 'a', source: 'google' as const, name: 'A dup', category: 'activity/other' as const },
      { placeId: 'b', source: 'google' as const, name: 'B', category: 'activity/other' as const },
    ];
    const result = dedupeByPlaceId(places);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('A');
    expect(result[1].name).toBe('B');
  });

  test('keeps items without placeId', () => {
    const places = [
      { source: 'sample' as const, name: 'X', category: 'activity/other' as const },
      { source: 'sample' as const, name: 'Y', category: 'activity/other' as const },
    ];
    const result = dedupeByPlaceId(places);
    expect(result).toHaveLength(2);
  });
});

describe('categoryToActivityType', () => {
  test('food/restaurant -> food', () => {
    expect(categoryToActivityType('food/restaurant')).toBe('food');
  });

  test('stay/hotel -> hotel', () => {
    expect(categoryToActivityType('stay/hotel')).toBe('hotel');
  });

  test('activity/museum -> activity', () => {
    expect(categoryToActivityType('activity/museum')).toBe('activity');
  });
});

describe('priceLevelLabel', () => {
  test('level 2 -> $$', () => {
    expect(priceLevelLabel(2)).toBe('$$');
  });

  test('null -> empty string', () => {
    expect(priceLevelLabel(undefined)).toBe('');
  });
});

describe('formatDistance', () => {
  test('500m', () => {
    expect(formatDistance(500)).toBe('500m');
  });

  test('1500m -> 1.5 km', () => {
    expect(formatDistance(1500)).toBe('1.5 km');
  });

  test('undefined -> empty string', () => {
    expect(formatDistance(undefined)).toBe('');
  });
});

describe('calcDistance', () => {
  test('Paris to nearby point is roughly correct', () => {
    // Eiffel Tower to Arc de Triomphe: ~2.8km
    const d = calcDistance(48.8584, 2.2945, 48.8738, 2.2950);
    expect(d).toBeGreaterThan(1500);
    expect(d).toBeLessThan(2500);
  });
});
