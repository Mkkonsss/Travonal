import { Activity, Trip } from '@/context/trips';
import { TravelProfile } from '@/context/profile';
import { TravelMemoryEntry } from '@/context/memory';
import { checkConflicts, getTripDayCount, timeToMinutes, minutesToTime, isOutdoorActivity } from './itinerary-engine';
import { formatDayLabel } from './trip-helpers';
import type { TripWeatherForecast } from './weather';
import { getWeatherForDay, isBadWeatherDay } from './weather';

export type PulseSeverity = 'urgent' | 'important';

export type PulseAlertType =
  | 'conflict' | 'closure' | 'weather'
  | 'flight_conflict' | 'sunset_mismatch' | 'duplicate';

export interface PulseAlert {
  id: string;
  type: PulseAlertType;
  severity: PulseSeverity;
  title: string;
  message: string;
  day?: number;
  activityId?: string;
  actionLabel: string;
  command?: string;
  preparedSolution?: {
    activities: Activity[];
    summary: string;
  };
}

/** Opening hours data attached to an activity for closure detection. */
export interface ActivityHours {
  activityId: string;
  /** Periods like ["Mon: 9:00-17:00", "Tue: Closed", ...] */
  periods?: string[];
  /** Whether we are confident in this data */
  confident: boolean;
}

function severityForType(type: PulseAlert['type']): PulseSeverity {
  switch (type) {
    case 'conflict':
    case 'closure':
    case 'flight_conflict':
      return 'urgent';
    case 'weather':
    case 'sunset_mismatch':
    case 'duplicate':
    default:
      return 'important';
  }
}

/**
 * Parse opening hours period string to check if open at a given time.
 * Returns: true = open, false = closed, null = can't determine.
 */
function isOpenAtTime(periods: string[], dayOfWeek: number, timeMinutes: number): boolean | null {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayName = dayNames[dayOfWeek];
  if (!dayName) return null;

  const dayPeriod = periods.find((p) => p.startsWith(dayName));
  if (!dayPeriod) return null;

  const lower = dayPeriod.toLowerCase();
  if (lower.includes('closed')) return false;
  if (lower.includes('open 24') || lower.includes('24 hours')) return true;

  // Try to parse "Mon: 9:00-17:00" format
  const match = dayPeriod.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const openMin = parseInt(match[1]) * 60 + parseInt(match[2]);
  const closeMin = parseInt(match[3]) * 60 + parseInt(match[4]);

  // Handle overnight hours (e.g., 22:00-02:00)
  if (closeMin < openMin) {
    return timeMinutes >= openMin || timeMinutes < closeMin;
  }
  return timeMinutes >= openMin && timeMinutes < closeMin;
}

/**
 * Run Trip Pulse evaluation.
 * @param maxAlerts - Maximum alerts to return. Defaults to 5 for display.
 *   Pass `Infinity` for lifecycle evaluation where all active issues must be tracked.
 * @param weatherForecast - Optional weather forecast for weather-aware alerts.
 * @param activityHours - Optional opening hours data for closure detection.
 */
