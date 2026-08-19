import { simulateImportIdentification } from '@/services/mock-generator';

describe('simulateImportIdentification', () => {
  test('identifies restaurant/food source', () => {
    const result = simulateImportIdentification('restaurant-post');
    expect(result.type).toBe('food');
    expect(result.category).toBe('food');
    expect(result.title).toBeTruthy();
  });

  test('identifies museum/art source', () => {
    const result = simulateImportIdentification('museum-gallery');
    expect(result.type).toBe('activity');
    expect(result.category).toBe('art');
    expect(result.title).toBeTruthy();
  });

  test('identifies nature/hike source', () => {
    const result = simulateImportIdentification('hike-nature-trail');
    expect(result.type).toBe('activity');
    expect(result.title).toBeTruthy();
  });

  test('returns valid structure for unknown source', () => {
    const result = simulateImportIdentification('instagram-food');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('destination');
    expect(result).toHaveProperty('category');
    expect(result).toHaveProperty('cost');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('description');
    expect(result).toHaveProperty('tags');
    expect(result).toHaveProperty('type');
    expect(result.duration).toBeGreaterThan(0);
    expect(Array.isArray(result.tags)).toBe(true);
  });
});
