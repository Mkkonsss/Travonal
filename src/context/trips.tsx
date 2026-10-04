import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import {
  loadTripsSafe,
  saveTrips,
} from '@/services/storage';
import { createTripRecord } from '@/services/trip-helpers';
import { generateId } from '@/services/itinerary-engine';
import { generateActivityId, normalizeTimeTo24 } from '@/services/ai-utils';
import { useAuth } from '@/context/auth';
import { pushTrips, pullTrips, deleteRemoteTrip } from '@/services/sync';

export type ReservationType = 'restaurant' | 'hotel' | 'flight' | 'train' | 'activity' | 'other';

export interface Reservation {
  id: string;
  tripId?: string;
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
  checkOutDate?: string;
  checkInTime?: string;
  checkOutTime?: string;
  roomType?: string;
  amenities?: string[];
  // Flight / train
  flightNumber?: string;
  origin?: string;       // "YYZ - Toronto"
  destination?: string;  // "FLL - Fort Lauderdale"
  seat?: string;
  boardingTime?: string; // HH:MM
  passengerName?: string;
  baggage?: string;
  arrivalTime?: string;  // HH:MM
  // Shared
  guestCount?: number;
  cancellationPolicy?: string;
  duration?: string;
}

export interface Activity {
  id: string;
  title: string;
  day: number;
  time: string;
  type: 'flight' | 'hotel' | 'activity' | 'food';
  locked?: boolean;
  fixed?: boolean; // fixed reservation / commitment — always treated as locked
  requested?: boolean; // from board/inbox — AI must include, can freely place
  category?: string;
  description?: string;
  cost?: 'free' | 'budget' | 'moderate' | 'premium';
  placeId?: string;       // Google Place ID
  address?: string;       // formattedAddress from Google Places
  lat?: number;           // location.latitude
  lng?: number;           // location.longitude
  openingHours?: string[];  // from Google Places
  rating?: number;          // Google rating (1-5)
  reviewCount?: number;     // Google review count
  notes?: string;           // user's personal notes from board
  reservationId?: string; // linked reservation ID
  bookingStatus?: 'booked' | 'pending'; // booking state — undefined = not yet booked
}

/** @deprecated ChangeRecord functionality has been removed. Kept as a stub for downstream imports. */
export interface ChangeRecord {
  id: string;
  tripId: string;
  description: string;
  timestamp: string;
  previousActivities: Activity[];
  appliedActivities?: Activity[];
  previousReservations?: Reservation[];
  appliedReservations?: Reservation[];
  undone?: boolean;
  changedBy?: string;
}

