import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { generateId } from '@/services/itinerary-engine';
import { loadStandaloneBookings, saveStandaloneBookings } from '@/services/storage';
import { Reservation } from '@/context/trips';
import { useAuth } from '@/context/auth';
import { pushStandaloneBookings, pullStandaloneBookings } from '@/services/sync';

interface BookingsContextValue {
  standaloneBookings: Reservation[];
  addStandaloneBooking: (payload: Omit<Reservation, 'id' | 'tripId'>) => Reservation;
  updateStandaloneBooking: (id: string, updates: Partial<Reservation>) => void;
  removeStandaloneBooking: (id: string) => void;
  linkBookingToTrip: (bookingId: string, tripId: string) => Reservation | null;
  resetAll: () => void;
}

const BookingsContext = createContext<BookingsContextValue | null>(null);

export function BookingsProvider({ children }: { children: ReactNode }) {
  const [standaloneBookings, setStandaloneBookings] = useState<Reservation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { user } = useAuth();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadStandaloneBookings().then((data) => {
      setStandaloneBookings(data as Reservation[]);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // Pull remote bookings on sign-in, merge with local
  useEffect(() => {
    if (!loaded || !user?.id) return;
    pullStandaloneBookings(user.id).then((remote) => {
      if (!remote || remote.length === 0) return;
      setStandaloneBookings((local) => {
        const localIds = new Set(local.map((b) => b.id));
        const newFromRemote = remote.filter((b) => !localIds.has(b.id));
        return newFromRemote.length > 0 ? [...local, ...newFromRemote] : local;
      });
    });
  }, [loaded, user?.id]);

  useEffect(() => {
    if (loaded) saveStandaloneBookings(standaloneBookings).catch(() => {});
  }, [standaloneBookings, loaded]);

  // Push to Supabase (debounced)
  useEffect(() => {
    if (!loaded || !user?.id) return;
    const userId = user.id;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      pushStandaloneBookings(userId, standaloneBookings);
    }, 1500);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [standaloneBookings, loaded, user?.id]);

  const addStandaloneBooking = useCallback((payload: Omit<Reservation, 'id' | 'tripId'>): Reservation => {
    const booking: Reservation = { ...payload, id: generateId(), tripId: undefined };
    setStandaloneBookings(prev => [booking, ...prev]);
    return booking;
  }, []);

  const updateStandaloneBooking = useCallback((id: string, updates: Partial<Reservation>) => {
    setStandaloneBookings(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  }, []);

  const removeStandaloneBooking = useCallback((id: string) => {
    setStandaloneBookings(prev => prev.filter(b => b.id !== id));
  }, []);

  const resetAll = useCallback(() => {
    setStandaloneBookings([]);
  }, []);

  // Returns the booking with tripId set so the caller can add it to the trip
  const linkBookingToTrip = useCallback((bookingId: string, tripId: string): Reservation | null => {
    let linked: Reservation | null = null;
    setStandaloneBookings(prev => prev.filter(b => {
      if (b.id === bookingId) { linked = { ...b, tripId }; return false; }
      return true;
    }));
    return linked;
  }, []);

  return (
    <BookingsContext.Provider value={{ standaloneBookings, addStandaloneBooking, updateStandaloneBooking, removeStandaloneBooking, linkBookingToTrip, resetAll }}>
      {children}
    </BookingsContext.Provider>
  );
}

export function useBookings() {
  const ctx = useContext(BookingsContext);
  if (!ctx) throw new Error('useBookings must be used within BookingsProvider');
  return ctx;
}
