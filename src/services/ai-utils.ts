/**
 * Shared AI utility functions for normalizing, merging, deduplicating,
 * and extracting content for AI-related flows.
 */

import type { Activity } from '@/context/trips';
import { haversineDistanceKm } from './itinerary-engine';

// ─── Time Normalization ─────────────────────────────────────────────────────

/** Convert any time string (12-hour AM/PM or 24-hour) to HH:MM 24-hour format. */
export function normalizeTimeTo24(raw: string, fallback = '09:00'): string {
  const s = raw.trim();
  // Already valid 24-hour (e.g. "09:00", "19:30")
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = Math.min(parseInt(m24[1], 10), 23);
    return `${String(h).padStart(2, '0')}:${m24[2]}`;
  }
  // 12-hour with AM/PM (e.g. "7:00 PM", "9:00AM")
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2];
    const pm = m12[3].toUpperCase() === 'PM';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  return fallback;
}

// ─── Normalize Activity ──────────────────────────────────────────────────────

const VALID_TYPES = new Set(['activity', 'food', 'hotel', 'flight']);
const VALID_COSTS = new Set(['free', 'budget', 'moderate', 'premium']);

// ─── ID Generation ───────────────────────────────────────────────────────────

/**
 * Generate a stable, collision-resistant activity ID.
 * Uses crypto.randomUUID() when available for guaranteed uniqueness.
 */
export function generateActivityId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 'act_' + crypto.randomUUID().replace(/-/g, '');
  }
  // fallback for older envs
  return 'act_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 11);
}

// ─── Normalize Activity ──────────────────────────────────────────────────────

/**
 * Normalizes an AI-generated activity, ensuring all required fields
 * have valid values. Preserves `id` if the AI returned one (existing
 * activities keep their IDs; new activities have no id and get one
 * assigned by the caller). Returns null if the activity is
 * unsalvageable (e.g. missing title entirely).
 */
export function normalizeActivity(
  raw: Record<string, unknown>,
  numDays: number,
): (Omit<Activity, 'id'> & { id?: string }) | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;

  let day = typeof raw.day === 'number' ? raw.day : Number(raw.day);
  if (!Number.isFinite(day) || day < 1) day = 1;
  if (day > numDays) day = numDays;

  let time = typeof raw.time === 'string' ? normalizeTimeTo24(raw.time.trim()) : '09:00';

  let type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '';
  if (!VALID_TYPES.has(type)) type = 'activity';

  let cost = typeof raw.cost === 'string' ? raw.cost.trim().toLowerCase() : '';
  if (!VALID_COSTS.has(cost)) cost = 'moderate';

  const description = typeof raw.description === 'string'
    ? raw.description.trim()
    : undefined;

  const duration = typeof raw.duration === 'number' && raw.duration > 0
    ? raw.duration
    : 60;

  const category = typeof raw.category === 'string'
    ? raw.category.trim()
    : undefined;

  // Preserve the id the AI returned (existing activities keep their IDs)
  const rawId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;

  const result: Omit<Activity, 'id'> & { id?: string } = {
    title,
    day,
    time,
    type: type as Activity['type'],
    cost: cost as Activity['cost'],
    duration,
  };
  if (rawId) result.id = rawId;
  if (description) result.description = description;
  if (category) result.category = category;

  // Preserve locked/fixed/requested flags if present
  if (raw.locked) (result as Activity).locked = true;
  if (raw.fixed) (result as Activity).fixed = true;
  if (raw.requested) (result as Activity).requested = true;

  // Preserve Google Places metadata if present
  if (typeof raw.placeId === 'string' && raw.placeId) {
    (result as Activity).placeId = raw.placeId;
  }
  if (typeof raw.address === 'string' && raw.address) {
    (result as Activity).address = raw.address;
  }
  if (typeof raw.lat === 'number' && Number.isFinite(raw.lat)) {
    (result as Activity).lat = raw.lat;
  }
  if (typeof raw.lng === 'number' && Number.isFinite(raw.lng)) {
    (result as Activity).lng = raw.lng;
  }

  return result;
}

