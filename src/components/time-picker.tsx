/**
 * AM/PM time picker modal + optional duration control.
 * Replaces raw HH:MM text inputs throughout the app.
 */

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
export const MINUTES_5 = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const MINUTES = MINUTES_5;
export const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 180];

function to24(hour12: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function from24(hour24: number): { hour12: number; period: 'AM' | 'PM' } {
  if (hour24 === 0) return { hour12: 12, period: 'AM' };
  if (hour24 < 12) return { hour12: hour24, period: 'AM' };
  if (hour24 === 12) return { hour12: 12, period: 'PM' };
  return { hour12: hour24 - 12, period: 'PM' };
}

/** Parse "HH:MM" or "h:MM AM/PM" to { hour12, minute, period }. Returns sensible defaults on bad input. */
export function parseTime(time: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
  // 24-hour format (e.g. "09:00", "19:30")
  const match24 = time.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1], 10);
    const m = parseInt(match24[2], 10);
    const { hour12, period } = from24(Math.min(h, 23));
    return { hour12, minute: Math.min(m, 59), period };
  }
  // 12-hour with AM/PM (e.g. "7:00 PM") — handles corrupted stored data
  const match12 = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    const h = parseInt(match12[1], 10);
    const m = parseInt(match12[2], 10);
    const period = match12[3].toUpperCase() as 'AM' | 'PM';
    if (h >= 1 && h <= 12) return { hour12: h, minute: Math.min(m, 59), period };
  }
  return { hour12: 12, minute: 0, period: 'PM' };
}

/** Format back to "HH:MM" 24-hour string for storage. */
export function formatTime(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  const h24 = to24(hour12, period);
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Format "HH:MM" to display string like "2:30 PM". */
export function formatTimeDisplay(time: string): string {
  const { hour12, minute, period } = parseTime(time);
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** Format duration in minutes to display string. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Default duration based on activity type. */
export function defaultDurationForType(type: string): number {
  switch (type) {
    case 'food': return 60;
    case 'hotel': return 480;
    case 'flight': return 180;
    default: return 60;
  }
}

/** Default time based on activity type. */
export function defaultTimeForType(type: string): string {
  switch (type) {
    case 'food': return '12:00';
    case 'hotel': return '15:00';
    case 'flight': return '10:00';
    default: return '10:00';
  }
}

// ============ TimePickerModal ============

export function TimePickerModal({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: string;
  onSelect: (time: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const parsed = parseTime(value);
  const [hour, setHour] = useState(parsed.hour12);
  const [minute, setMinute] = useState(parsed.minute);
  const [period, setPeriod] = useState(parsed.period);

  // Snap minute to nearest 5
  const snappedMinute = Math.round(minute / 5) * 5;

  function handleConfirm() {
    onSelect(formatTime(hour, snappedMinute, period));
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={pickerStyles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Pressable style={[pickerStyles.sheet, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()} accessibilityRole="button" accessibilityLabel="Time picker">
          <View style={pickerStyles.handle} />
          <ThemedText type="subtitle" style={pickerStyles.title}>Set time</ThemedText>

          {/* Hour */}
          <ThemedText type="eyebrow" style={[pickerStyles.label, { color: theme.textSecondary }]}>Hour</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pickerStyles.chipScroll}>
            {HOURS_12.map((h) => (
              <Pressable
                key={h}
                onPress={() => setHour(h)}
                style={[pickerStyles.chip, { backgroundColor: hour === h ? theme.primary : theme.backgroundElement }]}
                accessibilityRole="button"
                accessibilityLabel={`${h} o'clock`}
              >
                <ThemedText style={[pickerStyles.chipText, hour === h && { color: theme.primaryText }]}>{h}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          {/* Minute */}
          <ThemedText type="eyebrow" style={[pickerStyles.label, { color: theme.textSecondary }]}>Minute</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pickerStyles.chipScroll}>
            {MINUTES.map((m) => (
              <Pressable
                key={m}
                onPress={() => setMinute(m)}
                style={[pickerStyles.chip, { backgroundColor: snappedMinute === m ? theme.primary : theme.backgroundElement }]}
                accessibilityRole="button"
                accessibilityLabel={`${String(m).padStart(2, '0')} minutes`}
              >
                <ThemedText style={[pickerStyles.chipText, snappedMinute === m && { color: theme.primaryText }]}>
                  {String(m).padStart(2, '0')}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          {/* AM/PM */}
          <View style={pickerStyles.periodRow}>
            {(['AM', 'PM'] as const).map((p) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={[pickerStyles.periodBtn, { backgroundColor: period === p ? theme.primary : theme.backgroundElement }]}
                accessibilityRole="button"
                accessibilityLabel={p}
              >
                <ThemedText style={[pickerStyles.periodText, period === p && { color: theme.primaryText }]}>{p}</ThemedText>
              </Pressable>
            ))}
          </View>

          {/* Preview */}
          <ThemedText style={[pickerStyles.preview, { color: theme.text }]}>
            {hour}:{String(snappedMinute).padStart(2, '0')} {period}
          </ThemedText>

          {/* Actions */}
          <View style={pickerStyles.actions}>
            <Pressable onPress={onClose} style={[pickerStyles.cancelBtn, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="Cancel">
              <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
            </Pressable>
            <Pressable onPress={handleConfirm} style={[pickerStyles.confirmBtn, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel="Set time">
              <ThemedText style={{ color: theme.primaryText, fontSize: 15, fontWeight: '700' }}>Set</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ============ TimePickerButton — tappable pill that opens the modal ============

export function TimePickerButton({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
}) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const display = value ? formatTimeDisplay(value) : (placeholder ?? 'Set time');

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={[pickerStyles.button, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
        accessibilityRole="button"
        accessibilityLabel={display}
      >
        <ThemedText style={[pickerStyles.buttonText, { color: value ? theme.text : theme.textSecondary }]}>
          {display}
        </ThemedText>
      </Pressable>
      <TimePickerModal
        key={value || '12:00'}
        visible={visible}
        value={value || '12:00'}
        onSelect={onChange}
        onClose={() => setVisible(false)}
      />
    </>
  );
}

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    borderRadius: Radius.lg,
    padding: 24,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 360,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { textAlign: 'center', marginBottom: 16 },
  label: { marginBottom: 8, marginTop: 8 },
  chipScroll: { gap: 6, paddingVertical: 4 },
  chip: {
    minWidth: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  chipText: { fontSize: 15, fontWeight: '600' },
  periodRow: { flexDirection: 'row', gap: 10, marginTop: 12, justifyContent: 'center', minHeight: 48 },
  periodBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: Radius.md,
  },
  periodText: { fontSize: 16, fontWeight: '700' },
  preview: { textAlign: 'center', fontSize: 24, fontWeight: '700', marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  button: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 80,
  },
  buttonText: { fontSize: 15 },
});
