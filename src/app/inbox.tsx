import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useInbox, InboxItem } from '@/context/inbox';
import { useSavedPlaces } from '@/context/saved-places';
import { useTheme } from '@/hooks/use-theme';
import { deleteOwnedMedia } from '@/services/storage';

const TYPE_ICONS: Record<InboxItem['type'], string> = {
  photo: '\u{1F4F7}',
  video: '\u{1F3AC}',
  screenshot: '\u{1F4F7}',
  link: '\u{1F517}',
  saved_place: '\u{2665}',
};

const STATUS_LABELS: Record<InboxItem['status'], string> = {
  needs_trip: 'Not added to a trip yet',
  fits_current: 'Not added to a trip yet',
  planned: 'Planned',
};

/** Inline video player using expo-video. Renders an in-app VideoView inside a modal. */
function InboxVideoPlayer({ uri }: { uri: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });

  return (
    <>
      <Pressable
        onPress={() => { setOpen(true); player.play(); }}
        style={[styles.itemThumbnail, styles.videoButton, { backgroundColor: theme.backgroundElement }]}
        accessibilityRole="button"
        accessibilityLabel="Play video"
      >
        <ThemedText style={styles.videoPlayIcon}>{'\u25B6\uFE0F'}</ThemedText>
        <ThemedText style={[styles.videoButtonText, { color: theme.textSecondary }]}>Tap to play video</ThemedText>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => { player.pause(); setOpen(false); }}>
        <Pressable style={styles.videoModalBackdrop} onPress={() => { player.pause(); setOpen(false); }} accessibilityRole="button" accessibilityLabel="Close video">
          <Pressable style={styles.videoModalInner} onPress={(e) => e.stopPropagation()} accessibilityRole="button" accessibilityLabel="Video player">
            <VideoView
              player={player}
              style={styles.videoViewStyle}
              allowsPictureInPicture={false}
              contentFit="contain"
              nativeControls
            />
            <Pressable onPress={() => { player.pause(); setOpen(false); }} style={[styles.videoCloseBtn, { backgroundColor: theme.backgroundElement }]} accessibilityRole="button" accessibilityLabel="Close video">
              <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Close</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function InboxItemCard({
  item,
  index,
  onPlace,
  onRemove,
  onReopen,
  onMove,
}: {
  item: InboxItem;
  index: number;
  onPlace: () => void;
  onRemove: () => void;
  onReopen?: () => void;
  onMove?: () => void;
}) {
  const theme = useTheme();
  const [showFullImage, setShowFullImage] = useState(false);
  const [mediaError, setMediaError] = useState(false);

  function handleRemove() {
    Alert.alert(
      'Remove item?',
      `Remove "${item.title}" from your inbox?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: onRemove },
      ],
    );
  }

  function renderMedia() {
    if (!item.mediaUri) return null;
    if (mediaError) {
      return (
        <View style={[styles.itemThumbnail, styles.mediaUnavailable, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={[styles.mediaUnavailableText, { color: theme.textSecondary }]}>Media unavailable</ThemedText>
        </View>
      );
    }
    if (item.mediaType === 'image') {
      return (
        <>
          <Pressable onPress={() => setShowFullImage(true)} accessibilityRole="button" accessibilityLabel="View full image">
            <Image
              source={{ uri: item.mediaUri }}
              style={styles.itemThumbnail}
              resizeMode="cover"
              onError={() => setMediaError(true)}
            />
          </Pressable>
          <Modal visible={showFullImage} transparent animationType="fade" onRequestClose={() => setShowFullImage(false)}>
            <Pressable style={styles.fullImageBackdrop} onPress={() => setShowFullImage(false)} accessibilityRole="button" accessibilityLabel="Close image viewer">
              <Image
                source={{ uri: item.mediaUri }}
                style={styles.fullImage}
                resizeMode="contain"
                onError={() => { setMediaError(true); setShowFullImage(false); }}
              />
              <Pressable
                onPress={() => setShowFullImage(false)}
                style={styles.fullImageCloseBtn}
                accessibilityRole="button"
                accessibilityLabel="Close image"
              >
                <ThemedText style={styles.fullImageCloseText}>{'\u2715'}</ThemedText>
              </Pressable>
            </Pressable>
          </Modal>
        </>
      );
    }
    if (item.mediaType === 'video') {
      return <InboxVideoPlayer uri={item.mediaUri} />;
    }
    return null;
  }

  return (
    <Animated.View entering={FadeInDown.delay(index * 50).springify()}>
      <Pressable
        onPress={item.status !== 'planned' ? onPlace : undefined}
        onLongPress={handleRemove}
        style={({ pressed }) => [
          styles.itemCard,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${STATUS_LABELS[item.status]}`}
      >
        {renderMedia()}
        <View style={styles.itemRow}>
          <ThemedText style={styles.itemIcon}>{TYPE_ICONS[item.type]}</ThemedText>
          <View style={styles.itemInfo}>
            <ThemedText style={styles.itemTitle}>{item.title}</ThemedText>
            {item.destination && item.destination !== 'Unknown' && (
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {item.destination}
              </ThemedText>
            )}
            {item.description && (
              <ThemedText type="small" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {item.description}
              </ThemedText>
            )}
          </View>
          <View style={styles.itemRight}>
            {item.status === 'planned' ? (
              <View style={styles.plannedActions}>
                <View style={[styles.plannedBadge, { backgroundColor: theme.primaryMuted }]}>
                  <ThemedText style={[styles.plannedText, { color: theme.primary }]}>Planned</ThemedText>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {onMove && (
                    <Pressable
                      onPress={onMove}
                      style={[styles.reopenBtn, { borderColor: theme.border }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${item.title} to different trip`}
                      hitSlop={4}
                    >
                      <ThemedText style={[styles.reopenBtnText, { color: theme.textSecondary }]}>Move</ThemedText>
                    </Pressable>
                  )}
                  {onReopen && (
                    <Pressable
                      onPress={onReopen}
                      style={[styles.reopenBtn, { borderColor: theme.border }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Reopen ${item.title}`}
                      hitSlop={4}
                    >
                      <ThemedText style={[styles.reopenBtnText, { color: theme.textSecondary }]}>Reopen</ThemedText>
                    </Pressable>
                  )}
                </View>
              </View>
            ) : (
              <Pressable
                onPress={onPlace}
                style={[styles.addBtn, { backgroundColor: theme.primary }]}
                accessibilityRole="button"
                accessibilityLabel={`Add ${item.title} to trip`}
              >
                <ThemedText style={[styles.addBtnText, { color: theme.primaryText }]}>Add to trip</ThemedText>
              </Pressable>
            )}
            <Pressable
              onPress={handleRemove}
              style={styles.deleteBtn}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.title} from inbox`}
              hitSlop={6}
            >
              <ThemedText style={[styles.deleteBtnText, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
            </Pressable>
          </View>
        </View>
        {item.tags && item.tags.length > 0 && (
          <View style={styles.tagRow}>
            {item.tags.map((tag) => (
              <View key={tag} style={[styles.tag, { backgroundColor: theme.primaryMuted }]}>
                <ThemedText style={[styles.tagText, { color: theme.primary }]}>{tag}</ThemedText>
              </View>
            ))}
            {item.cost && (
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {item.cost === 'free' ? 'Free' : item.cost === 'budget' ? '$' : item.cost === 'moderate' ? '$$' : '$$$'}
                {item.duration ? ` \u00B7 ${item.duration}m` : ''}
              </ThemedText>
            )}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function InboxSection({
  title,
  items,
  emptyText,
  startIndex,
  onPlace,
  onRemove,
  onReopen,
  onMove,
}: {
  title: string;
  items: InboxItem[];
  emptyText: string;
  startIndex: number;
  onPlace: (item: InboxItem) => void;
  onRemove: (id: string) => void;
  onReopen?: (id: string) => void;
  onMove?: (item: InboxItem) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>
        {title} ({items.length})
      </ThemedText>
      {items.length === 0 ? (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {emptyText}
        </ThemedText>
      ) : (
        <View style={styles.itemList}>
          {items.map((item, i) => (
            <InboxItemCard
              key={item.id}
              item={item}
              index={startIndex + i}
              onPlace={() => onPlace(item)}
              onRemove={() => onRemove(item.id)}
              onReopen={onReopen ? () => onReopen(item.id) : undefined}
              onMove={onMove ? () => onMove(item) : undefined}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export default function InboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { items, removeItem, updateItem, getByStatus } = useInbox();
  const { unsavePlace, savedPlaces } = useSavedPlaces();

  const needsTrip = [...getByStatus('needs_trip'), ...getByStatus('fits_current')];
  const planned = getByStatus('planned');

  function handlePlace(item: InboxItem) {
    router.push(`/place-trip?itemId=${item.id}` as any);
  }

  function handleRemove(id: string) {
    const item = items.find((i) => i.id === id);
    if (item?.mediaUri) {
      deleteOwnedMedia(item.mediaUri);
    }
    // Unsave from saved places if this was a saved_place item
    if (item?.type === 'saved_place') {
      const match = savedPlaces.find((p) => p.title === item.title && p.destination === item.destination);
      if (match) unsavePlace(match.id);
    }
    removeItem(id);
  }

  function handleReopen(id: string) {
    updateItem(id, { status: 'needs_trip', tripId: undefined });
    // Navigate to place-trip so user can re-assign it
    router.push(`/place-trip?itemId=${id}` as any);
  }

  function handleMoveToTrip(item: InboxItem) {
    // Re-open and navigate to trip picker
    updateItem(item.id, { status: 'needs_trip', tripId: undefined });
    router.push(`/place-trip?itemId=${item.id}` as any);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <View style={styles.headerBtn} />
        <ThemedText style={styles.headerTitle}>Inbox</ThemedText>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close inbox"
        >
          <ThemedText style={[styles.headerClose, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Import buttons */}
        <View style={styles.importRow}>
          <Pressable
            onPress={() => router.push('/import-link')}
            style={({ pressed }) => [
              styles.importBtn,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Paste a link"
          >
            <ThemedText style={styles.importIcon}>{'\u{1F517}'}</ThemedText>
            <ThemedText style={styles.importLabel}>Paste a link</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => router.push('/import-screenshot')}
            style={({ pressed }) => [
              styles.importBtn,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Import media"
          >
            <ThemedText style={styles.importIcon}>{'\u{1F4F7}'}</ThemedText>
            <ThemedText style={styles.importLabel}>Import media</ThemedText>
          </Pressable>
        </View>

        {items.length === 0 ? (
          <Animated.View entering={FadeIn.duration(400)} style={styles.emptyState}>
            <ThemedText style={styles.emptyIcon}>{'\u{1F4E5}'}</ThemedText>
            <ThemedText type="headline">Your inbox is empty</ThemedText>
            <ThemedText style={[styles.emptyDesc, { color: theme.textSecondary }]}>
              {"Save places from links, screenshots, or the Explore tab. They'll show up here so you can add them to a trip."}
            </ThemedText>
          </Animated.View>
        ) : (
          <>
            <InboxSection
              title="Not added to a trip yet"
              items={needsTrip}
              emptyText="Nothing here"
              startIndex={0}
              onPlace={handlePlace}
              onRemove={handleRemove}
            />
            <InboxSection
              title="Planned"
              items={planned}
              emptyText="Nothing planned yet"
              startIndex={needsTrip.length}
              onPlace={handlePlace}
              onRemove={handleRemove}
              onReopen={handleReopen}
              onMove={handleMoveToTrip}
            />
          </>
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
  headerTitle: { fontSize: 17, fontWeight: '600' as const },
  headerBtn: { width: 64, alignItems: 'flex-end' as const },
  headerClose: { fontSize: 20, fontWeight: '400' as const },
  scrollContent: { padding: Spacing.four },

  // Import buttons
  importRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: Spacing.four,
  },
  importBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  importIcon: { fontSize: 24, lineHeight: 32 },
  importLabel: { fontSize: 13, fontWeight: '600' },

  // Sections
  section: { gap: 10, marginBottom: Spacing.four },
  itemList: { gap: 8 },

  // Item card
  itemCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  itemThumbnail: { width: '100%', height: 100, borderTopLeftRadius: 11, borderTopRightRadius: 11 },
  itemIcon: { fontSize: 22, lineHeight: 28 },
  itemInfo: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 15, fontWeight: '600' },
  itemRight: { alignItems: 'flex-end', gap: 6 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { fontSize: 14, fontWeight: '300' },
  addBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  addBtnText: { fontSize: 12, fontWeight: '600' },
  plannedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  plannedText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  plannedActions: { alignItems: 'flex-end', gap: 4 },
  reopenBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  reopenBtnText: { fontSize: 11, fontWeight: '600' },

  // Tags
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: { fontSize: 11, fontWeight: '600' },

  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyIcon: { fontSize: 48, lineHeight: 60, marginBottom: 8 },
  emptyDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },

  // Media
  mediaUnavailable: { alignItems: 'center', justifyContent: 'center' },
  mediaUnavailableText: { fontSize: 13, fontWeight: '500' },
  videoButton: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  videoPlayIcon: { fontSize: 32, lineHeight: 40 },
  videoButtonText: { fontSize: 14, fontWeight: '500' },
  videoModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  videoModalInner: { width: '100%', gap: 12 },
  videoViewStyle: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12 },
  videoCloseBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  fullImageBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  fullImage: { width: '100%', height: '80%' },
  fullImageCloseBtn: { position: 'absolute', top: 48, right: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  fullImageCloseText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