export interface Trip {
  id: string;
  title?: string;
  destination: string;
  country: string;
  startDate: string;
  endDate: string;
  /** When false, startDate/endDate are placeholders and should not be shown as real calendar dates. */
  datesKnown?: boolean;
  notes: string;
  emoji: string;
  activities: Activity[];
  budget?: '$' | '$$' | '$$$' | '$$$$';
  pace?: 'relaxed' | 'moderate' | 'active';
  interests?: string[];
  travelWith?: 'solo' | 'partner' | 'family' | 'friends' | 'group';
  departurePoint?: string;
  tripPurpose?: string;
  restrictions?: string;
  travelers?: number;
  tripInstructions?: string; // per-trip overrides e.g. "okay with early mornings on this trip"
  geoContext?: string;       // pre-computed geographic cluster summary for AI prompt
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
  name?: string;
  contact?: string; // email or phone
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

export type TripState = 'draft' | 'upcoming' | 'active' | 'past' | 'planned';

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

// Module-level store for last-viewed trip — read by chat tab without needing re-renders
let _lastViewedTripId: string | undefined;
export function setLastViewedTripId(id: string) { _lastViewedTripId = id; }
export function getLastViewedTripId() { return _lastViewedTripId; }

interface TripsContextType {
  trips: Trip[];
  loaded: boolean;
  /** True only when the trip data itself failed to load. Saving is disabled. */
  tripsLoadError: boolean;
  /** Re-attempt loading trip data after a previous failure. */
  retryTripsLoad: () => void;
  addTrip: (trip: Omit<Trip, 'id' | 'activities'>) => string;
  addTripWithActivities: (trip: Omit<Trip, 'id' | 'activities'>, initialActivities: Omit<Activity, 'id'>[], reservations?: Omit<Reservation, 'id' | 'tripId'>[]) => string;
  getTrip: (id: string) => Trip | undefined;
  getTripState: (trip: Trip) => TripState;
  updateTrip: (id: string, updates: Partial<Omit<Trip, 'id'>>) => void;
  deleteTrip: (id: string) => void;
  addActivity: (tripId: string, activity: Omit<Activity, 'id'>) => boolean;
  updateActivity: (tripId: string, activityId: string, updates: Partial<Omit<Activity, 'id'>>, skipLockCheck?: boolean) => boolean;
  removeActivity: (tripId: string, activityId: string, skipLockCheck?: boolean) => boolean;
  moveActivity: (tripId: string, activityId: string, newDay: number, newTime: string, skipLockCheck?: boolean) => boolean;
  toggleLock: (tripId: string, activityId: string) => void;
  reorderActivities: (tripId: string, day: number, orderedIds: string[]) => void;
  replaceActivity: (tripId: string, oldActivityId: string, newActivity: Omit<Activity, 'id'>, skipLockCheck?: boolean) => boolean;
  setTripActivities: (tripId: string, activities: Activity[], changeDescription?: string, bypassLockProtection?: boolean) => void;
  updateTripPrepItems: (tripId: string, items: PrepItem[]) => void;
  updateTripBudget: (tripId: string, budgetTotal: number) => void;
  updateTripExpenses: (tripId: string, expenses: BudgetItem[]) => void;
  addReservation: (tripId: string, res: Omit<Reservation, 'id' | 'tripId'>) => void;
  attachReservation: (tripId: string, activityId: string, res: Omit<Reservation, 'id' | 'tripId'>) => void;
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
  const [loaded, setLoaded] = useState(false);
  const [tripsLoadError, setTripsLoadError] = useState(false);
  const { user } = useAuth();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tripsRef = useRef<Trip[]>(EMPTY_TRIPS);
  useEffect(() => { tripsRef.current = trips; }, [trips]);

  useEffect(() => {
    loadTripsSafe<Trip[]>(EMPTY_TRIPS).then((tripsResult) => {
      if (!tripsResult.ok) setTripsLoadError(true);
      setTrips(tripsResult.data);
      setLoaded(true);
    });
  }, []);

  // After local data is ready and user is signed in, pull any remote-only trips
  useEffect(() => {
    if (!loaded || !user?.id) return;
    pullTrips(user.id).then((remoteTrips) => {
      if (remoteTrips.length === 0) return;
      setTrips((local) => {
        const localIds = new Set(local.map((t) => t.id));
        const newFromRemote = remoteTrips.filter((t) => !localIds.has(t.id));
        return newFromRemote.length > 0 ? [...local, ...newFromRemote] : local;
      });
    });
   
  }, [loaded, user?.id]);

  // Trip save is gated only on its OWN load result, not on history.
  useEffect(() => {
    if (loaded && !tripsLoadError) {
      saveTrips(trips);
    }
  }, [trips, loaded, tripsLoadError]);

  // Push trips to Supabase (debounced 1.5s to avoid hammering on rapid mutations)
  useEffect(() => {
    if (!loaded || !user?.id || tripsLoadError) return;
    const userId = user.id;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      pushTrips(userId, trips);
    }, 1500);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [trips, loaded, user?.id, tripsLoadError]);

  function retryTripsLoad() {
    loadTripsSafe<Trip[]>(EMPTY_TRIPS).then((result) => {
      if (result.ok) {
        setTrips(result.data);
        setTripsLoadError(false);
      }
      // If still failing, keep tripsLoadError=true; don't touch saved state.
    });
  }

  function addTrip(trip: Omit<Trip, 'id' | 'activities'>): string {
    const newTrip = createTripRecord(trip);
    setTrips((prev) => [...prev, newTrip]);
    return newTrip.id;
  }

