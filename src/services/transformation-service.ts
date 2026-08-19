import { Activity, Trip } from '@/context/trips';
import { TravelProfile } from '@/context/profile';
import { TravelMemoryEntry } from '@/context/memory';
import { TravonalCommand } from '@/components/ask-travonal';
import { findReplacement, findSurprise, PlaceOption, getAlternatives } from './alternatives-pool';
import { reflowDay, generateId, timeToMinutes, minutesToTime } from './itinerary-engine';

export type TransformScope =
  | { type: 'activity'; activityId: string; day: number }
  | { type: 'day'; day: number }
  | { type: 'days'; days: number[] }
  | { type: 'full_trip' };

export interface TransformResult {
  activities: Activity[];
  summary: string;
  changes: string[];
  whyFits?: string;
  memoryEntry?: {
    type: TravelMemoryEntry['type'];
    category: string;
    detail: string;
  };
  lockedProtectedCount?: number;
}

function isLocked(a: Activity): boolean {
  return !!(a.locked || a.fixed);
}

function placeToActivity(place: PlaceOption, day: number, time: string): Activity {
  // Cap non-hotel durations at 240 minutes (4 hours) to prevent overlaps
  const maxDuration = place.type === 'hotel' ? 480 : 240;
  return {
    id: generateId(),
    title: place.title,
    type: place.type,
    day,
    time,
    duration: Math.min(place.duration, maxDuration),
    category: place.category,
    cost: place.cost,
    description: place.description,
  };
}

/**
 * Find top 3 replacement alternatives for an activity.
 */
export function findTopReplacements(
  destination: string,
  currentActivity: Activity,
  options?: {
    interests?: string[];
    dislikes?: string[];
    budget?: string;
    avoidCrowds?: boolean;
    preferAdventurous?: boolean;
    preferRelaxed?: boolean;
    existingTitles?: string[];
  }
): PlaceOption[] {
  const pool = getAlternatives(destination);

  // Filter out activities with the same title AND any existing duplicates
  const existingLower = new Set((options?.existingTitles ?? []).map((t) => t.toLowerCase()));
  let candidates = pool.filter((p) => p.title !== currentActivity.title && !existingLower.has(p.title.toLowerCase()));

  // Never offer hotels as replacements unless we're replacing a hotel
  if (currentActivity.type !== 'hotel') {
    candidates = candidates.filter((p) => p.type !== 'hotel');
  }

  // Prefer same type
  const sameType = candidates.filter((p) => p.type === currentActivity.type);
  if (sameType.length > 0) candidates = sameType;

  // Apply filters
  if (options?.avoidCrowds) {
    const lowCrowd = candidates.filter((p) => p.crowdLevel === 'low');
    if (lowCrowd.length > 0) candidates = lowCrowd;
  }

  if (options?.preferRelaxed) {
    const lowEnergy = candidates.filter((p) => p.energyLevel === 'low');
    if (lowEnergy.length > 0) candidates = lowEnergy;
  }

  if (options?.preferAdventurous) {
    const highEnergy = candidates.filter((p) => p.energyLevel === 'high' || p.energyLevel === 'medium');
    if (highEnergy.length > 0) candidates = highEnergy;
  }

  if (options?.budget) {
    const budgetMap: Record<string, string[]> = {
      budget: ['free', 'budget'],
      moderate: ['free', 'budget', 'moderate'],
      premium: ['free', 'budget', 'moderate', 'premium'],
    };
    const allowed = budgetMap[options.budget] ?? budgetMap.moderate;
    const budgetFiltered = candidates.filter((p) => allowed.includes(p.cost));
    if (budgetFiltered.length > 0) candidates = budgetFiltered;
  }

  // Score by interest match
  if (options?.interests && options.interests.length > 0) {
    candidates.sort((a, b) => {
      const aScore = a.tags.filter((t) => options.interests!.includes(t)).length;
      const bScore = b.tags.filter((t) => options.interests!.includes(t)).length;
      return bScore - aScore;
    });
  }

  // Filter out disliked tags
  if (options?.dislikes && options.dislikes.length > 0) {
    if (options.dislikes.includes('Crowds')) {
      candidates = candidates.filter((p) => p.crowdLevel !== 'high');
    }
  }

  return candidates.slice(0, 3);
}

/**
 * Look up the crowd level of an activity by title from the alternatives pool.
 */
