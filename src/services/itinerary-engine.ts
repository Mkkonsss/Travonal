import { Activity } from '@/context/trips';

export interface ConflictCheck {
  type: 'overlap' | 'gap_too_short' | 'day_overloaded' | 'empty_day' | 'locked_conflict';
  message: string;
  activityIds?: string[];
  day?: number;
  severity?: 'info' | 'warning' | 'error';
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isLocked(a: Activity): boolean {
  return !!(a.locked || a.fixed);
}

export function checkConflicts(activities: Activity[], totalDays: number): ConflictCheck[] {
  const conflicts: ConflictCheck[] = [];

  const byDay = new Map<number, Activity[]>();
  for (const a of activities) {
    const existing = byDay.get(a.day) ?? [];
    existing.push(a);
    byDay.set(a.day, existing);
  }

  for (const [day, dayActivities] of byDay) {
    const sorted = [...dayActivities].sort((a, b) => a.time.localeCompare(b.time));

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const currentEnd = timeToMinutes(current.time) + (current.duration ?? 60);
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

    if (dayActivities.length > 6) {
      conflicts.push({
        type: 'day_overloaded',
        message: `Day ${day} has ${dayActivities.length} activities`,
        day,
        severity: 'warning',
      });
    }
  }

  for (let d = 1; d <= totalDays; d++) {
    const dayActs = byDay.get(d) ?? [];
    if (dayActs.length === 0) {
      conflicts.push({
        type: 'empty_day',
        message: `Day ${d} has no activities planned`,
        day: d,
        severity: 'info',
      });
    } else if (dayActs.length >= 3) {
      // Check for missing meals
      const hasMeal = dayActs.some((a) => a.type === 'food');
      if (!hasMeal) {
        conflicts.push({
          type: 'gap_too_short',
          message: `Day ${d} has ${dayActs.length} activities but no meal planned`,
          day: d,
          severity: 'info',
        });
      }
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
    .sort((a, b) => a.time.localeCompare(b.time));
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

  return [...otherActivities, ...result.sort((a, b) => a.time.localeCompare(b.time))];
}

export function getTripDayCount(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const s = Date.UTC(sy, sm - 1, sd);
  const e = Date.UTC(ey, em - 1, ed);
  return Math.round((e - s) / 86400000) + 1;
}

export function generateId(): string {
  return String(Date.now()) + String(Math.floor(Math.random() * 1000));
}

/**
 * Get the plan health status for a trip.
 */
export function getPlanHealth(activities: Activity[], totalDays: number): {
  status: 'healthy' | 'issues' | 'checking';
  label: string;
  issueCount: number;
} {
  const conflicts = checkConflicts(activities, totalDays);
  const errors = conflicts.filter((c) => c.severity === 'error');
  const warnings = conflicts.filter((c) => c.severity === 'warning');

  if (errors.length > 0) {
    const total = errors.length + warnings.length;
    return {
      status: 'issues',
      label: `${total} ${total === 1 ? 'issue' : 'issues'}`,
      issueCount: total,
    };
  }
  if (warnings.length > 0) {
    return {
      status: 'issues',
      label: `${warnings.length} ${warnings.length === 1 ? 'issue' : 'issues'}`,
      issueCount: warnings.length,
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
    } else if (proposed.time !== a.time || proposed.day !== a.day || proposed.title !== a.title) {
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
