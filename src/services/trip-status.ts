/**
 * Trip status lifecycle — pure functions for determining where we are
 * in a trip's timeline. No React, no side effects.
 */

import type { Trip, Activity } from '@/context/trips';
import { timeToMinutes, compareByTime } from './itinerary-engine';

/**
 * Get the current date and time in the destination's timezone.
 * Falls back to device-local time if timezone is not available.
 */
export function getDestinationNow(timezone?: string): { dateStr: string; timeStr: string } {
  try {
    if (timezone) {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
      const timeStr = `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}`;
      return { dateStr, timeStr };
    }
  } catch {
    // Timezone not recognized — fall through to device time
  }
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return { dateStr: `${y}-${mo}-${d}`, timeStr: `${h}:${mi}` };
}

/**
 * Get which day of the trip today is (1-indexed).
 * Returns 0 if the trip hasn't started, or totalDays+1 if it's over.
 */
export function getTripDayNumber(startDate: string, endDate: string, timezone?: string): number {
  const { dateStr } = getDestinationNow(timezone);
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [dy, dm, dd] = dateStr.split('-').map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const todayUtc = Date.UTC(dy, dm - 1, dd);
  const dayNumber = Math.round((todayUtc - startUtc) / 86400000) + 1;

  const [ey, em, ed] = endDate.split('-').map(Number);
  const endUtc = Date.UTC(ey, em - 1, ed);
  const totalDays = Math.round((endUtc - startUtc) / 86400000) + 1;

  if (dayNumber < 1) return 0;
  if (dayNumber > totalDays) return totalDays + 1;
  return dayNumber;
}

/**
 * Check if a trip is currently active (today is within start/end dates).
 */
export function isTripActive(trip: Trip, timezone?: string): boolean {
  if (trip.datesKnown === false) return false;
  const dayNumber = getTripDayNumber(trip.startDate, trip.endDate, timezone);
  const [sy, sm, sd] = trip.startDate.split('-').map(Number);
  const [ey, em, ed] = trip.endDate.split('-').map(Number);
  const totalDays = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
  return dayNumber >= 1 && dayNumber <= totalDays;
}

/**
 * Check whether a specific trip day is in the past.
 */
export function isDayComplete(startDate: string, dayNumber: number, timezone?: string): boolean {
  const { dateStr } = getDestinationNow(timezone);
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const dayDate = new Date(Date.UTC(sy, sm - 1, sd));
  dayDate.setUTCDate(dayDate.getUTCDate() + dayNumber - 1);
  const dayStr = dayDate.toISOString().split('T')[0];
  return dateStr > dayStr;
}

/**
 * Get today's activities sorted by time.
 */
export function getActiveDayActivities(trip: Trip, timezone?: string): Activity[] {
  const dayNumber = getTripDayNumber(trip.startDate, trip.endDate, timezone);
  if (dayNumber < 1) return [];
  return trip.activities
    .filter((a) => a.day === dayNumber)
    .sort(compareByTime);
}

export interface NowPosition {
  currentDay: number;
  currentTime: string;
  pastActivities: Activity[];
  currentActivity: Activity | null;
  upcomingActivities: Activity[];
}

/**
 * Determine where "now" falls in today's schedule.
 * - pastActivities: activities whose end time (time + duration) has passed
 * - currentActivity: activity that is happening right now (started but not ended)
 * - upcomingActivities: activities that haven't started yet
 */
export function getNowPosition(trip: Trip, timezone?: string): NowPosition {
  const { timeStr } = getDestinationNow(timezone);
  const dayNumber = getTripDayNumber(trip.startDate, trip.endDate, timezone);
  const nowMinutes = timeToMinutes(timeStr);

  const dayActivities = trip.activities
    .filter((a) => a.day === dayNumber)
    .sort(compareByTime);

  const past: Activity[] = [];
  let current: Activity | null = null;
  const upcoming: Activity[] = [];

  for (const a of dayActivities) {
    const startMin = timeToMinutes(a.time);
    const endMin = startMin + (a.duration ?? 60);

    if (endMin <= nowMinutes) {
      past.push(a);
    } else if (startMin <= nowMinutes && endMin > nowMinutes) {
      current = a;
    } else {
      upcoming.push(a);
    }
  }

  return { currentDay: dayNumber, currentTime: timeStr, pastActivities: past, currentActivity: current, upcomingActivities: upcoming };
}

/**
 * Get remaining outdoor activities for the current day (after current time).
 */
export function getRemainingOutdoorActivities(
  trip: Trip,
  isOutdoor: (a: Activity) => boolean,
  timezone?: string,
): Activity[] {
  const { upcomingActivities, currentActivity } = getNowPosition(trip, timezone);
  const remaining = currentActivity ? [currentActivity, ...upcomingActivities] : upcomingActivities;
  return remaining.filter(isOutdoor);
}
