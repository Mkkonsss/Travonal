/**
 * Pure functions for pulse history state transitions.
 * Used by the PulseHistoryContext provider. Exported for testing.
 */
import { PulseHistoryEntry } from '@/services/storage';

let idCounter = 0;
export function generateOccurrenceId(): string {
  return `occ-${Date.now()}-${++idCounter}`;
}

/** Reset the counter (for testing determinism). */
export function resetIdCounter(): void {
  idCounter = 0;
}

export interface AlertMeta {
  title: string;
  message: string;
  alertType: string;
  severity: string;
}

const MAX_HISTORY = 300;

/**
 * Record an alert occurrence. If an active (non-resolved) occurrence already exists
 * for this (tripId, alertId) pair, update its metadata. Otherwise create a new occurrence.
 * Returns [updatedEntries, occurrenceId].
 */
export function recordAlert(
  entries: PulseHistoryEntry[],
  tripId: string,
  alertId: string,
  meta: AlertMeta,
): [PulseHistoryEntry[], string] {
  const activeIdx = entries.findIndex(
    (e) => e.tripId === tripId && e.alertId === alertId && e.status !== 'resolved'
  );
  if (activeIdx >= 0) {
    const updated = [...entries];
    updated[activeIdx] = { ...updated[activeIdx], ...meta };
    return [updated, updated[activeIdx].occurrenceId];
  }
  const occurrenceId = generateOccurrenceId();
  const newEntry: PulseHistoryEntry = {
    occurrenceId,
    alertId,
    tripId,
    status: 'new',
    createdAt: new Date().toISOString(),
    ...meta,
  };
  const next = [...entries, newEntry];
  return [next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next, occurrenceId];
}

/**
 * Mark active occurrences as "seen" for the given trip and alert IDs.
 * Returns updated entries (or the same array if nothing changed).
 */
export function markSeen(
  entries: PulseHistoryEntry[],
  tripId: string,
  activeAlertIds: string[],
): PulseHistoryEntry[] {
  const idSet = new Set(activeAlertIds);
  let changed = false;
  const now = new Date().toISOString();
  const updated = entries.map((e) => {
    if (e.tripId === tripId && e.status === 'new' && idSet.has(e.alertId)) {
      changed = true;
      return { ...e, status: 'seen' as const, seenAt: now };
    }
    return e;
  });
  return changed ? updated : entries;
}

/**
 * Resolve the active occurrence for a given (tripId, alertId) pair.
 * Returns updated entries (or the same array if nothing changed).
 */
export function resolveAlert(
  entries: PulseHistoryEntry[],
  tripId: string,
  alertId: string,
): PulseHistoryEntry[] {
  const now = new Date().toISOString();
  let changed = false;
  const updated = entries.map((e) => {
    if (e.tripId === tripId && e.alertId === alertId && e.status !== 'resolved') {
      changed = true;
      return { ...e, status: 'resolved' as const, resolvedAt: now };
    }
    return e;
  });
  return changed ? updated : entries;
}

/**
 * Auto-resolve occurrences for alerts no longer in the active set.
 * Uses the FULL active alert set (not display-capped) to avoid false resolution.
 * Returns updated entries (or the same array if nothing changed).
 */
export function autoResolve(
  entries: PulseHistoryEntry[],
  tripId: string,
  activeAlertIds: Set<string>,
): PulseHistoryEntry[] {
  const now = new Date().toISOString();
  let changed = false;
  const updated = entries.map((e) => {
    if (e.tripId === tripId && e.status !== 'resolved' && !activeAlertIds.has(e.alertId)) {
      changed = true;
      return { ...e, status: 'resolved' as const, resolvedAt: now };
    }
    return e;
  });
  return changed ? updated : entries;
}

/**
 * Mark a specific occurrence as notified.
 * Returns updated entries (or the same array if nothing changed).
 */
export function markNotified(
  entries: PulseHistoryEntry[],
  occurrenceId: string,
): PulseHistoryEntry[] {
  const idx = entries.findIndex((e) => e.occurrenceId === occurrenceId);
  if (idx < 0 || entries[idx].notified) return entries;
  const updated = [...entries];
  updated[idx] = { ...updated[idx], notified: true };
  return updated;
}

/**
 * Check if the active occurrence for a logical alert has been notified.
 */
export function isOccurrenceNotified(
  entries: PulseHistoryEntry[],
  tripId: string,
  alertId: string,
): boolean {
  const active = entries.find(
    (e) => e.tripId === tripId && e.alertId === alertId && e.status !== 'resolved'
  );
  return !!active?.notified;
}

/**
 * Get resolved entries for a specific trip.
 */
export function getResolvedForTrip(
  entries: PulseHistoryEntry[],
  tripId: string,
): PulseHistoryEntry[] {
  return entries.filter((e) => e.tripId === tripId && e.status === 'resolved');
}

/**
 * Get the active (non-resolved) occurrence for a logical alert.
 */
export function getActiveOccurrence(
  entries: PulseHistoryEntry[],
  tripId: string,
  alertId: string,
): PulseHistoryEntry | undefined {
  return entries.find(
    (e) => e.tripId === tripId && e.alertId === alertId && e.status !== 'resolved'
  );
}
