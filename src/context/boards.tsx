import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { loadBoardsSafe, saveBoards, deleteOwnedMedia } from '@/services/storage';
import { generateId } from '@/services/itinerary-engine';

export interface BoardItem {
  id: string;
  title: string;
  destination?: string;
  category?: string; // "food", "nightlife", "museum", etc.
  type: 'activity' | 'food' | 'hotel' | 'flight';
  cost?: 'free' | 'budget' | 'moderate' | 'premium';
  duration?: number;
  description?: string;
  notes?: string;
  source?: string; // URL
  sourceType: 'link' | 'screenshot' | 'text' | 'explore';
  mediaUri?: string;
  mediaType?: 'image' | 'video';
  placeId?: string; // Google Place ID
  address?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  reviewCount?: number;
  openNow?: boolean;
  openingHours?: string[];
  website?: string;
  phone?: string;
  priceLevel?: number;
  googleMapsUri?: string;
  date?: string; // for bookings
  time?: string; // for reservations
  plannedTripId?: string; // set when item is added to a trip
  addedAt: number;
}

export interface Board {
  id: string;
  name: string;
  items: BoardItem[];
  createdAt: number;
  updatedAt: number;
}

interface BoardsContextType {
  boards: Board[];
  loaded: boolean;
  loadError: boolean;
  retryLoad: () => void;
  createBoard: (name: string) => string;
  deleteBoard: (id: string) => void;
  renameBoard: (id: string, name: string) => void;
  addItemToBoard: (boardId: string, item: Omit<BoardItem, 'id' | 'addedAt'>) => string;
  removeItemFromBoard: (boardId: string, itemId: string) => void;
  updateBoardItem: (boardId: string, itemId: string, updates: Partial<BoardItem>) => void;
  markItemPlanned: (boardId: string, itemId: string, tripId: string) => void;
  moveItemToBoard: (fromBoardId: string, toBoardId: string, itemId: string) => void;
  clearPlannedTrip: (tripId: string) => void;
  reorderBoardItem: (boardId: string, itemId: string, direction: 'up' | 'down') => void;
  setBoardItemOrder: (boardId: string, orderedIds: string[]) => void;
  getBoard: (id: string) => Board | undefined;
  resetAll: () => void;
}

const BoardsContext = createContext<BoardsContextType | null>(null);

