import AsyncStorage from '@react-native-async-storage/async-storage';
import { Paths, File } from 'expo-file-system';
import { withRetry, reportStorageError } from '@/services/storage-errors';

const KEYS = {
  TRIPS: '@travonal/trips',
  PROFILE: '@travonal/profile',
  MEMORY: '@travonal/memory',
  SAVED_PLACES: '@travonal/saved_places',
  ONBOARDING_COMPLETE: '@travonal/onboarding_complete',
  CHANGE_HISTORY: '@travonal/change_history',
  INBOX: '@travonal/inbox',
  DISMISSED_PULSE: '@travonal/dismissed_pulse',
  CHAT_MESSAGES: '@travonal/chat_messages',
  CHAT_THREADS: '@travonal/chat_threads',
  RECENT_SEARCHES: '@travonal/recent_searches',
  NOTIF_DISMISSED: '@travonal/notif_dismissed',
  TRIP_PULSE_ENABLED: '@travonal/trip_pulse_enabled',
  LEARNING_ENABLED: '@travonal/learning_enabled',
  SEEN_PULSE: '@travonal/seen_pulse',
  PULSE_HISTORY: '@travonal/pulse_history',
  PULSE_NOTIFIED: '@travonal/pulse_notified',
  DISCOVERY_SEEN: '@travonal/discovery_seen',
  DISCOVERY_DISMISSED: '@travonal/discovery_dismissed',
  DISCOVERY_INTERACTIONS: '@travonal/discovery_interactions',
  BOARDS: '@travonal/boards',
} as const;

/**
 * Discriminated union to distinguish a missing key (safe to treat as default)
 * from a read/parse error (unsafe — must NOT autosave the fallback, which
 * would silently destroy real data that may still be on disk).
 */
export type StorageLoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; data: T; error: unknown };

/**
 * Raw AsyncStorage write — throws on failure. Used as retry target.
 * Separated from the user-facing save wrappers so retry doesn't
 * recursively create another error report.
 */
async function rawSetItem(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}

async function safeLoad<T>(key: string, fallback: T): Promise<StorageLoadResult<T>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return { ok: true, data: fallback }; // key absent — safe default
    return { ok: true, data: JSON.parse(raw) as T };
  } catch (error) {
    return { ok: false, data: fallback, error }; // read/parse failure — unsafe to autosave
  }
}

export async function loadTrips<T>(fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.TRIPS);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function loadTripsSafe<T>(fallback: T): Promise<StorageLoadResult<T>> {
  return safeLoad(KEYS.TRIPS, fallback);
}

export async function saveTrips<T>(trips: T): Promise<boolean> {
  const data = JSON.stringify(trips);
  try {
    await withRetry(() => rawSetItem(KEYS.TRIPS, data));
    return true;
  } catch (e) {
    console.warn('Failed to save trips:', e);
    reportStorageError('trips', () => rawSetItem(KEYS.TRIPS, data));
    return false;
  }
}

export async function loadProfile<T>(fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PROFILE);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function loadProfileSafe<T>(fallback: T): Promise<StorageLoadResult<T>> {
  return safeLoad(KEYS.PROFILE, fallback);
}

export async function saveProfile<T>(profile: T): Promise<boolean> {
  const data = JSON.stringify(profile);
  try {
    await withRetry(() => rawSetItem(KEYS.PROFILE, data));
    return true;
  } catch (e) {
    console.warn('Failed to save profile:', e);
    reportStorageError('profile', () => rawSetItem(KEYS.PROFILE, data));
    return false;
  }
}

export async function loadMemory<T>(fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.MEMORY);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function loadMemorySafe<T>(fallback: T): Promise<StorageLoadResult<T>> {
  return safeLoad(KEYS.MEMORY, fallback);
}

