import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { loadSavedPlacesSafe, saveSavedPlaces } from '@/services/storage';
import { useInbox } from '@/context/inbox';

export interface SavedPlace {
  id: string;
  title: string;
  destination: string;
  type: 'flight' | 'hotel' | 'activity' | 'food';
  category: string;
  cost: 'free' | 'budget' | 'moderate' | 'premium';
  duration: number;
  description: string;
  tags: string[];
  crowdLevel: 'low' | 'medium' | 'high';
  energyLevel: 'low' | 'medium' | 'high';
  bestTime?: string;
  savedAt: number;
}

const EMPTY_SAVED: SavedPlace[] = [];

interface SavedPlacesContextType {
  savedPlaces: SavedPlace[];
  loaded: boolean;
  /** True when the initial load failed; saving is disabled to protect stored data. */
  loadError: boolean;
  /** Re-attempt loading saved places after a previous failure. */
  retryLoad: () => void;
  savePlace: (place: Omit<SavedPlace, 'id' | 'savedAt'>) => void;
  unsavePlace: (id: string) => void;
  isSaved: (title: string, destination: string) => boolean;
  getSavedPlaces: () => SavedPlace[];
  clearAll: () => void;
  resetAll: () => void;
}

const SavedPlacesContext = createContext<SavedPlacesContextType | null>(null);

export function SavedPlacesProvider({ children }: { children: ReactNode }) {
  const { items: inboxItems, addItem: addInboxItem, removeItem: removeInboxItem } = useInbox();
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(EMPTY_SAVED);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    loadSavedPlacesSafe<SavedPlace[]>(EMPTY_SAVED).then((result) => {
      if (!result.ok) setLoadError(true);
      setSavedPlaces(result.data);
      setLoaded(true);
    });
  }, []);

  // Only autosave when the initial load succeeded — prevents overwriting real data.
  useEffect(() => {
    if (loaded && !loadError) {
      saveSavedPlaces(savedPlaces);
    }
  }, [savedPlaces, loaded, loadError]);

  function retryLoad() {
    loadSavedPlacesSafe<SavedPlace[]>(EMPTY_SAVED).then((result) => {
      if (result.ok) {
        setSavedPlaces(result.data);
        setLoadError(false);
      }
      // Still failing: keep loadError=true; don't touch saved state.
    });
  }

  function savePlace(place: Omit<SavedPlace, 'id' | 'savedAt'>) {
    setSavedPlaces((prev) => [
      ...prev,
      { ...place, id: String(Date.now()), savedAt: Date.now() },
    ]);

    // Also add to Inbox with dedup
    const alreadyInInbox = inboxItems.some(
      (item) => item.title === place.title && item.destination === place.destination
    );
    if (!alreadyInInbox) {
      addInboxItem({
        type: 'saved_place',
        title: place.title,
        destination: place.destination,
        category: place.category,
        cost: place.cost,
        duration: place.duration,
        description: place.description,
        tags: place.tags,
        status: 'needs_trip',
      });
    }
  }

  function unsavePlace(id: string) {
    // Remove corresponding inbox item of type 'saved_place'
    const place = savedPlaces.find((p) => p.id === id);
    if (place) {
      const inboxItem = inboxItems.find(
        (i) => i.type === 'saved_place' && i.title === place.title && i.destination === place.destination
      );
      if (inboxItem) removeInboxItem(inboxItem.id);
    }
    setSavedPlaces((prev) => prev.filter((p) => p.id !== id));
  }

  function isSaved(title: string, destination: string) {
    return savedPlaces.some((p) => p.title === title && p.destination === destination);
  }

  function getSavedPlaces() {
    return savedPlaces;
  }

  function clearAll() {
    setSavedPlaces([]);
  }

  function resetAll() {
    setSavedPlaces([]);
    setLoadError(false);
  }

  return (
    <SavedPlacesContext.Provider
      value={{
        savedPlaces,
        loaded,
        loadError,
        retryLoad,
        savePlace,
        unsavePlace,
        isSaved,
        getSavedPlaces,
        clearAll,
        resetAll,
      }}>
      {children}
    </SavedPlacesContext.Provider>
  );
}

export function useSavedPlaces() {
  const ctx = useContext(SavedPlacesContext);
  if (!ctx) throw new Error('useSavedPlaces must be used within SavedPlacesProvider');
  return ctx;
}
