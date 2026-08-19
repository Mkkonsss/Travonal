import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { loadMemorySafe, saveMemory, loadLearningEnabled, saveLearningEnabled } from '@/services/storage';

export interface TravelMemoryEntry {
  id: string;
  type: 'preference_saved' | 'activity_skipped' | 'activity_replaced' |
        'recommendation_accepted' | 'recommendation_rejected';
  category: string;
  detail: string;
  tripId: string;
  timestamp: string;
  isGlobal: boolean;
  origin?: string; // e.g. "Smart Replace in Tokyo trip" — where/how the memory was created
  enabled: boolean; // user can disable without deleting
}

interface MemoryContextType {
  entries: TravelMemoryEntry[];
  loaded: boolean;
  learningEnabled: boolean;
  setLearningEnabled: (enabled: boolean) => void;
  addEntry: (entry: Omit<TravelMemoryEntry, 'id' | 'timestamp' | 'enabled'>) => void;
  updateEntry: (id: string, updates: Partial<Omit<TravelMemoryEntry, 'id'>>) => void;
  removeEntry: (id: string) => void;
  toggleEntry: (id: string) => void;
  getGlobalPreferences: () => TravelMemoryEntry[];
  getTripMemory: (tripId: string) => TravelMemoryEntry[];
  getActiveEntries: () => TravelMemoryEntry[];
  clearAll: () => void;
  resetAll: () => void;
}

const MemoryContext = createContext<MemoryContextType | null>(null);

export function MemoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TravelMemoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [learningEnabled, setLearningEnabled] = useState(true);

  useEffect(() => {
    Promise.all([
      loadMemorySafe<TravelMemoryEntry[]>([]),
      loadLearningEnabled(),
    ]).then(([result, savedLearning]) => {
      if (!result.ok) setLoadFailed(true);
      // Migrate old entries that don't have 'enabled' field
      const migrated = result.data.map((e) => ({
        ...e,
        enabled: e.enabled ?? true,
      }));
      setEntries(migrated);
      setLearningEnabled(savedLearning);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded && !loadFailed) {
      saveMemory(entries);
    }
  }, [entries, loaded, loadFailed]);

  function handleSetLearningEnabled(enabled: boolean) {
    setLearningEnabled(enabled);
    saveLearningEnabled(enabled);
  }

  function addEntry(entry: Omit<TravelMemoryEntry, 'id' | 'timestamp' | 'enabled'>) {
    // If learning is disabled globally, do not add
    if (!learningEnabled) return;
    setEntries((prev) => [
      ...prev,
      { ...entry, id: String(Date.now()), timestamp: new Date().toISOString(), enabled: true },
    ]);
  }

  function updateEntry(id: string, updates: Partial<Omit<TravelMemoryEntry, 'id'>>) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function toggleEntry(id: string) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e))
    );
  }

  function getGlobalPreferences() {
    return entries.filter((e) => e.isGlobal && e.enabled);
  }

  function getTripMemory(tripId: string) {
    return entries.filter((e) => e.tripId === tripId);
  }

  function getActiveEntries() {
    return entries.filter((e) => e.enabled);
  }

  function clearAll() {
    setEntries([]);
  }

  function resetAll() {
    setEntries([]);
    setLearningEnabled(true);
    setLoadFailed(false);
  }

  return (
    <MemoryContext.Provider
      value={{
        entries,
        loaded,
        learningEnabled,
        setLearningEnabled: handleSetLearningEnabled,
        addEntry,
        updateEntry,
        removeEntry,
        toggleEntry,
        getGlobalPreferences,
        getTripMemory,
        getActiveEntries,
        clearAll,
        resetAll,
      }}>
      {children}
    </MemoryContext.Provider>
  );
}

export function useMemory() {
  const ctx = useContext(MemoryContext);
  if (!ctx) throw new Error('useMemory must be used within MemoryProvider');
  return ctx;
}
