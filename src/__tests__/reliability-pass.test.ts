/**
 * Comprehensive tests for the reliability pass (Issues 1-9).
 * All tests import and exercise actual production code — no copied implementations.
 */

import { parseTextToCommand } from '@/components/ask-travonal';
import { transformTrip, TransformScope } from '@/services/transformation-service';
import { runTripPulse } from '@/services/trip-pulse';
import { pulseInputFingerprint } from '@/components/app-pulse-evaluator';
import {
  recordAlert,
  markSeen,
  resolveAlert,
  autoResolve,
  markNotified,
  isOccurrenceNotified,
  getResolvedForTrip,
  getActiveOccurrence,
  resetIdCounter,
} from '@/services/pulse-history-ops';
import { PulseHistoryEntry } from '@/services/storage';
import { Trip, Activity } from '@/context/trips';
import { TravelProfile } from '@/context/profile';

// ---------- shared fixtures ----------

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

function makeActivity(overrides: Partial<Activity> & { id: string; day: number; time: string }): Activity {
  return {
    title: 'Test Activity',
    type: 'activity',
    duration: 120,
    category: 'culture',
    cost: 'moderate',
    ...overrides,
  };
}

function makeTrip(overrides: Partial<Trip> & { id: string }): Trip {
  return {
    destination: 'Tokyo',
    country: 'Japan',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    notes: '',
    emoji: '',
    activities: [],
    status: 'planned',
    ...overrides,
  };
}

const META = { title: 'Test Alert', message: 'Test msg', alertType: 'conflict', severity: 'urgent' };

// ============================================================
// Issue 1: "Move this later/earlier" at activity scope
// ============================================================

describe('Issue 1: Move this later/earlier', () => {
  test('"move this later" parses to move_later command', () => {
    const result = parseTextToCommand('move this later');
    expect(result.command).toBe('move_later');
  });

  test('"push this earlier" parses to move_earlier command', () => {
    const result = parseTextToCommand('push this earlier');
    expect(result.command).toBe('move_earlier');
  });

  test('"shift earlier" parses to move_earlier', () => {
    const result = parseTextToCommand('shift earlier');
    expect(result.command).toBe('move_earlier');
  });

  test('"slide this later" parses to move_later', () => {
    const result = parseTextToCommand('slide this later');
    expect(result.command).toBe('move_later');
  });

  test('move_later at activity scope shifts +60 minutes', () => {
    const trip = makeTrip({
      id: 't1',
      activities: [
        makeActivity({ id: 'a1', day: 1, time: '10:00', title: 'Museum' }),
        makeActivity({ id: 'a2', day: 1, time: '14:00', title: 'Temple' }),
      ],
    });
    const scope: TransformScope = { type: 'activity', activityId: 'a1', day: 1 };
    const result = transformTrip(trip, 'move_later', scope, BASE_PROFILE, []);
    const a1 = result.activities.find((a) => a.id === 'a1');
    expect(a1?.time).toBe('11:00');
    // Other activity unchanged
    const a2 = result.activities.find((a) => a.id === 'a2');
    expect(a2?.time).toBe('14:00');
  });

  test('move_earlier at activity scope shifts -60 minutes', () => {
    const trip = makeTrip({
      id: 't1',
      activities: [
        makeActivity({ id: 'a1', day: 1, time: '10:00', title: 'Museum' }),
        makeActivity({ id: 'a2', day: 1, time: '14:00', title: 'Temple' }),
      ],
    });
    const scope: TransformScope = { type: 'activity', activityId: 'a1', day: 1 };
    const result = transformTrip(trip, 'move_earlier', scope, BASE_PROFILE, []);
    const a1 = result.activities.find((a) => a.id === 'a1');
    expect(a1?.time).toBe('09:00');
    const a2 = result.activities.find((a) => a.id === 'a2');
    expect(a2?.time).toBe('14:00');
  });

  test('move_later with explicit startAfter uses that time', () => {
    const trip = makeTrip({
      id: 't1',
      activities: [makeActivity({ id: 'a1', day: 1, time: '10:00', title: 'Museum' })],
    });
    const scope: TransformScope = { type: 'activity', activityId: 'a1', day: 1 };
    const result = transformTrip(trip, 'move_later', scope, BASE_PROFILE, [], undefined, undefined, '16:30');
    const a1 = result.activities.find((a) => a.id === 'a1');
    expect(a1?.time).toBe('16:30');
  });

  test('move_earlier does not go below 00:00', () => {
    const trip = makeTrip({
      id: 't1',
      activities: [makeActivity({ id: 'a1', day: 1, time: '00:30', title: 'Late Night' })],
    });
    const scope: TransformScope = { type: 'activity', activityId: 'a1', day: 1 };
    const result = transformTrip(trip, 'move_earlier', scope, BASE_PROFILE, []);
    const a1 = result.activities.find((a) => a.id === 'a1');
    expect(a1?.time).toBe('00:00');
  });

  test('locked activity cannot be moved', () => {
    const trip = makeTrip({
      id: 't1',
      activities: [makeActivity({ id: 'a1', day: 1, time: '10:00', title: 'Hotel', locked: true })],
    });
    const scope: TransformScope = { type: 'activity', activityId: 'a1', day: 1 };
    const result = transformTrip(trip, 'move_later', scope, BASE_PROFILE, []);
    expect(result.summary).toBe('Cannot modify');
  });

  test('move_later at day scope returns guidance message', () => {
    const trip = makeTrip({
      id: 't1',
      activities: [makeActivity({ id: 'a1', day: 1, time: '10:00', title: 'Museum' })],
    });
    const scope: TransformScope = { type: 'day', day: 1 };
    const result = transformTrip(trip, 'move_later', scope, BASE_PROFILE, []);
    expect(result.summary).toContain('specific activity');
  });
});