  function addTripWithActivities(
    trip: Omit<Trip, 'id' | 'activities'>,
    initialActivities: Omit<Activity, 'id'>[],
    reservations?: Omit<Reservation, 'id' | 'tripId'>[],
  ): string {
    const base = createTripRecord(trip);

    // Create reservations with real IDs first so we can link activities to them.
    const tripReservations = (reservations ?? []).map((r) => ({
      ...r,
      id: generateId(),
      tripId: base.id,
    }));

    // Match each initial activity to its reservation by title+day to stamp reservationId.
    const activities = initialActivities.map((a) => {
      const linked = tripReservations.find(
        (r) => r.title === a.title && (r.day == null || r.day === (a.day ?? 1)),
      );
      return {
        ...a,
        id: generateActivityId(),
        reservationId: linked?.id,
      };
    });

    const newTrip: Trip = {
      ...base,
      activities,
      reservations: tripReservations.length > 0 ? tripReservations : undefined,
    };
    setTrips((prev) => [...prev, newTrip]);
    // Sync ref immediately so sequential actions in the same loop can find this trip
    tripsRef.current = [...tripsRef.current, newTrip];
    return newTrip.id;
  }

  function getTrip(id: string) {
    // Use tripsRef for consistency with other operations — ensures just-created
    // trips are findable within the same action batch (before React re-renders).
    return tripsRef.current.find((t) => t.id === id);
  }

  function getTripState(trip: Trip): TripState {
    if (trip.status === 'draft' || trip.activities.length === 0) return 'draft';
    // Undated trips (duration-only, no confirmed calendar dates) are "planned" (dates TBD)
    if (trip.datesKnown === false) return 'planned';
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
    // Sync ref so sequential actions in the same batch see the update
    tripsRef.current = tripsRef.current.map((t) => (t.id === id ? { ...t, ...updates } : t));
  }

  function deleteTrip(id: string) {
    setTrips((prev) => prev.filter((t) => t.id !== id));
    if (user?.id) deleteRemoteTrip(id);
  }

