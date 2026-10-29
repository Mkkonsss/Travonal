/**
 * The backend allows 60 photo requests a minute. Photos keep under that, check the shared cache
 * together instead of one by one, and wait out a refusal instead of giving up on the photo.
 */

jest.mock('@/services/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

type Photos = typeof import('@/services/free-photos') & typeof import('@/services/photo-budget');

/** Fresh copies of the photo modules — their caches and budget are module state. */
function load(): Photos {
  let loaded!: Photos;
  jest.isolateModules(() => {
    loaded = {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ...require('@/services/photo-budget'),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ...require('@/services/free-photos'),
    };
  });
  return loaded;
}

interface EdgeCall { action: string; payload: any }

/** Fake edge function: answers each action with `reply`, records what was asked. */
function mockEdge(reply: (call: EdgeCall, nth: number) => { status?: number; data?: unknown }): EdgeCall[] {
  const calls: EdgeCall[] = [];
  globalThis.fetch = jest.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const call = JSON.parse(String(init?.body)) as EdgeCall;
    calls.push(call);
    const { status = 200, data } = reply(call, calls.filter((c) => c.action === call.action).length);
    return {
      ok: status < 300,
      status,
      headers: { get: (name: string) => (name === 'Retry-After' && status === 429 ? '60' : null) },
      json: async () => (status < 300 ? { success: true, data } : { success: false, error: 'Rate limit exceeded.' }),
    };
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  (globalThis as any).__DEV__ = false;
  jest.useFakeTimers({ now: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('photoRequestSlot', () => {
  test('lets 50 photo requests through in a minute and holds the next one until a slot frees', async () => {
    const { photoRequestSlot } = load();
    for (let i = 0; i < 50; i++) await photoRequestSlot();

    let released = false;
    photoRequestSlot().then(() => { released = true; });
    await jest.advanceTimersByTimeAsync(59_000);
    expect(released).toBe(false);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(released).toBe(true);
  });

  test('holds photo requests while the backend has asked us to wait', async () => {
    const { photoRequestSlot, pausePhotoRequests } = load();
    pausePhotoRequests(60);

    let released = false;
    photoRequestSlot().then(() => { released = true; });
    await jest.advanceTimersByTimeAsync(59_999);
    expect(released).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(released).toBe(true);
  });
});

describe('getPlacePhoto', () => {
  test('photos asked for together share one saved-photo check, and saved ones are not downloaded again', async () => {
    const { getPlacePhoto } = load();
    const calls = mockEdge(({ action }) => action === 'photo_cache_lookup'
      ? { data: { photos: { a: 'https://cdn.test/a.jpg' } } }
      : { data: { url: 'https://cdn.test/b.jpg', stored: true } });

    const pending = Promise.all([
      getPlacePhoto({ cacheKey: 'a', photoRef: 'places/a/photos/1' }),
      getPlacePhoto({ cacheKey: 'b', photoRef: 'places/b/photos/1' }),
    ]);
    await jest.advanceTimersByTimeAsync(100);

    expect(await pending).toEqual([
      { url: 'https://cdn.test/a.jpg', source: 'cache' },
      { url: 'https://cdn.test/b.jpg', source: 'cache' },
    ]);
    expect(calls).toEqual([
      { action: 'photo_cache_lookup', payload: { placeIds: ['a', 'b'] } },
      { action: 'photo_cache_store', payload: { placeId: 'b', photoRef: 'places/b/photos/1' } },
    ]);
  });

  test('downloads a place asked for twice at once only once', async () => {
    const { getPlacePhoto } = load();
    const calls = mockEdge(({ action }) => action === 'photo_cache_lookup'
      ? { data: { photos: {} } }
      : { data: { url: 'https://cdn.test/c.jpg', stored: false } });

    const pending = Promise.all([
      getPlacePhoto({ cacheKey: 'c', photoRef: 'places/c/photos/1' }),
      getPlacePhoto({ cacheKey: 'c', photoRef: 'places/c/photos/1' }),
    ]);
    await jest.advanceTimersByTimeAsync(100);

    expect((await pending).map((r) => r?.url)).toEqual(['https://cdn.test/c.jpg', 'https://cdn.test/c.jpg']);
    expect(calls.map((c) => c.action)).toEqual(['photo_cache_lookup', 'photo_cache_store']);
  });

  test('waits out a rate-limit refusal and tries again instead of marking the photo missing', async () => {
    const { getPlacePhoto } = load();
    const calls = mockEdge(({ action }, nth) => {
      if (action === 'photo_cache_lookup') return { data: { photos: {} } };
      return nth === 1 ? { status: 429 } : { data: { url: 'https://cdn.test/d.jpg', stored: false } };
    });

    let result: unknown;
    getPlacePhoto({ cacheKey: 'd', photoRef: 'places/d/photos/1' }).then((r) => { result = r; });
    await jest.advanceTimersByTimeAsync(100);
    expect(calls.filter((c) => c.action === 'photo_cache_store')).toHaveLength(1);
    expect(result).toBeUndefined();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls.filter((c) => c.action === 'photo_cache_store')).toHaveLength(2);
    expect(result).toEqual({ url: 'https://cdn.test/d.jpg', source: 'google' });
  });
});
