import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  loadTripsSafe,
  saveTrips,
  loadChangeHistorySafe,
  saveChangeHistory,
} from '@/services/storage';
import { createTripRecord, findUndoableChange } from '@/services/trip-helpers';
import { generateId } from '@/services/itinerary-engine';

export type ReservationType = 'restaurant' | 'hotel' | 'flight' | 'train' | 'activity' | 'other';

export interface Reservation {
  id: string;
  tripId: string;
  type: ReservationType;
  title: string;
  day?: number;
  date?: string;
  time?: string;
  confirmationNumber?: string;
  address?: string;
  bookingUrl?: string;
  price?: number;
  currency?: string;
  notes?: string;
  fixed?: boolean;
  cancelled?: boolean;
}

export interface Activity {
  id: string;
  title: string;
  day: number;
  time: string;
  type: 'flight' | 'hotel' | 'activity' | 'food';
  locked?: boolean;
  fixed?: boolean; // fixed reservation / commitment — always treated as locked
  category?: string;
  description?: string;
  duration?: number; // minutes
  cost?: 'free' | 'budget' | 'moderate' | 'premium';
}

export interface ChangeRecord {
  id: string;
  tripId: string;
  description: string;
  timestamp: string;
  previousActivities: Activity[];
  appliedActivities?: Activity[]; // deep copy of state AFTER; undefined = legacy (non-undoable)
  previousReservations?: Reservation[];
  appliedReservations?: Reservation[];
  undone?: boolean;
  /** Name of the member who made this change (local attribution) */
  changedBy?: string;
}

export interface Trip {
  id: string;
  title?: string;
  destination: string;
  country: string;
  startDate: string;
  endDate: string;
  notes: string;
  emoji: string;
  activities: Activity[];
  budget?: 'budget' | 'moderate' | 'premium';
  pace?: 'relaxed' | 'moderate' | 'active';
  interests?: string[];
  travelWith?: 'solo' | 'partner' | 'family' | 'friends' | 'group';
  departurePoint?: string;
  tripPurpose?: string;
  restrictions?: string;
  travelers?: number;
  tripInstructions?: string; // per-trip overrides e.g. "okay with early mornings on this trip"
  status?: 'draft' | 'planned' | 'active' | 'completed';
  generatedAt?: string;
  /** Monotonic counter incremented on every activity mutation. Used to scope pulse dismissals. */
  itineraryRevision?: number;
  prepItems?: PrepItem[];
  budgetTotal?: number;
  budgetCurrency?: string;
  expenses?: BudgetItem[];
  reservations?: Reservation[];
  invitations?: Invitation[];
  members?: TripMember[];
}

export interface PrepItem {
  id: string;
  text: string;
  done: boolean;
  custom: boolean;
  category?: 'documents' | 'transport' | 'accommodation' | 'packing' | 'health' | 'other';
}

export interface BudgetItem {
  id: string;
  label: string;
  amount: number;
  category: string;
  day?: number;
}

export interface Invitation {
  id: string;
  name: string;
  contact: string; // email or phone
  status: 'pending' | 'accepted' | 'declined';
  sentAt: string;
  role?: 'member' | 'viewer'; // role granted on acceptance
  inviteCode?: string; // shareable code for accepting
}

export interface TripMember {
  id: string;
  name: string;
  role: 'owner' | 'member' | 'viewer';
  joinedAt: string;
  /** Links back to the invitation that created this member, if any */
  invitationId?: string;
}

export type TripState = 'draft' | 'upcoming' | 'active' | 'past';

const EMPTY_TRIPS: Trip[] = [];

function isLocked(activity: Activity): boolean {
  return !!(activity.locked || activity.fixed);
}

/** Generate a short, human-friendly invite code (e.g. "TRV-A3X7K2") */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `TRV-${code}`;
}

