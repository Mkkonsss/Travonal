/**
 * Shared DatePickerModal used in both trip creation and trip editing.
 * Auto-scrolls month and day lists to the selected date when opened.
 * Supports minDate to prevent selecting end dates before start dates.
 */

import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

interface DatePickerModalProps {
  visible: boolean;
  label: string;
  /** Current value as YYYY-MM-DD. If empty, defaults to today. */
  value: string;
  onSelect: (date: string) => void;
  onClose: () => void;
  /** YYYY-MM-DD — days before this date are disabled. */
  minDate?: string;
}

export function DatePickerModal({
  visible,
  label,
  value,
  onSelect,
  onClose,
  minDate,
}: DatePickerModalProps) {
  const theme = useTheme();
  const now = new Date();

  // Parse existing value or default to today
  let initYear = now.getFullYear();
  let initMonth = now.getMonth();
  let initDay = now.getDate();
  if (value) {
    const [y, m, d] = value.split('-').map(Number);
    if (y && m && d) { initYear = y; initMonth = m - 1; initDay = d; }
  }

  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);
  const [day, setDay] = useState(initDay);

  // Re-sync state when the modal becomes visible or value changes
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!visible) return;
    const now2 = new Date();
    let y2 = now2.getFullYear();
    let mo2 = now2.getMonth();
    let d2 = now2.getDate();
    if (value) {
      const parts = value.split('-').map(Number);
      if (parts[0] && parts[1] && parts[2]) { y2 = parts[0]; mo2 = parts[1] - 1; d2 = parts[2]; }
    }
    setYear(y2);
    setMonth(mo2);
    setDay(d2);
  }, [visible, value]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const maxDay = daysInMonth(year, month);
  const clampedDay = Math.min(day, maxDay);

  // Parse minDate for disabling earlier days
  let minYear = 0, minMonth = 0, minDay = 0;
  if (minDate) {
    const [my, mm, md] = minDate.split('-').map(Number);
    if (my && mm && md) { minYear = my; minMonth = mm - 1; minDay = md; }
  }

  function isDayDisabled(d: number): boolean {
    if (!minDate || !minYear) return false;
    if (year > minYear) return false;
    if (year < minYear) return true;
    if (month > minMonth) return false;
    if (month < minMonth) return true;
    return d < minDay;
  }

  // Auto-scroll refs
  const monthScrollRef = useRef<ScrollView>(null);
  const dayScrollRef = useRef<ScrollView>(null);

  // Stable refs so the open-effect can read current values without re-firing on changes
  const monthRef = useRef(month);
  const clampedDayRef = useRef(clampedDay);
  useEffect(() => { monthRef.current = month; }, [month]);
  useEffect(() => { clampedDayRef.current = clampedDay; }, [clampedDay]);

  // Scroll to selected month/day ONLY when modal opens (visible transitions false→true)
  useEffect(() => {
    if (!visible) return;
    const CHIP_WIDTH = 56; // approximate chip width + gap
    const DAY_CHIP_WIDTH = 44;

    const monthTimer = setTimeout(() => {
      monthScrollRef.current?.scrollTo({ x: Math.max(0, monthRef.current * CHIP_WIDTH - 60), y: 0, animated: false });
    }, 50);
    const dayTimer = setTimeout(() => {
      dayScrollRef.current?.scrollTo({ x: Math.max(0, (clampedDayRef.current - 1) * DAY_CHIP_WIDTH - 60), y: 0, animated: false });
    }, 50);

    return () => { clearTimeout(monthTimer); clearTimeout(dayTimer); };
  }, [visible]);

  function confirm() {
    const d = Math.min(clampedDay, maxDay);
    // Enforce minDate: if the resulting date is before minDate, clamp to minDate
    if (minYear && minMonth !== undefined && minDay) {
      const selectedMs = Date.UTC(year, month, d);
      const minMs = Date.UTC(minYear, minMonth, minDay);
      if (selectedMs < minMs) {
        // Clamp to minDate instead of silently accepting an invalid date
        const dateStr = `${minYear}-${String(minMonth + 1).padStart(2, '0')}-${String(minDay).padStart(2, '0')}`;
        onSelect(dateStr);
        onClose();
        return;
      }
    }
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    onSelect(dateStr);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()} accessibilityRole="button" accessibilityLabel="Date picker">
          <View style={styles.handle} />
          <ThemedText type="subtitle" style={styles.title}>{label}</ThemedText>

          {/* Year */}
          <ThemedText type="eyebrow" style={[styles.label, { color: theme.textSecondary }]}>Year</ThemedText>
          <View style={styles.yearRow}>
            <Pressable
              onPress={() => {
                const newYear = year - 1;
                setYear(newYear);
                const maxDayInMonth = daysInMonth(newYear, month);
                if (day > maxDayInMonth) setDay(maxDayInMonth);
              }}
              style={[styles.arrow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Previous year"
            >
              <ThemedText style={[styles.arrowText, { color: theme.primary }]}>{'\u2039'}</ThemedText>
            </Pressable>
            <ThemedText style={styles.yearValue}>{year}</ThemedText>
            <Pressable
              onPress={() => {
                const newYear = year + 1;
                setYear(newYear);
                const maxDayInMonth = daysInMonth(newYear, month);
                if (day > maxDayInMonth) setDay(maxDayInMonth);
              }}
              style={[styles.arrow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Next year"
            >
              <ThemedText style={[styles.arrowText, { color: theme.primary }]}>{'\u203A'}</ThemedText>
            </Pressable>
          </View>

          {/* Month */}
          <ThemedText type="eyebrow" style={[styles.label, { color: theme.textSecondary }]}>Month</ThemedText>
          <ScrollView ref={monthScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
            {MONTHS.map((m, i) => (
              <Pressable
                key={m}
                onPress={() => {
                  setMonth(i);
                  // Clamp day only when needed (e.g. Jan 31 → Feb), not unconditionally
                  const maxDayInNewMonth = daysInMonth(year, i);
                  if (day > maxDayInNewMonth) setDay(maxDayInNewMonth);
                }}
                style={[styles.chip, { backgroundColor: month === i ? theme.primary : theme.backgroundElement }]}
                accessibilityRole="button"
                accessibilityLabel={m}
              >
                <ThemedText style={[styles.chipText, month === i && { color: theme.primaryText }]}>
                  {m.slice(0, 3)}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          {/* Day */}
          <ThemedText type="eyebrow" style={[styles.label, { color: theme.textSecondary }]}>Day</ThemedText>
          <ScrollView ref={dayScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
            {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => {
              const disabled = isDayDisabled(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => { if (!disabled) setDay(d); }}
                  style={[
                    styles.dayChip,
                    {
                      backgroundColor: clampedDay === d ? theme.primary : theme.backgroundElement,
                      opacity: disabled ? 0.3 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Day ${d}`}
                >
                  <ThemedText style={[styles.dayText, clampedDay === d && { color: theme.primaryText }]}>
                    {d}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Preview */}
          <ThemedText style={[styles.preview, { color: theme.text }]}>
            {MONTHS[month]} {clampedDay}, {year}
          </ThemedText>

          <View style={styles.actions}>
            <Pressable
              onPress={() => { onSelect(''); onClose(); }}
              style={[styles.clearBtn, { borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Clear date"
            >
              <ThemedText style={[styles.clearText, { color: theme.textSecondary }]}>Clear</ThemedText>
            </Pressable>
            <Pressable
              onPress={confirm}
              style={[styles.confirmBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Set date"
            >
              <ThemedText style={[styles.confirmText, { color: theme.primaryText }]}>Set date</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  arrow: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 22, fontWeight: '300', lineHeight: 26 },
  yearValue: { fontSize: 20, fontWeight: '700', minWidth: 60, textAlign: 'center' },
  chipScroll: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, minWidth: 48, alignItems: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  dayChip: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 14, fontWeight: '600' },
  preview: { textAlign: 'center', fontSize: 16, fontWeight: '600', marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  clearBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  clearText: { fontSize: 14, fontWeight: '600' },
  confirmBtn: { flex: 2, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '700' },
});
