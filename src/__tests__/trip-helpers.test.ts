import { resolveCountry } from '@/services/trip-helpers';

describe('resolveCountry', () => {
  test('resolves Paris to France', () => {
    expect(resolveCountry('Paris')).toBe('France');
  });

  test('resolves Tokyo to Japan', () => {
    expect(resolveCountry('Tokyo')).toBe('Japan');
  });

  test('resolves London to United Kingdom', () => {
    expect(resolveCountry('London')).toBe('United Kingdom');
  });

  test('is case insensitive', () => {
    expect(resolveCountry('PARIS')).toBe('France');
    expect(resolveCountry('paris')).toBe('France');
    expect(resolveCountry('Paris')).toBe('France');
  });

  test('returns null for unknown city', () => {
    expect(resolveCountry('Springfield')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(resolveCountry('')).toBeNull();
  });

  test('resolves NYC to United States', () => {
    expect(resolveCountry('NYC')).toBe('United States');
  });

  test('resolves Barcelona to Spain', () => {
    expect(resolveCountry('Barcelona')).toBe('Spain');
  });

  test('resolves Bali to Indonesia', () => {
    expect(resolveCountry('Bali')).toBe('Indonesia');
  });

  test('partial match — destination containing a city name', () => {
    // "New York City" should resolve because it contains "new york"
    const result = resolveCountry('New York City');
    expect(result).toBe('United States');
  });
});
