import { Activity, Trip } from '@/context/trips';
import { TravelProfile } from '@/context/profile';
import { TravelMemoryEntry } from '@/context/memory';
import { getAlternatives, PlaceOption } from './alternatives-pool';
import { checkConflicts, generateId, getTripDayCount, timeToMinutes } from './itinerary-engine';

function isLocked(a: Activity): boolean {
  return !!(a.locked || a.fixed);
}

export interface RepairWarning {
  type: 'locked_conflict' | 'unfillable_day' | 'no_meal_available' | 'time_overflow';
  message: string;
  day?: number;
}

function placeToActivity(place: PlaceOption, day: number, time: string): Activity {
  return {
    id: generateId(),
    title: place.title,
    type: place.type,
    day,
    time,
    duration: place.duration,
    category: place.category,
    cost: place.cost,
    description: place.description,
  };
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface GenerationOptions {
  trip: Trip;
  profile: TravelProfile;
  memory: TravelMemoryEntry[];
  fixedActivities?: Activity[]; // pre-existing fixed reservations
}

/**
 * Check if a food place is compatible with user's dietary restrictions.
 */
function isDietaryCompatible(place: PlaceOption, restrictions: string[]): boolean {
  if (restrictions.length === 0) return true;
  if (!place.dietaryOptions || place.dietaryOptions.length === 0) return true; // assume ok if unknown
  for (const restriction of restrictions) {
    const lower = restriction.toLowerCase();
    if (place.dietaryOptions.some((d) => d.toLowerCase().includes(lower))) return true;
  }
  return restrictions.length === 0;
}

/**
 * Check if a place is suitable for the travel group type.
 */
function isGroupCompatible(place: PlaceOption, travelWith: string): boolean {
  if (travelWith === 'family' && place.familyFriendly === false) return false;
  if (travelWith === 'friends' || travelWith === 'group') {
    if (place.groupFriendly === false) return false;
  }
  return true;
}

/**
 * Meal time windows for scheduling food at appropriate times.
 */
const MEAL_WINDOWS = {
  breakfast: { start: 7 * 60, end: 10 * 60 },
  lunch: { start: 11 * 60 + 30, end: 14 * 60 },
  dinner: { start: 18 * 60, end: 21 * 60 },
};

function getMealSlot(currentMinutes: number): 'breakfast' | 'lunch' | 'dinner' | null {
  if (currentMinutes >= MEAL_WINDOWS.breakfast.start && currentMinutes <= MEAL_WINDOWS.breakfast.end) return 'breakfast';
  if (currentMinutes >= MEAL_WINDOWS.lunch.start && currentMinutes <= MEAL_WINDOWS.lunch.end) return 'lunch';
  if (currentMinutes >= MEAL_WINDOWS.dinner.start && currentMinutes <= MEAL_WINDOWS.dinner.end) return 'dinner';
  return null;
}

/**
 * Generate a believable multi-day itinerary using local place data and user profile.
 * Deterministic: same inputs → same output (no randomness beyond tie-breaking).
 */
export function generateItinerary(options: GenerationOptions): Activity[] {
  const { trip, profile, fixedActivities = [] } = options;
  const totalDays = getTripDayCount(trip.startDate, trip.endDate);
  const pool = getAlternatives(trip.destination);
  const activities: Activity[] = [...fixedActivities];
  const usedTitles = new Set(fixedActivities.map((a) => a.title));
  const travelWith = trip.travelWith ?? profile.travelWith ?? 'solo';
  const dietary = profile.dietaryRestrictions ?? [];

  // Score places by profile fit
  const scoredPlaces = pool
    .filter((p) => !usedTitles.has(p.title))
    .filter((p) => isGroupCompatible(p, travelWith))
    .filter((p) => p.type !== 'food' || isDietaryCompatible(p, dietary))
    .map((place) => {
      let score = 0;
      // Interest match
      for (const interest of (trip.interests ?? profile.interests)) {
        if (place.tags.some((t) => t.toLowerCase().includes(interest.toLowerCase()))) score += 3;
        if (place.category.toLowerCase().includes(interest.toLowerCase())) score += 2;
      }
      // Budget alignment
      const budgetOrder = ['free', 'budget', 'moderate', 'premium'];
      const userBudget = trip.budget ?? profile.budget ?? 'moderate';
      const userIdx = budgetOrder.indexOf(userBudget);
      const placeIdx = budgetOrder.indexOf(place.cost);
      if (placeIdx <= userIdx) score += 2;
      else score -= 2;
      // Pace alignment
      const pace = trip.pace ?? profile.pace;
      if (pace === 'relaxed' && place.energyLevel === 'low') score += 2;
      if (pace === 'active' && place.energyLevel === 'high') score += 2;
      // Crowd preference (from dislikes)
      if (profile.dislikes.includes('Crowds') && place.crowdLevel === 'high') score -= 4;
      // Group bonuses
      if (travelWith === 'family' && place.familyFriendly) score += 2;
      if ((travelWith === 'friends' || travelWith === 'group') && place.groupFriendly) score += 1;
      if (travelWith === 'partner' && place.atmosphere?.some((a) => a.toLowerCase() === 'romantic')) score += 3;
      // Mobility/accessibility — penalise high-energy places when mobility needs exist
      if (profile.mobilityNeeds.length > 0 && place.energyLevel === 'high') score -= 3;
      // Accommodation preference — boost places tagged with matching atmosphere
      if (profile.accommodationPreference === 'resort' && place.atmosphere?.some((a) => /relax|spa|pool/i.test(a))) score += 2;
      if (profile.accommodationPreference === 'boutique' && place.atmosphere?.some((a) => /unique|artisan|hidden/i.test(a))) score += 2;
      return { place, score };
    })
    .sort((a, b) => b.score - a.score);

  // Determine activities per day based on pace and flexibility
  const pace = trip.pace ?? profile.pace;
  const flexibility = profile.flexibility;
  let activitiesPerDay = pace === 'relaxed' ? 3 : pace === 'active' ? 5 : 4;
  // Flexible travelers get fewer scheduled items (more free time)
  if (flexibility === 'freeflow') activitiesPerDay = Math.max(2, activitiesPerDay - 1);
  // Planned travelers get a tighter schedule
  if (flexibility === 'planned') activitiesPerDay = Math.min(6, activitiesPerDay + 1);
  // Mobility needs reduce density
  if (profile.mobilityNeeds.length > 0) activitiesPerDay = Math.max(2, activitiesPerDay - 1);

  // Parse absoluteRules for start-time constraints
  function parseStartHourFromRules(rules: string[], pacePref: string): number {
    const lower = rules.map((r) => r.toLowerCase());
    for (const rule of lower) {
      // "start after N AM/PM"
      const startAfter = rule.match(/start(?:ing)?\s*after\s*(\d+)\s*(am|pm)?/);
      if (startAfter) {
        let h = parseInt(startAfter[1], 10);
        if (startAfter[2] === 'pm' && h !== 12) h += 12;
        return Math.max(6, Math.min(12, h));
      }
      // "never schedule before N AM/PM" or "no activities before N AM/PM"
      const beforeMatch = rule.match(/(?:never|no|don'?t)\s+(?:schedule|start|plan|activities?)\s+before\s+(\d+)\s*(am|pm)?/);
      if (beforeMatch) {
        let h = parseInt(beforeMatch[1], 10);
        if (beforeMatch[2] === 'pm' && h !== 12) h += 12;
        return Math.max(6, Math.min(12, h));
      }
      if (rule.includes('avoid early') || rule.includes('no early')) return 10;
    }
    return pacePref === 'relaxed' ? 10 : pacePref === 'active' ? 8 : 9;
  }
  const startHour = parseStartHourFromRules(profile.absoluteRules ?? [], pace);
  // Extra buffer between activities for mobility needs
  const activityBuffer = profile.mobilityNeeds.length > 0 ? 45 : 30;

  // Separate by type for balanced distribution
  const foodPlaces = scoredPlaces.filter((s) => s.place.type === 'food');
  const activityPlaces = scoredPlaces.filter((s) => s.place.type === 'activity');
  let foodIdx = 0;
  let actIdx = 0;

  for (let day = 1; day <= totalDays; day++) {
    const dayFixed = activities.filter((a) => a.day === day);
    const slotsNeeded = activitiesPerDay - dayFixed.length;
    if (slotsNeeded <= 0) continue;

    const targetSlots = slotsNeeded;

    let currentMinutes = startHour * 60;
    // Track which meals have been scheduled this day
    const mealsScheduled = new Set<string>();
    for (const fixed of dayFixed) {
      if (fixed.type === 'food') {
        const fixedMins = parseInt(fixed.time.split(':')[0]) * 60 + parseInt(fixed.time.split(':')[1]);
        const slot = getMealSlot(fixedMins);
        if (slot) mealsScheduled.add(slot);
      }
    }

    // Skip past fixed activities
    for (const fixed of dayFixed.sort((a, b) => a.time.localeCompare(b.time))) {
      const fixedStart = parseInt(fixed.time.split(':')[0]) * 60 + parseInt(fixed.time.split(':')[1]);
      if (fixedStart + (fixed.duration ?? 60) > currentMinutes) {
        currentMinutes = fixedStart + (fixed.duration ?? 60) + 30;
      }
    }

    let added = 0;
    while (added < targetSlots) {
      if (currentMinutes > 21 * 60) break; // don't schedule past 9pm

      const mealSlot = getMealSlot(currentMinutes);
      const needsMeal = mealSlot && !mealsScheduled.has(mealSlot);

      let place: PlaceOption | undefined;
      if (needsMeal && foodIdx < foodPlaces.length) {
        // Schedule a meal at meal time
        place = foodPlaces[foodIdx++]?.place;
        if (place) mealsScheduled.add(mealSlot!);
      } else if (actIdx < activityPlaces.length) {
        place = activityPlaces[actIdx++]?.place;
      } else if (foodIdx < foodPlaces.length) {
        place = foodPlaces[foodIdx++]?.place;
      }

      if (!place) {
        // Pool exhausted — generate deterministic fallback activity
        const activityFallbacks = [
          'Morning city walk', 'Afternoon park stroll', 'Riverside promenade', 'Old town wander',
          'Viewpoint visit', 'Historic quarter tour', 'Botanical garden', 'Street market browse',
          'Local neighbourhood walk', 'Waterfront promenade', 'Hilltop lookout', 'Cultural district stroll',
          'Seaside walk', 'Park relaxation', 'City centre wander', 'Artisan quarter browse',
          'Lakeside path', 'Evening boulevard walk', 'Craft market visit', 'Scenic overlook',
        ];
        const foodFallbacks = [
          'Local bistro lunch', 'Corner caf\u00E9 stop', 'Neighbourhood restaurant', 'Market food hall',
          'Terrace dining', 'Casual local eatery', 'Wine bar dinner', 'Rooftop caf\u00E9',
          'Street food stall', 'Family-run trattoria', 'Harbour-side seafood', 'Bakery breakfast',
          'Tapas bar evening', 'Night market dinner', 'Courtyard lunch spot', 'Riverside brasserie',
          'Farm-to-table bistro', 'Neighbourhood diner', 'Artisan coffee house', 'Sunset bar snacks',
        ];
        // Determine whether this slot should be food or activity based on position
        const wantFood = added % 2 === 1; // alternate: activity, food, activity, food, activity
        // Tiered fallback: first unique title, then "Title (2)", "Title (3)"… before using day-number suffix
        function pickUnused(pool: string[]): string {
          const direct = pool.find((t) => !usedTitles.has(t));
          if (direct) return direct;
          for (let n = 2; n <= 9; n++) {
            const tiered = pool.find((t) => !usedTitles.has(`${t} (${n})`));
            if (tiered) return `${tiered} (${n})`;
          }
          return pool[0]; // absolute last resort; will get day-suffix if truly duplicate
        }
        const unusedActivity = pickUnused(activityFallbacks);
        const unusedFood = pickUnused(foodFallbacks);
        const fallback = wantFood
          ? { type: 'food' as Activity['type'], title: unusedFood, duration: 45, category: 'food' }
          : { type: 'activity' as Activity['type'], title: unusedActivity, duration: 60, category: 'culture' };
        const uniqueTitle = fallback.title;
        if (!usedTitles.has(uniqueTitle)) {
          fallback.title = uniqueTitle;
          const fallbackActivity: Activity = {
            id: generateId(),
            title: fallback.title,
            type: fallback.type,
            day,
            time: minutesToTime(currentMinutes),
            duration: fallback.duration,
            category: fallback.category,
            cost: 'budget',
          };
          activities.push(fallbackActivity);
          usedTitles.add(fallback.title);
          if (fallback.type === 'food') mealsScheduled.add(getMealSlot(currentMinutes) ?? 'lunch');
          currentMinutes += fallback.duration + 30;
          added++;
        } else {
          // Even the fallback title is used — skip to avoid infinite loop
          currentMinutes += 60;
          added++;
        }
        continue;
      }
      if (usedTitles.has(place.title)) continue;

      // Use bestTime if provided and reasonable
      let time = minutesToTime(currentMinutes);
      if (place.bestTime) {
        const bestMins = parseInt(place.bestTime.split(':')[0]) * 60 + parseInt(place.bestTime.split(':')[1]);
        if (bestMins >= currentMinutes) {
          time = place.bestTime;
          currentMinutes = bestMins;
        }
      }

      const activity = placeToActivity(place, day, time);
      activities.push(activity);
      usedTitles.add(place.title);
      currentMinutes += (place.duration ?? 60) + activityBuffer;
      added++;
    }

    // Ensure lunch is scheduled if we have food places and we're past lunch window without one
    if (!mealsScheduled.has('lunch') && foodIdx < foodPlaces.length) {
      const lunchPlace = foodPlaces[foodIdx++]?.place;
      if (lunchPlace && !usedTitles.has(lunchPlace.title)) {
        const lunchActivity = placeToActivity(lunchPlace, day, '12:30');
        activities.push(lunchActivity);
        usedTitles.add(lunchPlace.title);
        mealsScheduled.add('lunch');
      }
    }

    // Fallback: ensure at least one meal even when pool is exhausted
    if (!mealsScheduled.has('lunch') && !mealsScheduled.has('dinner') && !mealsScheduled.has('breakfast')) {
      const mealFallbacks = [
        'Local bistro lunch', 'Corner caf\u00E9 stop', 'Neighbourhood restaurant', 'Market food hall',
        'Terrace dining', 'Casual local eatery', 'Wine bar dinner', 'Rooftop caf\u00E9',
        'Street food stall', 'Family-run trattoria', 'Harbour-side seafood', 'Bakery breakfast',
        'Tapas bar evening', 'Night market dinner', 'Courtyard lunch spot', 'Riverside brasserie',
        'Farm-to-table bistro', 'Neighbourhood diner', 'Artisan coffee house', 'Sunset bar snacks',
      ];
      const baseMealTitle = mealFallbacks[(day - 1) % mealFallbacks.length];
      const fallbackMealTitle = usedTitles.has(baseMealTitle) ? `${baseMealTitle} (Day ${day})` : baseMealTitle;
      if (!usedTitles.has(fallbackMealTitle)) {
        const mealActivity: Activity = {
          id: generateId(),
          title: fallbackMealTitle,
          type: 'food',
          day,
          time: '12:30',
          duration: 60,
          category: 'food',
          cost: 'budget',
        };
        activities.push(mealActivity);
        usedTitles.add(fallbackMealTitle);
      }
    }

    // Fallback: ensure at least one activity-type entry if none exist
    const dayActsCheck = activities.filter((a) => a.day === day && a.type !== 'food');
    if (dayActsCheck.length === 0) {
      const actFallbacks = [
        'Morning city walk', 'Afternoon park stroll', 'Riverside promenade', 'Old town wander',
        'Viewpoint visit', 'Historic quarter tour', 'Botanical garden', 'Street market browse',
        'Local neighbourhood walk', 'Waterfront promenade', 'Hilltop lookout', 'Cultural district stroll',
        'Seaside walk', 'Park relaxation', 'City centre wander', 'Artisan quarter browse',
        'Lakeside path', 'Evening boulevard walk', 'Craft market visit', 'Scenic overlook',
      ];
      const baseActTitle = actFallbacks[(day - 1) % actFallbacks.length];
      const fallbackActTitle = usedTitles.has(baseActTitle) ? `${baseActTitle} (Day ${day})` : baseActTitle;
      if (!usedTitles.has(fallbackActTitle)) {
        const actFallback: Activity = {
          id: generateId(),
          title: fallbackActTitle,
          type: 'activity',
          day,
          time: '10:00',
          duration: 60,
          category: 'culture',
          cost: 'free',
        };
        activities.push(actFallback);
        usedTitles.add(fallbackActTitle);
      }
    }
  }

  return activities.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
}

/**
 * Validate and repair a generated itinerary.
 * - Locked/fixed activities are never modified
 * - Fills empty days with at least one activity at a conflict-free time
 * - Ensures at least one meal (food) per non-transit day at a conflict-free time
 * - Removes duplicate titles (keeping locked/fixed copies)
 * - Fixes overlapping times by moving only flexible activities
 * - Clamps all times to 23:59 max
 * - Respects dietary restrictions when selecting food places
 * - Runs a final health validation loop (max 3 iterations)
 * - Returns warnings for unavoidable conflicts
 */
export function validateAndRepairItinerary(
  activities: Activity[],
  trip: Trip,
  profile: TravelProfile,
): { activities: Activity[]; warnings: RepairWarning[] } {
  const totalDays = getTripDayCount(trip.startDate, trip.endDate);
  const pool = getAlternatives(trip.destination);
  const dietary = profile.dietaryRestrictions ?? [];
  const warnings: RepairWarning[] = [];
  let result = activities.map((a) => ({ ...a })); // deep-copy each activity

  // --- helpers ---

  /** Clamp minutes to [0, 1439] (i.e. 00:00 – 23:59) */
  function clampMinutes(mins: number): number {
    return Math.max(0, Math.min(mins, 23 * 60 + 59));
  }

  /** Safe minutesToTime that clamps before formatting */
  function safeTime(mins: number): string {
    return minutesToTime(clampMinutes(mins));
  }

  /** Get all activities for a given day, sorted by time */
  function dayActivities(day: number): Activity[] {
    return result.filter((a) => a.day === day).sort((a, b) => a.time.localeCompare(b.time));
  }

  /** Find the first conflict-free slot on a day within [earliest, latest).
   *  Returns the start minute or null if none fits. */
  function findFreeSlot(day: number, durationMins: number, earliest: number, latest: number, excludeId?: string): number | null {
    const acts = dayActivities(day).filter((a) => !excludeId || a.id !== excludeId);
    // Build list of occupied intervals
    const occupied = acts
      .map((a) => ({ start: timeToMinutes(a.time), end: timeToMinutes(a.time) + (a.duration ?? 60) }))
      .sort((a, b) => a.start - b.start);

    let candidate = earliest;
    for (const slot of occupied) {
      if (candidate + durationMins <= slot.start) return candidate; // fits before this occupied block
      if (candidate < slot.end) candidate = slot.end + 15; // skip past + 15-min buffer
    }
    // Try after all occupied blocks
    if (candidate + durationMins <= latest) return candidate;
    return null;
  }

  // --- 1. Remove duplicate titles (keep locked/fixed over flexible) ---
  const titleMap = new Map<string, Activity[]>();
  for (const a of result) {
    const existing = titleMap.get(a.title) ?? [];
    existing.push(a);
    titleMap.set(a.title, existing);
  }
  const idsToRemove = new Set<string>();
  for (const [, group] of titleMap) {
    if (group.length <= 1) continue;
    // Keep all locked ones; if multiple locked share a title, keep them all (they may be on different days)
    const lockedOnes = group.filter(isLocked);
    const flexOnes = group.filter((a) => !isLocked(a));
    if (lockedOnes.length > 0) {
      // Remove all flexible duplicates
      for (const f of flexOnes) idsToRemove.add(f.id);
    } else {
      // No locked ones — keep only the first flexible
      for (let i = 1; i < flexOnes.length; i++) idsToRemove.add(flexOnes[i].id);
    }
  }
  result = result.filter((a) => !idsToRemove.has(a.id));

  // --- 2. Clamp any invalid times ---
  for (const a of result) {
    const mins = timeToMinutes(a.time);
    if (mins > 23 * 60 + 59) {
      if (isLocked(a)) {
        warnings.push({
          type: 'time_overflow',
          message: `Locked activity "${a.title}" has time ${a.time} which exceeds 23:59`,
          day: a.day,
        });
      } else {
        a.time = safeTime(mins);
      }
    }
  }

  // --- 3. Fix overlapping times within each day (move only flexible activities) ---
  for (let day = 1; day <= totalDays; day++) {
    const sorted = dayActivities(day);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const prevEnd = timeToMinutes(prev.time) + (prev.duration ?? 60);
      const curStart = timeToMinutes(cur.time);

      if (curStart < prevEnd) {
        // Overlap detected
        if (isLocked(cur) && isLocked(prev)) {
          // Both locked — cannot fix, warn
          warnings.push({
            type: 'locked_conflict',
            message: `Locked activities "${prev.title}" and "${cur.title}" overlap on day ${day}`,
            day,
          });
        } else if (isLocked(cur)) {
          // Current is locked, previous is flexible — move previous earlier or to a free slot
          const prevAct = result.find((a) => a.id === prev.id);
          if (prevAct) {
            const neededDuration = prev.duration ?? 60;
            const freeSlot = findFreeSlot(day, neededDuration, 8 * 60, curStart - neededDuration, prev.id);
            if (freeSlot != null) {
              prevAct.time = safeTime(freeSlot);
            }
            // If no slot found, leave it — will be caught in health loop
          }
        } else {
          // Current is flexible (or both flexible) — push current after previous
          const newStart = clampMinutes(prevEnd + 15);
          const act = result.find((a) => a.id === cur.id);
          if (act) act.time = safeTime(newStart);
        }
      }
    }
  }

  // --- 4. Fill empty days with at least one activity at a conflict-free time ---
  const usedTitles = new Set(result.map((a) => a.title));

  for (let day = 1; day <= totalDays; day++) {
    const acts = dayActivities(day);
    if (acts.length === 0) {
      const available = pool.filter((p) => !usedTitles.has(p.title) && p.type === 'activity');
      if (available.length > 0) {
        const place = available[0];
        const duration = place.duration ?? 60;
        const slot = findFreeSlot(day, duration, 9 * 60, 21 * 60);
        if (slot != null) {
          result.push(placeToActivity(place, day, safeTime(slot)));
          usedTitles.add(place.title);
        } else {
          warnings.push({
            type: 'unfillable_day',
            message: `Could not find a conflict-free slot to fill empty day ${day}`,
            day,
          });
        }
      } else {
        // Pool exhausted — generate fallback activity
        const actFallbacksRepair = [
          'Morning city walk', 'Afternoon park stroll', 'Riverside promenade', 'Old town wander',
          'Viewpoint visit', 'Historic quarter tour', 'Botanical garden', 'Street market browse',
          'Local neighbourhood walk', 'Waterfront promenade', 'Hilltop lookout', 'Cultural district stroll',
          'Seaside walk', 'Park relaxation', 'City centre wander', 'Artisan quarter browse',
          'Lakeside path', 'Evening boulevard walk', 'Craft market visit', 'Scenic overlook',
        ];
        const fallbackTitle = actFallbacksRepair.find((t) => !usedTitles.has(t)) ?? `Activity (Day ${day})`;
        if (!usedTitles.has(fallbackTitle)) {
          const slot = findFreeSlot(day, 60, 9 * 60, 21 * 60);
          if (slot != null) {
            result.push({
              id: generateId(),
              title: fallbackTitle,
              type: 'activity',
              day,
              time: safeTime(slot),
              duration: 60,
              category: 'culture',
              cost: 'free',
            });
            usedTitles.add(fallbackTitle);
          } else {
            warnings.push({
              type: 'unfillable_day',
              message: `Could not find a conflict-free slot to fill empty day ${day}`,
              day,
            });
          }
        } else {
          warnings.push({
            type: 'unfillable_day',
            message: `No available activities in pool to fill day ${day}`,
            day,
          });
        }
      }
    }
  }

  // --- 5. Ensure at least one meal per day ---
  for (let day = 1; day <= totalDays; day++) {
    const acts = dayActivities(day);
    const hasMeal = acts.some((a) => a.type === 'food');
    if (!hasMeal) {
      const foodPlaces = pool.filter(
        (p) => p.type === 'food' && !usedTitles.has(p.title) && isDietaryCompatible(p, dietary),
      );
      if (foodPlaces.length > 0) {
        const place = foodPlaces[0];
        const duration = place.duration ?? 60;
        // Try to place within lunch window first, then any available slot
        let slot = findFreeSlot(day, duration, MEAL_WINDOWS.lunch.start, MEAL_WINDOWS.lunch.end);
        if (slot == null) slot = findFreeSlot(day, duration, MEAL_WINDOWS.dinner.start, MEAL_WINDOWS.dinner.end);
        if (slot == null) slot = findFreeSlot(day, duration, MEAL_WINDOWS.breakfast.start, MEAL_WINDOWS.breakfast.end);
        if (slot == null) slot = findFreeSlot(day, duration, 8 * 60, 22 * 60); // fallback: anywhere
        if (slot != null) {
          result.push(placeToActivity(place, day, safeTime(slot)));
          usedTitles.add(place.title);
        } else {
          warnings.push({
            type: 'no_meal_available',
            message: `No conflict-free slot for a meal on day ${day}`,
            day,
          });
        }
      } else {
        // Pool exhausted — generate fallback meal
        const foodFallbacksRepair = [
          'Local bistro lunch', 'Corner caf\u00E9 stop', 'Neighbourhood restaurant', 'Market food hall',
          'Terrace dining', 'Casual local eatery', 'Wine bar dinner', 'Rooftop caf\u00E9',
          'Street food stall', 'Family-run trattoria', 'Harbour-side seafood', 'Bakery breakfast',
          'Tapas bar evening', 'Night market dinner', 'Courtyard lunch spot', 'Riverside brasserie',
          'Farm-to-table bistro', 'Neighbourhood diner', 'Artisan coffee house', 'Sunset bar snacks',
        ];
        const baseFallbackMealTitle = foodFallbacksRepair[(day - 1) % foodFallbacksRepair.length];
        const fallbackMealTitle = usedTitles.has(baseFallbackMealTitle) ? `${baseFallbackMealTitle} (Day ${day})` : baseFallbackMealTitle;
        if (!usedTitles.has(fallbackMealTitle)) {
          const duration = 60;
          let slot = findFreeSlot(day, duration, MEAL_WINDOWS.lunch.start, MEAL_WINDOWS.lunch.end);
          if (slot == null) slot = findFreeSlot(day, duration, MEAL_WINDOWS.dinner.start, MEAL_WINDOWS.dinner.end);
          if (slot == null) slot = findFreeSlot(day, duration, 8 * 60, 22 * 60);
          if (slot != null) {
            result.push({
              id: generateId(),
              title: fallbackMealTitle,
              type: 'food',
              day,
              time: safeTime(slot),
              duration,
              category: 'food',
              cost: 'budget',
            });
            usedTitles.add(fallbackMealTitle);
          } else {
            warnings.push({
              type: 'no_meal_available',
              message: `No conflict-free slot for a fallback meal on day ${day}`,
              day,
            });
          }
        } else {
          warnings.push({
            type: 'no_meal_available',
            message: `No dietary-compatible food places available for day ${day}`,
            day,
          });
        }
      }
    }
  }

  // --- 6. Final health validation loop (max 3 iterations) ---
  for (let iteration = 0; iteration < 3; iteration++) {
    let madeChange = false;

    for (let day = 1; day <= totalDays; day++) {
      const sorted = dayActivities(day);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const prevEnd = timeToMinutes(prev.time) + (prev.duration ?? 60);
        const curStart = timeToMinutes(cur.time);

        if (curStart < prevEnd) {
          if (isLocked(cur) && isLocked(prev)) {
            // Already warned — skip
            continue;
          }
          // Move the flexible one
          const target = isLocked(cur) ? prev : cur;
          const act = result.find((a) => a.id === target.id);
          if (!act || isLocked(act)) continue;

          if (target.id === cur.id) {
            // Push current forward
            const newStart = clampMinutes(prevEnd + 15);
            if (newStart + (act.duration ?? 60) > 23 * 60 + 59) {
              warnings.push({
                type: 'time_overflow',
                message: `Moving "${act.title}" to resolve overlap would exceed 23:59 on day ${day}`,
                day,
              });
            } else {
              act.time = safeTime(newStart);
              madeChange = true;
            }
          } else {
            // Move previous earlier
            const neededDuration = act.duration ?? 60;
            const freeSlot = findFreeSlot(day, neededDuration, 8 * 60, curStart - neededDuration, act.id);
            if (freeSlot != null) {
              act.time = safeTime(freeSlot);
              madeChange = true;
            }
          }
        }
      }
    }

    if (!madeChange) break;
  }

  // --- 7. Final conflict check — warn about any remaining error-severity conflicts ---
  const finalConflicts = checkConflicts(result, totalDays);
  for (const conflict of finalConflicts) {
    if (conflict.severity === 'error') {
      warnings.push({
        type: conflict.type === 'locked_conflict' ? 'locked_conflict' : 'locked_conflict',
        message: `Unresolved conflict: ${conflict.message}`,
        day: conflict.day,
      });
    }
  }

  return {
    activities: result.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)),
    warnings,
  };
}

