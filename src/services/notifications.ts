import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

/** Notification categories */
export type NotificationCategory = 'trip_reminder' | 'pulse_alert' | 'discovery' | 'general';

// Show notifications in foreground — but suppress pulse alerts (already visible in-app via alerts tab)
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const cat = notification.request.content.data?.category;
    const show = cat !== 'pulse_alert';
    return { shouldShowAlert: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

let permissionGranted = false;

/** Monotonic counter that increments when permission state changes. */
let permissionVersion = 0;

/** Callbacks to notify when permission state changes. */
const permissionListeners: Set<() => void> = new Set();

/**
 * Load the current OS permission state (non-prompt).
 * Should be called on app startup so `hasPermission()` reflects reality.
 */
export async function loadNotificationPermissionState(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
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

export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, string>,
  category?: NotificationCategory,
): Promise<boolean> {
  if (!permissionGranted) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { ...data, category: category ?? 'general' },
        categoryIdentifier: category ?? 'general',
      },
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

// ---------- Identifier helpers ----------
// Using stable identifiers per-trip means scheduling the same notification twice
// simply replaces it rather than creating a duplicate — no race conditions, no spam.

function departureId(tripId: string) { return `departure_${tripId}`; }
function briefingId(tripId: string, day: number) { return `briefing_${tripId}_d${day}`; }
function bookingId(tripId: string) { return `booking_${tripId}`; }
function alertCheckId(tripId: string) { return `alert_check_${tripId}`; }

// ---------- Fingerprint helpers (skip scheduling if nothing changed) ----------

const FP_KEY = 'notif_fp';

async function readFp(key: string): Promise<string | null> {
  try { return await AsyncStorage.getItem(`${FP_KEY}_${key}`); } catch { return null; }
}
async function writeFp(key: string, value: string): Promise<void> {
  try { await AsyncStorage.setItem(`${FP_KEY}_${key}`, value); } catch {}
}
async function clearFp(key: string): Promise<void> {
  try { await AsyncStorage.removeItem(`${FP_KEY}_${key}`); } catch {}
}

// ---------- Booking reminder ----------

/**
 * Schedule a booking reminder 7 days before the trip.
 * Using a stable identifier prevents duplicates even if called multiple times.
 */
export async function scheduleBookingReminders(
  tripId: string,
  destination: string,
  unbookedCount: number,
  tripStartDate: string,
): Promise<void> {
  if (Platform.OS === 'web' || !permissionGranted || unbookedCount === 0) return;

  const fp = `${tripId}:${tripStartDate}:${unbookedCount}`;
  if (await readFp(`booking_${tripId}`) === fp) return;

  const triggerDate = new Date(new Date(tripStartDate + 'T09:00:00').getTime() - 7 * 24 * 60 * 60 * 1000);
  if (triggerDate <= new Date()) return;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: bookingId(tripId),
      content: {
        title: `${destination} trip in 1 week`,
        body: `${unbookedCount} item${unbookedCount > 1 ? 's' : ''} still need${unbookedCount === 1 ? 's' : ''} booking. Tap to review.`,
        data: { category: 'trip_reminder', tripId },
        categoryIdentifier: 'trip_reminder',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
    await writeFp(`booking_${tripId}`, fp);
  } catch {}
}

export async function cancelBookingReminders(tripId: string): Promise<void> {
  try { await Notifications.cancelScheduledNotificationAsync(bookingId(tripId)); } catch {}
  await clearFp(`booking_${tripId}`);
}

// ---------- Departure reminder ----------

/**
 * Schedule a "trip starts tomorrow!" notification at 6 PM the day before.
 */
export async function scheduleDepartureReminder(
  tripId: string,
  destination: string,
  tripStartDate: string,
): Promise<void> {
  if (Platform.OS === 'web' || !permissionGranted) return;

  const fp = `${tripId}:${tripStartDate}`;
  if (await readFp(`departure_${tripId}`) === fp) return;

  const triggerDate = new Date(new Date(tripStartDate + 'T18:00:00').getTime() - 24 * 60 * 60 * 1000);
  if (triggerDate <= new Date()) return;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: departureId(tripId),
      content: {
        title: `${destination} trip starts tomorrow!`,
        body: 'Have a wonderful trip. Tap to review your itinerary.',
        data: { category: 'trip_reminder', tripId },
        categoryIdentifier: 'trip_reminder',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
    await writeFp(`departure_${tripId}`, fp);
  } catch {}
}

export async function cancelDepartureReminder(tripId: string): Promise<void> {
  try { await Notifications.cancelScheduledNotificationAsync(departureId(tripId)); } catch {}
  await clearFp(`departure_${tripId}`);
}

// ---------- Daily trip briefing ----------

/**
 * Schedule an 8 AM briefing for each day of the trip.
 * Each day uses a stable identifier so re-scheduling replaces rather than duplicates.
 */
export async function scheduleDailyBriefings(
  tripId: string,
  destination: string,
  tripStartDate: string,
  tripEndDate: string,
  activitiesByDay: Map<number, string[]>,
): Promise<void> {
  if (Platform.OS === 'web' || !permissionGranted) return;

  const totalActivities = Array.from(activitiesByDay.values()).reduce((s, a) => s + a.length, 0);
  const fp = `${tripId}:${tripStartDate}:${tripEndDate}:${totalActivities}`;
  if (await readFp(`briefing_${tripId}`) === fp) return;

  const now = new Date();
  const start = new Date(tripStartDate + 'T08:00:00');
  const end = new Date(tripEndDate + 'T23:59:59');

  let dayNum = 1;
  const current = new Date(start);
  while (current <= end) {
    if (current > now) {
      const dayActivities = activitiesByDay.get(dayNum) ?? [];
      const preview = dayActivities.length > 0
        ? dayActivities.slice(0, 3).join(', ') + (dayActivities.length > 3 ? ` +${dayActivities.length - 3} more` : '')
        : 'No activities planned yet';

      try {
        await Notifications.scheduleNotificationAsync({
          identifier: briefingId(tripId, dayNum),
          content: {
            title: `Day ${dayNum} in ${destination}`,
            body: preview,
            data: { category: 'trip_reminder', tripId },
            categoryIdentifier: 'trip_reminder',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(current) },
        });
      } catch {}
    }
    current.setDate(current.getDate() + 1);
    dayNum++;
  }

  await writeFp(`briefing_${tripId}`, fp);
}

export async function cancelDailyBriefings(tripId: string): Promise<void> {
  // Cancel all scheduled notifications whose identifier starts with the briefing prefix for this trip
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const prefix = `briefing_${tripId}_d`;
    await Promise.all(
      all
        .filter((n) => n.identifier.startsWith(prefix))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}))
    );
  } catch {}
  await clearFp(`briefing_${tripId}`);
}

