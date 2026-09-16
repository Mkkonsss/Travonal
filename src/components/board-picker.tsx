import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { BoardsIcon } from '@/components/icons';
import { Radius, Spacing } from '@/constants/theme';
import { useBoards } from '@/context/boards';
import { useTheme } from '@/hooks/use-theme';

interface BoardPickerProps {
  visible: boolean;
  onSelect: (boardId: string) => void;
  onClose: () => void;
  /** Hide this board from the list (e.g. the board you're moving from) */
  excludeBoardId?: string;
}

export function BoardPicker({ visible, onSelect, onClose, excludeBoardId }: BoardPickerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { boards, createBoard } = useBoards();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<TextInput>(null);

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const id = createBoard(name);
    setNewName('');
    setShowCreate(false);
    onSelect(id);
  }

  function handleClose() {
    setShowCreate(false);
    setNewName('');
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={styles.backdrop} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 }]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="button"
          accessibilityLabel="Board picker"
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <ThemedText type="subtitle" style={styles.title}>Save to board</ThemedText>

          {/* Create new board */}
          {showCreate ? (
            <View style={[styles.createRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <TextInput
                ref={inputRef}
                value={newName}
                onChangeText={setNewName}
                placeholder="Board name..."
                placeholderTextColor={theme.textSecondary}
                style={[styles.createInput, { color: theme.text }]}
                returnKeyType="done"
                onSubmitEditing={handleCreate}
                autoFocus
              />
              <Pressable onPress={handleCreate} disabled={!newName.trim()} accessibilityRole="button">
                <SymbolView name="checkmark.circle.fill" size={28} tintColor={newName.trim() ? theme.primary : theme.border} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => { setShowCreate(true); setTimeout(() => inputRef.current?.focus(), 100); }}
              style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              <View style={[styles.optionIcon, { backgroundColor: theme.primaryMuted }]}>
                <SymbolView name="plus" size={18} tintColor={theme.primary} />
              </View>
              <ThemedText style={[styles.optionLabel, { color: theme.primary }]}>Create new board</ThemedText>
            </Pressable>
          )}

          {boards.length > 0 && <View style={[styles.separator, { backgroundColor: theme.border }]} />}

          {/* Existing boards */}
          <ScrollView style={styles.boardList} showsVerticalScrollIndicator={false}>
            {[...boards]
              .filter((b) => b.id !== excludeBoardId)
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((board, i) => (
                <View key={board.id}>
                  {i > 0 && <View style={[styles.itemSeparator, { backgroundColor: theme.border }]} />}
                  <Pressable
                    onPress={() => onSelect(board.id)}
                    style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${board.name}, ${board.items.length} items`}
                  >
                    <View style={[styles.optionIcon, { backgroundColor: theme.backgroundElement }]}>
                      <BoardsIcon size={18} color={theme.textSecondary} />
                    </View>
                    <View style={styles.optionInfo}>
                      <ThemedText style={styles.optionLabel}>{board.name}</ThemedText>
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>
                        {board.items.length} {board.items.length === 1 ? 'item' : 'items'}
                      </ThemedText>
                    </View>
                  </Pressable>
                </View>
              ))}
          </ScrollView>

          <Pressable
            onPress={handleClose}
            style={[styles.cancel, { backgroundColor: theme.backgroundElement }]}
            accessibilityRole="button"
          >
            <ThemedText style={{ fontWeight: '600' }}>Cancel</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
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
    paddingTop: 12,
    paddingHorizontal: Spacing.four,
    maxHeight: '70%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
    marginBottom: 20,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginBottom: 8,
  },
  createInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 6,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  boardList: {
    maxHeight: 300,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionInfo: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  itemSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 54,
  },
  cancel: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
});
