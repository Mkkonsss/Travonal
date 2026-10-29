/**
 * Discovery tracking — persists seen/dismissed places and interaction history.
 *
 * In-memory Sets for fast synchronous lookups, with debounced AsyncStorage persistence.
 * Caps: 5,000 seen places (evicts oldest 1,000), 2,000 interactions.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Storage keys ──

const SEEN_KEY = '@travonal/discovery_seen';
const DISMISSED_KEY = '@travonal/discovery_dismissed';
const INTERACTIONS_KEY = '@travonal/discovery_interactions';

// ── Types ──

export type InteractionAction = 'save' | 'add_to_trip' | 'view_detail' | 'skip' | 'dismiss';

interface InteractionRecord {
  placeId: string;
  action: InteractionAction;
  category?: string;
  ts: number;
}

export interface CategoryPreferences {
  [category: string]: number;
}

// ── In-memory state ──

let seenSet = new Set<string>();
let dismissedSet = new Set<string>();
let interactions: InteractionRecord[] = [];
let loaded = false;

// ── Debounced persistence ──

let seenTimer: ReturnType<typeof setTimeout> | null = null;
let dismissedTimer: ReturnType<typeof setTimeout> | null = null;
let interactionsTimer: ReturnType<typeof setTimeout> | null = null;

function persistSeen(): void {
  if (seenTimer) clearTimeout(seenTimer);
  seenTimer = setTimeout(async () => {
    try {
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seenSet]));
    } catch { /* non-critical */ }
  }, 500);
}

function persistDismissed(): void {
  if (dismissedTimer) clearTimeout(dismissedTimer);
  dismissedTimer = setTimeout(async () => {
    try {
      await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedSet]));
    } catch { /* non-critical */ }
  }, 500);
}

function persistInteractions(): void {
  if (interactionsTimer) clearTimeout(interactionsTimer);
  interactionsTimer = setTimeout(async () => {
    try {
      await AsyncStorage.setItem(INTERACTIONS_KEY, JSON.stringify(interactions));
    } catch { /* non-critical */ }
  }, 500);
}

// ── Public API ──

/** Load all tracking data from AsyncStorage. Call once at app start. */
export async function loadTrackingData(): Promise<void> {
  if (loaded) return;
  try {
    const [seenRaw, dismissedRaw, interactionsRaw] = await Promise.all([
      AsyncStorage.getItem(SEEN_KEY),
      AsyncStorage.getItem(DISMISSED_KEY),
      AsyncStorage.getItem(INTERACTIONS_KEY),
    ]);

    if (seenRaw) {
      const arr: string[] = JSON.parse(seenRaw);
      seenSet = new Set(arr);
    }
    if (dismissedRaw) {
      const arr: string[] = JSON.parse(dismissedRaw);
      dismissedSet = new Set(arr);
    }
    if (interactionsRaw) {
      interactions = JSON.parse(interactionsRaw);
    }
  } catch {
    // Start fresh if corrupted
  }
  loaded = true;
}

/** Mark places as seen (batch). Caps at 5,000 — evicts oldest 1,000 when exceeded. */
export function markSeen(placeIds: string[]): void {
  for (const id of placeIds) {
    seenSet.add(id);
  }
  // Cap at 5,000
  if (seenSet.size > 5000) {
    const arr = [...seenSet];
    seenSet = new Set(arr.slice(arr.length - 4000));
  }
  persistSeen();
}

/** Mark a place as dismissed ("Not for me"). Never shown again. */
export function markDismissed(placeId: string): void {
  dismissedSet.add(placeId);
  persistDismissed();
}

/** Record a user interaction for implicit preference learning. */
export function recordInteraction(
  placeId: string,
  action: InteractionAction,
  category?: string,
): void {
  interactions.push({ placeId, action, category, ts: Date.now() });
  // Cap at 2,000
  if (interactions.length > 2000) {
    interactions = interactions.slice(-1500);
  }
  persistInteractions();
}

/** Fast synchronous check — is this place already seen or dismissed? */
export function isSeenOrDismissed(placeId: string): boolean {
  return seenSet.has(placeId) || dismissedSet.has(placeId);
}

/**
 * Analyze interaction history to compute category affinity scores.
 * Positive actions (save, add_to_trip, view_detail) boost the category.
 * Negative actions (dismiss) penalize it.
 */
export function getImplicitPreferences(): CategoryPreferences {
  const prefs: CategoryPreferences = {};

  const WEIGHTS: Record<InteractionAction, number> = {
    save: 3,
    add_to_trip: 5,
    view_detail: 1,
    skip: 0,
    dismiss: -2,
  };

  for (const record of interactions) {
    if (!record.category) continue;
    const weight = WEIGHTS[record.action] ?? 0;
    prefs[record.category] = (prefs[record.category] ?? 0) + weight;
  }

  return prefs;
}

/** Get count of seen places (for debugging/display). */
export function getSeenCount(): number {
  return seenSet.size;
}
