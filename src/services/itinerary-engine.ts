import { Activity } from '@/context/trips';

export interface ConflictCheck {
  type: 'overlap' | 'locked_conflict';
  message: string;
  activityIds?: string[];
  day?: number;
  severity?: 'info' | 'warning' | 'error';
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Numeric time comparison for sorting activities — robust against non-padded times like "4:30". */
export function compareByTime(a: { time: string }, b: { time: string }): number {
  return timeToMinutes(a.time) - timeToMinutes(b.time);
}

export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isLocked(a: Activity): boolean {
  return !!(a.locked || a.fixed);
}

export function checkConflicts(activities: Activity[], _totalDays: number): ConflictCheck[] {
  const conflicts: ConflictCheck[] = [];

  const byDay = new Map<number, Activity[]>();
  for (const a of activities) {
    const existing = byDay.get(a.day) ?? [];
    existing.push(a);
    byDay.set(a.day, existing);
  }

  for (const [day, dayActivities] of byDay) {
    const sorted = [...dayActivities].sort(compareByTime);

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      // Hard overlap: only flag when both activities have explicit durations,
      // or when they start at the exact same time.
      const sameStart = current.time === next.time;
      const bothHaveDuration = current.duration != null && next.duration != null;

      if (sameStart) {
        conflicts.push({
          type: 'overlap',
          message: `"${current.title}" and "${next.title}" are both at ${current.time} on Day ${day}`,
          activityIds: [current.id, next.id],
          day,
          severity: 'error',
        });
      } else if (bothHaveDuration) {
        const currentEnd = timeToMinutes(current.time) + current.duration!;
        const nextStart = timeToMinutes(next.time);
        if (currentEnd > nextStart) {
          conflicts.push({
            type: 'overlap',
            message: `"${current.title}" and "${next.title}" overlap on Day ${day}`,
            activityIds: [current.id, next.id],
            day,
            severity: 'error',
          });
        }
      }
      // If only one activity has a duration, don't flag — the user hasn't
      // specified how long the other takes, so we can't know if it's a conflict.
    }
  }

  return conflicts;
}

/**
 * Lock-aware reflow: adjusts times but preserves locked/fixed activity positions.
 */
export function reflowDay(activities: Activity[], day: number, startTime: string = '09:00'): Activity[] {
  const dayActivities = activities
    .filter((a) => a.day === day)
    .sort(compareByTime);
  const otherActivities = activities.filter((a) => a.day !== day);

  // Fixed/locked activities keep their times
  const fixed = dayActivities.filter(isLocked);
  const flexible = dayActivities.filter((a) => !isLocked(a));

  // Build timeline: place fixed activities first, then fill in flexible ones around them
  const fixedSlots = fixed.map((a) => ({
    start: timeToMinutes(a.time),
    end: timeToMinutes(a.time) + (a.duration ?? 60),
    activity: a,
  }));

  const result: Activity[] = [...fixed]; // fixed stay as-is
  let currentTime = timeToMinutes(startTime);

  for (const flexAct of flexible) {
    // Find next available slot that doesn't overlap with fixed activities
    let slotOk = false;
    while (!slotOk && currentTime < 22 * 60) {
      const proposedEnd = currentTime + (flexAct.duration ?? 60);
      slotOk = !fixedSlots.some(
        (f) => currentTime < f.end && proposedEnd > f.start
      );
      if (!slotOk) {
        // Jump past the conflicting fixed activity
        const conflicting = fixedSlots.find(
          (f) => currentTime < f.end && proposedEnd > f.start
        );
        if (conflicting) {
          currentTime = conflicting.end + 30;
        } else {
          currentTime += 30;
        }
      }
    }

    result.push({ ...flexAct, time: minutesToTime(currentTime) });
    currentTime += (flexAct.duration ?? 60) + 30;
  }

  return [...otherActivities, ...result.sort(compareByTime)];
}

/**
 * Push upcoming activities forward by a delay (in minutes).
 * Only shifts activities on the given day that start at or after `fromTime`.
 * Locked/fixed activities are NOT moved. Activities are capped at 23:30.
 */
export function reflowFromTime(
  activities: Activity[],
  day: number,
  fromTime: string,
  delayMinutes: number,
): Activity[] {
  const fromMin = timeToMinutes(fromTime);
  return activities.map((a) => {
    if (a.day !== day) return a;
    if (isLocked(a)) return a;
    const startMin = timeToMinutes(a.time);
    if (startMin < fromMin) return a;
    const newStart = Math.min(startMin + delayMinutes, 23 * 60 + 30);
    return { ...a, time: minutesToTime(newStart) };
  });
}

export function getTripDayCount(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const s = Date.UTC(sy, sm - 1, sd);
  const e = Date.UTC(ey, em - 1, ed);
  return Math.round((e - s) / 86400000) + 1;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return String(Date.now()) + String(Math.floor(Math.random() * 10000));
}

/**
 * Get the plan health status for a trip.
 */
/**
 * Compute straight-line distance between two coordinates using Haversine formula.
 * Returns distance in kilometers.
 */
export function haversineDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Format distance for display. Shows "X.X km" or "X m" for short distances.
 * Does NOT estimate walking/transit time — that requires real routing data.
 */
export function formatDistance(distKm: number): string {
  if (distKm < 0.1) return `${Math.round(distKm * 1000)} m`;
  if (distKm < 1) return `${(distKm * 1000).toFixed(0)} m`;
  return `${distKm.toFixed(1)} km`;
}

/**
 * Suggest the next available time slot on a given day.
 * For food type, prefers meal times. For activities, finds first gap.
 */