export function runTripPulse(
  trip: Trip,
  profile: TravelProfile,
  memory: TravelMemoryEntry[],
  maxAlerts: number = 5,
  weatherForecast?: TripWeatherForecast | null,
  activityHours?: ActivityHours[],
): PulseAlert[] {
  const alerts: PulseAlert[] = [];
  const totalDays = getTripDayCount(trip.startDate, trip.endDate);
  const totalActivities = trip.activities.length;
  const conflicts = checkConflicts(trip.activities, totalDays);

  // 1. Hard schedule conflicts (only true overlaps — same time or impossible overlap)
  for (const conflict of conflicts) {
    if (conflict.type === 'overlap') {
      alerts.push({
        id: `conflict-${conflict.day}-${conflict.activityIds?.join('-')}`,
        type: 'conflict',
        severity: severityForType('conflict'),
        title: 'Schedule conflict',
        message: conflict.message,
        day: conflict.day,
        actionLabel: 'Fix timing',
        command: 'reflow_day',
      });
    }
  }

  // 2. Closure/hours guard (deterministic detection from structured data)
  if (activityHours && activityHours.length > 0 && trip.datesKnown !== false) {
    for (const hours of activityHours) {
      if (!hours.confident || !hours.periods || hours.periods.length === 0) continue;
      const activity = trip.activities.find((a) => a.id === hours.activityId);
      if (!activity) continue;

      const start = new Date(trip.startDate + 'T00:00:00');
      const actDate = new Date(start);
      actDate.setDate(actDate.getDate() + activity.day - 1);
      const dayOfWeek = actDate.getDay();

      const actTimeMinutes = timeToMinutes(activity.time);
      const openStatus = isOpenAtTime(hours.periods, dayOfWeek, actTimeMinutes);

      if (openStatus === false) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        alerts.push({
          id: `closure-${activity.id}`,
          type: 'closure',
          severity: severityForType('closure'),
          title: 'Possible closure',
          message: `"${activity.title}" appears to be closed on ${dayNames[dayOfWeek]}s at ${activity.time}. Travonal has prepared a fix.`,
          day: activity.day,
          activityId: activity.id,
          actionLabel: 'Review fix',
          command: 'fix_my_day',
        });
      }
    }
  }

  // 3. Weather-aware alerts (from forecast data, never guesses)
  if (weatherForecast && totalActivities > 0 && trip.datesKnown !== false) {
    const dayMap = new Map<number, Activity[]>();
    for (const a of trip.activities) {
      const existing = dayMap.get(a.day) ?? [];
      existing.push(a);
      dayMap.set(a.day, existing);
    }

    for (const [day, dayActivities] of dayMap) {
      const weather = getWeatherForDay(weatherForecast, trip.startDate, day);
      if (!weather || !isBadWeatherDay(weather)) continue;

      const outdoorActivities = dayActivities.filter(isOutdoorActivity);
      if (outdoorActivities.length === 0) continue;

      const outdoorNames = outdoorActivities
        .slice(0, 2)
        .map((a) => `"${a.title}"`)
        .join(' and ');
      const moreCount = outdoorActivities.length > 2 ? ` and ${outdoorActivities.length - 2} more` : '';
      const label = formatDayLabel(day, trip.startDate, trip.datesKnown);

      alerts.push({
        id: `weather-${day}`,
        type: 'weather',
        severity: severityForType('weather'),
        title: `Rain expected on ${label}`,
        message: `${outdoorNames}${moreCount} may be affected. Travonal prepared a rain-friendly version.`,
        day,
        actionLabel: 'Review changes',
        command: 'fix_my_day',
      });
    }
  }

  // 4. Flight/arrival conflicts — activities too close to flight times
  if (totalActivities > 0) {
    const flights = trip.activities.filter((a) => a.type === 'flight');
    const nonFlights = trip.activities.filter((a) => a.type !== 'flight');

    for (const flight of flights) {
      const flightStart = timeToMinutes(flight.time);
      const flightEnd = flightStart + (flight.duration ?? 120);
      const isArrival = /\b(arriv|land|get in)\b/i.test(flight.title);
      const isDeparture = /\b(depart|take.?off|leav|fly out)\b/i.test(flight.title);

      for (const act of nonFlights) {
        if (act.day !== flight.day) continue;
        const actStart = timeToMinutes(act.time);
        const actEnd = actStart + (act.duration ?? 60);

        // Arrival: flag activities that end less than 90 min after flight lands
        // (user still needs to deplane, get luggage, transit to city)
        if (isArrival || !isDeparture) {
          if (actStart < flightEnd + 90 && actEnd > flightStart) {
            const label = formatDayLabel(flight.day, trip.startDate, trip.datesKnown);
            alerts.push({
              id: `flight-arrival-${flight.id}-${act.id}`,
              type: 'flight_conflict',
              severity: severityForType('flight_conflict'),
              title: `Tight after landing on ${label}`,
              message: `"${act.title}" starts at ${act.time}, but "${flight.title}" doesn't land until ${minutesToTime(flightEnd)}. You may need time for luggage and transit.`,
              day: flight.day,
              activityId: act.id,
              actionLabel: 'Fix timing',
              command: 'reflow_day',
            });
          }
        }

        // Departure: flag activities that end less than 120 min before flight
        // (user needs to get to airport, check in, go through security)
        if (isDeparture || !isArrival) {
          if (actEnd > flightStart - 120 && actStart < flightStart) {
            const label = formatDayLabel(flight.day, trip.startDate, trip.datesKnown);
            alerts.push({
              id: `flight-depart-${flight.id}-${act.id}`,
              type: 'flight_conflict',
              severity: severityForType('flight_conflict'),
              title: `Tight before flight on ${label}`,
              message: `"${act.title}" ends around ${minutesToTime(actEnd)}, but "${flight.title}" departs at ${flight.time}. Allow time for airport transit and check-in.`,
              day: flight.day,
              activityId: act.id,
              actionLabel: 'Fix timing',
              command: 'reflow_day',
            });
          }
        }
      }
    }
  }

  // 5. Sunset/sunrise mismatch — activity mentions sunset/sunrise but time is wrong
  if (totalActivities > 0 && trip.datesKnown !== false) {
    const SUNSET_PATTERN = /\b(sunset|sun\s*set|golden\s*hour)\b/i;
    const SUNRISE_PATTERN = /\b(sunrise|sun\s*rise)\b/i;

    for (const activity of trip.activities) {
      const isSunsetActivity = SUNSET_PATTERN.test(activity.title);
      const isSunriseActivity = SUNRISE_PATTERN.test(activity.title);
      if (!isSunsetActivity && !isSunriseActivity) continue;

      const actMinutes = timeToMinutes(activity.time);

      // Approximate sunset/sunrise from date and latitude
      const start = new Date(trip.startDate + 'T00:00:00');
      const actDate = new Date(start);
      actDate.setDate(actDate.getDate() + activity.day - 1);
      const dayOfYear = Math.floor((actDate.getTime() - new Date(actDate.getFullYear(), 0, 0).getTime()) / 86400000);
      const lat = activity.lat ?? 40; // default to mid-latitude if unknown

      // Rough sunset/sunrise estimate using day-of-year and latitude
      // Sunset ranges roughly 17:00-21:00 depending on season and latitude
      // Sunrise ranges roughly 5:00-8:00
      const summerOffset = Math.sin(((dayOfYear - 80) / 365) * 2 * Math.PI);
      const latFactor = (lat / 90) * 1.5; // higher lat = more seasonal variation
      const approxSunsetMinutes = 18.5 * 60 + summerOffset * latFactor * 60; // ~17:00 to ~20:00
      const approxSunriseMinutes = 6.5 * 60 - summerOffset * latFactor * 60; // ~5:00 to ~8:00

      if (isSunsetActivity) {
        // Flag if scheduled more than 2 hours before or 1 hour after estimated sunset
        if (actMinutes < approxSunsetMinutes - 120 || actMinutes > approxSunsetMinutes + 60) {
          const approxTime = minutesToTime(Math.round(approxSunsetMinutes));
          const label = formatDayLabel(activity.day, trip.startDate, trip.datesKnown);
          alerts.push({
            id: `sunset-${activity.id}`,
            type: 'sunset_mismatch',
            severity: severityForType('sunset_mismatch'),
            title: `Sunset timing on ${label}`,
            message: `"${activity.title}" is at ${activity.time}, but sunset is approximately around ${approxTime} that day.`,
            day: activity.day,
            activityId: activity.id,
            actionLabel: 'Adjust time',
            command: 'reflow_day',
          });
        }
      }

      if (isSunriseActivity) {
        if (actMinutes < approxSunriseMinutes - 60 || actMinutes > approxSunriseMinutes + 120) {
          const approxTime = minutesToTime(Math.round(approxSunriseMinutes));
          const label = formatDayLabel(activity.day, trip.startDate, trip.datesKnown);
          alerts.push({
            id: `sunrise-${activity.id}`,
            type: 'sunset_mismatch',
            severity: severityForType('sunset_mismatch'),
            title: `Sunrise timing on ${label}`,
            message: `"${activity.title}" is at ${activity.time}, but sunrise is approximately around ${approxTime} that day.`,
            day: activity.day,
            activityId: activity.id,
            actionLabel: 'Adjust time',
            command: 'reflow_day',
          });
        }
      }
    }
  }

  // 6. Duplicate/redundant activities on the same day
  if (totalActivities > 0) {
    const dayMap = new Map<number, Activity[]>();
    for (const a of trip.activities) {
      const existing = dayMap.get(a.day) ?? [];
      existing.push(a);
      dayMap.set(a.day, existing);
    }

    const flagged = new Set<string>();
    for (const [day, dayActivities] of dayMap) {
      for (let i = 0; i < dayActivities.length; i++) {
        for (let j = i + 1; j < dayActivities.length; j++) {
          const a = dayActivities[i];
          const b = dayActivities[j];
          const pairKey = [a.id, b.id].sort().join('-');
          if (flagged.has(pairKey)) continue;

          const isDuplicate =
            // Exact same title
            a.title.toLowerCase().trim() === b.title.toLowerCase().trim() ||
            // Same placeId (same venue)
            (a.placeId && b.placeId && a.placeId === b.placeId);

          if (isDuplicate) {
            flagged.add(pairKey);
            const label = formatDayLabel(day, trip.startDate, trip.datesKnown);
            alerts.push({
              id: `duplicate-${pairKey}`,
              type: 'duplicate',
              severity: severityForType('duplicate'),
              title: `Duplicate on ${label}`,
              message: `"${a.title}" appears twice on the same day.`,
              day,
              activityId: b.id,
              actionLabel: 'Review',
              command: 'fix_my_day',
            });
          }
        }
      }
    }
  }

  return maxAlerts === Infinity ? alerts : alerts.slice(0, maxAlerts);
}
