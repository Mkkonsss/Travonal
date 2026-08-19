import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { loadTripPulseEnabled, saveTripPulseEnabled } from '@/services/storage';

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
  const [enabled, setEnabledState] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadTripPulseEnabled().then((val) => {
      setEnabledState(val);
      setLoaded(true);
    });
  }, []);

  function setEnabled(value: boolean) {
    setEnabledState(value);
    saveTripPulseEnabled(value);
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