// ─── Day-Scoped Merge ────────────────────────────────────────────────────────

/**
 * When AI edits a specific day, merge the returned activities for that day
 * with the activities from other days (which the AI didn't touch).
 */
export function mergeDayScopedActivities(
  allActivities: Activity[],
  aiActivities: Activity[],
  day: number | undefined,
): Activity[] {
  if (day == null) return aiActivities;
  const otherDays = allActivities.filter((a) => a.day !== day);
  return [...otherDays, ...aiActivities];
}

// ─── Fixed Activity Deduplication ────────────────────────────────────────────

/**
 * After AI generation, remove any activities from the AI result that
 * duplicate a fixed/locked activity (matched by title+day+time).
 * Then add the original fixed activities back.
 */
export function deduplicateFixedActivities(
  aiActivities: Omit<Activity, 'id'>[],
  fixedActivities: Activity[],
): (Omit<Activity, 'id'> | Activity)[] {
  if (fixedActivities.length === 0) return aiActivities;

  const fixedKeys = new Set(
    fixedActivities.map((a) =>
      `${a.title.toLowerCase()}|${a.day}|${a.time}`
    ),
  );

  const deduplicated = aiActivities.filter((a) => {
    const key = `${a.title.toLowerCase()}|${a.day}|${a.time}`;
    return !fixedKeys.has(key);
  });

  return [...deduplicated, ...fixedActivities];
}

// ─── Ensure Requested Activities ─────────────────────────────────────────────

/**
 * Ensure all requested (board/inbox) activities appear in the final result.
 * If the AI included them (matched by normalized title), keep the AI's version
 * (it has optimal day/time). If any are missing, inject them with sensible defaults.
 */
