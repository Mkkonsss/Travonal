/**
 * offline-trips.ts — download and serve trip data for offline use.
 *
 * Photos (the only network-dependent asset in a trip) are downloaded to the
 * device's document directory and served via local file:// URIs when the
 * user is offline or the trip has been explicitly downloaded.
 *
 * Manifest stored in AsyncStorage under MANIFEST_KEY.
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFLINE_DIR = (FileSystem.documentDirectory ?? '') + 'offline_trips/';
const MANIFEST_KEY = 'offline_trips_manifest_v1';

interface TripOfflineEntry {
  downloadedAt: string;
  /** cacheKey (placeId or activityId) → local file:// URI */
  photoMap: Record<string, string>;
}

type OfflineManifest = Record<string, TripOfflineEntry>;

// ─── Manifest helpers ────────────────────────────────────────────────────────

async function readManifest(): Promise<OfflineManifest> {
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY);
    return raw ? (JSON.parse(raw) as OfflineManifest) : {};
  } catch {
    return {};
  }
}

async function writeManifest(manifest: OfflineManifest): Promise<void> {
  try {
    await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  } catch {}
}

// ─── Directory helpers ────────────────────────────────────────────────────────

async function ensureDir(tripId: string): Promise<string> {
  const dir = OFFLINE_DIR + tripId + '/';
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Returns true if this trip has been downloaded for offline use. */
export async function isOfflineAvailable(tripId: string): Promise<boolean> {
  const manifest = await readManifest();
  return !!manifest[tripId];
}

/**
 * Download all photos in the provided map to device storage.
 * `photoMap` is Map<cacheKey, https_url> — the same map returned by useActivityPhotos.
 * `onProgress(done, total)` is called after each photo completes.
 */
export async function downloadTripForOffline(
  tripId: string,
  photoMap: Map<string, string>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const dir = await ensureDir(tripId);
  const manifest = await readManifest();
  const existing = manifest[tripId]?.photoMap ?? {};
  const localMap: Record<string, string> = { ...existing };

  const entries = Array.from(photoMap.entries()).filter(([, url]) => url.startsWith('http'));
  const total = entries.length;
  let done = 0;

  for (const [key, url] of entries) {
    const ext = url.includes('.jpg') ? 'jpg' : url.includes('.png') ? 'png' : 'jpg';
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const localUri = dir + safeKey + '.' + ext;

    try {
      // Skip if already downloaded
      const info = await FileSystem.getInfoAsync(localUri);
      if (!info.exists) {
        await FileSystem.downloadAsync(url, localUri);
      }
      localMap[key] = localUri;
    } catch {
      // Skip failed photo — trip still usable with placeholder
    }

    done++;
    onProgress?.(done, total);
  }

  manifest[tripId] = {
    downloadedAt: new Date().toISOString(),
    photoMap: localMap,
  };
  await writeManifest(manifest);
}

/**
 * Returns the local photo map for a downloaded trip, or null if not downloaded.
 * Keys match those from useActivityPhotos (placeId or activityId).
 */
export async function getOfflinePhotoMap(tripId: string): Promise<Map<string, string> | null> {
  const manifest = await readManifest();
  const entry = manifest[tripId];
  if (!entry) return null;
  return new Map(Object.entries(entry.photoMap));
}

/** Remove all downloaded files and the manifest entry for this trip. */
export async function deleteOfflineTrip(tripId: string): Promise<void> {
  const dir = OFFLINE_DIR + tripId + '/';
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    }
  } catch {}
  const manifest = await readManifest();
  delete manifest[tripId];
  await writeManifest(manifest);
}

/** Returns approximate size of downloaded files in bytes, or 0 if not downloaded. */
export async function getOfflineSize(tripId: string): Promise<number> {
  const manifest = await readManifest();
  const entry = manifest[tripId];
  if (!entry) return 0;
  let total = 0;
  for (const localUri of Object.values(entry.photoMap)) {
    try {
      const info = await FileSystem.getInfoAsync(localUri, { size: true });
      if (info.exists && 'size' in info) total += (info as FileSystem.FileInfo & { size: number }).size ?? 0;
    } catch {}
  }
  return total;
}

/** Human-readable size string, e.g. "12 MB". */
export function formatOfflineSize(bytes: number): string {
  if (bytes === 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
