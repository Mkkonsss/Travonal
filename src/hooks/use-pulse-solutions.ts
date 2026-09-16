/**
 * Hook that watches pulse alerts and automatically fires prepareFixAI()
 * in the background for alerts that have actionable commands.
 *
 * Solutions are cached in-memory and invalidated when the itinerary changes.
 * Max 2 concurrent AI calls, debounced 3s after itinerary changes.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Trip, Activity } from '@/context/trips';
import type { TravelProfile } from '@/context/profile';
import type { TravelMemoryEntry } from '@/context/memory';
import type { PulseAlert } from '@/services/trip-pulse';
import { prepareFixAI } from '@/services/ai';
import { normalizeActivity, generateActivityId } from '@/services/ai-utils';
import { getTripDayCount } from '@/services/itinerary-engine';
import {
  setPreparedSolution,
  getPreparedSolution,
  hasPreparedSolution,
  clearAllSolutions,
  markPreparing,
  clearPreparing,
  isPreparing,
  type PreparedSolution,
} from '@/services/pulse-solution-cache';

const MAX_CONCURRENT = 2;

// Alert types worth preparing a fix for
const FIXABLE_TYPES = new Set([
  'conflict', 'closure', 'weather', 'flight_conflict', 'duplicate',
]);

async function prepareSingleAlert(
  currentTrip: Trip,
  alert: PulseAlert,
  profile: TravelProfile,
  memory: TravelMemoryEntry[],
): Promise<void> {
  try {
    const activeMemory = memory.filter((m) => m.enabled);
    const result = await prepareFixAI({
      trip: currentTrip,
      alert: {
        type: alert.type,
        message: alert.message,
        day: alert.day,
        activityId: alert.activityId,
      },
      profile,
      memory: activeMemory.map((m) => ({ detail: m.detail })),
    });

    const totalDays = getTripDayCount(currentTrip.startDate, currentTrip.endDate);

    // Normalize and stamp IDs
    const normalized = (result.activities ?? [])
      .map((a) => normalizeActivity(a as unknown as Record<string, unknown>, totalDays))
      .filter(Boolean) as (Omit<Activity, 'id'> & { id?: string })[];

    const withIds: Activity[] = normalized.map((a) =>
      a.id ? (a as Activity) : { ...a, id: generateActivityId() },
    );

    const solution: PreparedSolution = {
      activities: withIds,
      summary: result.summary ?? alert.message,
      changes: result.changes ?? [],
    };

    setPreparedSolution(alert.id, solution);
  } catch {
    // Silently fail — the alert will show without a prepared solution
    // and fall back to the existing command-based flow
  }
}

export function usePulseSolutions(
  trip: Trip | undefined,
  alerts: PulseAlert[],
  profile: TravelProfile,
  memory: TravelMemoryEntry[],
) {
  const [solutionVersion, setSolutionVersion] = useState(0);
  const activeCount = useRef(0);
  const lastRevision = useRef<number | undefined>(undefined);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs for use in async functions
  const tripRef = useRef(trip);
  const alertsRef = useRef(alerts);
  const profileRef = useRef(profile);
  const memoryRef = useRef(memory);
  useEffect(() => {
    tripRef.current = trip;
    alertsRef.current = alerts;
    profileRef.current = profile;
    memoryRef.current = memory;
  });

  // Invalidate all solutions when itinerary changes
  const currentRevision = trip?.itineraryRevision ?? 0;
  useEffect(() => {
    if (lastRevision.current !== undefined && lastRevision.current !== currentRevision) {
      clearAllSolutions();
      setSolutionVersion((v) => v + 1);
    }
    lastRevision.current = currentRevision;
  }, [currentRevision]);

  // Prepare solutions for fixable alerts in the background
  useEffect(() => {
    if (!trip || alerts.length === 0) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const currentTrip = tripRef.current;
      if (!currentTrip) return;

      const fixable = alertsRef.current.filter(
        (a) => FIXABLE_TYPES.has(a.type) &&
          a.command &&
          !hasPreparedSolution(a.id) &&
          !isPreparing(a.id),
      );

      for (const alert of fixable) {
        if (activeCount.current >= MAX_CONCURRENT) break;

        activeCount.current++;
        markPreparing(alert.id);

        prepareSingleAlert(currentTrip, alert, profileRef.current, memoryRef.current).finally(() => {
          activeCount.current--;
          clearPreparing(alert.id);
          setSolutionVersion((v) => v + 1);
        });
      }
    }, 3000);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.map((a) => a.id).join(','), currentRevision]);

  const getSolution = useCallback((alertId: string): PreparedSolution | undefined => {
    // Reference solutionVersion to trigger re-renders when solutions arrive
    void solutionVersion;
    return getPreparedSolution(alertId);
  }, [solutionVersion]);

  const isPreparingSolution = useCallback((alertId: string): boolean => {
    void solutionVersion;
    return isPreparing(alertId);
  }, [solutionVersion]);

  return { getSolution, isPreparing: isPreparingSolution };
}