export function ensureRequestedActivities(
  aiActivities: (Omit<Activity, 'id'> | Activity)[],
  originalRequested: Activity[],
  numDays: number,
): (Omit<Activity, 'id'> | Activity)[] {
  if (originalRequested.length === 0) return aiActivities;

  const normalize = (s: string) => s.toLowerCase().trim().replace(/['']/g, "'");

  // Build a set of titles already present in the AI output
  const aiTitleSet = new Set(
    aiActivities.map((a) => normalize(a.title)),
  );

  const missing: Activity[] = [];
  for (const req of originalRequested) {
    if (!aiTitleSet.has(normalize(req.title))) {
      missing.push(req);
    }
  }

  if (missing.length === 0) return aiActivities;

  // Mark AI-generated activities that match a requested title so the flag is preserved
  const requestedTitles = new Set(originalRequested.map((a) => normalize(a.title)));
  const result: (Omit<Activity, 'id'> | Activity)[] = aiActivities.map((a) =>
    requestedTitles.has(normalize(a.title)) ? { ...a, requested: true } : a,
  );

  // Inject missing requested items at reasonable times
  for (const item of missing) {
    // Pick best day: prefer day with geographically nearby activities, then fewest total
    let bestDay = 1;

    const countByDay = new Map<number, number>();
    for (let d = 1; d <= numDays; d++) countByDay.set(d, 0);
    for (const a of result) {
      countByDay.set(a.day, (countByDay.get(a.day) ?? 0) + 1);
    }

    if (item.lat && item.lng) {
      // Score each day by how many nearby activities it has
      const dayProximity = new Map<number, number>();
      for (let d = 1; d <= numDays; d++) dayProximity.set(d, 0);
      for (const a of result) {
        if ((a as Activity).lat && (a as Activity).lng) {
          const dist = haversineDistanceKm(
            item.lat, item.lng,
            (a as Activity).lat!, (a as Activity).lng!,
          );
          if (dist < 3) {
            dayProximity.set(a.day, (dayProximity.get(a.day) ?? 0) + 1);
          }
        }
      }
      // Pick day with most nearby activities; break ties by fewest total
      let bestProximity = -1;
      let bestCount = Infinity;
      for (const [d, proximity] of dayProximity) {
        const total = countByDay.get(d) ?? 0;
        if (proximity > bestProximity || (proximity === bestProximity && total < bestCount)) {
          bestProximity = proximity;
          bestCount = total;
          bestDay = d;
        }
      }
    } else {
      // No coordinates — fall back to day with fewest activities
      let minCount = Infinity;
      for (const [d, c] of countByDay) {
        if (c < minCount) { minCount = c; bestDay = d; }
      }
    }

    // Find the first available time slot on that day
    const dayActs = result
      .filter((a) => a.day === bestDay)
      .sort((a, b) => a.time.localeCompare(b.time));

    let insertTime = '10:00';
    if (dayActs.length > 0) {
      const last = dayActs[dayActs.length - 1];
      const lastEndMins = timeToMins(last.time) + ((last as Activity).duration ?? 60) + 30;
      if (lastEndMins < 21 * 60) {
        const h = Math.floor(lastEndMins / 60);
        const m = lastEndMins % 60;
        insertTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }

    result.push({
      ...item,
      day: bestDay,
      time: insertTime,
      requested: true,
    });
  }

  return result;
}

// ─── HTML Text Extraction ────────────────────────────────────────────────────

/**
 * Extract useful plain text from an HTML string for sending to Claude.
 * Pulls title, meta descriptions, og tags, and body text.
 */
export function extractHTMLText(html: string): string {
  const parts: string[] = [];

  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    parts.push('Title: ' + titleMatch[1].trim());
  }

  // Extract meta description
  const metaDesc = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  ) ?? html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i
  );
  if (metaDesc) {
    parts.push('Description: ' + metaDesc[1].trim());
  }

  // Extract og:title
  const ogTitle = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  ) ?? html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i
  );
  if (ogTitle) {
    parts.push('OG Title: ' + ogTitle[1].trim());
  }

  // Extract og:description
  const ogDesc = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
  ) ?? html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i
  );
  if (ogDesc) {
    parts.push('OG Description: ' + ogDesc[1].trim());
  }

  // Extract body text (strip tags, collapse whitespace)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    let bodyText = bodyMatch[1];
    // Remove scripts and styles
    bodyText = bodyText.replace(/<script[\s\S]*?<\/script>/gi, '');
    bodyText = bodyText.replace(/<style[\s\S]*?<\/style>/gi, '');
    // Strip HTML tags
    bodyText = bodyText.replace(/<[^>]+>/g, ' ');
    // Decode basic HTML entities
    bodyText = bodyText
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ');
    // Collapse whitespace
    bodyText = bodyText.replace(/\s+/g, ' ').trim();
    // Truncate to 2000 chars
    if (bodyText.length > 2000) {
      bodyText = bodyText.slice(0, 2000) + '...';
    }
    if (bodyText) {
      parts.push('Content: ' + bodyText);
    }
  }

  return parts.join('\n');
}

// ─── Post-Generation Validation ──────────────────────────────────────────────

export interface ValidationIssue {
  type: 'meal_timing' | 'pace_overload' | 'duplicate_title' | 'overlap' | 'missing_meal';
  severity: 'error' | 'warning';
  day: number;
  message: string;
}

const MEAL_WINDOWS = {
  breakfast: { start: '07:00', end: '09:30' },
  lunch: { start: '12:00', end: '13:30' },
  dinner: { start: '19:00', end: '21:30' },
};

/**
 * Validate AI-generated activities before saving.
 * Returns a list of issues found (warnings and errors).
 */
