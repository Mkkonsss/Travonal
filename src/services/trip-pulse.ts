import { Activity, Trip } from '@/context/trips';
import { TravelProfile } from '@/context/profile';
import { TravelMemoryEntry } from '@/context/memory';
import { checkConflicts, getTripDayCount } from './itinerary-engine';

export type PulseSeverity = 'urgent' | 'important' | 'suggestion';

export interface PulseAlert {
  id: string;
  type: 'conflict' | 'empty_day' | 'overloaded' | 'low_fit' | 'optimization' | 'suggestion';
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

function severityForType(type: PulseAlert['type']): PulseSeverity {
  switch (type) {
    case 'conflict':
      return 'urgent';
    case 'overloaded':
      return 'important';
    case 'empty_day':
    case 'low_fit':
    case 'optimization':
    case 'suggestion':
    default:
      return 'suggestion';
  }
}

/**
 * Run Trip Pulse evaluation.
 * @param maxAlerts - Maximum alerts to return. Defaults to 5 for display.
 *   Pass `Infinity` for lifecycle evaluation where all active issues must be tracked.
 */
export function runTripPulse(
  trip: Trip,
  profile: TravelProfile,
  memory: TravelMemoryEntry[],
  maxAlerts: number = 5,
): PulseAlert[] {
  const alerts: PulseAlert[] = [];
  const totalDays = getTripDayCount(trip.startDate, trip.endDate);
  const conflicts = checkConflicts(trip.activities, totalDays);

  // 1. Schedule conflicts
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

  // 2. Empty days — only show when the trip has at least some activities.
  // For draft trips with fewer than 3 activities, show at most 1 empty-day alert
  // to avoid overwhelming the user who is just starting to plan.
  const totalActivities = trip.activities.length;
  const isDraftWithFewActivities = totalActivities < Math.max(3, Math.floor(totalDays / 2));
  if (totalActivities > 0) {
    let emptyDayAlertCount = 0;
    for (const conflict of conflicts) {
      if (conflict.type === 'empty_day') {
        if (isDraftWithFewActivities && emptyDayAlertCount >= 1) continue;
        alerts.push({
          id: `empty-${conflict.day}`,
          type: 'empty_day',
          severity: severityForType('empty_day'),
          title: `Day ${conflict.day} is empty`,
          message: 'This day has no activities planned. Want a suggestion?',
          day: conflict.day,
          actionLabel: 'Get suggestion',
          command: 'surprise_me',
        });
        emptyDayAlertCount++;
      }
    }
  }

  // 3. Overloaded days — only when trip has activities
  for (const conflict of conflicts) {
    if (conflict.type === 'day_overloaded' && totalActivities > 0) {
      alerts.push({
        id: `overloaded-${conflict.day}`,
        type: 'overloaded',
        severity: severityForType('overloaded'),
        title: `Day ${conflict.day} is packed`,
        message: conflict.message,
        day: conflict.day,
        actionLabel: 'Make it relaxed',
        command: 'make_relaxed',
      });
    }
  }

  // 4. Low-fit activities (activities that conflict with profile dislikes)
  if (profile.dislikes.length > 0) {
    const dislikeChecks: Record<string, (a: Activity) => boolean> = {
      'Crowds': () => false, // Can't determine from activity data alone
      'Early mornings': (a) => {
        const hour = parseInt(a.time.split(':')[0]);
        return hour < 8;
      },
      'Late nights': (a) => {
        const hour = parseInt(a.time.split(':')[0]);
        return hour >= 21;
      },
    };

    for (const activity of trip.activities) {
      for (const dislike of profile.dislikes) {
        const check = dislikeChecks[dislike];
        if (check && check(activity)) {
          alerts.push({
            id: `lowfit-${activity.id}-${dislike}`,
            type: 'low_fit',
            severity: severityForType('low_fit'),
            title: 'Potential mismatch',
            message: `"${activity.title}" is scheduled ${dislike === 'Early mornings' ? 'early' : 'late'}, but you prefer to avoid ${dislike.toLowerCase()}.`,
            day: activity.day,
            activityId: activity.id,
            actionLabel: 'Adjust timing',
            command: 'reflow_day',
          });
        }
      }
    }
  }

  // 5. Pace mismatch
  const dayMap = new Map<number, Activity[]>();
  for (const a of trip.activities) {
    const existing = dayMap.get(a.day) ?? [];
    existing.push(a);
    dayMap.set(a.day, existing);
  }

  for (const [day, dayActivities] of dayMap) {
    const nonTransport = dayActivities.filter((a) => a.type !== 'flight' && a.type !== 'hotel');
    if (profile.pace === 'relaxed' && nonTransport.length > 3) {
      alerts.push({
        id: `pace-${day}`,
        type: 'optimization',
        severity: severityForType('optimization'),
        title: `Day ${day} may be too busy`,
        message: `You prefer a relaxed pace, but Day ${day} has ${nonTransport.length} activities.`,
        day,
        actionLabel: 'Make relaxed',
        command: 'make_relaxed',
      });
    }
    if (profile.pace === 'active' && nonTransport.length < 2 && nonTransport.length > 0 && !isDraftWithFewActivities) {
      alerts.push({
        id: `pace-active-${day}`,
        type: 'suggestion',
        severity: severityForType('suggestion'),
        title: `Day ${day} could use more`,
        message: `You prefer an active pace. Day ${day} only has ${nonTransport.length} activities.`,
        day,
        actionLabel: 'Add more',
        command: 'surprise_me',
      });
    }
  }

  // Limit to most relevant for display; pass Infinity for lifecycle evaluation
  return maxAlerts === Infinity ? alerts : alerts.slice(0, maxAlerts);
}
