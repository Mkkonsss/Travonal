import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  PulseHistoryEntry,
  loadPulseHistory,
  savePulseHistory,
} from '@/services/storage';
import {
  recordAlert as recordAlertOp,
  markSeen as markSeenOp,
  resolveAlert as resolveAlertOp,
  autoResolve as autoResolveOp,
  markNotified as markNotifiedOp,
  isOccurrenceNotified as isOccurrenceNotifiedOp,
  getResolvedForTrip as getResolvedForTripOp,
  getActiveOccurrence as getActiveOccurrenceOp,
  AlertMeta,
} from '@/services/pulse-history-ops';

// ---------- context type ----------

interface PulseHistoryContextType {
  entries: PulseHistoryEntry[];
  loaded: boolean;
  recordAlert: (tripId: string, alertId: string, meta: AlertMeta) => string;
  markSeen: (tripId: string, activeAlertIds: string[]) => void;
  resolveAlert: (tripId: string, alertId: string) => void;
  autoResolve: (tripId: string, activeAlertIds: Set<string>) => void;
  markNotified: (occurrenceId: string) => void;
  getForTrip: (tripId: string) => PulseHistoryEntry[];
  getResolvedForTrip: (tripId: string) => PulseHistoryEntry[];
  getActiveOccurrence: (tripId: string, alertId: string) => PulseHistoryEntry | undefined;
  isOccurrenceNotified: (tripId: string, alertId: string) => boolean;
  resetAll: () => void;
}

const PulseHistoryContext = createContext<PulseHistoryContextType | null>(null);

// ---------- provider ----------

export function PulseHistoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<PulseHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadPulseHistory().then((stored) => {
      setEntries(stored);
      setLoaded(true);
    });
  }, []);

  // Persist whenever entries change (after initial load)
  const loadedForSave = loaded;
  useEffect(() => {
    if (loadedForSave) {
      savePulseHistory(entries);
    }
  }, [entries, loadedForSave]);

  function recordAlert(tripId: string, alertId: string, meta: AlertMeta): string {
    let occurrenceId = '';
    setEntries((prev) => {
      const [updated, id] = recordAlertOp(prev, tripId, alertId, meta);
      occurrenceId = id;
      return updated;
    });
    return occurrenceId;
  }

  function markSeen(tripId: string, activeAlertIds: string[]) {
    setEntries((prev) => markSeenOp(prev, tripId, activeAlertIds));
  }

  function resolveAlert(tripId: string, alertId: string) {
    setEntries((prev) => resolveAlertOp(prev, tripId, alertId));
  }

  function autoResolve(tripId: string, activeAlertIds: Set<string>) {
    setEntries((prev) => autoResolveOp(prev, tripId, activeAlertIds));
  }

  function markNotified(occurrenceId: string) {
    setEntries((prev) => markNotifiedOp(prev, occurrenceId));
  }

  function getForTrip(tripId: string): PulseHistoryEntry[] {
    return entries.filter((e) => e.tripId === tripId);
  }

  function getResolvedForTrip(tripId: string): PulseHistoryEntry[] {
    return getResolvedForTripOp(entries, tripId);
  }

  function getActiveOccurrence(tripId: string, alertId: string): PulseHistoryEntry | undefined {
    return getActiveOccurrenceOp(entries, tripId, alertId);
  }

  function isOccurrenceNotified(tripId: string, alertId: string): boolean {
    return isOccurrenceNotifiedOp(entries, tripId, alertId);
  }

  function resetAll() {
    setEntries([]);
  }

  return (
    <PulseHistoryContext value={{
      entries,
      loaded,
      recordAlert,
      markSeen,
      resolveAlert,
      autoResolve,
      markNotified,
      getForTrip,
      getResolvedForTrip,
      getActiveOccurrence,
      isOccurrenceNotified,
      resetAll,
    }}>
      {children}
    </PulseHistoryContext>
  );
}

export function usePulseHistory(): PulseHistoryContextType {
  const ctx = useContext(PulseHistoryContext);
  if (!ctx) throw new Error('usePulseHistory must be used within PulseHistoryProvider');
  return ctx;
}