export function validateGeneratedActivities(
  activities: Activity[],
  numDays: number,
  pace: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // Separate limits for main experiences vs meals
  const maxMainPerDay = pace === 'relaxed' ? 2 : pace === 'active' ? 6 : 4;
  const maxMealsPerDay = 3;

  // Group by day
  const byDay = new Map<number, Activity[]>();
  for (const a of activities) {
    const d = a.day;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(a);
  }

  // Check for duplicate titles
  const allTitles = activities.map((a) => a.title.toLowerCase().trim());
  const seen = new Set<string>();
  for (const title of allTitles) {
    if (seen.has(title)) {
      const a = activities.find((x) => x.title.toLowerCase().trim() === title);
      issues.push({ type: 'duplicate_title', severity: 'error', day: a?.day ?? 0, message: `Duplicate place: "${title}"` });
      break;
    }
    seen.add(title);
  }

  for (const [day, acts] of byDay) {
    const sorted = [...acts].sort((a, b) => a.time.localeCompare(b.time));

    // Pace overload check - count meals and main separately
    // Requested activities (from user's board) are excluded from pace limits
    const meals = acts.filter((a) => a.type === 'food');
    const main = acts.filter((a) => a.type !== 'food');
    const nonRequestedMain = main.filter((a) => !a.requested);
    const nonRequestedMeals = meals.filter((a) => !a.requested);
    if (main.length > maxMainPerDay) {
      // Only a critical error if non-requested activities alone exceed the limit
      const severity = nonRequestedMain.length > maxMainPerDay ? 'error' as const : 'warning' as const;
      issues.push({
        type: 'pace_overload',
        severity,
        day,
        message: `Day ${day}: ${main.length} main activities for ${pace} pace (max ${maxMainPerDay})`,
      });
    }
    if (meals.length > maxMealsPerDay) {
      const severity = nonRequestedMeals.length > maxMealsPerDay ? 'error' as const : 'warning' as const;
      issues.push({
        type: 'pace_overload',
        severity,
        day,
        message: `Day ${day}: ${meals.length} meals (max ${maxMealsPerDay})`,
      });
    }

    // Meal timing check with severity levels
    // Blocking (error): clearly wrong times
    // Warning: slightly off but acceptable
    for (const a of acts) {
      const title = a.title.toLowerCase();
      const isBreakfast = /breakfast|morning meal/.test(title);
      const isLunch = /lunch|midday/.test(title);
      const isDinner = /dinner|supper|evening meal/.test(title);
      if (isBreakfast) {
        if (a.time < '06:00' || a.time > '10:30') {
          // Blocking: clearly wrong breakfast time
          issues.push({ type: 'meal_timing', severity: 'error', day, message: `Day ${day}: Breakfast at ${a.time} (must be 06:00-10:30)` });
        } else if (a.time > '09:30') {
          // Warning: late but acceptable (09:31-10:30)
          issues.push({ type: 'meal_timing', severity: 'warning', day, message: `Day ${day}: Breakfast at ${a.time} is late (ideal 07:00-09:30)` });
        }
      }
      if (isLunch) {
        if (a.time < '11:00' || a.time > '15:00') {
          // Blocking: clearly wrong lunch time
          issues.push({ type: 'meal_timing', severity: 'error', day, message: `Day ${day}: Lunch at ${a.time} (must be 11:00-15:00)` });
        } else if (a.time < '12:00' || a.time > '13:30') {
          // Warning: slightly off (11:00-11:59 or 13:31-15:00)
          issues.push({ type: 'meal_timing', severity: 'warning', day, message: `Day ${day}: Lunch at ${a.time} is slightly off (ideal 12:00-13:30)` });
        }
      }
      if (isDinner) {
        if (a.time < '17:00' || a.time > '23:00') {
          // Blocking: clearly wrong dinner time
          issues.push({ type: 'meal_timing', severity: 'error', day, message: `Day ${day}: Dinner at ${a.time} (must be 17:00-23:00)` });
        } else if (a.time < '19:00') {
          // Warning: early but acceptable (17:00-18:59)
          issues.push({ type: 'meal_timing', severity: 'warning', day, message: `Day ${day}: Dinner at ${a.time} is early (ideal 19:00-21:30)` });
        } else if (a.time > '21:30') {
          // Warning: late but acceptable (21:31-23:00)
          issues.push({ type: 'meal_timing', severity: 'warning', day, message: `Day ${day}: Dinner at ${a.time} is late (ideal 19:00-21:30)` });
        }
      }
    }

    // Overlap check (simple)
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];
      const currEndMins = timeToMins(curr.time) + (curr.duration ?? 60);
      const nextStartMins = timeToMins(next.time);
      if (currEndMins > nextStartMins) {
        issues.push({
          type: 'overlap',
          severity: 'error',
          day,
          message: `Day ${day}: "${curr.title}" overlaps "${next.title}"`,
        });
      }
    }
  }

  return issues;
}