function getPlaceCrowdLevel(destination: string, title: string): 'low' | 'medium' | 'high' | null {
  const pool = getAlternatives(destination);
  const match = pool.find((p) => p.title === title);
  return match?.crowdLevel ?? null;
}

const COST_VALUE: Record<string, number> = { free: 0, budget: 15, moderate: 35, premium: 75 };

function getDaysFromScope(scope: TransformScope, trip: Trip): number[] {
  switch (scope.type) {
    case 'activity': return [scope.day];
    case 'day': return [scope.day];
    case 'days': return scope.days;
    case 'full_trip': {
      const parts = trip.startDate.split('-').map(Number);
      const eParts = trip.endDate.split('-').map(Number);
      const totalDays = Math.max(1, Math.round(
        (Date.UTC(eParts[0], eParts[1] - 1, eParts[2]) -
         Date.UTC(parts[0], parts[1] - 1, parts[2])) / 86400000
      ) + 1);
      return Array.from({ length: totalDays }, (_, i) => i + 1);
    }
  }
}

function scopeLabel(scope: TransformScope): string {
  switch (scope.type) {
    case 'activity': return `Day ${scope.day}`;
    case 'day': return `Day ${scope.day}`;
    case 'days': return `Days ${scope.days.join(', ')}`;
    case 'full_trip': return 'Full trip';
  }
}

