/**
 * AM/PM time picker modal + optional duration control.
 * Replaces raw HH:MM text inputs throughout the app.
 */

import { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
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

/** Parse "HH:MM" to { hour12, minute, period }. Returns sensible defaults on bad input. */
function parseTime(time: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour12: 12, minute: 0, period: 'PM' };
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const { hour12, period } = from24(Math.min(h, 23));
  return { hour12, minute: Math.min(m, 59), period };
}

/** Format back to "HH:MM" 24-hour string for storage. */
function formatTime(hour12: number, minute: number, period: 'AM' | 'PM'): string {
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
  showDuration,
  duration,
  onDurationChange,
}: {
  visible: boolean;
  value: string;
  onSelect: (time: string) => void;
  onClose: () => void;
  showDuration?: boolean;
  duration?: number;
  onDurationChange?: (mins: number) => void;
}) {
  const theme = useTheme();
  const parsed = parseTime(value);
  const [hour, setHour] = useState(parsed.hour12);
  const [minute, setMinute] = useState(parsed.minute);
  const [period, setPeriod] = useState(parsed.period);
  const [localDuration, setLocalDuration] = useState(duration ?? 60);
  const [showCustomDuration, setShowCustomDuration] = useState(false);
  const [customHours, setCustomHours] = useState('');
  const [customMinutes, setCustomMinutes] = useState('');
  const [customDurationError, setCustomDurationError] = useState('');

  // Snap minute to nearest 5
  const snappedMinute = Math.round(minute / 5) * 5;

  function handleConfirm() {
    let finalDuration = localDuration;
    if (showCustomDuration) {
      const h = parseInt(customHours || '0', 10);
      const m = parseInt(customMinutes || '0', 10);
      if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 12 && m >= 0 && m <= 59 && (h * 60 + m) >= 1) {
        finalDuration = h * 60 + m;
      } else {
        setCustomDurationError('Enter valid hours (0\u201312) and minutes (0\u201359), total \u2265 1 min');
        return;
      }
    }
    onSelect(formatTime(hour, snappedMinute, period));
    if (showDuration && onDurationChange) {
      onDurationChange(finalDuration);
    }
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={pickerStyles.kavContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={pickerStyles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Pressable style={[pickerStyles.sheet, { backgroundColor: theme.background }]} onPress={(e) => { e.stopPropagation(); Keyboard.dismiss(); }} accessibilityRole="button" accessibilityLabel="Time picker">
          <View style={pickerStyles.handle} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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

          {/* Duration */}
          {showDuration && (
            <>
              <ThemedText type="eyebrow" style={[pickerStyles.label, { color: theme.textSecondary }]}>Duration</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pickerStyles.chipScroll}>
                {DURATION_PRESETS.map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => { setLocalDuration(d); setShowCustomDuration(false); setCustomDurationError(''); }}
                    style={[pickerStyles.chip, { backgroundColor: !showCustomDuration && localDuration === d ? theme.primary : theme.backgroundElement }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatDuration(d)} duration`}
                  >
                    <ThemedText style={[pickerStyles.chipText, !showCustomDuration && localDuration === d && { color: theme.primaryText }]}>
                      {formatDuration(d)}
                    </ThemedText>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => {
                    const h = Math.floor(localDuration / 60);
                    const m = localDuration % 60;
                    setCustomHours(String(h));
                    setCustomMinutes(String(m));
                    setCustomDurationError('');
                    setShowCustomDuration(true);
                  }}
                  style={[pickerStyles.chip, { backgroundColor: showCustomDuration ? theme.primary : theme.backgroundElement }]}
                  accessibilityRole="button"
                  accessibilityLabel="Custom duration"
                >
                  <ThemedText style={[pickerStyles.chipText, showCustomDuration && { color: theme.primaryText }]}>Custom</ThemedText>
                </Pressable>
              </ScrollView>
              {showCustomDuration && (
                <View style={pickerStyles.customDurationRow}>
                  <TextInput
                    style={[pickerStyles.customDurationInput, { color: theme.text, borderColor: customDurationError ? '#DC2626' : theme.border }]}
                    value={customHours}
                    onChangeText={(v) => { setCustomHours(v.replace(/[^0-9]/g, '')); setCustomDurationError(''); }}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={theme.textSecondary}
                    maxLength={2}
                  />
                  <ThemedText style={[pickerStyles.customDurationUnit, { color: theme.textSecondary }]}>h</ThemedText>
                  <TextInput
                    style={[pickerStyles.customDurationInput, { color: theme.text, borderColor: customDurationError ? '#DC2626' : theme.border }]}
                    value={customMinutes}
                    onChangeText={(v) => { setCustomMinutes(v.replace(/[^0-9]/g, '')); setCustomDurationError(''); }}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={theme.textSecondary}
                    maxLength={2}
                  />
                  <ThemedText style={[pickerStyles.customDurationUnit, { color: theme.textSecondary }]}>m</ThemedText>
                  {customDurationError ? (
                    <ThemedText style={pickerStyles.customDurationError}>{customDurationError}</ThemedText>
                  ) : null}
                </View>
              )}
            </>
          )}

          {/* Actions */}
          <View style={pickerStyles.actions}>
            <Pressable onPress={onClose} style={[pickerStyles.cancelBtn, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="Cancel">
              <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
            </Pressable>
            <Pressable onPress={handleConfirm} style={[pickerStyles.confirmBtn, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel="Set time">
              <ThemedText style={{ color: theme.primaryText, fontSize: 15, fontWeight: '700' }}>Set</ThemedText>
            </Pressable>
          </View>
          </ScrollView>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============ TimePickerButton — tappable pill that opens the modal ============

export function TimePickerButton({
  value,
  onChange,
  placeholder,
  showDuration,
  duration,
  onDurationChange,
}: {
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
  showDuration?: boolean;
  duration?: number;
  onDurationChange?: (mins: number) => void;
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
          {showDuration && duration ? ` (${formatDuration(duration)})` : ''}
        </ThemedText>
      </Pressable>
      <TimePickerModal
        key={`${value || '12:00'}-${duration ?? 60}`}
        visible={visible}
        value={value || '12:00'}
        onSelect={onChange}
        onClose={() => setVisible(false)}
        showDuration={showDuration}
        duration={duration}
        onDurationChange={onDurationChange}
      />
    </>
  );
}

const pickerStyles = StyleSheet.create({
  kavContainer: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    borderRadius: 20,
    padding: 24,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 360,
    overflow: 'visible' as const,
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
  periodRow: { flexDirection: 'row', gap: 10, marginTop: 12, justifyContent: 'center', overflow: 'visible' as const, minHeight: 48 },
  periodBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
  },
  periodText: { fontSize: 16, fontWeight: '700' },
  preview: { textAlign: 'center', fontSize: 24, fontWeight: '700', marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  button: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 80,
  },
  buttonText: { fontSize: 15 },
  customDurationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  customDurationInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    width: 90,
  },
  customDurationUnit: { fontSize: 14 },
  customDurationError: { fontSize: 12, color: '#DC2626', flex: 1 },
});
