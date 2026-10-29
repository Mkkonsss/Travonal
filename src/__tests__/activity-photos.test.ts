/**
 * Activity photo lookup by name — the search behind photos for activities with no placeId.
 * Several screens ask for the same activities at once (trip, bookings, the prefetcher),
 * so concurrent asks must share one search.
 */

import { photoForName } from '@/hooks/use-activity-photos';
import { fetchPlaceDetails, searchPlaceByName } from '@/services/explore-service';
import { getPlacePhoto } from '@/services/free-photos';

jest.mock('@/services/explore-service', () => ({
  searchExplorePlaces: jest.fn(),
  searchPlaceByName: jest.fn(),
  fetchPlaceDetails: jest.fn(),
}));
jest.mock('@/services/free-photos', () => ({
  prefetchPhotosFromCache: jest.fn(),
  getCachedPhotoUrl: jest.fn(),
  getPlacePhoto: jest.fn(),
}));
jest.mock('@/services/ai', () => ({ getPlaceDetailsAI: jest.fn() }));

const search = searchPlaceByName as jest.Mock;
const details = fetchPlaceDetails as jest.Mock;
const photo = getPlacePhoto as jest.Mock;

const hint = {
  key: 'Delta Hotels Toronto Markham::Toronto',
  name: 'Delta Hotels Toronto Markham',
  destination: 'Toronto',
};

beforeEach(() => jest.resetAllMocks());

describe('photoForName', () => {
  test('screens asking at the same time share one search', async () => {
    search.mockResolvedValue([{ placeId: 'p1', photos: [{ reference: 'ref1' }] }]);
    photo.mockResolvedValue({ url: 'https://cdn.test/p1.jpg', source: 'google' });

    const [a, b] = await Promise.all([photoForName(hint), photoForName({ ...hint })]);

    expect(a).toBe('https://cdn.test/p1.jpg');
    expect(b).toBe('https://cdn.test/p1.jpg');
    expect(search).toHaveBeenCalledTimes(1);
    expect(photo).toHaveBeenCalledTimes(1);
    expect(photo).toHaveBeenCalledWith({ cacheKey: hint.key, photoRef: 'ref1' });
  });

  test('searches again once the earlier lookup has finished', async () => {
    // A miss may be a dropped request — it must not stick
    search.mockResolvedValue([]);
    await photoForName(hint);
    await photoForName(hint);
    expect(search).toHaveBeenCalledTimes(2);
  });

  test('falls back to place details when the search result has no photo', async () => {
    search.mockResolvedValue([{ placeId: 'p2' }]);
    details.mockResolvedValue({ photos: [{ name: 'places/p2/photos/x' }] });
    photo.mockResolvedValue({ url: 'https://cdn.test/p2.jpg', source: 'google' });

    await expect(photoForName(hint)).resolves.toBe('https://cdn.test/p2.jpg');
    expect(details).toHaveBeenCalledWith('p2');
    expect(photo).toHaveBeenCalledWith({ cacheKey: hint.key, photoRef: 'places/p2/photos/x' });
  });

  test('resolves to null when there is no photo or a lookup fails', async () => {
    search.mockResolvedValue([{ placeId: 'p3' }]);
    details.mockResolvedValue(null);
    await expect(photoForName(hint)).resolves.toBeNull();
    expect(photo).not.toHaveBeenCalled();

    search.mockRejectedValue(new Error('offline'));
    await expect(photoForName(hint)).resolves.toBeNull();
  });
});
