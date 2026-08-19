import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { loadInboxSafe, saveInbox, deleteOwnedMedia } from '@/services/storage';

export interface InboxItem {
  id: string;
  type: 'photo' | 'video' | 'screenshot' | 'link' | 'saved_place';
  title: string;
  destination?: string;
  source?: string; // URL or "Camera Roll"
  category?: string;
  cost?: 'free' | 'budget' | 'moderate' | 'premium';
  duration?: number;
  description?: string;
  tags?: string[];
  status: 'needs_trip' | 'fits_current' | 'planned';
  tripId?: string; // if placed into a trip
  mediaUri?: string; // local URI of the selected photo or video
  mediaType?: 'image' | 'video'; // original media type
  createdAt: number;
}

interface InboxContextType {
  items: InboxItem[];
  loaded: boolean;
  /** True when the initial load failed; saving is disabled to protect stored data. */
  loadError: boolean;
  /** Re-attempt loading inbox data after a previous failure. */
  retryLoad: () => void;
  addItem: (item: Omit<InboxItem, 'id' | 'createdAt'>) => void;
  updateItem: (id: string, updates: Partial<Omit<InboxItem, 'id'>>) => void;
  removeItem: (id: string) => void;
  getByStatus: (status: InboxItem['status']) => InboxItem[];
  getForTrip: (tripId: string) => InboxItem[];
  markPlanned: (id: string, tripId: string) => void;
  resetAll: () => void;
}

const InboxContext = createContext<InboxContextType | null>(null);

export function InboxProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    loadInboxSafe<InboxItem[]>([]).then((result) => {
      if (!result.ok) setLoadError(true);
      setItems(result.data);
      setLoaded(true);
    });
  }, []);

  // Only autosave when the initial load succeeded — prevents overwriting real data.
  useEffect(() => {
    if (loaded && !loadError) {
      saveInbox(items);
    }
  }, [items, loaded, loadError]);

  function retryLoad() {
    loadInboxSafe<InboxItem[]>([]).then((result) => {
      if (result.ok) {
        setItems(result.data);
        setLoadError(false);
      }
      // Still failing: keep loadError=true; don't touch saved state.
    });
  }

  function addItem(item: Omit<InboxItem, 'id' | 'createdAt'>) {
    setItems((prev) => [
      ...prev,
      { ...item, id: String(Date.now()) + String(Math.floor(Math.random() * 1000)), createdAt: Date.now() },
    ]);
  }

  function updateItem(id: string, updates: Partial<Omit<InboxItem, 'id'>>) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...updates } : i))
    );
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function getByStatus(status: InboxItem['status']) {
    return items
      .filter((i) => i.status === status)
      .sort((a, b) => {
        // Newest first; use 0 as stable fallback for missing/invalid timestamps
        const ta = typeof a.createdAt === 'number' && isFinite(a.createdAt) ? a.createdAt : 0;
        const tb = typeof b.createdAt === 'number' && isFinite(b.createdAt) ? b.createdAt : 0;
        return tb - ta;
      });
  }

  function getForTrip(tripId: string) {
    return items.filter((i) => i.tripId === tripId);
  }

  function markPlanned(id: string, tripId: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: 'planned' as const, tripId } : i))
    );
  }

  function resetAll() {
    // Delete owned media files before clearing
    for (const item of items) {
      if (item.mediaUri) deleteOwnedMedia(item.mediaUri);
    }
    setItems([]);
    setLoadError(false);
  }

  return (
    <InboxContext.Provider
      value={{ items, loaded, loadError, retryLoad, addItem, updateItem, removeItem, getByStatus, getForTrip, markPlanned, resetAll }}>
      {children}
    </InboxContext.Provider>
  );
}

export function useInbox() {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error('useInbox must be used within InboxProvider');
  return ctx;
}
