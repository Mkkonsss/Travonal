/**
 * Device ID Service
 *
 * Generates and persists a stable UUID for signed-out users so the
 * discovery feed can track served places and avoid repetition even
 * without authentication. On sign-in, the Edge Function migrates
 * device history to the authenticated user.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@travonal/device_id';

let _cached: string | null = null;

function generateId(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += hex[Math.floor(Math.random() * 16)];
  }
  // Format as UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return (
    id.slice(0, 8) + '-' +
    id.slice(8, 12) + '-4' +
    id.slice(13, 16) + '-' +
    ((parseInt(id[16], 16) & 0x3) | 0x8).toString(16) + id.slice(17, 20) + '-' +
    id.slice(20, 32)
  );
}

/**
 * Get the stable device ID, creating one if it doesn't exist.
 * The ID persists across app restarts via AsyncStorage.
 */
export async function getDeviceId(): Promise<string> {
  if (_cached) return _cached;

  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      _cached = stored;
      return stored;
    }
  } catch {
    // Storage read failed — generate a new one
  }

  const id = generateId();
  _cached = id;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Best-effort persist — if it fails, we'll generate a new one next time
  }
  return id;
}

/**
 * Get the cached device ID synchronously, or null if not yet loaded.
 * Call getDeviceId() first to ensure it's populated.
 */
export function getDeviceIdSync(): string | null {
  return _cached;
}