interface TripsContextType {
  trips: Trip[];
  loaded: boolean;
  changeHistory: ChangeRecord[];
  /** True only when the trip data itself failed to load. Saving is disabled. */
  tripsLoadError: boolean;
  /** True only when change-history failed to load. Does NOT block trip saving. */
  historyLoadError: boolean;
  /** Re-attempt loading trip data after a previous failure. */
  retryTripsLoad: () => void;
  addTrip: (trip: Omit<Trip, 'id' | 'activities'>) => string;
  getTrip: (id: string) => Trip | undefined;
  getTripState: (trip: Trip) => TripState;
  updateTrip: (id: string, updates: Partial<Omit<Trip, 'id'>>) => void;
  deleteTrip: (id: string) => void;
  addActivity: (tripId: string, activity: Omit<Activity, 'id'>) => void;
  updateActivity: (tripId: string, activityId: string, updates: Partial<Omit<Activity, 'id'>>) => void;
  removeActivity: (tripId: string, activityId: string) => void;
  moveActivity: (tripId: string, activityId: string, newDay: number, newTime: string) => void;
  toggleLock: (tripId: string, activityId: string) => void;
  reorderActivities: (tripId: string, day: number, orderedIds: string[]) => void;
  replaceActivity: (tripId: string, oldActivityId: string, newActivity: Omit<Activity, 'id'>) => void;
  setTripActivities: (tripId: string, activities: Activity[], changeDescription?: string, bypassLockProtection?: boolean) => void;
  undoChange: (tripId: string) => void;
  getUndoableChange: (tripId: string) => ChangeRecord | undefined;
  getTripChanges: (tripId: string) => ChangeRecord[];
  updateTripPrepItems: (tripId: string, items: PrepItem[]) => void;
  updateTripBudget: (tripId: string, budgetTotal: number) => void;
  updateTripExpenses: (tripId: string, expenses: BudgetItem[]) => void;
  addReservation: (tripId: string, res: Omit<Reservation, 'id' | 'tripId'>) => void;
  updateReservation: (tripId: string, res: Reservation) => void;
  removeReservation: (tripId: string, resId: string) => void;
  addInvitation: (tripId: string, inv: Omit<Invitation, 'id' | 'sentAt' | 'inviteCode'>) => void;
  removeInvitation: (tripId: string, invId: string) => void;
  updateInvitationStatus: (tripId: string, invId: string, status: Invitation['status']) => void;
  acceptInvitation: (tripId: string, invId: string) => void;
  declineInvitation: (tripId: string, invId: string) => void;
  addMember: (tripId: string, member: Omit<TripMember, 'id' | 'joinedAt'>) => void;
  removeMember: (tripId: string, memberId: string) => void;
  updateMemberRole: (tripId: string, memberId: string, role: TripMember['role']) => void;
  resetAll: () => void;
}

const TripsContext = createContext<TripsContextType | null>(null);