// ---------- Alert check reminder ----------

/**
 * Schedule a "review alerts" notification 7 days before the trip.
 */
export async function scheduleAlertCheckReminder(
  tripId: string,
  destination: string,
  tripStartDate: string,
): Promise<void> {
  if (Platform.OS === 'web' || !permissionGranted) return;

  const fp = `${tripId}:${tripStartDate}`;
  if (await readFp(`alert_${tripId}`) === fp) return;

  const triggerDate = new Date(new Date(tripStartDate + 'T09:00:00').getTime() - 7 * 24 * 60 * 60 * 1000);
  if (triggerDate <= new Date()) return;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: alertCheckId(tripId),
      content: {
        title: `${destination} trip in 1 week`,
        body: 'Review the latest alerts and advisories for your upcoming trip.',
        data: { category: 'pulse_alert', tripId, openPulse: '1' },
        categoryIdentifier: 'pulse_alert',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
    await writeFp(`alert_${tripId}`, fp);
  } catch {}
}

export async function cancelAlertCheckReminder(tripId: string): Promise<void> {
  try { await Notifications.cancelScheduledNotificationAsync(alertCheckId(tripId)); } catch {}
  await clearFp(`alert_${tripId}`);
}

/**
 * Cancel ALL notifications for a trip (call when a trip is deleted).
 */
export async function cancelAllTripNotifications(tripId: string): Promise<void> {
  await Promise.all([
    cancelBookingReminders(tripId),
    cancelDepartureReminder(tripId),
    cancelDailyBriefings(tripId),
    cancelAlertCheckReminder(tripId),
  ]);
}

/**
 * Cancel scheduled notifications for any tripId not in the provided set.
 * Call on app startup to clean up stale notifications from deleted trips.
 */
export async function cancelOrphanedTripNotifications(activeTripIds: Set<string>): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const toCancel = all.filter((n) => {
      const tripId = n.content.data?.tripId as string | undefined;
      return tripId && !activeTripIds.has(tripId);
    });
    await Promise.all(toCancel.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})));
  } catch {}
}