function timeToMins(t: string): number {
  const parts = t.split(':');
  return parseInt(parts[0] ?? '0', 10) * 60 + parseInt(parts[1] ?? '0', 10);
}

// ─── Repair Activities ──────────────────────────────────────────────────────

/**
 * Attempt to repair common validation issues in generated activities.
 * - Removes duplicate titles (keeps first occurrence)
 * - Resolves overlaps (removes shorter/lower-priority activity)
 * - Trims pace overload (keeps meals + fixed, removes extras)
 * Returns repaired activities array.
 */
export function repairActivities(
  activities: Activity[],
  numDays: number,
  pace: string,
): Activity[] {
  let result = [...activities];

  const isProtected = (a: Activity) => Boolean((a as any).locked || (a as any).fixed || (a as any).requested);

  // 0. Fix meal timing errors — snap clearly wrong meal times
  //    Never modify locked or fixed activities.
  result = result.map((a) => {
    if (isProtected(a)) return a;
    const title = a.title.toLowerCase();
    const isBreakfast = /breakfast|morning meal/.test(title);
    const isLunch = /lunch|midday/.test(title);
    const isDinner = /dinner|supper|evening meal/.test(title);
    if (isBreakfast && (a.time < '06:00' || a.time > '10:30')) {
      return { ...a, time: '08:00' };
    }
    if (isLunch && (a.time < '11:00' || a.time > '15:00')) {
      return { ...a, time: '12:30' };
    }
    if (isDinner && (a.time < '17:00' || a.time > '23:00')) {
      return { ...a, time: '19:00' };
    }
    return a;
  });

  // 1. Remove duplicate titles (keep first occurrence)
  //    When a duplicate exists, prefer the protected (locked/fixed/requested) copy.
  const seenTitles = new Map<string, number>(); // title → index in result
  const dupRemove = new Set<number>();
  for (let i = 0; i < result.length; i++) {
    const key = result[i].title.toLowerCase().trim();
    const prev = seenTitles.get(key);
    if (prev !== undefined) {
      // Duplicate found — keep the protected one; if both protected, keep first
      if (isProtected(result[i]) && !isProtected(result[prev])) {
        dupRemove.add(prev);
        seenTitles.set(key, i);
      } else {
        dupRemove.add(i);
      }
    } else {
      seenTitles.set(key, i);
    }
  }
  result = result.filter((_, i) => !dupRemove.has(i));

  // 2. Resolve overlaps per day (remove shorter/lower-priority)
  const byDay = new Map<number, Activity[]>();
  for (const a of result) {
    if (!byDay.has(a.day)) byDay.set(a.day, []);
    byDay.get(a.day)!.push(a);
  }

  const idsToRemove = new Set<string>();

  for (const [, acts] of byDay) {
    const sorted = [...acts].sort((a, b) => a.time.localeCompare(b.time));

    // Resolve overlaps
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];
      if (idsToRemove.has(curr.id)) continue;
      const currEnd = timeToMins(curr.time) + (curr.duration ?? 60);
      const nextStart = timeToMins(next.time);
      if (currEnd > nextStart) {
        const currProtected = curr.locked || curr.fixed || curr.requested;
        const nextProtected = next.locked || next.fixed || next.requested;
        if (currProtected && nextProtected) {
          // Both protected — shift the later one forward to resolve overlap
          const newStartMins = currEnd;
          const h = String(Math.floor(newStartMins / 60)).padStart(2, '0');
          const m = String(newStartMins % 60).padStart(2, '0');
          sorted[i + 1] = { ...next, time: `${h}:${m}` };
          // Update in result array as well
          const idx = result.findIndex((a) => a.id === next.id);
          if (idx !== -1) result[idx] = sorted[i + 1];
        } else if (nextProtected) {
          if (!currProtected) idsToRemove.add(curr.id);
        } else if (currProtected) {
          idsToRemove.add(next.id);
        } else {
          // Remove shorter duration
          const currDur = curr.duration ?? 60;
          const nextDur = next.duration ?? 60;
          idsToRemove.add(currDur <= nextDur ? curr.id : next.id);
        }
      }
    }
  }

  result = result.filter((a) => !idsToRemove.has(a.id));

  // 3. Trim pace overload per day - separate meals from main
  const maxMainPerDay = pace === 'relaxed' ? 2 : pace === 'active' ? 6 : 4;
  const maxMeals = 3;
  const byDay2 = new Map<number, Activity[]>();
  for (const a of result) {
    if (!byDay2.has(a.day)) byDay2.set(a.day, []);
    byDay2.get(a.day)!.push(a);
  }

  const overloadRemove = new Set<string>();
  for (const [, acts] of byDay2) {
    const meals = acts.filter((a) => a.type === 'food');
    const main = acts.filter((a) => a.type !== 'food');

    // Trim excess main activities (keep locked/fixed/requested first)
    if (main.length > maxMainPerDay) {
      const sorted = [...main].sort((a, b) => {
        const aL = (a.locked || a.fixed || a.requested) ? 0 : 1;
        const bL = (b.locked || b.fixed || b.requested) ? 0 : 1;
        if (aL !== bL) return aL - bL;
        return a.time.localeCompare(b.time);
      });
      for (let i = maxMainPerDay; i < sorted.length; i++) {
        if (!sorted[i].locked && !sorted[i].fixed && !sorted[i].requested) {
          overloadRemove.add(sorted[i].id);
        }
      }
    }

    // Trim excess meals (keep locked/fixed/requested first)
    if (meals.length > maxMeals) {
      const sortedM = [...meals].sort((a, b) => {
        const aL = (a.locked || a.fixed || a.requested) ? 0 : 1;
        const bL = (b.locked || b.fixed || b.requested) ? 0 : 1;
        if (aL !== bL) return aL - bL;
        return a.time.localeCompare(b.time);
      });
      for (let i = maxMeals; i < sortedM.length; i++) {
        if (!sortedM[i].locked && !sortedM[i].fixed && !sortedM[i].requested) {
          overloadRemove.add(sortedM[i].id);
        }
      }
    }
  }

  result = result.filter((a) => !overloadRemove.has(a.id));

  return result;
}

