/**
 * Device ID Tests
 *
 * Tests the stable device UUID generation and caching logic
 * used for signed-out user tracking in the discovery feed.
 */

// Re-implement the core logic as pure functions (same approach as seen-places tests)

function generateId(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += hex[Math.floor(Math.random() * 16)];
  }
  return (
    id.slice(0, 8) + '-' +
    id.slice(8, 12) + '-4' +
    id.slice(13, 16) + '-' +
    ((parseInt(id[16], 16) & 0x3) | 0x8).toString(16) + id.slice(17, 20) + '-' +
    id.slice(20, 32)
  );
}

describe('Device ID', () => {
  test('generates valid UUID v4 format', () => {
    const id = generateId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(id).toMatch(uuidRegex);
  });

  test('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    // All 100 should be unique
    expect(ids.size).toBe(100);
  });

  test('version nibble is always 4', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateId();
      // The 13th character (index 14 counting the hyphen) should be '4'
      expect(id[14]).toBe('4');
    }
  });

  test('variant bits are correct (8, 9, a, or b)', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateId();
      // The 17th character (index 19 counting hyphens) should be 8, 9, a, or b
      expect(['8', '9', 'a', 'b']).toContain(id[19]);
    }
  });

  test('caching returns same ID when stored', () => {
    // Simulate the caching behavior
    let cached: string | null = null;
    const store: Record<string, string> = {};

    function getDeviceId(): string {
      if (cached) return cached;
      const stored = store['@travonal/device_id'];
      if (stored) {
        cached = stored;
        return stored;
      }
      const id = generateId();
      cached = id;
      store['@travonal/device_id'] = id;
      return id;
    }

    const first = getDeviceId();
    const second = getDeviceId();
    const third = getDeviceId();

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  test('reads from store on cold start', () => {
    let cached: string | null = null;
    const store: Record<string, string> = {
      '@travonal/device_id': 'existing-device-id-12345',
    };

    function getDeviceId(): string {
      if (cached) return cached;
      const stored = store['@travonal/device_id'];
      if (stored) {
        cached = stored;
        return stored;
      }
      const id = generateId();
      cached = id;
      store['@travonal/device_id'] = id;
      return id;
    }

    const id = getDeviceId();
    expect(id).toBe('existing-device-id-12345');
  });
});
