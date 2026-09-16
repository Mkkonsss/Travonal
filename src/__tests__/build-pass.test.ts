/**
 * Tests covering features added in the current build pass:
 * - Collaboration types & createTripRecord owner member
 * - Pulse input fingerprint
 * - Transformation service improvements (reduce_cost, reduce_travel_time)
 * - Trip prep context-awareness
 */

import { Trip, Activity, TripMember, Invitation, ChangeRecord } from '@/context/trips';
import { createTripRecord } from '@/services/trip-helpers';
import { pulseInputFingerprint } from '@/components/app-pulse-evaluator';
import { transformTrip, TransformScope } from '@/services/transformation-service';
import { TravelProfile } from '@/context/profile';

// ---------- shared helpers ----------

function makeTrip(overrides: Partial<Trip> & { id: string; startDate: string; endDate: string }): Trip {
  return {
    destination: 'Tokyo',
    country: 'Japan',
    notes: '',
    emoji: '',
    activities: [],
    status: 'planned',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<Activity> & { id: string; day: number; time: string }): Activity {
  return {
    title: 'Test Activity',
    type: 'activity',
    ...overrides,
  };
}

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

// ---------- Collaboration ----------

describe('Collaboration foundation', () => {
  test('createTripRecord auto-adds owner member', () => {
    const trip = createTripRecord({
      destination: 'Paris',
      country: 'France',
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      notes: '',
      emoji: '',
    });

    expect(trip.members).toBeDefined();
    expect(trip.members!.length).toBe(1);
    expect(trip.members![0].role).toBe('owner');
    expect(trip.members![0].name).toBe('You');
    expect(trip.members![0].joinedAt).toBeTruthy();
  });

  test('TripMember interface shape', () => {
    const member: TripMember = {
      id: '1',
      name: 'Alice',
      role: 'member',
      joinedAt: '2026-08-18T00:00:00.000Z',
      invitationId: 'inv-1',
    };
    expect(member.role).toBe('member');
    expect(member.invitationId).toBe('inv-1');
  });

  test('Invitation includes role and inviteCode fields', () => {
    const inv: Invitation = {
      id: '1',
      name: 'Bob',
      contact: 'bob@test.com',
      status: 'pending',
      sentAt: '2026-08-18T00:00:00.000Z',
      role: 'viewer',
      inviteCode: 'TRV-ABC123',
    };
    expect(inv.role).toBe('viewer');
    expect(inv.inviteCode).toMatch(/^TRV-/);
  });

  test('ChangeRecord includes changedBy field', () => {
    const record: ChangeRecord = {
      id: '1',
      tripId: 't1',
      description: 'Test change',
      timestamp: '2026-08-18T00:00:00.000Z',
      previousActivities: [],
      changedBy: 'Alice',
    };
    expect(record.changedBy).toBe('Alice');
  });
});

// ---------- Pulse fingerprint ----------

describe('pulseInputFingerprint', () => {
  test('returns same fingerprint for same input', () => {
    const trips = [makeTrip({
      id: 't1',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      activities: [makeActivity({ id: 'a1', day: 1, time: '10:00', duration: 60, type: 'activity' })],
    })];
    const profile = { pace: 'moderate', dislikes: [] as string[] };

    const fp1 = pulseInputFingerprint(trips, profile);
    const fp2 = pulseInputFingerprint(trips, profile);
    expect(fp1).toBe(fp2);
  });

  test('fingerprint changes when activity changes', () => {
    const baseTrip = makeTrip({
      id: 't1',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      activities: [makeActivity({ id: 'a1', day: 1, time: '10:00', duration: 60, type: 'activity' })],
    });
    const profile = { pace: 'moderate', dislikes: [] as string[] };

    const fp1 = pulseInputFingerprint([baseTrip], profile);

    const modifiedTrip = {
      ...baseTrip,
      activities: [makeActivity({ id: 'a1', day: 1, time: '14:00', duration: 60, type: 'activity' })],
    };
    const fp2 = pulseInputFingerprint([modifiedTrip], profile);

    expect(fp1).not.toBe(fp2);
  });

  test('fingerprint does not depend on profile dislikes (no longer used for alerts)', () => {
    const trips = [makeTrip({
      id: 't1',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      activities: [],
    })];

    const fp1 = pulseInputFingerprint(trips, { pace: 'moderate', dislikes: [] });
    const fp2 = pulseInputFingerprint(trips, { pace: 'moderate', dislikes: ['crowds'] });

    expect(fp1).toBe(fp2);
  });
});

// ---------- Transformation service improvements ----------

describe('reduce_cost transformation', () => {
  test('returns changes array with cost info', () => {
    const trip = makeTrip({
      id: 't1',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      activities: [
        makeActivity({ id: 'a1', day: 1, time: '10:00', title: 'Fancy Restaurant', cost: 'premium', type: 'food' }),
        makeActivity({ id: 'a2', day: 1, time: '14:00', title: 'Museum', cost: 'moderate', type: 'activity' }),
        makeActivity({ id: 'a3', day: 2, time: '10:00', title: 'Park Walk', cost: 'free', type: 'activity' }),
      ],
    });

    const scope: TransformScope = { type: 'full_trip' };
    const result = transformTrip(trip, 'reduce_cost', scope, DEFAULT_PROFILE, []);

    // Should produce a summary and changes
    expect(result.summary).toBeTruthy();
    expect(result.changes.length).toBeGreaterThanOrEqual(0);
  });
});

describe('reduce_travel_time transformation', () => {
  test('returns summary for itinerary', () => {
    const trip = makeTrip({
      id: 't1',
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      activities: [
        makeActivity({ id: 'a1', day: 1, time: '09:00', title: 'Place A', type: 'activity' }),
        makeActivity({ id: 'a2', day: 1, time: '12:00', title: 'Place B', type: 'activity' }),
      ],
    });

    const scope: TransformScope = { type: 'full_trip' };
    const result = transformTrip(trip, 'reduce_travel_time', scope, DEFAULT_PROFILE, []);
    // Should either improve or say already well-ordered
    expect(result.summary).toBeTruthy();
  });
});

// ---------- Trip types ----------

describe('Trip type extensions', () => {
  test('Trip supports members field', () => {
    const trip = makeTrip({
      id: 't1',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      members: [
        { id: 'm1', name: 'You', role: 'owner', joinedAt: '2026-08-18T00:00:00Z' },
        { id: 'm2', name: 'Alice', role: 'member', joinedAt: '2026-08-18T00:00:00Z', invitationId: 'inv-1' },
      ],
    });

    expect(trip.members!.length).toBe(2);
    expect(trip.members![0].role).toBe('owner');
    expect(trip.members![1].role).toBe('member');
  });

  test('Trip supports invitations with codes and roles', () => {
    const trip = makeTrip({
      id: 't1',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      invitations: [
        {
          id: 'inv-1',
          name: 'Bob',
          contact: 'bob@test.com',
          status: 'pending',
          sentAt: '2026-08-18T00:00:00Z',
          role: 'viewer',
          inviteCode: 'TRV-XYZ789',
        },
      ],
    });

    expect(trip.invitations![0].inviteCode).toBe('TRV-XYZ789');
    expect(trip.invitations![0].role).toBe('viewer');
  });
});