export async function saveMemory<T>(memory: T): Promise<boolean> {
  const data = JSON.stringify(memory);
  try {
    await withRetry(() => rawSetItem(KEYS.MEMORY, data));
    return true;
  } catch (e) {
    console.warn('Failed to save memory:', e);
    reportStorageError('travel memory', () => rawSetItem(KEYS.MEMORY, data));
    return false;
  }
}

export async function loadSavedPlaces<T>(fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SAVED_PLACES);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSavedPlacesSafe<T>(fallback: T): Promise<StorageLoadResult<T>> {
  return safeLoad(KEYS.SAVED_PLACES, fallback);
}

export async function saveSavedPlaces<T>(places: T): Promise<boolean> {
  const data = JSON.stringify(places);
  try {
    await withRetry(() => rawSetItem(KEYS.SAVED_PLACES, data));
    return true;
  } catch (e) {
    console.warn('Failed to save places:', e);
    reportStorageError('saved places', () => rawSetItem(KEYS.SAVED_PLACES, data));
    return false;
  }
}

export async function isOnboardingComplete(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(KEYS.ONBOARDING_COMPLETE);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function setOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.ONBOARDING_COMPLETE, 'true');
  } catch (e) {
    console.warn('Failed to save onboarding state:', e);
  }
}

export async function clearOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEYS.ONBOARDING_COMPLETE);
  } catch (e) {
    console.warn('Failed to clear onboarding state:', e);
  }
}

export async function loadChangeHistory<T>(fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CHANGE_HISTORY);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function loadChangeHistorySafe<T>(fallback: T): Promise<StorageLoadResult<T>> {
  return safeLoad(KEYS.CHANGE_HISTORY, fallback);
}

export async function saveChangeHistory<T>(history: T): Promise<boolean> {
  const data = JSON.stringify(history);
  try {
    await withRetry(() => rawSetItem(KEYS.CHANGE_HISTORY, data));
    return true;
  } catch (e) {
    console.warn('Failed to save change history:', e);
    reportStorageError('change history', () => rawSetItem(KEYS.CHANGE_HISTORY, data));
    return false;
  }
}

export async function loadInbox<T>(fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.INBOX);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function loadInboxSafe<T>(fallback: T): Promise<StorageLoadResult<T>> {
  return safeLoad(KEYS.INBOX, fallback);
}

export async function saveInbox<T>(inbox: T): Promise<boolean> {
  const data = JSON.stringify(inbox);
  try {
    await withRetry(() => rawSetItem(KEYS.INBOX, data));
    return true;
  } catch (e) {
    console.warn('Failed to save inbox:', e);
    reportStorageError('inbox', () => rawSetItem(KEYS.INBOX, data));
    return false;
  }
}

export function loadBoardsSafe<T>(fallback: T): Promise<StorageLoadResult<T>> {
  return safeLoad(KEYS.BOARDS, fallback);
}

export async function saveBoards<T>(boards: T): Promise<boolean> {
  const data = JSON.stringify(boards);
  try {
    await withRetry(() => rawSetItem(KEYS.BOARDS, data));
    return true;
  } catch (e) {
    console.warn('Failed to save boards:', e);
    reportStorageError('boards', () => rawSetItem(KEYS.BOARDS, data));
    return false;
  }
}

export async function loadDismissedPulse(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.DISMISSED_PULSE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveDismissedPulse(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.DISMISSED_PULSE, JSON.stringify(ids));
  } catch (e) {
    console.warn('Failed to save dismissed pulse:', e);
  }
}

export async function loadChatMessages<T>(fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CHAT_MESSAGES);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveChatMessages<T>(messages: T): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.CHAT_MESSAGES, JSON.stringify(messages));
  } catch (e) {
    console.warn('Failed to save chat messages:', e);
  }
}