/**
 * Simulated generation steps for the progress screen.
 */
export const GENERATION_STEPS = [
  { label: 'Exploring your destination', duration: 2500 },
  { label: 'Finding the best spots', duration: 2200 },
  { label: 'Planning your mornings', duration: 2000 },
  { label: 'Picking restaurants & cafes', duration: 2200 },
  { label: 'Mapping out your route', duration: 2000 },
  { label: 'Optimizing your schedule', duration: 1800 },
  { label: 'Balancing your pace', duration: 1500 },
  { label: 'Adding finishing touches', duration: 1800 },
] as const;

/**
 * Simulated Fix My Day problems.
 */
export function generateFixMyDayProblems(trip: Trip, day: number): {
  id: string;
  problem: string;
  affectedActivityId?: string;
  severity: 'info' | 'warning' | 'error';
  suggestedFix: string;
}[] {
  const dayActivities = trip.activities.filter((a) => a.day === day);
  if (dayActivities.length === 0) return [];

  const problems: {
    id: string;
    problem: string;
    affectedActivityId?: string;
    severity: 'info' | 'warning' | 'error';
    suggestedFix: string;
  }[] = [];

  // Simulated problems based on activity types
  const museums = dayActivities.filter((a) => a.category === 'art' || a.category === 'culture');
  if (museums.length > 0) {
    const target = museums[0];
    if (!target.locked && !target.fixed) {
      problems.push({
        id: `closed-${target.id}`,
        problem: `"${target.title}" is closed today (simulated)`,
        affectedActivityId: target.id,
        severity: 'error',
        suggestedFix: 'Replace with a nearby alternative that\'s open',
      });
    }
  }

  // Check for early morning activities
  const early = dayActivities.find((a) => {
    const hour = parseInt(a.time.split(':')[0]);
    return hour < 9 && !a.locked && !a.fixed;
  });
  if (early) {
    problems.push({
      id: `early-${early.id}`,
      problem: `"${early.title}" starts at ${early.time} — quite early`,
      affectedActivityId: early.id,
      severity: 'warning',
      suggestedFix: 'Move to a later time slot',
    });
  }

  // Check for timing conflicts
  const sorted = [...dayActivities].sort((a, b) => a.time.localeCompare(b.time));
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const currentEnd = parseInt(current.time.split(':')[0]) * 60 +
      parseInt(current.time.split(':')[1]) + (current.duration ?? 60);
    const nextStart = parseInt(next.time.split(':')[0]) * 60 + parseInt(next.time.split(':')[1]);
    if (currentEnd > nextStart) {
      problems.push({
        id: `overlap-${current.id}-${next.id}`,
        problem: `"${current.title}" overlaps with "${next.title}"`,
        affectedActivityId: next.id,
        severity: 'error',
        suggestedFix: 'Adjust timing to remove overlap',
      });
    }
  }

  return problems;
}