function transformSingleDay(
  trip: Trip,
  command: TravonalCommand,
  day: number,
  profile: TravelProfile,
  activities: Activity[],
  existingTitles: string[],
  startAfter?: string,
): TransformResult {
  const dayActivities = activities
    .filter((a) => a.day === day)
    .sort((a, b) => a.time.localeCompare(b.time));

  // Count locked/fixed for reporting
  const lockedCount = dayActivities.filter(isLocked).length;

  switch (command) {
    case 'make_relaxed': {
      const locked = dayActivities.filter(isLocked);
      const unlocked = dayActivities.filter((a) => !isLocked(a));
      const essential = unlocked.filter((a) => a.type === 'flight' || a.type === 'hotel');
      const optional = unlocked.filter((a) => a.type !== 'flight' && a.type !== 'hotel');
      const maxOptional = Math.max(0, 3 - locked.length - essential.length);
      const kept = optional.slice(0, maxOptional);
      const removed = optional.slice(maxOptional);
      const keptIds = new Set([
        ...locked.map((a) => a.id),
        ...essential.map((a) => a.id),
        ...kept.map((a) => a.id),
      ]);
      const newActivities = activities.filter((a) => a.day !== day || keptIds.has(a.id));
      const reflowed = reflowDay(newActivities, day, '10:00');
      return {
        activities: reflowed,
        summary: `Day ${day} made more relaxed`,
        changes: [
          `${removed.length} ${removed.length === 1 ? 'activity' : 'activities'} removed`,
          'Later start time (10:00)',
          'Added breathing room between activities',
          ...(locked.length > 0 ? [`${locked.length} locked ${locked.length === 1 ? 'activity' : 'activities'} protected`] : []),
        ],
        whyFits: profile.pace === 'relaxed'
          ? 'This matches your preferred relaxed pace.'
          : `Adjusted Day ${day} to a calmer pace while keeping your must-dos.`,
        lockedProtectedCount: locked.length,
      };
    }

    case 'make_adventurous': {
      const changes: string[] = [];
      let result = [...activities];
      const replaceable = dayActivities.filter(
        (a) => !isLocked(a) && a.type === 'activity'
      );
      for (const activity of replaceable.slice(0, 2)) {
        const replacement = findReplacement(trip.destination, activity, {
          interests: profile.interests,
          dislikes: profile.dislikes,
          preferAdventurous: true,
          budget: trip.budget,
        });
        if (replacement) {
          result = result.map((a) =>
            a.id === activity.id
              ? placeToActivity(replacement, day, activity.time)
              : a
          );
          changes.push(`"${activity.title}" replaced with "${replacement.title}"`);
        }
      }
      if (changes.length === 0) {
        const surprise = findSurprise(trip.destination, existingTitles, ['Adventure'], profile.dislikes);
        if (surprise) {
          const newAct = placeToActivity(surprise, day, '14:00');
          result.push(newAct);
          changes.push(`Added "${surprise.title}"`);
        }
      }
      return {
        activities: result,
        summary: `Day ${day} made more adventurous`,
        changes: [
          ...(changes.length > 0 ? changes : ['No changes — activities already high-energy']),
          ...(lockedCount > 0 ? [`${lockedCount} locked ${lockedCount === 1 ? 'activity' : 'activities'} protected`] : []),
        ],
        whyFits: `Selected based on your interests: ${profile.interests.slice(0, 3).join(', ') || 'general'}`,
        lockedProtectedCount: lockedCount,
      };
    }

    case 'reduce_cost': {
      const changes: string[] = [];
      let result = [...activities];
      let savings = 0;
      let changedCount = 0;
      const currentCost = dayActivities.reduce((s, a) => s + (COST_VALUE[a.cost ?? 'moderate'] ?? 35), 0);
      const expensive = dayActivities.filter(
        (a) => !isLocked(a) && (a.cost === 'premium' || a.cost === 'moderate')
      );
      for (const activity of expensive) {
        const replacement = findReplacement(trip.destination, activity, {
          interests: profile.interests,
          budget: 'budget',
        });
        if (replacement && (replacement.cost === 'free' || replacement.cost === 'budget')) {
          savings += (COST_VALUE[activity.cost ?? 'moderate'] ?? 35) - (COST_VALUE[replacement.cost] ?? 15);
          changedCount++;
          result = result.map((a) =>
            a.id === activity.id
              ? placeToActivity(replacement, day, activity.time)
              : a
          );
          changes.push(`"${activity.title}" ($${COST_VALUE[activity.cost ?? 'moderate']}) \u2192 "${replacement.title}" ($${COST_VALUE[replacement.cost]})`);
        }
      }
      const proposedCost = currentCost - savings;
      if (savings > 0) {
        changes.push(`Current estimate: ~$${currentCost} \u2192 Proposed: ~$${proposedCost}`);
        changes.push(`Savings: ~$${savings} across ${changedCount} ${changedCount === 1 ? 'activity' : 'activities'}`);
      }
      return {
        activities: result,
        summary: savings > 0 ? `Day ${day} costs reduced by ~$${savings}` : `Day ${day} — no savings found`,
        changes: [
          ...(changes.length > 0 ? changes : ['No expensive activities found to replace']),
          ...(lockedCount > 0 ? [`${lockedCount} locked ${lockedCount === 1 ? 'activity' : 'activities'} protected (not changed)`] : []),
        ],
        whyFits: 'Swapped for budget-friendly alternatives matching your interests.',
        lockedProtectedCount: lockedCount,
      };
    }

    case 'avoid_crowds': {
      const changes: string[] = [];
      let result = [...activities];
      const crowded = dayActivities.filter((a) => {
        if (isLocked(a) || a.type !== 'activity') return false;
        const crowd = getPlaceCrowdLevel(trip.destination, a.title);
        if (crowd === null) return false; // unknown -- don't assume crowded
        return crowd === 'medium' || crowd === 'high';
      });
      // Check if all activities have unknown crowd data
      const activitiesWithKnownCrowd = dayActivities.filter((a) => {
        if (isLocked(a) || a.type !== 'activity') return false;
        return getPlaceCrowdLevel(trip.destination, a.title) !== null;
      });
      if (activitiesWithKnownCrowd.length === 0 && dayActivities.filter((a) => !isLocked(a) && a.type === 'activity').length > 0) {
        return {
          activities: result,
          summary: `Day ${day} crowd level`,
          changes: [
            'Crowd data is not available for these activities.',
            ...(lockedCount > 0 ? [`${lockedCount} locked ${lockedCount === 1 ? 'activity' : 'activities'} protected`] : []),
          ],
          whyFits: 'No crowd data available to make recommendations.',
          lockedProtectedCount: lockedCount,
        };
      }
      for (const activity of crowded) {
        const originalCrowd = getPlaceCrowdLevel(trip.destination, activity.title);
        const replacement = findReplacement(trip.destination, activity, {
          interests: profile.interests,
          dislikes: profile.dislikes,
          avoidCrowds: true,
          budget: trip.budget,
        });
        if (
          replacement &&
          originalCrowd !== null &&
          (replacement.crowdLevel === 'low' ||
            (replacement.crowdLevel === 'medium' && originalCrowd === 'high')) &&
          replacement.crowdLevel !== originalCrowd
        ) {
          result = result.map((a) =>
            a.id === activity.id
              ? placeToActivity(replacement, day, activity.time)
              : a
          );
          changes.push(`"${activity.title}" replaced with quieter "${replacement.title}"`);
        }
      }
      return {
        activities: result,
        summary: `Day ${day} crowd level reduced`,
        changes: [
          ...(changes.length > 0
            ? changes
            : ['No high-crowd activities found \u2014 your itinerary is already low-crowd!']),
          ...(lockedCount > 0 ? [`${lockedCount} locked ${lockedCount === 1 ? 'activity' : 'activities'} protected`] : []),
        ],
        whyFits: 'Swapped for quieter alternatives away from tourist crowds.',
        lockedProtectedCount: lockedCount,
      };
    }

    case 'reduce_travel_time': {
      const pool = getAlternatives(trip.destination);
      const coordMap = new Map<string, { lat: number; lng: number }>();
      for (const p of pool) {
        if (p.lat != null && p.lng != null) {
          coordMap.set(p.title, { lat: p.lat, lng: p.lng });
        }
      }
      const locked = dayActivities.filter(isLocked);
      const unlocked = dayActivities.filter((a) => !isLocked(a));
      const withCoords = unlocked.filter((a) => coordMap.has(a.title));
      const withoutCoords = unlocked.filter((a) => !coordMap.has(a.title));
      if (withCoords.length < 2) {
        return {
          activities,
          summary: `Day ${day} \u2014 no change`,
          changes: [
            'Not enough location data to optimize travel order. Try adding activities from the Explore tab which include coordinates.',
            ...(lockedCount > 0 ? [`${lockedCount} locked ${lockedCount === 1 ? 'activity' : 'activities'} protected`] : []),
          ],
          lockedProtectedCount: lockedCount,
        };
      }
      let reordered: Activity[];
      if (withCoords.length >= 2) {
        const sorted: Activity[] = [withCoords[0]];
        const remaining = withCoords.slice(1);
        while (remaining.length > 0) {
          const last = sorted[sorted.length - 1];
          const lastCoord = coordMap.get(last.title)!;
          let nearestIdx = 0;
          let nearestDist = Infinity;
          for (let i = 0; i < remaining.length; i++) {
            const coord = coordMap.get(remaining[i].title)!;
            const dist = Math.sqrt(
              Math.pow(coord.lat - lastCoord.lat, 2) + Math.pow(coord.lng - lastCoord.lng, 2)
            );
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestIdx = i;
            }
          }
          sorted.push(remaining.splice(nearestIdx, 1)[0]);
        }
        reordered = [...sorted, ...withoutCoords];
      } else {
        reordered = unlocked;
      }
      let currentTime = timeToMinutes(dayActivities[0]?.time ?? '09:00');
      const result = activities.filter((a) => a.day !== day);
      result.push(...locked);
      for (const act of reordered) {
        for (const l of locked) {
          const lStart = timeToMinutes(l.time);
          const lEnd = lStart + (l.duration ?? 60);
          if (currentTime >= lStart && currentTime < lEnd) {
            currentTime = lEnd + 15;
          }
        }
        result.push({ ...act, time: minutesToTime(currentTime) });
        currentTime += (act.duration ?? 60) + 30;
      }
      // Verify that the reorder actually improved proximity
      function totalDistance(acts: Activity[]): number {
        let dist = 0;
        for (let i = 1; i < acts.length; i++) {
          const c1 = coordMap.get(acts[i - 1].title);
          const c2 = coordMap.get(acts[i].title);
          if (c1 && c2) dist += Math.sqrt(Math.pow(c2.lat - c1.lat, 2) + Math.pow(c2.lng - c1.lng, 2));
        }
        return dist;
      }
      const originalDist = totalDistance(withCoords);
      const reorderedWithCoords = reordered.filter((a) => coordMap.has(a.title));
      const newDist = totalDistance(reorderedWithCoords);
      const improved = newDist < originalDist * 0.95; // require 5% improvement

      if (!improved) {
        return {
          activities,
          summary: `Day ${day} — already well-ordered`,
          changes: [
            'Activities are already in an efficient order. No improvement found.',
            ...(lockedCount > 0 ? [`${lockedCount} locked ${lockedCount === 1 ? 'activity' : 'activities'} protected`] : []),
          ],
          lockedProtectedCount: lockedCount,
        };
      }

      return {
        activities: result.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)),
        summary: `Day ${day} optimized for less travel`,
        changes: [
          `Reordered ${withCoords.length} activities by proximity`,
          'Buffer time added between stops',
          ...(lockedCount > 0 ? [`${lockedCount} locked ${lockedCount === 1 ? 'activity' : 'activities'} protected`] : []),
        ],
        whyFits: 'Reorganized to minimize time spent traveling between activities.',
        lockedProtectedCount: lockedCount,
      };
    }

    case 'reflow_day': {
      const reflowStart = startAfter ?? dayActivities[0]?.time ?? '09:00';
      const reflowed = reflowDay(activities, day, reflowStart);
      return {
        activities: reflowed,
        summary: `Day ${day} timing adjusted`,
        changes: [
          ...(startAfter ? [`Start time set to ${startAfter}`] : []),
          'Times auto-adjusted with 30-minute buffers between activities',
          ...(lockedCount > 0 ? [`${lockedCount} locked ${lockedCount === 1 ? 'activity' : 'activities'} protected`] : []),
        ],
        whyFits: 'Ensured comfortable spacing between your activities.',
        lockedProtectedCount: lockedCount,
      };
    }

    case 'fix_my_day': {
      const changes: string[] = [];
      let result = [...activities];
      const sorted = dayActivities.sort((a, b) => a.time.localeCompare(b.time));
      let hasOverlaps = false;
      for (let i = 0; i < sorted.length - 1; i++) {
        const cur = sorted[i];
        const next = sorted[i + 1];
        const curEnd = timeToMinutes(cur.time) + (cur.duration ?? 60);
        if (curEnd > timeToMinutes(next.time)) {
          hasOverlaps = true;
          break;
        }
      }
      if (hasOverlaps) {
        result = reflowDay(result, day, sorted[0]?.time ?? '09:00');
        changes.push('Fixed overlapping activity times');
      }
      const dayActs = result.filter((a) => a.day === day);
      const hasLunch = dayActs.some((a) => a.type === 'food' && timeToMinutes(a.time) >= 11 * 60 && timeToMinutes(a.time) < 15 * 60);
      const hasDinner = dayActs.some((a) => a.type === 'food' && timeToMinutes(a.time) >= 17 * 60);
      if (!hasLunch && dayActs.length >= 2) {
        const lunchPlace = findSurprise(trip.destination, existingTitles, ['Food', 'Local cuisine'], []);
        if (lunchPlace && lunchPlace.type === 'food') {
          result.push(placeToActivity(lunchPlace, day, '12:30'));
          changes.push(`Added lunch: "${lunchPlace.title}"`);
        } else {
          result.push({
            id: generateId(), title: 'Lunch break', type: 'food', day, time: '12:30',
            duration: 60, category: 'food', description: 'Time for a meal',
          });
          changes.push('Added lunch break');
        }
      }
      if (!hasDinner && dayActs.length >= 2) {
        const dinnerPlace = findSurprise(trip.destination, existingTitles, ['Food', 'Local cuisine'], []);
        if (dinnerPlace && dinnerPlace.type === 'food') {
          result.push(placeToActivity(dinnerPlace, day, '19:00'));
          changes.push(`Added dinner: "${dinnerPlace.title}"`);
        } else {
          result.push({
            id: generateId(), title: 'Dinner', type: 'food', day, time: '19:00',
            duration: 75, category: 'food', description: 'Time for dinner',
          });
          changes.push('Added dinner break');
        }
      }
      const updatedDayActs = result.filter((a) => a.day === day);
      if (updatedDayActs.length > 6) {
        const locked = updatedDayActs.filter(isLocked);
        const unlocked = updatedDayActs
          .filter((a) => !isLocked(a))
          .sort((a, b) => a.time.localeCompare(b.time));
        const keep = unlocked.slice(0, 6 - locked.length);
        const remove = unlocked.slice(6 - locked.length);
        const keepIds = new Set([...locked.map((a) => a.id), ...keep.map((a) => a.id)]);
        result = result.filter((a) => a.day !== day || keepIds.has(a.id));
        if (remove.length > 0) {
          changes.push(`Removed ${remove.length} extra ${remove.length === 1 ? 'activity' : 'activities'} to avoid overpacking`);
        }
      }
      result = reflowDay(result, day, result.filter((a) => a.day === day).sort((a, b) => a.time.localeCompare(b.time))[0]?.time ?? '09:00');
      if (changes.length === 0) {
        changes.push('No issues found — your day looks good!');
      } else {
        changes.push('Re-spaced activities with comfortable buffers');
      }
      return {
        activities: result,
        summary: `Day ${day} fixed`,
        changes: [
          ...changes,
          ...(lockedCount > 0 ? [`${lockedCount} locked ${lockedCount === 1 ? 'activity' : 'activities'} protected`] : []),
        ],
        whyFits: 'Detected and resolved scheduling issues for a smoother day.',
        lockedProtectedCount: lockedCount,
      };
    }

    default: {
      return {
        activities,
        summary: '',
        changes: [],
      };
    }
  }
}

