import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

let permissionGranted = false;

/** Monotonic counter that increments when permission state changes. */
let permissionVersion = 0;

/** Callbacks to notify when permission state changes. */
const permissionListeners: Set<() => void> = new Set();

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    const granted = status === 'granted';
    if (granted !== permissionGranted) {
      permissionGranted = granted;
      permissionVersion++;
      for (const cb of permissionListeners) cb();
    }
    return permissionGranted;
  } catch {
    return false;
  }
}

export async function scheduleLocalNotification(title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  if (!permissionGranted) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: data ?? {} },
      trigger: null, // immediate
    });
    return true;
  } catch {
    return false;
  }
}

export function hasPermission(): boolean {
  return permissionGranted;
}

/**
 * Returns a monotonic counter that changes when notification permission state changes.
 * React components can use this as an effect dependency to re-evaluate when permission resolves.
 */
export function getPermissionVersion(): number {
  return permissionVersion;
}

/**
 * Subscribe to permission changes. Returns an unsubscribe function.
 */
export function onPermissionChange(callback: () => void): () => void {
  permissionListeners.add(callback);
  return () => { permissionListeners.delete(callback); };
}

/**
 * Set up a listener for notification taps.
 * Returns an unsubscribe function. The handler receives the data payload.
 */
export function onNotificationTap(handler: (data: Record<string, unknown>) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data ?? {};
    handler(data as Record<string, unknown>);
  });
  return () => subscription.remove();
}

/**
 * Open the OS notification settings for this app.
 */
export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openSettings();
  } else if (Platform.OS === 'android') {
    await Linking.openSettings();
  }
}