/**
 * Simulated screenshot/link import: generate a believable demo place from a URL or "screenshot".
 */
export function simulateImportIdentification(source: string): {
  title: string;
  destination: string;
  category: string;
  cost: 'free' | 'budget' | 'moderate' | 'premium';
  duration: number;
  description: string;
  tags: string[];
  type: 'activity' | 'food';
} {
  // Generate believable results based on URL patterns
  const lower = source.toLowerCase();
  if (lower.includes('restaurant') || lower.includes('food') || lower.includes('eat')) {
    return {
      title: 'Hidden Gem Restaurant',
      destination: 'Unknown',
      category: 'food',
      cost: 'moderate',
      duration: 90,
      description: 'A charming local spot with great reviews',
      tags: ['Food & Dining'],
      type: 'food',
    };
  }
  if (lower.includes('museum') || lower.includes('gallery') || lower.includes('art')) {
    return {
      title: 'Contemporary Art Gallery',
      destination: 'Unknown',
      category: 'art',
      cost: 'moderate',
      duration: 120,
      description: 'A must-visit collection of modern works',
      tags: ['Art & Museums', 'Culture'],
      type: 'activity',
    };
  }
  if (lower.includes('hike') || lower.includes('trail') || lower.includes('nature')) {
    return {
      title: 'Scenic Nature Trail',
      destination: 'Unknown',
      category: 'nature',
      cost: 'free',
      duration: 180,
      description: 'A beautiful trail with panoramic views',
      tags: ['Nature', 'Adventure'],
      type: 'activity',
    };
  }
  if (lower.includes('tiktok') || lower.includes('instagram') || lower.includes('reel')) {
    return {
      title: 'Viral Sunset Viewpoint',
      destination: 'Unknown',
      category: 'nature',
      cost: 'free',
      duration: 60,
      description: 'The sunset spot everyone is sharing right now',
      tags: ['Photography', 'Nature'],
      type: 'activity',
    };
  }
  // Default
  return {
    title: 'Interesting Place',
    destination: 'Unknown',
    category: 'culture',
    cost: 'budget',
    duration: 90,
    description: 'A place worth visiting based on what you shared',
    tags: ['Culture'],
    type: 'activity',
  };
}
