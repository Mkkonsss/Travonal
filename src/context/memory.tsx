import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { loadMemorySafe, saveMemory, loadLearningEnabled, saveLearningEnabled, loadMemoryFirstSeen, saveMemoryFirstSeen } from '@/services/storage';
import { useAuth } from '@/context/auth';
import { pushMemory, pullMemory } from '@/services/sync';

export type MemoryCategory =
  | 'preference' | 'crowds' | 'budget' | 'logistics'
  | 'activity_type' | 'food' | 'discovery' | 'quality'
  | 'timing' | 'destination';

export type MemorySentiment = 'positive' | 'negative' | 'neutral';

export type MemoryEntryType = 'preference_saved' | 'activity_skipped' | 'activity_replaced' |
  'recommendation_accepted' | 'recommendation_rejected';

const SENTIMENT_MAP: Record<MemoryEntryType, MemorySentiment> = {
  preference_saved: 'positive',
  recommendation_accepted: 'positive',
  activity_skipped: 'negative',
  recommendation_rejected: 'negative',
  activity_replaced: 'neutral',
};

export interface TravelMemoryEntry {
  id: string;
  type: MemoryEntryType;
  category: MemoryCategory;
  detail: string;
  tripId: string;
  timestamp: string;
  isGlobal: boolean;
  origin?: string; // e.g. "Smart Replace in Tokyo trip" — where/how the memory was created
  enabled: boolean; // user can disable without deleting
  sentiment: MemorySentiment;
  destination?: string; // structured destination for scoped filtering
}

interface MemoryContextType {
  entries: TravelMemoryEntry[];
  loaded: boolean;
  learningEnabled: boolean;
  setLearningEnabled: (enabled: boolean) => void;
  addEntry: (entry: Omit<TravelMemoryEntry, 'id' | 'timestamp' | 'enabled' | 'sentiment'>) => void;
  updateEntry: (id: string, updates: Partial<Omit<TravelMemoryEntry, 'id'>>) => void;
  removeEntry: (id: string) => void;
  toggleEntry: (id: string) => void;
  getGlobalPreferences: () => TravelMemoryEntry[];
  getTripMemory: (tripId: string) => TravelMemoryEntry[];
  getActiveEntries: () => TravelMemoryEntry[];
  clearAll: () => void;
  resetAll: () => void;
  setOnFirstEntry: (cb: (() => void) | null) => void;
}

const MemoryContext = createContext<MemoryContextType | null>(null);

export function MemoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TravelMemoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [learningEnabled, setLearningEnabled] = useState(true);
  const { user } = useAuth();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstEntrySeen = useRef(true); // assume seen until we load the real value
  const onFirstEntryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    Promise.all([
      loadMemorySafe<TravelMemoryEntry[]>([]),
      loadLearningEnabled(),
      loadMemoryFirstSeen(),
    ]).then(([result, savedLearning, seen]) => {
      if (!result.ok) setLoadFailed(true);
      // Migrate old entries that don't have 'enabled' or 'sentiment' fields
      const migrated = result.data.map((e) => ({
        ...e,
        enabled: e.enabled ?? true,
        sentiment: e.sentiment ?? (SENTIMENT_MAP[e.type as MemoryEntryType] || 'neutral'),
      }));
      setEntries(migrated);
      setLearningEnabled(savedLearning);
      firstEntrySeen.current = seen;
      setLoaded(true);
    });
  }, []);

  // Pull remote memory on sign-in
  useEffect(() => {
    if (!loaded || !user?.id) return;
    pullMemory(user.id).then((remote) => {
      if (!remote || remote.length === 0) return;
      // Merge: keep local entries, add remote entries that don't exist locally
      setEntries((prev) => {
        const localIds = new Set(prev.map((e) => e.id));
        const newRemote = remote.filter((e) => !localIds.has(e.id));
        return newRemote.length > 0 ? [...prev, ...newRemote] : prev;
      });
    });
  }, [loaded, user?.id]);

  // Save to AsyncStorage on every change
  useEffect(() => {
    if (loaded && !loadFailed) {
      saveMemory(entries);
    }
  }, [entries, loaded, loadFailed]);

  // Push to Supabase (debounced)
  useEffect(() => {
    if (!loaded || !user?.id) return;
    const userId = user.id;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      pushMemory(userId, entries);
    }, 2000);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [entries, loaded, user?.id]);

  function handleSetLearningEnabled(enabled: boolean) {
    setLearningEnabled(enabled);
    saveLearningEnabled(enabled);
  }

  function addEntry(entry: Omit<TravelMemoryEntry, 'id' | 'timestamp' | 'enabled' | 'sentiment'>) {
    // If learning is disabled globally, do not add
    if (!learningEnabled) return;
    setEntries((prev) => [
      ...prev,
      {
        ...entry,
        id: String(Date.now()),
        timestamp: new Date().toISOString(),
        enabled: true,
        sentiment: SENTIMENT_MAP[entry.type] ?? 'neutral',
      },
    ]);
    // First-memory onboarding toast
    if (!firstEntrySeen.current) {
      firstEntrySeen.current = true;
      saveMemoryFirstSeen();
      onFirstEntryRef.current?.();
    }
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

  function setOnFirstEntry(cb: (() => void) | null) {
    onFirstEntryRef.current = cb;
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
        setOnFirstEntry,
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