  const addActivity = useCallback((tripId: string, activity: Omit<Activity, 'id'>): boolean => {
    const trip = tripsRef.current.find((t) => t.id === tripId);
    if (!trip) return false;

    const newAct: Activity = { ...activity, id: generateActivityId(), time: normalizeTimeTo24(activity.time) };

    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        const updated: Trip = {
          ...t,
          activities: [...t.activities, newAct],
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
        if (updated.status === 'draft' && updated.activities.length > 0) {
          updated.status = 'planned';
        }
        return updated;
      })
    );
    return true;
  }, []);

  const updateActivity = useCallback((tripId: string, activityId: string, updates: Partial<Omit<Activity, 'id'>>, skipLockCheck?: boolean): boolean => {
    const trip = tripsRef.current.find((t) => t.id === tripId);
    if (!trip) return false;
    const target = trip.activities.find((a) => a.id === activityId);
    if (!target) return false;
    if (!skipLockCheck && isLocked(target) && !('locked' in updates)) return false;

    const safeUpdates = updates.time ? { ...updates, time: normalizeTimeTo24(updates.time) } : updates;

    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        return {
          ...t,
          activities: t.activities.map((a) =>
            a.id === activityId ? { ...a, ...safeUpdates } : a
          ),
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
      })
    );
    return true;
  }, []);

  const removeActivity = useCallback((tripId: string, activityId: string, skipLockCheck?: boolean): boolean => {
    const trip = tripsRef.current.find((t) => t.id === tripId);
    if (!trip) return false;
    const target = trip.activities.find((a) => a.id === activityId);
    if (!target) return false;
    if (!skipLockCheck && isLocked(target)) return false;

    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        return {
          ...t,
          activities: t.activities.filter((a) => a.id !== activityId),
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
      })
    );
    return true;
  }, []);

  function moveActivity(tripId: string, activityId: string, newDay: number, newTime: string, skipLockCheck?: boolean): boolean {
    const trip = tripsRef.current.find((t) => t.id === tripId);
    if (!trip) return false;
    const target = trip.activities.find((a) => a.id === activityId);
    if (!target) return false;
    if (!skipLockCheck && isLocked(target)) return false;

    const safeTime = normalizeTimeTo24(newTime);

    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        return {
          ...t,
          activities: t.activities.map((a) =>
            a.id === activityId ? { ...a, day: newDay, time: safeTime } : a
          ),
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
      })
    );
    return true;
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

  function replaceActivity(tripId: string, oldActivityId: string, newActivity: Omit<Activity, 'id'>, skipLockCheck?: boolean): boolean {
    const trip = tripsRef.current.find((t) => t.id === tripId);
    if (!trip) return false;
    const target = trip.activities.find((a) => a.id === oldActivityId);
    if (!target) return false;
    if (!skipLockCheck && isLocked(target)) return false;

    const newId = generateActivityId();

    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;
        return {
          ...t,
          activities: t.activities.map((a) =>
            a.id === oldActivityId ? { ...newActivity, id: newId } : a
          ),
          itineraryRevision: (t.itineraryRevision ?? 0) + 1,
        };
      })
    );
    return true;
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

    const activityType: Activity['type'] =
      res.type === 'restaurant' ? 'food' :
      res.type === 'hotel' ? 'hotel' :
      res.type === 'flight' ? 'flight' :
      'activity';

    // Auto-link: check for an existing unbooked activity with a matching name
    const nameLC = res.title.toLowerCase();
    const match = trip.activities.find((a) =>
      a.type === activityType && !a.reservationId &&
      (a.title.toLowerCase().includes(nameLC) || nameLC.includes(a.title.toLowerCase()))
    );

    let newActivities: Activity[];
    if (match) {
      // Link reservation to existing activity
      newActivities = trip.activities.map((a) =>
        a.id === match.id
          ? { ...a, reservationId: newRes.id, bookingStatus: 'booked' as const }
          : a
      );
    } else {
      // No match — create a new activity linked to the reservation
      const newActivity: Activity = {
        id: generateId(),
        title: res.title,
        day: res.day ?? 1,
        time: res.time ? normalizeTimeTo24(res.time) : '12:00',
        type: activityType,
        fixed: true,
        locked: true,
        reservationId: newRes.id,
      };
      newActivities = [...trip.activities, newActivity];
    }

    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, activities: newActivities, reservations: newResArr } : t))
    );
  }

  function attachReservation(tripId: string, activityId: string, res: Omit<Reservation, 'id' | 'tripId'>) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const activity = trip.activities.find((a) => a.id === activityId);
    if (!activity) return;

    const newRes: Reservation = { ...res, id: generateId(), tripId };
    const prevRes = trip.reservations ?? [];
    const newResArr = [...prevRes, newRes];

    // Link the activity to the new reservation and mark as booked
    const newActivities = trip.activities.map((a) => {
      if (a.id !== activityId) return a;
      return { ...a, reservationId: newRes.id, bookingStatus: 'booked' as const };
    });

    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, activities: newActivities, reservations: newResArr } : t))
    );
  }

  function updateReservation(tripId: string, res: Reservation) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const prevRes = trip.reservations ?? [];
    const newResArr = prevRes.map((r) => (r.id === res.id ? res : r));
    // Sync linked activity with reservation changes
    const newActivities = trip.activities.map((a) => {
      if (a.reservationId !== res.id) return a;
      return {
        ...a,
        title: res.title,
        day: res.day ?? a.day,
        time: res.time ? normalizeTimeTo24(res.time) : a.time,
      };
    });
    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, activities: newActivities, reservations: newResArr } : t))
    );
  }

  function removeReservation(tripId: string, resId: string) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const prevRes = trip.reservations ?? [];
    const newResArr = prevRes.filter((r) => r.id !== resId);

    // Remove the linked activity that was created for this reservation.
    // If the user had separately added content to that activity slot, we
    // remove only the exact reservation-linked activity (by reservationId).
    // Activities that were user-edited (no reservationId) are left untouched.
    const newActivities = trip.activities.filter((a) => a.reservationId !== resId);

    setTrips((prev) =>
      prev.map((t) => (t.id === tripId ? { ...t, activities: newActivities, reservations: newResArr } : t))
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
    setTripsLoadError(false);
  }

  return (
    <TripsContext.Provider
      value={{
        trips,
        loaded,
        tripsLoadError,
        retryTripsLoad,
        addTrip,
        addTripWithActivities,
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
        updateTripPrepItems,
        updateTripBudget,
        updateTripExpenses,
        addReservation,
        attachReservation,
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