export function TripsProvider({ children }: { children: ReactNode }) {
  const [trips, setTrips] = useState<Trip[]>(EMPTY_TRIPS);
  const [changeHistory, setChangeHistory] = useState<ChangeRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Separate failure flags: history failure must NOT block trip saves.
  const [tripsLoadError, setTripsLoadError] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState(false);

  useEffect(() => {
    Promise.all([
      loadTripsSafe<Trip[]>(EMPTY_TRIPS),
      loadChangeHistorySafe<ChangeRecord[]>([]),
    ]).then(([tripsResult, historyResult]) => {
      if (!tripsResult.ok) setTripsLoadError(true);
      if (!historyResult.ok) setHistoryLoadError(true);
      setTrips(tripsResult.data);
      setChangeHistory(historyResult.data);
      setLoaded(true);
    });
  }, []);

  // Trip save is gated only on its OWN load result, not on history.
  useEffect(() => {
    if (loaded && !tripsLoadError) {
      saveTrips(trips);
    }
  }, [trips, loaded, tripsLoadError]);

  // History save is gated only on its OWN load result.
  useEffect(() => {
    if (loaded && !historyLoadError) {
      saveChangeHistory(changeHistory);
    }
  }, [changeHistory, loaded, historyLoadError]);

  function retryTripsLoad() {
    loadTripsSafe<Trip[]>(EMPTY_TRIPS).then((result) => {
      if (result.ok) {
        setTrips(result.data);
        setTripsLoadError(false);
      }
      // If still failing, keep tripsLoadError=true; don't touch saved state.
    });
  }

  function recordChange(
    tripId: string,
    description: string,
    previousActivities: Activity[],
    appliedActivities: Activity[],
    previousReservations?: Reservation[],
    appliedReservations?: Reservation[],
  ) {
    // Attribution: find the owner's name from the trip's member list
    const trip = trips.find((t) => t.id === tripId);
    const owner = (trip?.members ?? []).find((m) => m.role === 'owner');
    const record: ChangeRecord = {
      id: String(Date.now()) + String(Math.floor(Math.random() * 1000)),
      tripId,
      description,
      timestamp: new Date().toISOString(),
      previousActivities: JSON.parse(JSON.stringify(previousActivities)),
      appliedActivities: JSON.parse(JSON.stringify(appliedActivities)),
      previousReservations: previousReservations ? JSON.parse(JSON.stringify(previousReservations)) : undefined,
      appliedReservations: appliedReservations ? JSON.parse(JSON.stringify(appliedReservations)) : undefined,
      changedBy: owner?.name ?? 'You',
    };
    setChangeHistory((prev) => [record, ...prev].slice(0, 50)); // keep last 50
  }

  function addTrip(trip: Omit<Trip, 'id' | 'activities'>): string {
    const newTrip = createTripRecord(trip);
    setTrips((prev) => [...prev, newTrip]);
    return newTrip.id;
  }

  function getTrip(id: string) {
    return trips.find((t) => t.id === id);
  }

  function getTripState(trip: Trip): TripState {
    if (trip.status === 'draft' || trip.activities.length === 0) return 'draft';
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const start = new Date(trip.startDate + 'T00:00:00');
    const end = new Date(trip.endDate + 'T00:00:00');
    if (now > end) return 'past';
    if (now >= start && now <= end) return 'active';
    return 'upcoming';
  }

  function updateTrip(id: string, updates: Partial<Omit<Trip, 'id'>>) {
    setTrips((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }

  function deleteTrip(id: string) {
    setTrips((prev) => prev.filter((t) => t.id !== id));
    setChangeHistory((prev) => prev.filter((c) => c.tripId !== id));
  }

  function addActivity(tripId: string, activity: Omit<Activity, 'id'>) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const newAct = { ...activity, id: String(Date.now()) + String(Math.floor(Math.random() * 100)) };
    const newActivities = [...trip.activities, newAct];
    recordChange(tripId, `Added "${activity.title}"`, trip.activities, newActivities);
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const updated: Trip = {
          ...t,
          activities: newActivities,
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
        if (updated.status === 'draft' && updated.activities.length > 0) {
          updated.status = 'planned';
        }
        return updated;
      })
    );
  }

  function updateActivity(tripId: string, activityId: string, updates: Partial<Omit<Activity, 'id'>>) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const target = trip.activities.find((a) => a.id === activityId);
    if (target && isLocked(target) && !('locked' in updates)) return;
    const newActivities = trip.activities.map((a) =>
      a.id === activityId ? { ...a, ...updates } : a
    );
    if (target) {
      recordChange(tripId, `Updated "${target.title}"`, trip.activities, newActivities);
    }
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        return {
          ...t,
          activities: newActivities,
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
      })
    );
  }

  function removeActivity(tripId: string, activityId: string) {
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const target = t.activities.find((a) => a.id === activityId);
        // Lock protection: cannot remove locked/fixed activity
        if (target && isLocked(target)) return t;
        return { ...t, activities: t.activities.filter((a) => a.id !== activityId), itineraryRevision: (t.itineraryRevision ?? 0) + 1 };
      })
    );
  }

  function moveActivity(tripId: string, activityId: string, newDay: number, newTime: string) {
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const target = t.activities.find((a) => a.id === activityId);
        // Lock protection: cannot move locked/fixed activity
        if (target && isLocked(target)) return t;
        return {
          ...t,
          activities: t.activities.map((a) =>
            a.id === activityId ? { ...a, day: newDay, time: newTime } : a
          ),
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
      })
    );
  }

  function toggleLock(tripId: string, activityId: string) {
    setTrips((prev) =>
      prev.map((t) =>
        t.id === tripId
          ? {
              ...t,
              activities: t.activities.map((a) =>
                a.id === activityId ? { ...a, locked: !a.locked } : a
              ),
              itineraryRevision: (t.itineraryRevision ?? 0) + 1,
            }
          : t
      )
    );
  }

  function reorderActivities(tripId: string, day: number, orderedIds: string[]) {
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const dayActivities = t.activities.filter((a) => a.day === day);
        const otherActivities = t.activities.filter((a) => a.day !== day);
        // Lock protection: locked items stay in original position
        const lockedPositions = new Map<number, Activity>();
        dayActivities.forEach((a, i) => {
          if (isLocked(a)) lockedPositions.set(i, a);
        });
        const unlocked = orderedIds
          .map((id) => dayActivities.find((a) => a.id === id && !isLocked(a)))
          .filter(Boolean) as Activity[];
        const reordered: Activity[] = [];
        let ui = 0;
        for (let i = 0; i < dayActivities.length; i++) {
          if (lockedPositions.has(i)) {
            reordered.push(lockedPositions.get(i)!);
          } else if (ui < unlocked.length) {
            reordered.push(unlocked[ui++]);
          }
        }
        return { ...t, activities: [...otherActivities, ...reordered], itineraryRevision: (t.itineraryRevision ?? 0) + 1 };
      })
    );
  }

  function replaceActivity(tripId: string, oldActivityId: string, newActivity: Omit<Activity, 'id'>) {
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const target = t.activities.find((a) => a.id === oldActivityId);
        // Lock protection: cannot replace locked/fixed activity
        if (target && isLocked(target)) return t;
        return {
          ...t,
          activities: t.activities.map((a) =>
            a.id === oldActivityId ? { ...newActivity, id: String(Date.now()) } : a
          ),
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
      })
    );
  }

  function setTripActivities(tripId: string, activities: Activity[], changeDescription?: string, bypassLockProtection?: boolean) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    let merged: Activity[];
    if (bypassLockProtection) {
      merged = activities;
    } else {
      // Lock protection: preserve all locked/fixed activities from original
      const lockedOriginals = trip.activities.filter(isLocked);
      const lockedIds = new Set(lockedOriginals.map((a) => a.id));
      merged = activities.map((a) => {
        if (lockedIds.has(a.id)) {
          return lockedOriginals.find((o) => o.id === a.id)!;
        }
        return a;
      });
      for (const locked of lockedOriginals) {
        if (!merged.find((a) => a.id === locked.id)) {
          merged.push(locked);
        }
      }
    }
    if (changeDescription) {
      recordChange(tripId, changeDescription, trip.activities, merged);
    }
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const updated = { ...t, activities: merged, itineraryRevision: (t.itineraryRevision ?? 0) + 1 };
        if (updated.status === 'draft' && updated.activities.length > 0) {
          updated.status = 'planned';
        }
        return updated;
      })
    );
  }

  function undoChange(tripId: string) {
    const lastChange = findUndoableChange(changeHistory, tripId);
    if (!lastChange || !lastChange.appliedActivities) return;
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    // Only undo if current state still matches the applied snapshot
    const normalize = (acts: Activity[]) =>
      JSON.stringify([...acts].sort((a, b) => a.id.localeCompare(b.id)));
    if (normalize(trip.activities) !== normalize(lastChange.appliedActivities)) return;
    // If this change also snapshotted reservations, verify those match too
    if (lastChange.appliedReservations) {
      const normalizeRes = (res: Reservation[]) =>
        JSON.stringify([...res].sort((a, b) => a.id.localeCompare(b.id)));
      if (normalizeRes(trip.reservations ?? []) !== normalizeRes(lastChange.appliedReservations)) return;
    }
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const restored: Partial<Trip> = {
          activities: JSON.parse(JSON.stringify(lastChange.previousActivities)),
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
        if (lastChange.previousReservations) {
          restored.reservations = JSON.parse(JSON.stringify(lastChange.previousReservations));
        }
        return { ...t, ...restored };
      })
    );
    setChangeHistory((prev) =>
      prev.map((c) => (c.id === lastChange.id ? { ...c, undone: true } : c))
    );
  }

  function getUndoableChange(tripId: string) {
    const record = findUndoableChange(changeHistory, tripId);
    if (!record || !record.appliedActivities) return undefined; // legacy = non-undoable
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return undefined;
    const normalize = (acts: Activity[]) =>
      JSON.stringify([...acts].sort((a, b) => a.id.localeCompare(b.id)));
    if (normalize(trip.activities) !== normalize(record.appliedActivities)) return undefined;
    return record;
  }

  function getTripChanges(tripId: string) {
    return changeHistory.filter((c) => c.tripId === tripId);
  }

  function updateTripPrepItems(tripId: string, items: PrepItem[]) {
    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, prepItems: items } : t))
    );
  }

  function updateTripBudget(tripId: string, budgetTotal: number) {
    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, budgetTotal } : t))
    );
  }

  function updateTripExpenses(tripId: string, expenses: BudgetItem[]) {
    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, expenses } : t))
    );
  }

  function addReservation(tripId: string, res: Omit<Reservation, 'id' | 'tripId'>) {
    const newRes: Reservation = { ...res, id: generateId(), tripId };
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const prevRes = trip.reservations ?? [];
    const newResArr = [...prevRes, newRes];
    recordChange(tripId, `Added reservation "${res.title}"`, trip.activities, trip.activities, prevRes, newResArr);
    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, reservations: newResArr } : t))
    );
  }

  function updateReservation(tripId: string, res: Reservation) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const prevRes = trip.reservations ?? [];
    const newResArr = prevRes.map((r) => (r.id === res.id ? res : r));
    recordChange(tripId, `Updated reservation "${res.title}"`, trip.activities, trip.activities, prevRes, newResArr);
    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, reservations: newResArr } : t))
    );
  }

  function removeReservation(tripId: string, resId: string) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const prevRes = trip.reservations ?? [];
    const removed = prevRes.find((r) => r.id === resId);
    const newResArr = prevRes.filter((r) => r.id !== resId);
    recordChange(tripId, `Removed reservation "${removed?.title ?? resId}"`, trip.activities, trip.activities, prevRes, newResArr);
    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, reservations: newResArr } : t))
    );
  }

  function addInvitation(tripId: string, inv: Omit<Invitation, 'id' | 'sentAt' | 'inviteCode'>) {
    const newInv: Invitation = {
      ...inv,
      id: generateId(),
      sentAt: new Date().toISOString(),
      inviteCode: generateInviteCode(),
      role: inv.role ?? 'member',
    };
    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, invitations: [...(t.invitations ?? []), newInv] } : t))
    );
  }

  function removeInvitation(tripId: string, invId: string) {
    setTrips((prev) =>
      prev.map((t) =>
        t.id === tripId
          ? { ...t, invitations: (t.invitations ?? []).filter((i) => i.id !== invId) }
          : t
      )
    );
  }

  function updateInvitationStatus(tripId: string, invId: string, status: Invitation['status']) {
    setTrips((prev) =>
      prev.map((t) =>
        t.id === tripId
          ? { ...t, invitations: (t.invitations ?? []).map((i) => (i.id === invId ? { ...i, status } : i)) }
          : t
      )
    );
  }

  function acceptInvitation(tripId: string, invId: string) {
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const inv = (t.invitations ?? []).find((i) => i.id === invId);
        if (!inv || inv.status !== 'pending') return t;
        const updatedInvitations = (t.invitations ?? []).map((i) =>
          i.id === invId ? { ...i, status: 'accepted' as const } : i
        );
        const newMember: TripMember = {
          id: generateId(),
          name: inv.name,
          role: inv.role ?? 'member',
          joinedAt: new Date().toISOString(),
          invitationId: inv.id,
        };
        return {
          ...t,
          invitations: updatedInvitations,
          members: [...(t.members ?? []), newMember],
          travelers: (t.travelers ?? 1) + 1,
        };
      })
    );
  }

  function declineInvitation(tripId: string, invId: string) {
    updateInvitationStatus(tripId, invId, 'declined');
  }

  function addMember(tripId: string, member: Omit<TripMember, 'id' | 'joinedAt'>) {
    const newMember: TripMember = { ...member, id: generateId(), joinedAt: new Date().toISOString() };
    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, members: [...(t.members ?? []), newMember] } : t))
    );
  }

  function removeMember(tripId: string, memberId: string) {
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const member = (t.members ?? []).find((m) => m.id === memberId);
        if (!member || member.role === 'owner') return t; // can't remove owner
        const updatedMembers = (t.members ?? []).filter((m) => m.id !== memberId);
        // Also mark linked invitation as declined if present
        const updatedInvitations = member.invitationId
          ? (t.invitations ?? []).map((i) => (i.id === member.invitationId ? { ...i, status: 'declined' as const } : i))
          : t.invitations;
        return {
          ...t,
          members: updatedMembers,
          invitations: updatedInvitations,
          travelers: Math.max(1, (t.travelers ?? 1) - 1),
        };
      })
    );
  }

  function updateMemberRole(tripId: string, memberId: string, role: TripMember['role']) {
    setTrips((prev) =>
      prev.map((t) =>
        t.id === tripId
          ? { ...t, members: (t.members ?? []).map((m) => (m.id === memberId ? { ...m, role } : m)) }
          : t
      )
    );
  }

  function resetAll() {
    setTrips(EMPTY_TRIPS);
    setChangeHistory([]);
    setTripsLoadError(false);
    setHistoryLoadError(false);
  }

  return (
    <TripsContext.Provider
      value={{
        trips,
        loaded,
        changeHistory,
        tripsLoadError,
        historyLoadError,
        retryTripsLoad,
        addTrip,
        getTrip,
        getTripState,
        updateTrip,
        deleteTrip,
        addActivity,
        updateActivity,
        removeActivity,
        moveActivity,
        toggleLock,
        reorderActivities,
        replaceActivity,
        setTripActivities,
        undoChange,
        getUndoableChange,
        getTripChanges,
        updateTripPrepItems,
        updateTripBudget,
        updateTripExpenses,
        addReservation,
        updateReservation,
        removeReservation,
        addInvitation,
        removeInvitation,
        updateInvitationStatus,
        acceptInvitation,
        declineInvitation,
        addMember,
        removeMember,
        updateMemberRole,
        resetAll,
      }}>
      {children}
    </TripsContext.Provider>
  );
}

export function useTrips() {
  const ctx = useContext(TripsContext);
  if (!ctx) throw new Error('useTrips must be used within TripsProvider');
  return ctx;
}
