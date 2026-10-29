import { getAlternatives, findReplacement, findSurprise } from '@/services/alternatives-pool';
import { Activity } from '@/context/trips';

describe('getAlternatives', () => {
  test('returns the same generic ideas for every destination', () => {
    for (const destination of ['Tokyo', 'Barcelona', 'Kyoto', 'Atlantis']) {
      const pool = getAlternatives(destination);
      expect(pool.length).toBeGreaterThan(0);
      expect(pool.some((p) => p.title === 'Walking city tour')).toBe(true);
    }
  });

  // Guideline 2.1(a) / 1.1.6: the quick-edit ideas must never carry made-up venue details
  test('contains no made-up ratings, reviews, hours or verified badges', () => {
    for (const p of getAlternatives('Tokyo')) {
      expect(p.rating).toBeUndefined();
      expect(p.reviewCount).toBeUndefined();
      expect(p.reviews).toBeUndefined();
      expect(p.reviewSummary).toBeUndefined();
      expect(p.hours).toBeUndefined();
      expect(p.openNow).toBeUndefined();
      expect(p.verified).toBeUndefined();
    }
  });

  test('contains no named sample venues or fake hotels', () => {
    const titles = getAlternatives('Tokyo').map((p) => p.title);
    expect(titles).not.toContain('Senso-ji Temple');
    expect(titles).not.toContain('Tsukemen at Fuunji');
    expect(titles).not.toContain('Casa Batllo tour');
    expect(getAlternatives('Paris').some((p) => p.type === 'hotel')).toBe(false);
  });
});

describe('findReplacement', () => {
  const baseActivity: Activity = {
    id: '1',
    title: 'Museum visit',
    type: 'activity',
    day: 1,
    time: '10:00',
    category: 'art',
  };

  test('returns a replacement that is not the same activity', () => {
    const replacement = findReplacement('Tokyo', baseActivity);
    expect(replacement).not.toBeNull();
    expect(replacement!.title).not.toBe('Museum visit');
  });

  test('prefers same type when available', () => {
    const replacement = findReplacement('Tokyo', baseActivity);
    expect(replacement).not.toBeNull();
    expect(replacement!.type).toBe('activity');
  });

  test('respects budget filter', () => {
    const replacement = findReplacement('Tokyo', baseActivity, { budget: 'budget' });
    expect(replacement).not.toBeNull();
    expect(['free', 'budget']).toContain(replacement!.cost);
  });

  test('avoids crowds when requested', () => {
    const replacement = findReplacement('Tokyo', baseActivity, { avoidCrowds: true });
    expect(replacement).not.toBeNull();
    expect(replacement!.crowdLevel).toBe('low');
  });

  test('never returns the activity being replaced', () => {
    const food: Activity = { id: '1', title: 'Local market visit', type: 'food', day: 1, time: '12:00' };
    const result = findReplacement('Tokyo', food, { dislikes: ['Crowds'] });
    expect(result === null || result.title !== food.title).toBe(true);
  });
});

describe('findSurprise', () => {
  test('returns an activity not in existingTitles', () => {
    const existing = ['Walking city tour', 'Museum visit'];
    const surprise = findSurprise('Tokyo', existing, ['Art & Museums'], []);
    expect(surprise).not.toBeNull();
    expect(existing).not.toContain(surprise!.title);
  });

  test('returns null when all alternatives already exist', () => {
    const allTitles = getAlternatives('Kyoto').map((p) => p.title);
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
