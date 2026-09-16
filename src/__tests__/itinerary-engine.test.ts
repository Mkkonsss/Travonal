import {
  timeToMinutes,
  minutesToTime,
  checkConflicts,
  reflowDay,
  reflowFromTime,
  getTripDayCount,
  computeChangePreview,
  getPlanHealth,
} from '@/services/itinerary-engine';
import { Activity } from '@/context/trips';

function makeActivity(overrides: Partial<Activity> & { id: string; title: string; day: number; time: string }): Activity {
  return { type: 'activity', ...overrides };
}

describe('timeToMinutes / minutesToTime', () => {
  test('converts time strings to minutes', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('14:15')).toBe(855);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  test('converts minutes back to time strings', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(855)).toBe('14:15');
    expect(minutesToTime(1439)).toBe('23:59');
  });

  test('round-trips correctly', () => {
    for (const t of ['08:00', '12:30', '17:45', '22:00']) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t);
    }
  });
});

describe('getTripDayCount', () => {
  test('returns 1 for same-day trip', () => {
    expect(getTripDayCount('2026-05-01', '2026-05-01')).toBe(1);
  });

  test('returns correct count for multi-day trip', () => {
    expect(getTripDayCount('2026-05-01', '2026-05-07')).toBe(7);
  });

  test('handles month boundary', () => {
    expect(getTripDayCount('2026-01-30', '2026-02-02')).toBe(4);
  });
});

describe('checkConflicts', () => {
  test('detects overlapping activities when both have explicit durations', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00', duration: 90 }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '10:00', duration: 60 }),
    ];
    const conflicts = checkConflicts(activities, 1);
    const overlaps = conflicts.filter((c) => c.type === 'overlap');
    expect(overlaps.length).toBe(1);
    expect(overlaps[0].severity).toBe('error');
    expect(overlaps[0].activityIds).toContain('1');
    expect(overlaps[0].activityIds).toContain('2');
  });

  test('detects activities at the exact same time', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00' }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '09:00' }),
    ];
    const conflicts = checkConflicts(activities, 1);
    expect(conflicts.filter((c) => c.type === 'overlap').length).toBe(1);
  });

  test('no overlap when activities do not collide', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00', duration: 60 }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '10:00', duration: 60 }),
    ];
    const conflicts = checkConflicts(activities, 1);
    expect(conflicts.filter((c) => c.type === 'overlap').length).toBe(0);
  });

  test('no overlap when only one activity has a duration', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Dinner', day: 1, time: '19:00' }),
      makeActivity({ id: '2', title: 'Walk', day: 1, time: '19:45', duration: 30 }),
    ];
    const conflicts = checkConflicts(activities, 1);
    expect(conflicts.filter((c) => c.type === 'overlap').length).toBe(0);
  });
});

describe('reflowDay', () => {
  test('preserves locked activity times', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Locked', day: 1, time: '12:00', duration: 60, locked: true }),
      makeActivity({ id: '2', title: 'Flex1', day: 1, time: '09:00', duration: 60 }),
      makeActivity({ id: '3', title: 'Flex2', day: 1, time: '10:00', duration: 60 }),
    ];
    const result = reflowDay(activities, 1, '09:00');
    const locked = result.find((a) => a.id === '1')!;
    expect(locked.time).toBe('12:00');
  });

  test('does not move activities from other days', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Day1', day: 1, time: '09:00', duration: 60 }),
      makeActivity({ id: '2', title: 'Day2', day: 2, time: '10:00', duration: 60 }),
    ];
    const result = reflowDay(activities, 1, '09:00');
    const day2Act = result.find((a) => a.id === '2')!;
    expect(day2Act.time).toBe('10:00');
    expect(day2Act.day).toBe(2);
  });

  test('spaces flexible activities with gaps', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00', duration: 60 }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '09:00', duration: 60 }),
    ];
    const result = reflowDay(activities, 1, '09:00');
    const day1 = result.filter((a) => a.day === 1).sort((a, b) => a.time.localeCompare(b.time));
    // Second activity should start after first + gap
    const firstEnd = timeToMinutes(day1[0].time) + 60;
    const secondStart = timeToMinutes(day1[1].time);
    expect(secondStart).toBeGreaterThanOrEqual(firstEnd);
  });
});

