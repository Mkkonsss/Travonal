import { useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { Alert, Dimensions, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { BoardsIcon } from '@/components/icons';
import { Spacing, Radius } from '@/constants/theme';
import { useBoards, Board } from '@/context/boards';
import { useTheme } from '@/hooks/use-theme';
import { prefetchPhotosFromCache, getCachedPhotoUrl } from '@/services/free-photos';

const SCREEN_WIDTH = Dimensions.get('window').width;
const BOARD_PADDING = Spacing.four * 2;
const BOARD_GAP = 12;
const BOARD_CARD_WIDTH = (SCREEN_WIDTH - BOARD_PADDING - BOARD_GAP) / 2;
const PREVIEW_HEIGHT = BOARD_CARD_WIDTH * 0.85;

// ─── Board Cover ────────────────────────────────────────────────────────────

function BoardCover({ board, resolvedPhotos }: { board: Board; resolvedPhotos: Record<string, string> }) {
  const theme = useTheme();
  // Build image list: prefer mediaUri, fallback to resolved photo from cache
  const imageUris: string[] = [];
  for (const item of board.items) {
    if (imageUris.length >= 3) break;
    const uri = (item.mediaUri && item.mediaType === 'image')
      ? item.mediaUri
      : (item.placeId ? resolvedPhotos[item.placeId] : undefined);
    if (uri && !imageUris.includes(uri)) imageUris.push(uri);
  }
  const count = imageUris.length;

  if (count === 0) {
    return (
      <View style={[styles.coverEmpty, { backgroundColor: theme.backgroundElement }]}>
        <BoardsIcon size={28} color={theme.textSecondary} />
      </View>
    );
  }

  if (count === 1) {
    return (
      <ExpoImage
        source={{ uri: imageUris[0] }}
        style={styles.coverSingle}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    );
  }

  if (count === 2) {
    return (
      <View style={styles.coverRow}>
        <ExpoImage source={{ uri: imageUris[0] }} style={styles.coverHalf} contentFit="cover" cachePolicy="memory-disk" />
        <ExpoImage source={{ uri: imageUris[1] }} style={styles.coverHalf} contentFit="cover" cachePolicy="memory-disk" />
      </View>
    );
  }

  // 3+ images: 1 large left + 2 stacked right (Pinterest-style)
  return (
    <View style={styles.coverPinterest}>
      <ExpoImage source={{ uri: imageUris[0] }} style={styles.coverLarge} contentFit="cover" cachePolicy="memory-disk" />
      <View style={styles.coverStack}>
        <ExpoImage source={{ uri: imageUris[1] }} style={styles.coverSmall} contentFit="cover" cachePolicy="memory-disk" />
        <ExpoImage source={{ uri: imageUris[2] }} style={styles.coverSmall} contentFit="cover" cachePolicy="memory-disk" />
      </View>
    </View>
  );
}

// ─── Board Card ─────────────────────────────────────────────────────────────

function BoardCard({
  board,
  index,
  onPress,
  onDelete,
  resolvedPhotos,
}: {
  board: Board;
  index: number;
  onPress: () => void;
  onDelete: () => void;
  resolvedPhotos: Record<string, string>;
}) {
  const theme = useTheme();

  function handleLongPress() {
    Alert.alert('Delete board?', `Delete "${board.name}" and all its items?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <Pressable
        onPress={onPress}
        onLongPress={handleLongPress}
        style={({ pressed }) => [
          styles.boardCard,
          { opacity: pressed ? 0.88 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${board.name}, ${board.items.length} items`}
      >
        <View style={[styles.boardCover, { backgroundColor: theme.border }]}>
          <BoardCover board={board} resolvedPhotos={resolvedPhotos} />
        </View>
        <ThemedText style={styles.boardName} numberOfLines={1}>{board.name}</ThemedText>
        <ThemedText style={[styles.boardCount, { color: theme.textSecondary }]}>
          {board.items.length} {board.items.length === 1 ? 'pin' : 'pins'}
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

// ─── Create Board Card ──────────────────────────────────────────────────────

function CreateBoardCard({ onPress, index }: { onPress: () => void; index: number }) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.boardCard,
          { opacity: pressed ? 0.7 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Create a new board"
      >
        <View style={[styles.boardCover, styles.createCover, { borderColor: theme.border }]}>
          <SymbolView name="plus" size={28} tintColor={theme.textSecondary} />
        </View>
        <ThemedText style={styles.boardName}>New board</ThemedText>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function BoardsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { boards, createBoard, deleteBoard } = useBoards();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Fetch photos from shared cache for board cover images
  const [resolvedPhotos, setResolvedPhotos] = useState<Record<string, string>>({});
  useEffect(() => {
    const placeIds: string[] = [];
    for (const board of boards) {
      for (const item of board.items) {
        if (item.placeId && !item.mediaUri && !placeIds.includes(item.placeId)) {
          placeIds.push(item.placeId);
        }
      }
    }
    if (placeIds.length === 0) return;
    prefetchPhotosFromCache(placeIds).then(() => {
      const urls: Record<string, string> = {};
      for (const id of placeIds) {
        const url = getCachedPhotoUrl(id);
        if (url) urls[id] = url;
      }
      if (Object.keys(urls).length > 0) setResolvedPhotos(urls);
    });
  }, [boards]);

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const id = createBoard(name);
    setNewName('');
    setShowCreate(false);
    router.push(`/board-detail?boardId=${id}` as any);
  }

  function handleOpenCreate() {
    setShowCreate(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <View style={styles.headerSpacer} />
        <ThemedText style={styles.headerTitle}>Boards</ThemedText>
        <Pressable
          onPress={() => router.back()}
          style={[styles.headerSpacer, { alignItems: 'flex-end' }]}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <SymbolView name="xmark" size={20} tintColor={theme.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Create board inline input */}
        {showCreate && (
          <Animated.View entering={FadeIn.duration(200)} style={[styles.createInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <TextInput
              ref={inputRef}
              value={newName}
              onChangeText={setNewName}
              placeholder="Board name (e.g. Tokyo 2027)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.createTextInput, { color: theme.text }]}
              returnKeyType="done"
              onSubmitEditing={handleCreate}
              autoCapitalize="words"
            />
            <View style={styles.createActions}>
              <Pressable onPress={() => { setShowCreate(false); setNewName(''); }} style={styles.createCancelBtn} accessibilityRole="button">
                <ThemedText style={{ color: theme.textSecondary, fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                style={[styles.createConfirmBtn, { backgroundColor: newName.trim() ? theme.primary : theme.border }]}
                disabled={!newName.trim()}
                accessibilityRole="button"
              >
                <ThemedText style={{ color: newName.trim() ? '#fff' : theme.textSecondary, fontSize: 15, fontWeight: '600' }}>Create</ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {boards.length === 0 && !showCreate ? (
          <Animated.View entering={FadeIn.duration(400)} style={styles.emptyState}>
            <BoardsIcon size={48} color={theme.textSecondary} />
            <ThemedText type="headline">No boards yet</ThemedText>
            <ThemedText style={[styles.emptyDesc, { color: theme.textSecondary }]}>
              {"Create a board to organize your travel ideas. Add links, screenshots, or text — AI will sort everything and help you plan a trip."}
            </ThemedText>
            <Pressable
              onPress={handleOpenCreate}
              style={[styles.emptyCreateBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
            >
              <SymbolView name="plus" size={16} tintColor="#fff" />
              <ThemedText style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Create your first board</ThemedText>
            </Pressable>
          </Animated.View>
        ) : (
          <View style={styles.boardsGrid}>
            {boards
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((board, i) => (
                <BoardCard
                  key={board.id}
                  board={board}
                  index={i}
                  onPress={() => router.push(`/board-detail?boardId=${board.id}` as any)}
                  onDelete={() => deleteBoard(board.id)}
                  resolvedPhotos={resolvedPhotos}
                />
              ))}
            <CreateBoardCard onPress={handleOpenCreate} index={boards.length} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },
  headerSpacer: { width: 64 },
  scrollContent: { padding: Spacing.four },

  // Create input
  createInput: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  createTextInput: {
    fontSize: 17,
    fontWeight: '500',
    paddingVertical: 4,
  },
  createActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  createCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  createConfirmBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },

  // Boards grid
  boardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: BOARD_GAP,
  },
  boardCard: {
    width: BOARD_CARD_WIDTH,
    marginBottom: 4,
  },
  boardCover: {
    width: '100%',
    height: PREVIEW_HEIGHT,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },

  // Cover layouts
  coverEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverSingle: {
    flex: 1,
  },
  coverRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 2,
  },
  coverHalf: {
    flex: 1,
  },
  coverPinterest: {
    flex: 1,
    flexDirection: 'row',
    gap: 2,
  },
  coverLarge: {
    flex: 2,
  },
  coverStack: {
    flex: 1,
    gap: 2,
  },
  coverSmall: {
    flex: 1,
  },

  // Board info (below cover)
  boardName: { fontSize: 14, fontWeight: '700', marginTop: 8 },
  boardCount: { fontSize: 12, marginTop: 1 },

  // Create card
  createCover: {
    borderStyle: 'dashed',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },
  emptyCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: Radius.md,
    marginTop: 8,
  },
});
