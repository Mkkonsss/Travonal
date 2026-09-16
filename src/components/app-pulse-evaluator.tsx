import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useTrips, Trip } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useMemory } from '@/context/memory';
import { useTripPulse, shouldRunTripPulse } from '@/context/trip-pulse';
import { usePulseHistory } from '@/context/pulse-history';
import { runTripPulse } from '@/services/trip-pulse';
import { fetchWeatherForecast, TripWeatherForecast } from '@/services/weather';
import {
  scheduleLocalNotification,
  onPermissionChange,
} from '@/services/notifications';

function isUpcomingOrActive(trip: Trip): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(trip.endDate + 'T00:00:00');
  return now <= end && trip.activities.length > 0;
}

/**
 * Full-fidelity fingerprint of all inputs consumed by runTripPulse().
 * Changes whenever any input that could affect pulse evaluation changes.
 *
 * Exported for testing — do NOT copy this logic into tests; import it.
 */
export function pulseInputFingerprint(
  trips: Trip[],
  _profile: { pace: string; dislikes: string[] },
): string {
  let hash = '';
  for (const t of trips) {
    hash += `${t.id}|${t.startDate}|${t.endDate}|${t.itineraryRevision ?? 0}|`;
    for (const a of t.activities) {
      hash += `${a.id},${a.day},${a.time},${a.duration ?? 0},${a.type};`;
    }
    hash += '|';
  }
  return hash;
}

/**
 * App-level Trip Pulse evaluator.
 * Runs pulse checks across all upcoming/active trips and manages the
 * occurrence-based lifecycle via the centralized PulseHistoryContext.
 *
 * Uses uncapped evaluation (Infinity) for lifecycle resolution so alerts
 * beyond the top-5 display limit are not falsely auto-resolved.
 *
 * Renders nothing — this is a side-effect-only component.
 */
export function AppPulseEvaluator() {
  const { trips, loaded: tripsLoaded } = useTrips();
  const { profile } = useProfile();
  const { entries: memoryEntries } = useMemory();
  const { enabled: pulseEnabled, loaded: pulseLoaded } = useTripPulse();
  const pulseHistory = usePulseHistory();

  // Track permission version to re-evaluate when permission is granted
  const [permVersion, setPermVersion] = useState(0);

  // Refs to keep latest state available to the AppState listener
  const tripsRef = useRef(trips);
  const profileRef = useRef(profile);
  const memoryRef = useRef(memoryEntries);
  const pulseEnabledRef = useRef(pulseEnabled);
  const pulseLoadedRef = useRef(pulseLoaded);
  const pulseHistoryRef = useRef(pulseHistory);

  useEffect(() => {
    tripsRef.current = trips;
    profileRef.current = profile;
    memoryRef.current = memoryEntries;
    pulseEnabledRef.current = pulseEnabled;
    pulseLoadedRef.current = pulseLoaded;
    pulseHistoryRef.current = pulseHistory;
  });

  // Subscribe to notification permission changes
  useEffect(() => {
    return onPermissionChange(() => {
      setPermVersion((v) => v + 1);
    });
  }, []);

  // Full-fidelity fingerprint — changes when ANY pulse-relevant input changes
  const fingerprint = pulseInputFingerprint(trips, profile);

  async function evaluateNow() {
    const currentTrips = tripsRef.current;
    const currentProfile = profileRef.current;
    const currentMemory = memoryRef.current;
    const history = pulseHistoryRef.current;

    const relevantTrips = currentTrips.filter(isUpcomingOrActive);

    for (const trip of relevantTrips) {
      // Fetch weather forecast if any activity has coordinates
      let weatherForecast: TripWeatherForecast | null = null;
      const actWithCoords = trip.activities.find((a) => a.lat != null && a.lng != null);
      if (actWithCoords && actWithCoords.lat != null && actWithCoords.lng != null) {
        weatherForecast = await fetchWeatherForecast(
          actWithCoords.lat,
          actWithCoords.lng,
          trip.startDate,
          trip.endDate,
        );
      }

      // Use Infinity to get ALL alerts — lifecycle must not be limited by display cap
      const alerts = runTripPulse(trip, currentProfile, currentMemory, Infinity, weatherForecast);
      const activeAlertIds = new Set<string>();

      for (const alert of alerts) {
        activeAlertIds.add(alert.id);

        // Record or update the occurrence in centralized history
        const occurrenceId = history.recordAlert(trip.id, alert.id, {
          title: alert.title,
          message: alert.message,
          alertType: alert.type,
          severity: alert.severity,
        });

        // Schedule notification for urgent alerts whose occurrence hasn't been notified
        if (alert.severity === 'urgent' && !history.isOccurrenceNotified(trip.id, alert.id)) {
          const scheduled = await scheduleLocalNotification(
            `Trip Alerts: ${trip.destination}`,
            alert.message,
            { tripId: trip.id, alertId: alert.id },
          );
          if (scheduled) {
            history.markNotified(occurrenceId);
          }
        }
      }

      // Auto-resolve: alerts no longer generated → resolve their active occurrences
      // This uses the FULL alert set (uncapped), so issue #6 beyond display limit is not falsely resolved
      history.autoResolve(trip.id, activeAlertIds);
    }
  }

  // Evaluate when data is ready or inputs change
  useEffect(() => {
    if (!tripsLoaded || !pulseHistory.loaded || !shouldRunTripPulse(pulseLoadedRef.current, pulseEnabledRef.current)) return;
    evaluateNow();
  }, [tripsLoaded, pulseHistory.loaded, pulseLoaded, pulseEnabled, fingerprint, permVersion]);

  // AppState foreground listener — uses refs for current data
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && pulseHistoryRef.current.loaded && shouldRunTripPulse(pulseLoadedRef.current, pulseEnabledRef.current)) {
        evaluateNow();
      }
    });
    return () => subscription.remove();
  }, []);

  return null;
}