describe('computeChangePreview', () => {
  test('all locked/fixed activities go to protectedLocked', () => {
    const current: Activity[] = [
      makeActivity({ id: '1', title: 'Locked1', day: 1, time: '09:00', locked: true }),
      makeActivity({ id: '2', title: 'Fixed1', day: 1, time: '12:00', fixed: true }),
      makeActivity({ id: '3', title: 'Free', day: 1, time: '14:00' }),
    ];
    // proposed has same activities with no changes
    const proposed = [...current];
    const preview = computeChangePreview(current, proposed, 'test');

    expect(preview.protectedLocked.length).toBe(2);
    expect(preview.protectedLocked.map((a) => a.id).sort()).toEqual(['1', '2']);
    expect(preview.staying.map((a) => a.id)).toEqual(['3']);
  });

  test('detects removed activities as changing', () => {
    const current: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00' }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '12:00' }),
    ];
    const proposed: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00' }),
    ];
    const preview = computeChangePreview(current, proposed, 'removed B');
    expect(preview.changing.map((a) => a.id)).toContain('2');
  });

  test('detects new activities as changing', () => {
    const current: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00' }),
    ];
    const proposed: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00' }),
      makeActivity({ id: '2', title: 'New', day: 1, time: '12:00' }),
    ];
    const preview = computeChangePreview(current, proposed, 'added new');
    expect(preview.changing.map((a) => a.id)).toContain('2');
  });

  test('detects time changes as changing', () => {
    const current: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00' }),
    ];
    const proposed: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '11:00' }),
    ];
    const preview = computeChangePreview(current, proposed, 'moved');
    expect(preview.changing.map((a) => a.id)).toContain('1');
    expect(preview.staying.length).toBe(0);
  });
});

describe('getPlanHealth', () => {
  test('returns healthy when no issues', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00', type: 'food', duration: 60 }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '11:00', duration: 60 }),
    ];
    const health = getPlanHealth(activities, 1);
    expect(health.status).toBe('healthy');
    expect(health.issueCount).toBe(0);
  });

  test('returns issues when there are hard conflicts', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'A', day: 1, time: '09:00', duration: 120 }),
      makeActivity({ id: '2', title: 'B', day: 1, time: '10:00', duration: 60 }),
    ];
    const health = getPlanHealth(activities, 1);
    expect(health.status).toBe('issues');
    expect(health.issueCount).toBeGreaterThan(0);
  });
});

describe('reflowFromTime', () => {
  test('pushes upcoming activities forward by delay', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Past', day: 1, time: '09:00', duration: 60 }),
      makeActivity({ id: '2', title: 'Upcoming1', day: 1, time: '11:00', duration: 60 }),
      makeActivity({ id: '3', title: 'Upcoming2', day: 1, time: '14:00', duration: 60 }),
    ];
    const result = reflowFromTime(activities, 1, '10:30', 30);
    expect(result.find((a) => a.id === '1')!.time).toBe('09:00'); // before fromTime, unchanged
    expect(result.find((a) => a.id === '2')!.time).toBe('11:30'); // pushed 30 min
    expect(result.find((a) => a.id === '3')!.time).toBe('14:30'); // pushed 30 min
  });

  test('does not move locked activities', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Locked', day: 1, time: '12:00', duration: 60, locked: true }),
      makeActivity({ id: '2', title: 'Flexible', day: 1, time: '14:00', duration: 60 }),
    ];
    const result = reflowFromTime(activities, 1, '11:00', 60);
    expect(result.find((a) => a.id === '1')!.time).toBe('12:00'); // locked, unchanged
    expect(result.find((a) => a.id === '2')!.time).toBe('15:00'); // pushed 60 min
  });

  test('caps activities at 23:30', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Late', day: 1, time: '22:00', duration: 60 }),
    ];
    const result = reflowFromTime(activities, 1, '21:00', 120);
    expect(result[0].time).toBe('23:30');
  });

  test('does not affect other days', () => {
    const activities: Activity[] = [
      makeActivity({ id: '1', title: 'Day1', day: 1, time: '10:00', duration: 60 }),
      makeActivity({ id: '2', title: 'Day2', day: 2, time: '10:00', duration: 60 }),
    ];
    const result = reflowFromTime(activities, 1, '09:00', 30);
    expect(result.find((a) => a.id === '1')!.time).toBe('10:30');
    expect(result.find((a) => a.id === '2')!.time).toBe('10:00'); // day 2 unchanged
  });
});