// ============================================================
// Issue 2: Notification permission reactivity
// ============================================================

describe('Issue 2: Notification permission', () => {
  test('scheduleLocalNotification returns false when permission not granted', async () => {
    const { scheduleLocalNotification } = await import('@/services/notifications');
    const result = await scheduleLocalNotification('Test', 'Body');
    expect(result).toBe(false);
  });

  test('hasPermission returns false by default', async () => {
    const { hasPermission } = await import('@/services/notifications');
    expect(hasPermission()).toBe(false);
  });

  test('onPermissionChange returns an unsubscribe function', async () => {
    const { onPermissionChange } = await import('@/services/notifications');
    const cb = jest.fn();
    const unsub = onPermissionChange(cb);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  test('getPermissionVersion returns a number', async () => {
    const { getPermissionVersion } = await import('@/services/notifications');
    expect(typeof getPermissionVersion()).toBe('number');
  });
});

// ============================================================
// Issue 3: Full-fidelity fingerprinting (actual production function)
// ============================================================

describe('Issue 3: pulseInputFingerprint — actual production function', () => {
  test('same trips + profile produce same fingerprint', () => {
    const trips = [makeTrip({ id: 't1', activities: [makeActivity({ id: 'a1', day: 1, time: '09:00' })] })];
    const fp1 = pulseInputFingerprint(trips, BASE_PROFILE);
    const fp2 = pulseInputFingerprint(trips, BASE_PROFILE);
    expect(fp1).toBe(fp2);
  });

  test('adding activity changes fingerprint', () => {
    const trips1 = [makeTrip({ id: 't1', activities: [makeActivity({ id: 'a1', day: 1, time: '09:00' })] })];
    const trips2 = [makeTrip({
      id: 't1',
      activities: [
        makeActivity({ id: 'a1', day: 1, time: '09:00' }),
        makeActivity({ id: 'a2', day: 1, time: '14:00' }),
      ],
    })];
    expect(pulseInputFingerprint(trips1, BASE_PROFILE)).not.toBe(pulseInputFingerprint(trips2, BASE_PROFILE));
  });

  test('changing activity time changes fingerprint (same count)', () => {
    const trips1 = [makeTrip({ id: 't1', activities: [makeActivity({ id: 'a1', day: 1, time: '09:00' })] })];
    const trips2 = [makeTrip({ id: 't1', activities: [makeActivity({ id: 'a1', day: 1, time: '11:00' })] })];
    expect(pulseInputFingerprint(trips1, BASE_PROFILE)).not.toBe(pulseInputFingerprint(trips2, BASE_PROFILE));
  });

  test('changing reservation time changes fingerprint (same count)', () => {
    const res1 = { id: 'r1', tripId: 't1', title: 'Dinner', type: 'restaurant' as const, time: '19:00' };
    const res2 = { ...res1, time: '21:00' };
    const trips1 = [makeTrip({ id: 't1', reservations: [res1] })];
    const trips2 = [makeTrip({ id: 't1', reservations: [res2] })];
    expect(pulseInputFingerprint(trips1, BASE_PROFILE)).not.toBe(pulseInputFingerprint(trips2, BASE_PROFILE));
  });

  test('changing budget changes fingerprint', () => {
    const trips1 = [makeTrip({ id: 't1', budget: 'moderate' })];
    const trips2 = [makeTrip({ id: 't1', budget: 'premium' })];
    expect(pulseInputFingerprint(trips1, BASE_PROFILE)).not.toBe(pulseInputFingerprint(trips2, BASE_PROFILE));
  });

  test('changing profile pace changes fingerprint', () => {
    const trips = [makeTrip({ id: 't1' })];
    const fp1 = pulseInputFingerprint(trips, { ...BASE_PROFILE, pace: 'relaxed' });
    const fp2 = pulseInputFingerprint(trips, { ...BASE_PROFILE, pace: 'active' });
    expect(fp1).not.toBe(fp2);
  });

  test('changing profile dislikes changes fingerprint', () => {
    const trips = [makeTrip({ id: 't1' })];
    const fp1 = pulseInputFingerprint(trips, { ...BASE_PROFILE, dislikes: [] });
    const fp2 = pulseInputFingerprint(trips, { ...BASE_PROFILE, dislikes: ['Early mornings'] });
    expect(fp1).not.toBe(fp2);
  });

  test('changing dates changes fingerprint', () => {
    const trips1 = [makeTrip({ id: 't1', startDate: '2026-09-01', endDate: '2026-09-03' })];
    const trips2 = [makeTrip({ id: 't1', startDate: '2026-09-01', endDate: '2026-09-05' })];
    expect(pulseInputFingerprint(trips1, BASE_PROFILE)).not.toBe(pulseInputFingerprint(trips2, BASE_PROFILE));
  });

  test('changing itineraryRevision changes fingerprint', () => {
    const trips1 = [makeTrip({ id: 't1', itineraryRevision: 1 })];
    const trips2 = [makeTrip({ id: 't1', itineraryRevision: 2 })];
    expect(pulseInputFingerprint(trips1, BASE_PROFILE)).not.toBe(pulseInputFingerprint(trips2, BASE_PROFILE));
  });
});

// ============================================================
// Issues 4-7: Centralized pulse history with occurrence model
// (tests actual production operations from pulse-history-ops.ts)
// ============================================================

describe('Issues 4-7: Pulse history operations (production code)', () => {
  beforeEach(() => resetIdCounter());

  describe('recordAlert — creates or updates occurrences', () => {
    test('creates new occurrence when none exists', () => {
      const [entries, occId] = recordAlert([], 'trip-1', 'conflict-1', META);
      expect(entries.length).toBe(1);
      expect(entries[0].occurrenceId).toBe(occId);
      expect(entries[0].status).toBe('new');
      expect(entries[0].alertId).toBe('conflict-1');
      expect(entries[0].tripId).toBe('trip-1');
      expect(entries[0].title).toBe('Test Alert');
    });

    test('updates existing active occurrence metadata without creating duplicate', () => {
      const [first] = recordAlert([], 'trip-1', 'conflict-1', META);
      const newMeta = { ...META, message: 'Updated msg' };
      const [second, occId] = recordAlert(first, 'trip-1', 'conflict-1', newMeta);
      expect(second.length).toBe(1);
      expect(second[0].occurrenceId).toBe(occId);
      expect(second[0].message).toBe('Updated msg');
    });

    test('creates NEW occurrence when previous is resolved (Issue 5)', () => {
      let [entries] = recordAlert([], 'trip-1', 'conflict-1', META);
      entries = resolveAlert(entries, 'trip-1', 'conflict-1');
      expect(entries[0].status).toBe('resolved');

      // Same alert reappears — should create a NEW occurrence
      const [after, newOccId] = recordAlert(entries, 'trip-1', 'conflict-1', META);
      expect(after.length).toBe(2);
      expect(after[0].status).toBe('resolved'); // old occurrence preserved
      expect(after[1].status).toBe('new'); // new occurrence
      expect(after[1].occurrenceId).toBe(newOccId);
      expect(after[0].occurrenceId).not.toBe(newOccId); // different IDs
    });
  });

  describe('markSeen — transitions new → seen', () => {
    test('marks new occurrence as seen', () => {
      const [entries] = recordAlert([], 'trip-1', 'conflict-1', META);
      const updated = markSeen(entries, 'trip-1', ['conflict-1']);
      expect(updated[0].status).toBe('seen');
      expect(updated[0].seenAt).toBeDefined();
    });

    test('does not change already-seen occurrence', () => {
      const [entries] = recordAlert([], 'trip-1', 'conflict-1', META);
      const seen = markSeen(entries, 'trip-1', ['conflict-1']);
      const result = markSeen(seen, 'trip-1', ['conflict-1']);
      expect(result).toBe(seen); // same reference — no change
    });

    test('is trip-scoped: trip-B seen does not affect trip-A', () => {
      let [entries] = recordAlert([], 'trip-A', 'conflict-1', META);
      const [entries2] = recordAlert(entries, 'trip-B', 'conflict-1', META);
      const updated = markSeen(entries2, 'trip-B', ['conflict-1']);
      expect(updated[0].status).toBe('new'); // trip-A unchanged
      expect(updated[1].status).toBe('seen'); // trip-B changed
    });
  });

  describe('resolveAlert — dismiss creates persistent resolution (Issue 7)', () => {
    test('resolves active occurrence with resolvedAt', () => {
      const [entries] = recordAlert([], 'trip-1', 'conflict-1', META);
      const resolved = resolveAlert(entries, 'trip-1', 'conflict-1');
      expect(resolved[0].status).toBe('resolved');
      expect(resolved[0].resolvedAt).toBeDefined();
    });

    test('already-resolved occurrence is not changed', () => {
      const [entries] = recordAlert([], 'trip-1', 'conflict-1', META);
      const resolved = resolveAlert(entries, 'trip-1', 'conflict-1');
      const again = resolveAlert(resolved, 'trip-1', 'conflict-1');
      expect(again).toBe(resolved); // same reference
    });

    test('resolved occurrence stays in history (visible in resolved UI)', () => {
      const [entries] = recordAlert([], 'trip-1', 'conflict-1', META);
      const resolved = resolveAlert(entries, 'trip-1', 'conflict-1');
      const forTrip = getResolvedForTrip(resolved, 'trip-1');
      expect(forTrip.length).toBe(1);
      expect(forTrip[0].title).toBe('Test Alert');
    });
  });

  describe('autoResolve — uses full alert set, not display cap (Issue 8)', () => {
    test('auto-resolves alerts not in active set', () => {
      let entries: PulseHistoryEntry[] = [];
      [entries] = recordAlert(entries, 'trip-1', 'alert-1', META);
      [entries] = recordAlert(entries, 'trip-1', 'alert-2', META);
      [entries] = recordAlert(entries, 'trip-1', 'alert-3', META);

      // Only alert-1 still active
      const updated = autoResolve(entries, 'trip-1', new Set(['alert-1']));
      expect(getActiveOccurrence(updated, 'trip-1', 'alert-1')?.status).toBe('new');
      expect(getActiveOccurrence(updated, 'trip-1', 'alert-2')).toBeUndefined(); // resolved
      expect(getActiveOccurrence(updated, 'trip-1', 'alert-3')).toBeUndefined(); // resolved
      expect(getResolvedForTrip(updated, 'trip-1').length).toBe(2);
    });

    test('does not resolve alerts still in active set (even beyond top-5)', () => {
      let entries: PulseHistoryEntry[] = [];
      const alertIds: string[] = [];
      for (let i = 1; i <= 7; i++) {
        const id = `alert-${i}`;
        alertIds.push(id);
        [entries] = recordAlert(entries, 'trip-1', id, { ...META, title: `Alert ${i}` });
      }
      // All 7 are active — simulating the full uncapped set
      const updated = autoResolve(entries, 'trip-1', new Set(alertIds));
      // NONE should be resolved
      for (const id of alertIds) {
        expect(getActiveOccurrence(updated, 'trip-1', id)).toBeDefined();
      }
      expect(getResolvedForTrip(updated, 'trip-1').length).toBe(0);
    });
  });

  describe('Notification dedup — per-occurrence, not per-logical-key (Issue 6)', () => {
    test('new occurrence is not notified by default', () => {
      const [entries] = recordAlert([], 'trip-1', 'conflict-1', META);
      expect(isOccurrenceNotified(entries, 'trip-1', 'conflict-1')).toBe(false);
    });

    test('markNotified flags the specific occurrence', () => {
      const [entries, occId] = recordAlert([], 'trip-1', 'conflict-1', META);
      const updated = markNotified(entries, occId);
      expect(isOccurrenceNotified(updated, 'trip-1', 'conflict-1')).toBe(true);
    });

    test('new occurrence after resolution can be notified again (Issue 6)', () => {
      // First occurrence → notified → resolved
      let [entries, firstOccId] = recordAlert([], 'trip-1', 'conflict-1', META);
      entries = markNotified(entries, firstOccId);
      entries = resolveAlert(entries, 'trip-1', 'conflict-1');

      // Same issue reappears → new occurrence → NOT notified
      let secondOccId: string;
      [entries, secondOccId] = recordAlert(entries, 'trip-1', 'conflict-1', META);
      expect(isOccurrenceNotified(entries, 'trip-1', 'conflict-1')).toBe(false);
      expect(secondOccId).not.toBe(firstOccId);

      // Can be notified for this new occurrence
      entries = markNotified(entries, secondOccId);
      expect(isOccurrenceNotified(entries, 'trip-1', 'conflict-1')).toBe(true);
    });
  });

  describe('Full lifecycle: new → seen → resolved → reoccurrence', () => {
    test('complete lifecycle with reoccurrence preserves history', () => {
      // Step 1: Alert appears → new
      let [entries, occ1] = recordAlert([], 'trip-1', 'conflict-1', META);
      expect(entries[0].status).toBe('new');

      // Step 2: User opens pulse panel → seen
      entries = markSeen(entries, 'trip-1', ['conflict-1']);
      expect(entries[0].status).toBe('seen');

      // Step 3: User dismisses → resolved
      entries = resolveAlert(entries, 'trip-1', 'conflict-1');
      expect(entries[0].status).toBe('resolved');
      expect(entries[0].resolvedAt).toBeDefined();

      // Step 4: Same issue reappears → new occurrence
      let occ2: string;
      [entries, occ2] = recordAlert(entries, 'trip-1', 'conflict-1', META);
      expect(entries.length).toBe(2);
      expect(entries[0].status).toBe('resolved'); // old preserved
      expect(entries[1].status).toBe('new'); // new occurrence
      expect(occ1).not.toBe(occ2);

      // Step 5: Both visible in history
      const resolved = getResolvedForTrip(entries, 'trip-1');
      expect(resolved.length).toBe(1);
      const active = getActiveOccurrence(entries, 'trip-1', 'conflict-1');
      expect(active?.status).toBe('new');
    });
  });

  describe('Trip isolation', () => {
    test('operations on trip A do not affect trip B', () => {
      let entries: PulseHistoryEntry[] = [];
      [entries] = recordAlert(entries, 'trip-A', 'conflict-1', META);
      [entries] = recordAlert(entries, 'trip-B', 'conflict-1', META);

      // Resolve only trip-A
      entries = resolveAlert(entries, 'trip-A', 'conflict-1');
      expect(getActiveOccurrence(entries, 'trip-A', 'conflict-1')).toBeUndefined();
      expect(getActiveOccurrence(entries, 'trip-B', 'conflict-1')?.status).toBe('new');
    });
  });

  describe('History cap', () => {
    test('entries are capped at 300', () => {
      let entries: PulseHistoryEntry[] = [];
      for (let i = 0; i < 310; i++) {
        [entries] = recordAlert(entries, 'trip-1', `alert-${i}`, META);
        // Resolve so the next one creates a new entry
        entries = resolveAlert(entries, 'trip-1', `alert-${i}`);
      }
      // Should have at most 300 entries (310 pairs but trimmed)
      expect(entries.length).toBeLessThanOrEqual(300);
    });
  });
});

// ============================================================
// Issue 8: Display cap does not cause false resolution
// ============================================================

describe('Issue 8: runTripPulse — uncapped vs capped', () => {
  test('default cap returns at most 5 alerts', () => {
    // Create a trip with many overlapping activities to trigger > 5 alerts
    const activities: Activity[] = [];
    for (let i = 0; i < 8; i++) {
      activities.push(makeActivity({
        id: `a${i}`,
        day: 1,
        time: '10:00',
        title: `Activity ${i}`,
        duration: 120,
      }));
    }
    const trip = makeTrip({ id: 't1', activities });
    const capped = runTripPulse(trip, BASE_PROFILE, []);
    expect(capped.length).toBeLessThanOrEqual(5);
  });

  test('Infinity cap returns ALL alerts', () => {
    const activities: Activity[] = [];
    for (let i = 0; i < 8; i++) {
      activities.push(makeActivity({
        id: `a${i}`,
        day: 1,
        time: '10:00',
        title: `Activity ${i}`,
        duration: 120,
      }));
    }
    const trip = makeTrip({ id: 't1', activities });
    const uncapped = runTripPulse(trip, BASE_PROFILE, [], Infinity);
    const capped = runTripPulse(trip, BASE_PROFILE, []);
    expect(uncapped.length).toBeGreaterThanOrEqual(capped.length);
  });

  test('6+ simultaneous issues: issue #6 not falsely resolved', () => {
    // Create enough issues to exceed top-5: 6 days with overlapping activities = 6 conflict alerts
    const activities: Activity[] = [];
    for (let day = 1; day <= 6; day++) {
      activities.push(makeActivity({ id: `a${day}a`, day, time: '10:00', title: `Act ${day}A`, duration: 180 }));
      activities.push(makeActivity({ id: `a${day}b`, day, time: '11:00', title: `Act ${day}B`, duration: 120 }));
    }
    const trip = makeTrip({ id: 't1', activities, startDate: '2026-09-01', endDate: '2026-09-06' });

    const uncapped = runTripPulse(trip, BASE_PROFILE, [], Infinity);
    const capped = runTripPulse(trip, BASE_PROFILE, []);

    // Uncapped should have more alerts than capped (which is limited to 5)
    expect(uncapped.length).toBeGreaterThan(capped.length);

    // All uncapped alerts are genuinely active
    const uncappedIds = new Set(uncapped.map((a) => a.id));

    // Simulate autoResolve with FULL set — nothing should be resolved
    let entries: PulseHistoryEntry[] = [];
    for (const alert of uncapped) {
      [entries] = recordAlert(entries, 'trip-1', alert.id, {
        title: alert.title,
        message: alert.message,
        alertType: alert.type,
        severity: alert.severity,
      });
    }
    const afterAutoResolve = autoResolve(entries, 'trip-1', uncappedIds);
    expect(getResolvedForTrip(afterAutoResolve, 'trip-1').length).toBe(0);

    // Now simulate resolving with CAPPED set — this would falsely resolve alerts beyond top 5
    const cappedIds = new Set(capped.map((a) => a.id));
    const badAutoResolve = autoResolve(entries, 'trip-1', cappedIds);
    const falselyResolved = getResolvedForTrip(badAutoResolve, 'trip-1');
    // This proves the bug: using capped set would falsely resolve alerts
    expect(falselyResolved.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Issue 9: Resolved history visible in UI
// ============================================================

describe('Issue 9: Resolved history persistence', () => {
  beforeEach(() => resetIdCounter());

  test('resolved entries for trip are retrievable after creation', () => {
    let entries: PulseHistoryEntry[] = [];
    [entries] = recordAlert(entries, 'trip-1', 'conflict-1', { ...META, title: 'Conflict A' });
    entries = resolveAlert(entries, 'trip-1', 'conflict-1');
    const resolved = getResolvedForTrip(entries, 'trip-1');
    expect(resolved.length).toBe(1);
    expect(resolved[0].title).toBe('Conflict A');
    expect(resolved[0].resolvedAt).toBeDefined();
  });

  test('multiple occurrences of same issue show in history', () => {
    let entries: PulseHistoryEntry[] = [];
    // First occurrence → resolve
    [entries] = recordAlert(entries, 'trip-1', 'conflict-1', { ...META, title: 'Occurrence 1' });
    entries = resolveAlert(entries, 'trip-1', 'conflict-1');
    // Second occurrence → resolve
    [entries] = recordAlert(entries, 'trip-1', 'conflict-1', { ...META, title: 'Occurrence 2' });
    entries = resolveAlert(entries, 'trip-1', 'conflict-1');

    const resolved = getResolvedForTrip(entries, 'trip-1');
    expect(resolved.length).toBe(2);
  });

  test('only entries for current trip are returned', () => {
    let entries: PulseHistoryEntry[] = [];
    [entries] = recordAlert(entries, 'trip-A', 'conflict-1', META);
    entries = resolveAlert(entries, 'trip-A', 'conflict-1');
    [entries] = recordAlert(entries, 'trip-B', 'conflict-1', META);
    entries = resolveAlert(entries, 'trip-B', 'conflict-1');

    expect(getResolvedForTrip(entries, 'trip-A').length).toBe(1);
    expect(getResolvedForTrip(entries, 'trip-B').length).toBe(1);
    expect(getResolvedForTrip(entries, 'trip-C').length).toBe(0);
  });
});
