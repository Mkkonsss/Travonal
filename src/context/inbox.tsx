import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { loadInboxSafe, saveInbox, deleteOwnedMedia } from '@/services/storage';
import { useAuth } from '@/context/auth';
import { pushSavedPlaces, pullSavedPlaces } from '@/services/sync';

export interface InboxItem {
  id: string;
  type: 'photo' | 'video' | 'screenshot' | 'link' | 'saved_place';
  title: string;
  destination?: string;
  source?: string; // URL or "Camera Roll"
  category?: string;
  cost?: 'free' | 'budget' | 'moderate' | 'premium';
  description?: string;
  tags?: string[];
  crowdLevel?: 'low' | 'medium' | 'high';
  energyLevel?: 'low' | 'medium' | 'high';
  bestTime?: string;
  activityType?: 'flight' | 'hotel' | 'activity' | 'food';
  status: 'needs_trip' | 'fits_current' | 'planned';
  tripId?: string; // if placed into a trip
  mediaUri?: string; // local URI of the selected photo or video
  mediaType?: 'image' | 'video'; // original media type
  createdAt: number;
}

export interface SavePlaceInput {
  title: string;
  destination: string;
  type: 'flight' | 'hotel' | 'activity' | 'food';
  category: string;
  cost: 'free' | 'budget' | 'moderate' | 'premium';
  description: string;
  tags: string[];
  crowdLevel?: 'low' | 'medium' | 'high';
  energyLevel?: 'low' | 'medium' | 'high';
  bestTime?: string;
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
  // Saved places convenience methods
  savePlace: (place: SavePlaceInput) => void;
  unsavePlace: (id: string) => void;
  isSaved: (title: string, destination: string) => boolean;
  savedPlaces: InboxItem[];
}

const InboxContext = createContext<InboxContextType | null>(null);

export function InboxProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const { user } = useAuth();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadInboxSafe<InboxItem[]>([]).then((result) => {
      if (!result.ok) setLoadError(true);
      setItems(result.data);
      setLoaded(true);
    });
  }, []);

  // Pull remote saved places on sign-in, merge with local
  useEffect(() => {
    if (!loaded || !user?.id) return;
    pullSavedPlaces(user.id).then((remote) => {
      if (!remote || remote.length === 0) return;
      setItems((local) => {
        const localIds = new Set(local.map((i) => i.id));
        const newFromRemote = remote.filter((i) => !localIds.has(i.id));
        return newFromRemote.length > 0 ? [...local, ...newFromRemote] : local;
      });
    });
  }, [loaded, user?.id]);

  // Only autosave when the initial load succeeded — prevents overwriting real data.
  useEffect(() => {
    if (loaded && !loadError) {
      saveInbox(items);
    }
  }, [items, loaded, loadError]);

  // Push to Supabase (debounced)
  useEffect(() => {
    if (!loaded || loadError || !user?.id) return;
    const userId = user.id;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      pushSavedPlaces(userId, items);
    }, 1500);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [items, loaded, loadError, user?.id]);

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

  // Saved places convenience methods
  const savedPlaces = items.filter((i) => i.type === 'saved_place');

  function savePlace(place: SavePlaceInput) {
    const alreadyExists = items.some(
      (i) => i.type === 'saved_place' && i.title === place.title && i.destination === place.destination
    );
    if (alreadyExists) return;
    addItem({
      type: 'saved_place',
      title: place.title,
      destination: place.destination,
      category: place.category,
      cost: place.cost,
      description: place.description,
      tags: place.tags,
      crowdLevel: place.crowdLevel,
      energyLevel: place.energyLevel,
      bestTime: place.bestTime,
      activityType: place.type,
      status: 'needs_trip',
    });
  }

  function unsavePlace(id: string) {
    removeItem(id);
  }

  function isSaved(title: string, destination: string) {
    return items.some((i) => i.type === 'saved_place' && i.title === title && i.destination === destination);
  }

  return (
    <InboxContext.Provider
      value={{ items, loaded, loadError, retryLoad, addItem, updateItem, removeItem, getByStatus, getForTrip, markPlanned, resetAll, savePlace, unsavePlace, isSaved, savedPlaces }}>
      {children}
    </InboxContext.Provider>
  );
}

export function useInbox() {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error('useInbox must be used within InboxProvider');
  return ctx;
}
