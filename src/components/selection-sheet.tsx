/**
 * Cross-platform scrollable selection sheet.
 * Replaces Alert.alert with variable button counts (max 3 on Android).
 * Supports any number of options, a subtitle, scrolling, and Cancel.
 */

import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface SelectionOption {
  label: string;
  value: string;
}

export interface SelectionSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: SelectionOption[];
  onSelect: (value: string) => void;
  onClose: () => void;
}

export function SelectionSheet({
  visible,
  title,
  subtitle,
  options,
  onSelect,
  onClose,
}: SelectionSheetProps) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="button" accessibilityLabel="Selection sheet"
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />

          <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText
              style={[styles.subtitle, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {subtitle}
            </ThemedText>
          ) : null}

          <ScrollView
            style={styles.optionList}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {options.map((opt, i) => (
              <Pressable
                key={opt.value}
                style={({ pressed }) => [
                  styles.option,
                  { borderTopColor: i === 0 ? theme.border : 'transparent',
                    borderBottomColor: theme.border },
                  pressed && { opacity: 0.65 },
                ]}
                onPress={() => onSelect(opt.value)}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
              >
                <ThemedText style={[styles.optionText, { color: theme.primary }]}>
                  {opt.label}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          <View style={[styles.cancelGap, { backgroundColor: theme.backgroundElement }]} />

          <Pressable
            style={({ pressed }) => [styles.option, styles.cancelOption, pressed && { opacity: 0.65 }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <ThemedText style={[styles.optionText, { color: theme.textSecondary }]}>
              Cancel
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingBottom: 32,
    paddingTop: 8,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  optionList: {
    flexGrow: 0,
  },
  option: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelOption: {
    borderTopWidth: 0,
  },
  optionText: {
    fontSize: 17,
  },
  cancelGap: {
    height: 8,
  },
});