// Multi-day commands that can be iterated over each day
const MULTI_DAY_COMMANDS: TravonalCommand[] = [
  'make_relaxed', 'make_adventurous', 'reduce_cost', 'avoid_crowds',
  'reduce_travel_time', 'fix_my_day', 'reflow_day',
];

export function transformTrip(
  trip: Trip,
  command: TravonalCommand,
  scope: TransformScope,
  profile: TravelProfile,
  memory: TravelMemoryEntry[],
  targetActivityId?: string,
  searchTerms?: string,
  startAfter?: string,
): TransformResult {
  const activities = [...trip.activities];
  const existingTitles = activities.map((a) => a.title);

  // Non-day-scoped commands: replace_activity, surprise_me, add_activity
  if (command === 'replace_activity') {
    if (!targetActivityId) {
      return {
        activities,
        summary: 'Select an activity to replace',
        changes: ['Tap an activity card and use the Replace button'],
      };
    }
    const target = activities.find((a) => a.id === targetActivityId);
    if (!target || isLocked(target)) {
      return {
        activities,
        summary: 'Cannot replace',
        changes: [target && isLocked(target) ? 'This activity is locked or fixed' : 'Activity not found'],
      };
    }
    const replacement = findReplacement(trip.destination, target, {
      interests: profile.interests,
      dislikes: profile.dislikes,
      budget: trip.budget,
    });
    if (!replacement) {
      return {
        activities,
        summary: 'No alternatives found',
        changes: ['No suitable replacement in the alternatives pool for this destination'],
      };
    }
    const result = activities.map((a) =>
      a.id === targetActivityId
        ? placeToActivity(replacement, target.day, target.time)
        : a
    );
    return {
      activities: result,
      summary: 'Activity replaced',
      changes: [`"${target.title}" replaced with "${replacement.title}"`],
      whyFits: `"${replacement.title}": ${replacement.description}. Matches your interest in ${replacement.tags[0] ?? 'exploration'}.`,
      memoryEntry: {
        type: 'activity_replaced',
        category: target.category ?? target.type,
        detail: `Replaced "${target.title}" with "${replacement.title}" in ${trip.destination}`,
      },
    };
  }

  if (command === 'surprise_me' && scope.type !== 'activity') {
    const days = getDaysFromScope(scope, trip);

    // For multi-day surprise, add one surprise per day
    if (days.length > 1) {
      let currentActivities = [...activities];
      const allChanges: string[] = [];
      let lastWhyFits: string | undefined;

      for (const day of days) {
        const dayActs = currentActivities
          .filter((a) => a.day === day)
          .sort((a, b) => a.time.localeCompare(b.time));
        const currentTitles = currentActivities.map((a) => a.title);
        const surprise = findSurprise(trip.destination, currentTitles, profile.interests, profile.dislikes, searchTerms);
        if (surprise) {
          const withSurprise = [...currentActivities, placeToActivity(surprise, day, '14:00')];
          currentActivities = reflowDay(withSurprise, day, dayActs[0]?.time ?? '09:00');
          allChanges.push(`Day ${day}: Added "${surprise.title}"`);
          lastWhyFits = `Picked because you enjoy ${surprise.tags.filter((t) => profile.interests.includes(t)).join(', ') || surprise.tags[0]}.`;
        }
      }
      if (allChanges.length === 0) {
        return {
          activities,
          summary: searchTerms ? `No matches for "${searchTerms}"` : 'No surprises left',
          changes: [searchTerms ? `No activities matching "${searchTerms}" found` : 'All alternatives already in your itinerary'],
        };
      }
      return {
        activities: currentActivities,
        summary: searchTerms ? `Added ${allChanges.length} matching activities` : `Surprises added to ${scopeLabel(scope)}`,
        changes: allChanges,
        whyFits: lastWhyFits,
      };
    }

    // Single day
    const day = days[0];
    const dayActivities = activities
      .filter((a) => a.day === day)
      .sort((a, b) => a.time.localeCompare(b.time));
    const surprise = findSurprise(
      trip.destination,
      existingTitles,
      profile.interests,
      profile.dislikes,
      searchTerms,
    );
    if (!surprise) {
      return {
        activities,
        summary: searchTerms ? `No matches for "${searchTerms}"` : 'No surprises left',
        changes: [searchTerms ? `No activities matching "${searchTerms}" found` : 'All alternatives for this destination are already in your itinerary'],
      };
    }
    const result = [...activities, placeToActivity(surprise, day, '14:00')];
    const reflowed = reflowDay(result, day, dayActivities[0]?.time ?? '09:00');
    return {
      activities: reflowed,
      summary: searchTerms ? `Added "${surprise.title}"` : `Surprise added to Day ${day}`,
      changes: [`Added "${surprise.title}" \u2014 ${surprise.description}`],
      whyFits: `Picked because you enjoy ${surprise.tags.filter((t) => profile.interests.includes(t)).join(', ') || surprise.tags[0]}. ${surprise.crowdLevel === 'low' ? 'Low crowd level.' : ''}`,
      memoryEntry: {
        type: 'recommendation_accepted',
        category: surprise.category,
        detail: `Accepted surprise: "${surprise.title}" in ${trip.destination}`,
      },
    };
  }

  if (command === 'add_activity') {
    return { activities, summary: '', changes: [] };
  }

  // move_later / move_earlier only make sense at activity scope
  if (command === 'move_later' || command === 'move_earlier') {
    if (scope.type !== 'activity') {
      return { activities, summary: 'Select a specific activity', changes: ['Move Later/Earlier applies to a single activity — tap an activity and choose Customize'] };
    }
  }

  // Activity-specific scope: transform only the targeted activity — never fall through to day-level
  if (scope.type === 'activity') {
    const target = activities.find((a) => a.id === scope.activityId);
    if (!target) {
      return { activities, summary: 'Activity not found', changes: ['The selected activity could not be found'] };
    }
    if (isLocked(target)) {
      return { activities, summary: 'Cannot modify', changes: ['This activity is locked or fixed'] };
    }

    // Commands that replace the activity with a filtered alternative
    const commandAction: Record<string, { interests?: string[]; dislikes?: string[]; budget?: string; avoidCrowds?: boolean; preferAdventurous?: boolean; preferRelaxed?: boolean }> = {
      make_relaxed: { preferRelaxed: true, interests: profile.interests, dislikes: profile.dislikes, budget: trip.budget },
      make_adventurous: { preferAdventurous: true, interests: profile.interests, dislikes: profile.dislikes, budget: trip.budget },
      reduce_cost: { interests: profile.interests, budget: 'budget' },
      avoid_crowds: { avoidCrowds: true, interests: profile.interests, dislikes: profile.dislikes, budget: trip.budget },
    };
    const opts = commandAction[command];
    if (opts) {
      const replacement = findReplacement(trip.destination, target, opts);
      if (!replacement) {
        return { activities, summary: 'No alternatives found', changes: [`No suitable replacement found for "${target.title}"`] };
      }
      const result = activities.map((a) =>
        a.id === target.id ? placeToActivity(replacement, target.day, target.time) : a
      );
      return {
        activities: result,
        summary: `"${target.title}" updated`,
        changes: [`"${target.title}" replaced with "${replacement.title}"`],
        whyFits: `"${replacement.title}": ${replacement.description}`,
      };
    }

    // surprise_me at activity level: replace that activity with a surprise
    if (command === 'surprise_me') {
      const surprise = findSurprise(trip.destination, existingTitles, profile.interests, profile.dislikes, searchTerms);
      if (!surprise) {
        return { activities, summary: searchTerms ? `No matches for "${searchTerms}"` : 'No alternatives found', changes: [searchTerms ? `No activities matching "${searchTerms}" found` : 'All alternatives already in your itinerary'] };
      }
      const result = activities.map((a) =>
        a.id === target.id ? placeToActivity(surprise, target.day, target.time) : a
      );
      return {
        activities: result,
        summary: `"${target.title}" replaced`,
        changes: [`"${target.title}" replaced with "${surprise.title}" — ${surprise.description}`],
        whyFits: `Picked because you enjoy ${surprise.tags.filter((t) => profile.interests.includes(t)).join(', ') || surprise.tags[0]}.`,
      };
    }

    // move_later / move_earlier at activity level: shift by ±60 min (or use explicit startAfter)
    if (command === 'move_later' || command === 'move_earlier') {
      const currentMinutes = timeToMinutes(target.time);
      let newMinutes: number;
      if (startAfter) {
        newMinutes = timeToMinutes(startAfter);
      } else {
        const delta = command === 'move_later' ? 60 : -60;
        newMinutes = Math.max(0, Math.min(23 * 60 + 59, currentMinutes + delta));
      }
      const newTime = minutesToTime(newMinutes);
      if (newTime === target.time) {
        return { activities, summary: 'No change needed', changes: [`"${target.title}" is already at ${target.time}`] };
      }
      const result = activities.map((a) =>
        a.id === target.id ? { ...a, time: newTime } : a
      );
      return {
        activities: result,
        summary: `"${target.title}" moved to ${newTime}`,
        changes: [`"${target.title}" moved from ${target.time} to ${newTime}`],
      };
    }

    // reflow_day / reduce_travel_time at activity level: adjust only this activity's time
    if (command === 'reflow_day' || command === 'reduce_travel_time') {
      const newTime = startAfter ?? target.time;
      if (newTime === target.time && !startAfter) {
        return { activities, summary: 'No change needed', changes: [`"${target.title}" timing is already set`] };
      }
      const result = activities.map((a) =>
        a.id === target.id ? { ...a, time: newTime } : a
      );
      return {
        activities: result,
        summary: `"${target.title}" timing adjusted`,
        changes: [`"${target.title}" moved to ${newTime}`],
      };
    }

    // fix_my_day at activity level: not applicable to a single activity
    if (command === 'fix_my_day') {
      return { activities, summary: 'Select a broader scope', changes: ['Fix My Day analyzes the full day — use Day or Full Trip scope instead'] };
    }

    // Any other unhandled command — never silently fall through
    return { activities, summary: 'Not available for single activity', changes: [`"${command}" requires Day or Full Trip scope`] };
  }

  // Multi-day commands
  if (MULTI_DAY_COMMANDS.includes(command)) {
    const days = getDaysFromScope(scope, trip);

    // Single day -- delegate directly
    if (days.length === 1) {
      return transformSingleDay(trip, command, days[0], profile, activities, existingTitles, startAfter);
    }

    // Multi-day: iterate and accumulate
    let currentActivities = [...activities];
    const allChanges: string[] = [];
    let totalLocked = 0;
    let whyFits: string | undefined;

    for (const day of days) {
      const dayResult = transformSingleDay(
        { ...trip, activities: currentActivities },
        command,
        day,
        profile,
        currentActivities,
        currentActivities.map((a) => a.title),
        startAfter,
      );
      currentActivities = dayResult.activities;
      // Prefix day-specific changes
      for (const change of dayResult.changes) {
        allChanges.push(`Day ${day}: ${change}`);
      }
      totalLocked += dayResult.lockedProtectedCount ?? 0;
      if (!whyFits && dayResult.whyFits) whyFits = dayResult.whyFits;
    }

    const label = scopeLabel(scope);
    const commandLabels: Record<string, string> = {
      make_relaxed: 'made more relaxed',
      make_adventurous: 'made more adventurous',
      reduce_cost: 'costs reduced',
      avoid_crowds: 'crowd level reduced',
      reduce_travel_time: 'optimized for less travel',
      fix_my_day: 'fixed',
      reflow_day: 'timing adjusted',
    };
    const summary = `${label} ${commandLabels[command] ?? 'updated'}`;

    return {
      activities: currentActivities,
      summary,
      changes: allChanges,
      whyFits,
      lockedProtectedCount: totalLocked,
    };
  }

  return {
    activities,
    summary: 'Unknown command',
    changes: [],
  };
}
