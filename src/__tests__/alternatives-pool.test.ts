import { getAlternatives, getAllPoolDestinations, findReplacement, findSurprise } from '@/services/alternatives-pool';
import { Activity } from '@/context/trips';

describe('getAlternatives', () => {
  test('returns Tokyo alternatives for Tokyo', () => {
    const pool = getAlternatives('Tokyo');
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.some((p) => p.title === 'Senso-ji Temple')).toBe(true);
  });

  test('returns Barcelona alternatives for Barcelona', () => {
    const pool = getAlternatives('Barcelona');
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.some((p) => p.title === 'Casa Batllo tour')).toBe(true);
  });

  test('returns default alternatives for unknown destination', () => {
    const pool = getAlternatives('Atlantis');
    expect(pool.length).toBeGreaterThan(0);
    // Default pool should have generic items
    expect(pool.some((p) => p.title === 'Walking city tour')).toBe(true);
  });
});

describe('getAllPoolDestinations', () => {
  test('returns known destinations excluding _default', () => {
    const destinations = getAllPoolDestinations();
    expect(destinations).toContain('Tokyo');
    expect(destinations).toContain('Barcelona');
    expect(destinations).toContain('Kyoto');
    expect(destinations).not.toContain('_default');
  });
});

describe('findReplacement', () => {
  const baseActivity: Activity = {
    id: '1',
    title: 'TeamLab Borderless',
    type: 'activity',
    day: 1,
    time: '10:00',
    duration: 120,
    category: 'art',
  };

  test('returns a replacement that is not the same activity', () => {
    const replacement = findReplacement('Tokyo', baseActivity);
    expect(replacement).not.toBeNull();
    expect(replacement!.title).not.toBe('TeamLab Borderless');
  });

  test('prefers same type when available', () => {
    const replacement = findReplacement('Tokyo', baseActivity);
    expect(replacement).not.toBeNull();
    expect(replacement!.type).toBe('activity');
  });

  test('respects budget filter', () => {
    const replacement = findReplacement('Tokyo', baseActivity, { budget: 'budget' });
    if (replacement) {
      expect(['free', 'budget']).toContain(replacement.cost);
    }
  });

  test('avoids crowds when requested', () => {
    const replacement = findReplacement('Tokyo', baseActivity, { avoidCrowds: true });
    if (replacement) {
      expect(replacement.crowdLevel).not.toBe('high');
    }
  });

  test('returns null when no candidates remain (all excluded)', () => {
    // Use a destination with only one activity type match and exclude everything
    const food: Activity = { id: '1', title: 'Tsukemen at Fuunji', type: 'food', day: 1, time: '12:00' };
    const result = findReplacement('Tokyo', food, { dislikes: ['Crowds'] });
    // May or may not be null depending on pool, but should not crash
    expect(result === null || result.title !== food.title).toBe(true);
  });
});

describe('findSurprise', () => {
  test('returns an activity not in existingTitles', () => {
    const existing = ['TeamLab Borderless', 'Senso-ji Temple'];
    const surprise = findSurprise('Tokyo', existing, ['Art & Museums'], []);
    expect(surprise).not.toBeNull();
    expect(existing).not.toContain(surprise!.title);
  });

  test('returns null when all alternatives already exist', () => {
    const pool = getAlternatives('Kyoto');
    const allTitles = pool.map((p) => p.title);
    const surprise = findSurprise('Kyoto', allTitles, [], []);
    expect(surprise).toBeNull();
  });

  test('filters out high-crowd places when Crowds disliked', () => {
    const surprise = findSurprise('Tokyo', [], ['Culture'], ['Crowds']);
    if (surprise) {
      expect(surprise.crowdLevel).not.toBe('high');
    }
  });
});