// ─── Structured Output Validation ───────────────────────────────────────────

/**
 * Validate structured AI output has required fields.
 * Returns an error message if invalid, null if valid.
 */
export function validateAIOutput(
  data: unknown,
  action: string,
): string | null {
  if (data == null || typeof data !== 'object') {
    return 'AI returned non-object response';
  }

  const obj = data as Record<string, unknown>;

  if (action === 'generate_trip' || action === 'edit_trip') {
    if (!Array.isArray(obj.activities)) {
      return 'Missing activities array in AI response';
    }
    for (let i = 0; i < obj.activities.length; i++) {
      const a = obj.activities[i];
      if (!a || typeof a !== 'object') {
        return 'Activity at index ' + i + ' is not an object';
      }
      const act = a as Record<string, unknown>;
      if (!act.title || typeof act.title !== 'string') {
        return 'Activity at index ' + i + ' missing title';
      }
      if (act.day == null) {
        return 'Activity at index ' + i + ' missing day';
      }
      if (!act.time || typeof act.time !== 'string') {
        return 'Activity at index ' + i + ' missing time';
      }
      if (!act.type || typeof act.type !== 'string') {
        return 'Activity at index ' + i + ' missing type';
      }
    }
    return null;
  }

  if (action === 'chat') {
    if (typeof obj.message !== 'string') {
      return 'Missing message string in chat response';
    }
    if (!Array.isArray(obj.actions)) {
      return 'Missing actions array in chat response';
    }
    return null;
  }

  if (action === 'import_place') {
    if (typeof obj.found !== 'boolean') {
      return 'Missing found boolean in import response';
    }
    if (obj.found === true) {
      if (typeof obj.name !== 'string' || !obj.name) {
        return 'Missing name in import response';
      }
      if (typeof obj.location !== 'string') {
        return 'Missing location in import response';
      }
    }
    return null;
  }

  return null;
}

// Keep MEAL_WINDOWS exported for potential future use
export { MEAL_WINDOWS };
