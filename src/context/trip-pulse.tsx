import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { loadTripPulseEnabled, saveTripPulseEnabled } from '@/services/storage';
import { useAuth } from '@/context/auth';
import { mergeUserSettings, pullUserSettings } from '@/services/sync';

interface TripPulseContextType {
  enabled: boolean;
  loaded: boolean;
  setEnabled: (value: boolean) => void;
  resetAll: () => void;
}

const TripPulseContext = createContext<TripPulseContextType | null>(null);

/**
 * Whether Trip Pulse should be evaluated.
 * Returns true only when the persisted setting has finished loading AND the user has it enabled.
 * Prevents false-positive alerts from the default `true` before storage loads.
 */
export function shouldRunTripPulse(loaded: boolean, enabled: boolean): boolean {
  return loaded && enabled;
}

export function TripPulseProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { user } = useAuth();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadTripPulseEnabled().then((val) => {
      setEnabledState(val);
      setLoaded(true);
    });
  }, []);

  // Pull remote setting on sign-in
  useEffect(() => {
    if (!loaded || !user?.id) return;
    pullUserSettings(user.id).then((remote) => {
      if (remote && typeof remote.tripPulseEnabled === 'boolean') {
        setEnabledState(remote.tripPulseEnabled);
        saveTripPulseEnabled(remote.tripPulseEnabled);
      }
    });
  }, [loaded, user?.id]);

  function setEnabled(value: boolean) {
    setEnabledState(value);
    saveTripPulseEnabled(value);
    if (user?.id) {
      const userId = user.id;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        mergeUserSettings(userId, { tripPulseEnabled: value });
      }, 1500);
    }
  }

  function resetAll() {
    setEnabledState(true);
  }

  return (
    <TripPulseContext.Provider value={{ enabled, loaded, setEnabled, resetAll }}>
      {children}
    </TripPulseContext.Provider>
  );
}

export function useTripPulse() {
  const ctx = useContext(TripPulseContext);
  if (!ctx) throw new Error('useTripPulse must be used within TripPulseProvider');
  return ctx;
}