export function BoardsProvider({ children }: { children: ReactNode }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const hasChanged = useRef(false);

  useEffect(() => {
    loadBoardsSafe<Board[]>([]).then((result) => {
      if (!result.ok) setLoadError(true);
      setBoards(result.data);
      setLoaded(true);
    });
  }, []);

  // Only autosave after a real mutation (skip the initial load write-back)
  useEffect(() => {
    if (!loaded || loadError) return;
    if (!hasChanged.current) {
      hasChanged.current = true;
      return;
    }
    saveBoards(boards);
  }, [boards, loaded, loadError]);

  function retryLoad() {
    hasChanged.current = false;
    loadBoardsSafe<Board[]>([]).then((result) => {
      if (result.ok) {
        setBoards(result.data);
        setLoadError(false);
      }
    });
  }

  function createBoard(name: string): string {
    const id = generateId();
    const now = Date.now();
    setBoards((prev) => [...prev, { id, name, items: [], createdAt: now, updatedAt: now }]);
    return id;
  }

  function deleteBoard(id: string) {
    // Clean up media before mutating state (avoid side effects in updater)
    const board = boards.find((b) => b.id === id);
    if (board) {
      for (const item of board.items) {
        if (item.mediaUri) deleteOwnedMedia(item.mediaUri);
      }
    }
    setBoards((prev) => prev.filter((b) => b.id !== id));
  }

  function renameBoard(id: string, name: string) {
    setBoards((prev) =>
      prev.map((b) => (b.id === id ? { ...b, name, updatedAt: Date.now() } : b))
    );
  }

  function addItemToBoard(boardId: string, item: Omit<BoardItem, 'id' | 'addedAt'>): string {
    const itemId = generateId();
    setBoards((prev) =>
      prev.map((b) =>
        b.id === boardId
          ? { ...b, items: [...b.items, { ...item, id: itemId, addedAt: Date.now() }], updatedAt: Date.now() }
          : b
      )
    );
    return itemId;
  }

  function removeItemFromBoard(boardId: string, itemId: string) {
    // Clean up media before mutating state (avoid side effects in updater)
    const board = boards.find((b) => b.id === boardId);
    const item = board?.items.find((i) => i.id === itemId);
    if (item?.mediaUri) deleteOwnedMedia(item.mediaUri);
    setBoards((prev) =>
      prev.map((b) => {
        if (b.id !== boardId) return b;
        return { ...b, items: b.items.filter((i) => i.id !== itemId), updatedAt: Date.now() };
      })
    );
  }

  function updateBoardItem(boardId: string, itemId: string, updates: Partial<BoardItem>) {
    setBoards((prev) =>
      prev.map((b) =>
        b.id === boardId
          ? { ...b, items: b.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)), updatedAt: Date.now() }
          : b
      )
    );
  }

  function markItemPlanned(boardId: string, itemId: string, tripId: string) {
    updateBoardItem(boardId, itemId, { plannedTripId: tripId });
  }

  function moveItemToBoard(fromBoardId: string, toBoardId: string, itemId: string) {
    setBoards((prev) => {
      const sourceBoard = prev.find((b) => b.id === fromBoardId);
      const item = sourceBoard?.items.find((i) => i.id === itemId);
      if (!item) return prev;
      const now = Date.now();
      return prev.map((b) => {
        if (b.id === fromBoardId) return { ...b, items: b.items.filter((i) => i.id !== itemId), updatedAt: now };
        if (b.id === toBoardId) return { ...b, items: [...b.items, item], updatedAt: now };
        return b;
      });
    });
  }

  function clearPlannedTrip(tripId: string) {
    setBoards((prev) =>
      prev.map((b) => {
        const hasAffected = b.items.some((i) => i.plannedTripId === tripId);
        if (!hasAffected) return b;
        return {
          ...b,
          items: b.items.map((i) =>
            i.plannedTripId === tripId ? { ...i, plannedTripId: undefined } : i
          ),
          updatedAt: Date.now(),
        };
      })
    );
  }

  function reorderBoardItem(boardId: string, itemId: string, direction: 'up' | 'down') {
    setBoards((prev) =>
      prev.map((b) => {
        if (b.id !== boardId) return b;
        const items = [...b.items];
        const idx = items.findIndex((i) => i.id === itemId);
        if (idx < 0) return b;
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= items.length) return b;
        [items[idx], items[targetIdx]] = [items[targetIdx], items[idx]];
        return { ...b, items, updatedAt: Date.now() };
      })
    );
  }

  function setBoardItemOrder(boardId: string, orderedIds: string[]) {
    setBoards((prev) =>
      prev.map((b) => {
        if (b.id !== boardId) return b;
        const byId = new Map(b.items.map((i) => [i.id, i]));
        const items = orderedIds.map((id) => byId.get(id)).filter(Boolean) as BoardItem[];
        // Append any items not in the ordered list (safety net)
        for (const item of b.items) {
          if (!orderedIds.includes(item.id)) items.push(item);
        }
        return { ...b, items, updatedAt: Date.now() };
      })
    );
  }

  function getBoard(id: string): Board | undefined {
    return boards.find((b) => b.id === id);
  }

  function resetAll() {
    for (const board of boards) {
      for (const item of board.items) {
        if (item.mediaUri) deleteOwnedMedia(item.mediaUri);
      }
    }
    setBoards([]);
    setLoadError(false);
  }

  return (
    <BoardsContext.Provider
      value={{ boards, loaded, loadError, retryLoad, createBoard, deleteBoard, renameBoard, addItemToBoard, removeItemFromBoard, updateBoardItem, markItemPlanned, moveItemToBoard, clearPlannedTrip, reorderBoardItem, setBoardItemOrder, getBoard, resetAll }}>
      {children}
    </BoardsContext.Provider>
  );
}

export function useBoards() {
  const ctx = useContext(BoardsContext);
  if (!ctx) throw new Error('useBoards must be used within BoardsProvider');
  return ctx;
}