export async function loadChatThreads<T>(fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CHAT_THREADS);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveChatThreads<T>(threads: T): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.CHAT_THREADS, JSON.stringify(threads));
  } catch (e) {
    console.warn('Failed to save chat threads:', e);
  }
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.RECENT_SEARCHES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveRecentSearches(searches: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.RECENT_SEARCHES, JSON.stringify(searches));
  } catch (e) {
    console.warn('Failed to save recent searches:', e);
  }
}

export async function loadNotifDismissed(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(KEYS.NOTIF_DISMISSED);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function saveNotifDismissed(dismissed: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.NOTIF_DISMISSED, dismissed ? 'true' : 'false');
  } catch (e) {
    console.warn('Failed to save notification dismissed state:', e);
  }
}

export async function loadTripPulseEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(KEYS.TRIP_PULSE_ENABLED);
    return val !== 'false'; // default true
  } catch {
    return true;
  }
}

export async function saveTripPulseEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.TRIP_PULSE_ENABLED, enabled ? 'true' : 'false');
  } catch (e) {
    console.warn('Failed to save trip pulse setting:', e);
  }
}

export async function loadLearningEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(KEYS.LEARNING_ENABLED);
    return val !== 'false'; // default true
  } catch {
    return true;
  }
}

export async function saveLearningEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.LEARNING_ENABLED, enabled ? 'true' : 'false');
  } catch (e) {
    console.warn('Failed to save learning enabled setting:', e);
  }
}

export async function loadSeenPulse(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SEEN_PULSE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveSeenPulse(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.SEEN_PULSE, JSON.stringify(ids));
  } catch (e) {
    console.warn('Failed to save seen pulse:', e);
  }
}

// Pulse history: per-trip issue lifecycle tracking with occurrence model
export interface PulseHistoryEntry {
  /** Unique ID for this occurrence (not the logical alert ID) */
  occurrenceId: string;
  /** Logical alert identity from the pulse engine (e.g. "conflict-1-act1-act2") */
  alertId: string;
  tripId: string;
  status: 'new' | 'seen' | 'resolved';
  createdAt: string;
  seenAt?: string;
  resolvedAt?: string;
  /** Whether a notification was successfully scheduled for this occurrence */
  notified?: boolean;
  title?: string;
  message?: string;
  alertType?: string;
  severity?: string;
}

export async function loadPulseHistory(): Promise<PulseHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PULSE_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function savePulseHistory(entries: PulseHistoryEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.PULSE_HISTORY, JSON.stringify(entries));
  } catch (e) {
    console.warn('Failed to save pulse history:', e);
  }
}

// Track which pulse alerts have already triggered a notification (to avoid duplicates)
export async function loadPulseNotified(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PULSE_NOTIFIED);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function savePulseNotified(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.PULSE_NOTIFIED, JSON.stringify(ids));
  } catch (e) {
    console.warn('Failed to save pulse notified:', e);
  }
}

/**
 * All AsyncStorage keys used by Travonal.
 */
export const ALL_STORAGE_KEYS = Object.values(KEYS);

/**
 * Clears ALL persisted Travonal data from AsyncStorage.
 * Call context reset functions separately to clear in-memory state.
 */
export async function resetAllData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(ALL_STORAGE_KEYS);
  } catch (e) {
    console.warn('Failed to reset all data:', e);
  }
}

/**
 * Returns true if the URI starts with the expo-file-system document directory path.
 * These are files owned/copied by the app (vs external temp URIs from the picker).
 */
export function isOwnedMediaUri(uri: string): boolean {
  if (!uri) return false;
  const docDir = Paths.document.uri;
  if (!docDir) return false;
  return uri.startsWith(docDir);
}

/**
 * Deletes a file if it is an owned media URI (inside the document directory).
 * Never throws — errors are silently swallowed.
 */
export async function deleteOwnedMedia(uri: string): Promise<void> {
  try {
    if (isOwnedMediaUri(uri)) {
      const file = new File(uri);
      if (file.exists) {
        file.delete();
      }
    }
  } catch {
    // Silently swallow errors
  }
}
