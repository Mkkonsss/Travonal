/**
 * Cross-platform action sheet for trip-level actions.
 * Replaces Alert.alert with 4 buttons, which overflows on Android (max 3).
 */

import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export interface TripActionSheetProps {
  visible: boolean;
  title: string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function TripActionSheet({
  visible,
  title,
  onOpen,
  onEdit,
  onDelete,
  onClose,
}: TripActionSheetProps) {
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
          accessibilityRole="button"
          accessibilityLabel="Action sheet"
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>
            {title}
          </ThemedText>

          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
            onPress={() => { onClose(); onOpen(); }}
            accessibilityRole="button"
            accessibilityLabel="Open trip"
          >
            <ThemedText style={[styles.actionText, { color: theme.primary }]}>Open trip</ThemedText>
          </Pressable>

          <View style={[styles.separator, { backgroundColor: theme.border }]} />

          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
            onPress={() => { onClose(); onEdit(); }}
            accessibilityRole="button"
            accessibilityLabel="Edit trip"
          >
            <ThemedText style={[styles.actionText, { color: theme.text }]}>Edit trip</ThemedText>
          </Pressable>

          <View style={[styles.separator, { backgroundColor: theme.border }]} />

          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete trip"
          >
            <ThemedText style={[styles.actionText, styles.destructive]}>Delete trip</ThemedText>
          </Pressable>

          <View style={[styles.cancelSeparator, { backgroundColor: theme.border }]} />

          <Pressable
            style={({ pressed }) => [styles.action, styles.cancel, pressed && { opacity: 0.7 }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <ThemedText style={[styles.actionText, { color: theme.textSecondary }]}>Cancel</ThemedText>
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
    paddingTop: 8,
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
    paddingBottom: 12,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
  },
  cancelSeparator: {
    height: 8,
  },
  action: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  cancel: {
    marginTop: 0,
  },
  actionText: {
    fontSize: 17,
  },
  destructive: {
    color: '#E53935',
  },
});