export function suggestTimeForActivity(
  existingActivities: Activity[],
  day: number,
  type: Activity['type'],
): string {
  const dayActivities = existingActivities
    .filter((a) => a.day === day)
    .sort(compareByTime);

  // For food, check if meal slots are available
  if (type === 'food') {
    const times = dayActivities.map((a) => timeToMinutes(a.time));
    const hasBreakfast = times.some((t) => t >= 7 * 60 && t < 10 * 60);
    const hasLunch = times.some((t) => t >= 11 * 60 && t < 14 * 60);
    const hasDinner = times.some((t) => t >= 18 * 60 && t < 21 * 60);

    if (!hasLunch) return '12:30';
    if (!hasDinner) return '19:00';
    if (!hasBreakfast) return '08:30';
  }

  // Find first available gap after last activity
  if (dayActivities.length === 0) return '09:00';

  const lastAct = dayActivities[dayActivities.length - 1];
  const lastEnd = timeToMinutes(lastAct.time) + (lastAct.duration ?? 60);
  const nextStart = lastEnd + 30; // 30 min buffer

  if (nextStart >= 22 * 60) return '09:00'; // day full, default to morning
  return minutesToTime(nextStart);
}

// Outdoor activity categories that are affected by rain
const OUTDOOR_CATEGORIES = new Set([
  'nature', 'beach', 'adventure', 'outdoor', 'park', 'hiking',
  'water sports', 'sports', 'garden', 'walking tour',
]);

/** Check if an activity is outdoors (affected by weather). */
export function isOutdoorActivity(a: Activity): boolean {
  if (a.type === 'hotel' || a.type === 'flight' || a.type === 'food') return false;
  const cat = (a.category ?? '').toLowerCase();
  if (OUTDOOR_CATEGORIES.has(cat)) return true;
  const title = a.title.toLowerCase();
  return /\b(beach|park|garden|hike|kayak|surf|snorkel|dive|bike|cycle|trek|walk|tour|outdoor)\b/.test(title);
}

export function getPlanHealth(activities: Activity[], totalDays: number): {
  status: 'healthy' | 'issues' | 'checking';
  label: string;
  issueCount: number;
} {
  const conflicts = checkConflicts(activities, totalDays);

  if (conflicts.length > 0) {
    return {
      status: 'issues',
      label: `${conflicts.length} ${conflicts.length === 1 ? 'conflict' : 'conflicts'}`,
      issueCount: conflicts.length,
    };
  }
  return { status: 'healthy', label: 'Everything fits', issueCount: 0 };
}

/**
 * Compute what a change will affect — used for Universal Change Preview.
 * Separates into five clearly labelled groups: added, removed, modified,
 * unchanged, and protectedLocked.
 */
export interface ModifiedActivity {
  activity: Activity;
  oldTime?: string;
  newTime?: string;
  oldDay?: number;
  newDay?: number;
  oldTitle?: string;
  newTitle?: string;
}

/** Format a human-readable description of what changed for a modified activity. */
export function formatModifiedDescription(mod: ModifiedActivity): string {
  const parts: string[] = [];
  if (mod.oldTime && mod.newTime) parts.push(`${mod.oldTime} \u2192 ${mod.newTime}`);
  if (mod.oldDay != null && mod.newDay != null) parts.push(`Day ${mod.oldDay} \u2192 Day ${mod.newDay}`);
  if (mod.oldTitle && mod.newTitle) parts.push(`"${mod.oldTitle}" \u2192 "${mod.newTitle}"`);
  return parts.length > 0 ? parts.join(', ') : 'modified';
}

export interface ChangePreview {
  added: Activity[];
  removed: Activity[];
  modified: ModifiedActivity[];
  unchanged: Activity[];
  protectedLocked: Activity[];
  /** Kept for backwards compat — union of added + removed + modified activities */
  changing: Activity[];
  /** Kept for backwards compat — alias for unchanged */
  staying: Activity[];
  reason: string;
}

export function computeChangePreview(
  currentActivities: Activity[],
  proposedActivities: Activity[],
  reason: string,
): ChangePreview {
  const currentIds = new Set(currentActivities.map((a) => a.id));

  const added: Activity[] = [];
  const removed: Activity[] = [];
  const modified: ModifiedActivity[] = [];
  const unchanged: Activity[] = [];
  const protectedLocked: Activity[] = [];

  for (const a of currentActivities) {
    if (isLocked(a)) {
      protectedLocked.push(a);
      continue;
    }
    const proposed = proposedActivities.find((p) => p.id === a.id);
    if (!proposed) {
      removed.push(a);
    } else if (proposed.time !== a.time || proposed.day !== a.day || proposed.title !== a.title || proposed.type !== a.type || proposed.duration !== a.duration) {
      modified.push({
        activity: a,
        ...(proposed.time !== a.time ? { oldTime: a.time, newTime: proposed.time } : {}),
        ...(proposed.day !== a.day ? { oldDay: a.day, newDay: proposed.day } : {}),
        ...(proposed.title !== a.title ? { oldTitle: a.title, newTitle: proposed.title } : {}),
      });
    } else {
      unchanged.push(a);
    }
  }

  for (const a of proposedActivities) {
    if (!currentIds.has(a.id)) {
      added.push(a);
    }
  }

  // Backwards-compat fields
  const changing = [...added, ...removed, ...modified.map((m) => m.activity)];
  const staying = unchanged;

  return { added, removed, modified, unchanged, protectedLocked, changing, staying, reason };
}
