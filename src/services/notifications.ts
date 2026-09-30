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

// ---------- Booking reminder notifications ----------

const BOOKING_REMINDER_KEY = 'booking_reminder_ids';

/**
 * Schedule booking reminder notifications for a trip.
 * Schedules at 14 days and 7 days before the trip start date.
 * Cancels any existing reminders for this trip first.
 */
export async function scheduleBookingReminders(
  tripId: string,
  destination: string,
  unbookedCount: number,
  tripStartDate: string,
): Promise<void> {
  if (Platform.OS === 'web' || !permissionGranted || unbookedCount === 0) return;

  // Cancel existing reminders for this trip
  await cancelBookingReminders(tripId);

  const start = new Date(tripStartDate + 'T09:00:00');
  const now = new Date();
  const ids: string[] = [];

  const triggers = [
    { days: 14, label: '2 weeks' },
    { days: 7, label: '1 week' },
    { days: 1, label: '1 day' },
  ];

  for (const { days, label } of triggers) {
    const triggerDate = new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
    if (triggerDate <= now) continue;

    try {
      const isLastDay = days === 1;
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: isLastDay
            ? `Leaving tomorrow — ${unbookedCount} item${unbookedCount > 1 ? 's' : ''} still unbooked`
            : `${destination} trip in ${label}`,
          body: isLastDay
            ? `Your ${destination} trip starts tomorrow. Tap to review unbooked items.`
            : `${unbookedCount} item${unbookedCount > 1 ? 's' : ''} still need${unbookedCount === 1 ? 's' : ''} booking. Tap to review.`,
          data: { category: 'trip_reminder', tripId },
          categoryIdentifier: 'trip_reminder',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
      });
      ids.push(id);
    } catch {
      // Trigger date may be invalid on some platforms
    }
  }

  if (ids.length > 0) {
    await saveReminderIds(tripId, ids);
  }
}

/**
 * Cancel all booking reminders for a specific trip.
 */
export async function cancelBookingReminders(tripId: string): Promise<void> {
  const allReminders = await loadAllReminderIds();
  const ids = allReminders[tripId];
  if (!ids || ids.length === 0) return;

  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // Already cancelled or expired
    }
  }

  delete allReminders[tripId];
  await AsyncStorage.setItem(BOOKING_REMINDER_KEY, JSON.stringify(allReminders));
}

async function saveReminderIds(tripId: string, ids: string[]): Promise<void> {
  const allReminders = await loadAllReminderIds();
  allReminders[tripId] = ids;
  await AsyncStorage.setItem(BOOKING_REMINDER_KEY, JSON.stringify(allReminders));
}

async function loadAllReminderIds(): Promise<Record<string, string[]>> {
  try {
    const raw = await AsyncStorage.getItem(BOOKING_REMINDER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ---------- Departure reminder ----------

const DEPARTURE_REMINDER_KEY = 'departure_reminder_ids';

/**
 * Schedule a "Your trip starts tomorrow!" notification at 6 PM the day before.
 * Cancels any existing departure reminder for this trip first.
 */
export async function scheduleDepartureReminder(
  tripId: string,
  destination: string,
  tripStartDate: string,
): Promise<void> {
  if (Platform.OS === 'web' || !permissionGranted) return;

  await cancelDepartureReminder(tripId);

  const start = new Date(tripStartDate + 'T18:00:00'); // 6 PM
  const triggerDate = new Date(start.getTime() - 24 * 60 * 60 * 1000); // day before at 6 PM
  const now = new Date();
  if (triggerDate <= now) return;

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${destination} trip starts tomorrow!`,
        body: 'Have a wonderful trip. Tap to review your itinerary.',
        data: { category: 'trip_reminder', tripId },
        categoryIdentifier: 'trip_reminder',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
    const all = await loadDepartureIds();
    all[tripId] = id;
    await AsyncStorage.setItem(DEPARTURE_REMINDER_KEY, JSON.stringify(all));
  } catch {
    // Trigger date invalid
  }
}

export async function cancelDepartureReminder(tripId: string): Promise<void> {
  const all = await loadDepartureIds();
  const id = all[tripId];
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already cancelled
  }
  delete all[tripId];
  await AsyncStorage.setItem(DEPARTURE_REMINDER_KEY, JSON.stringify(all));
}

async function loadDepartureIds(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(DEPARTURE_REMINDER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ---------- Daily trip briefing ----------

const BRIEFING_KEY = 'daily_briefing_ids';

/**
 * Schedule a morning briefing notification for each day of the trip.
 * Fires at 8 AM local time with a summary of today's activities.
 * Cancels any existing briefings for this trip first.
 */
export async function scheduleDailyBriefings(
  tripId: string,
  destination: string,
  tripStartDate: string,
  tripEndDate: string,
  activitiesByDay: Map<number, string[]>,
): Promise<void> {
  if (Platform.OS === 'web' || !permissionGranted) return;

  await cancelDailyBriefings(tripId);

  const start = new Date(tripStartDate + 'T08:00:00');
  const end = new Date(tripEndDate + 'T23:59:59');
  const now = new Date();
  const ids: string[] = [];

  let dayNum = 1;
  const current = new Date(start);
  while (current <= end) {
    if (current > now) {
      const dayActivities = activitiesByDay.get(dayNum) ?? [];
      const preview = dayActivities.length > 0
        ? dayActivities.slice(0, 3).join(', ') + (dayActivities.length > 3 ? ` +${dayActivities.length - 3} more` : '')
        : 'No activities planned yet';

      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `Day ${dayNum} in ${destination}`,
            body: preview,
            data: { category: 'trip_reminder', tripId },
            categoryIdentifier: 'trip_reminder',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(current) },
        });
        ids.push(id);
      } catch {
        // Skip invalid dates
      }
    }
    current.setDate(current.getDate() + 1);
    dayNum++;
  }

  if (ids.length > 0) {
    const all = await loadBriefingIds();
    all[tripId] = ids;
    await AsyncStorage.setItem(BRIEFING_KEY, JSON.stringify(all));
  }
}

export async function cancelDailyBriefings(tripId: string): Promise<void> {
  const all = await loadBriefingIds();
  const ids = all[tripId];
  if (!ids || ids.length === 0) return;
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // Already cancelled
    }
  }
  delete all[tripId];
  await AsyncStorage.setItem(BRIEFING_KEY, JSON.stringify(all));
}

async function loadBriefingIds(): Promise<Record<string, string[]>> {
  try {
    const raw = await AsyncStorage.getItem(BRIEFING_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
