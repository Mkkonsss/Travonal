import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { BoardPicker } from '@/components/board-picker';
import { Spacing, Radius } from '@/constants/theme';
import { useBoards, BoardItem } from '@/context/boards';
import { useTrips } from '@/context/trips';
import { useToast } from '@/context/toast';
import { useTheme } from '@/hooks/use-theme';
import { searchExplorePlaces, fetchPlaceDetails } from '@/services/explore-service';
import { normalizeGooglePlace, type NormalizedPlace } from '@/services/place-model';
import { prefetchPhotosFromCache, getCachedPhotoUrl } from '@/services/free-photos';
import { getTripDayCount, suggestTimeForActivity } from '@/services/itinerary-engine';
import { importPlaceAI } from '@/services/ai';
import { useGate } from '@/hooks/use-gate';

const COLUMN_GAP = 10;

const CATEGORY_ICONS: Record<string, string> = {
  food: 'fork.knife',
  restaurant: 'fork.knife',
  cafe: 'cup.and.saucer.fill',
  bar: 'wineglass.fill',
  nightlife: 'moon.stars.fill',
  museum: 'building.columns.fill',
  park: 'leaf.fill',
  beach: 'sun.max.fill',
  shopping: 'bag.fill',
  hotel: 'bed.double.fill',
  flight: 'airplane',
  activity: 'mappin.circle.fill',
};

// ─── Pin Card (static content) ─────────────────────────────────────────────

function PinCardContent({
  item,
  pinWidth,
  resolvedPhotoUrl,
  onMenuPress,
  isDragging,
}: {
  item: BoardItem;
  pinWidth: number;
  resolvedPhotoUrl?: string;
  onMenuPress?: () => void;
  isDragging?: boolean;
}) {
  const theme = useTheme();
  const imageUrl = item.mediaUri ?? resolvedPhotoUrl;
  const icon = CATEGORY_ICONS[item.category ?? ''] ?? CATEGORY_ICONS[item.type] ?? 'mappin';

  return (
    <View style={[
      styles.pinCard,
      { backgroundColor: theme.backgroundElement },
      isDragging && styles.pinCardDragging,
    ]}>
      {imageUrl ? (
        <ExpoImage
          source={{ uri: imageUrl }}
          style={[styles.pinImage, { height: pinWidth * 0.85 }]}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.pinPlaceholder, { height: pinWidth * 0.55, backgroundColor: theme.border }]}>
          <SymbolView name={icon as any} size={24} tintColor={theme.textSecondary} />
        </View>
      )}
      <View style={styles.pinInfo}>
        <View style={styles.pinInfoRow}>
          <ThemedText style={[styles.pinTitle, { flex: 1 }]} numberOfLines={2}>{item.title}</ThemedText>
          {onMenuPress && (
            <Pressable
              onPress={onMenuPress}
              hitSlop={8}
              style={styles.pinMenuBtn}
              accessibilityRole="button"
              accessibilityLabel="Options"
            >
              <SymbolView name="ellipsis" size={14} tintColor={theme.textSecondary} />
            </Pressable>
          )}
        </View>
        {item.destination && (
          <ThemedText style={[styles.pinDest, { color: theme.textSecondary }]} numberOfLines={1}>
            {item.destination}
          </ThemedText>
        )}
        {item.notes && (
          <ThemedText style={[styles.pinNotes, { color: theme.textSecondary }]} numberOfLines={2}>
            {item.notes}
          </ThemedText>
        )}
      </View>
      {item.plannedTripId && (
        <View style={[styles.plannedDot, { backgroundColor: theme.live }]} />
      )}
    </View>
  );
}

// ─── Draggable Pin Grid ────────────────────────────────────────────────────

function DraggablePinGrid({
  items,
  pinWidth,
  onItemPress,
  onItemLongPress,
  onReorder,
  resolvedPhotos,
  scrollRef,
  scrollOffsetRef,
}: {
  items: BoardItem[];
  pinWidth: number;
  onItemPress: (item: BoardItem) => void;
  onItemLongPress: (item: BoardItem) => void;
  onReorder: (orderedIds: string[]) => void;
  resolvedPhotos: Record<string, string>;
  scrollRef: React.RefObject<ScrollView | null>;
  scrollOffsetRef: React.RefObject<number>;
}) {
  const theme = useTheme();

  // Track layout of each card by index
  const cardLayouts = useRef<Record<number, { x: number; y: number; w: number; h: number }>>({});
  const gridOrigin = useRef({ x: 0, y: 0 });

  // Drag state
  const [dragItemIndex, setDragItemIndex] = useState(-1);
  const [targetIndex, setTargetIndex] = useState(-1);
  const currentOrder = useRef<string[]>([]);

  // Keep current order in sync
  useEffect(() => {
    currentOrder.current = items.map((i) => i.id);
  }, [items]);

  const findDropTarget = useCallback((absX: number, absY: number) => {
    const layouts = cardLayouts.current;
    const gx = gridOrigin.current.x;
    const gy = gridOrigin.current.y;
    let closest = -1;
    let minDist = Infinity;

    for (let i = 0; i < items.length; i++) {
      const layout = layouts[i];
      if (!layout) continue;
      const cx = gx + layout.x + layout.w / 2;
      const cy = gy + layout.y + layout.h / 2 - scrollOffsetRef.current;
      const dist = Math.abs(absX - cx) + Math.abs(absY - cy);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    return closest;
  }, [items.length, scrollOffsetRef]);

  const commitReorder = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const order = [...currentOrder.current];
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    currentOrder.current = order;
    onReorder(order);
  }, [onReorder]);

  // Auto-scroll when dragging near edges
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAbsY = useRef(0);
  const screenHeight = Dimensions.get('window').height;
  const EDGE_ZONE = 80; // pixels from top/bottom edge to trigger auto-scroll

  const startAutoScroll = useCallback(() => {
    if (autoScrollTimer.current) return;
    autoScrollTimer.current = setInterval(() => {
      const y = lastAbsY.current;
      let speed = 0;
      if (y < EDGE_ZONE) {
        speed = -Math.max(4, (EDGE_ZONE - y) * 0.3); // scroll up
      } else if (y > screenHeight - EDGE_ZONE) {
        speed = Math.max(4, (y - (screenHeight - EDGE_ZONE)) * 0.3); // scroll down
      }
      if (speed !== 0) {
        scrollOffsetRef.current = Math.max(0, scrollOffsetRef.current + speed);
        scrollRef.current?.scrollTo({ y: scrollOffsetRef.current, animated: false });
      }
    }, 16); // ~60fps
  }, [screenHeight, scrollRef, scrollOffsetRef]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  }, []);

  const onDragStart = useCallback((idx: number) => {
    setDragItemIndex(idx);
    setTargetIndex(idx);
    startAutoScroll();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [startAutoScroll]);

  const onDragUpdate = useCallback((absX: number, absY: number) => {
    lastAbsY.current = absY;
    const target = findDropTarget(absX, absY);
    if (target >= 0) setTargetIndex(target);
  }, [findDropTarget]);

  const onDragEnd = useCallback((fromIdx: number) => {
    stopAutoScroll();
    setTargetIndex((target) => {
      commitReorder(fromIdx, target);
      return -1;
    });
    setDragItemIndex(-1);
  }, [commitReorder, stopAutoScroll]);

  // Split into 2 columns
  const left: { item: BoardItem; idx: number }[] = [];
  const right: { item: BoardItem; idx: number }[] = [];
  items.forEach((item, i) => {
    (i % 2 === 0 ? left : right).push({ item, idx: i });
  });

  const renderCard = (item: BoardItem, idx: number) => {
    const isBeingDragged = dragItemIndex === idx;
    const isDropTarget = targetIndex === idx && dragItemIndex >= 0 && dragItemIndex !== idx;

    return (
      <DraggableCard
        key={item.id}
        item={item}
        index={idx}
        pinWidth={pinWidth}
        resolvedPhotoUrl={item.placeId ? resolvedPhotos[item.placeId] : undefined}
        onPress={() => onItemPress(item)}
        onMenuPress={() => onItemLongPress(item)}
        onDragStart={onDragStart}
        onDragUpdate={onDragUpdate}
        onDragEnd={onDragEnd}
        onLayout={(layout) => { cardLayouts.current[idx] = layout; }}
        isBeingDragged={isBeingDragged}
        isDropTarget={isDropTarget}
        scrollRef={scrollRef}
      />
    );
  };

  return (
    <View
      style={styles.gridContainer}
      onLayout={(e) => {
        (e.target as any)?.measureInWindow?.((x: number, y: number) => {
          gridOrigin.current = { x, y };
        });
      }}
    >
      <View style={styles.gridColumn}>
        {left.map(({ item, idx }) => renderCard(item, idx))}
      </View>
      <View style={styles.gridColumn}>
        {right.map(({ item, idx }) => renderCard(item, idx))}
      </View>
    </View>
  );
}

// ─── Single Draggable Card ─────────────────────────────────────────────────

function DraggableCard({
  item,
  index,
  pinWidth,
  resolvedPhotoUrl,
  onPress,
  onMenuPress,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onLayout,
  isBeingDragged,
  isDropTarget,
  scrollRef,
}: {
  item: BoardItem;
  index: number;
  pinWidth: number;
  resolvedPhotoUrl?: string;
  onPress: () => void;
  onMenuPress: () => void;
  onDragStart: (idx: number) => void;
  onDragUpdate: (absX: number, absY: number) => void;
  onDragEnd: (fromIdx: number) => void;
  onLayout: (layout: { x: number; y: number; w: number; h: number }) => void;
  isBeingDragged: boolean;
  isDropTarget: boolean;
  scrollRef: React.RefObject<ScrollView | null>;
}) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const zIdx = useSharedValue(1);
  const isDragging = useRef(false);
  const startIdx = useRef(index);

  const triggerDragStart = useCallback((idx: number) => {
    onDragStart(idx);
  }, [onDragStart]);

  const triggerDragUpdate = useCallback((x: number, y: number) => {
    onDragUpdate(x, y);
  }, [onDragUpdate]);

  const triggerDragEnd = useCallback((idx: number) => {
    onDragEnd(idx);
  }, [onDragEnd]);

  const gesture = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      isDragging.current = true;
      startIdx.current = index;
      scale.value = withSpring(1.06, { damping: 15 });
      zIdx.value = 999;
      runOnJS(triggerDragStart)(index);
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      runOnJS(triggerDragUpdate)(e.absoluteX, e.absoluteY);
    })
    .onEnd(() => {
      translateX.value = withSpring(0, { damping: 20 });
      translateY.value = withSpring(0, { damping: 20 });
      scale.value = withSpring(1, { damping: 15 });
      zIdx.value = 1;
      isDragging.current = false;
      runOnJS(triggerDragEnd)(startIdx.current);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    zIndex: zIdx.value,
  }));

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 30).springify()}
      style={styles.pinWrapper}
      onLayout={(e) => {
        const { x, y, width, height } = e.nativeEvent.layout;
        onLayout({ x, y, w: width, h: height });
      }}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View style={[animatedStyle, isDropTarget && { borderWidth: 2, borderColor: theme.primary, borderRadius: Radius.md }]}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPress();
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={item.title}
          >
            <PinCardContent
              item={item}
              pinWidth={pinWidth}
              resolvedPhotoUrl={resolvedPhotoUrl}
              onMenuPress={onMenuPress}
              isDragging={isBeingDragged}
            />
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function BoardDetailScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const pinWidth = (screenWidth - Spacing.four * 2 - COLUMN_GAP) / 2;
  const { getBoard, removeItemFromBoard, renameBoard, deleteBoard, markItemPlanned, updateBoardItem, moveItemToBoard, setBoardItemOrder, boards, addItemToBoard } = useBoards();
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const { trips, addActivity } = useTrips();
  const { showToast } = useToast();
  const gate = useGate('import_place');

  const board = getBoard(boardId ?? '');
  // Keep a ref to the latest board so async closures can read current state
  const boardRef = useRef(board);
  boardRef.current = board;
  const [showMenu, setShowMenu] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [renameName, setRenameName] = useState(board?.name ?? '');
  // Trip action sheet & add-to-trip flow
  const [showTripActions, setShowTripActions] = useState(false);
  const [showAddToTrip, setShowAddToTrip] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Item action sheet (long-press)
  const [actionItem, setActionItem] = useState<BoardItem | null>(null);

  // Item edit modal
  const [editItem, setEditItem] = useState<BoardItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCategory, setEditCategory] = useState('');

  // Move to board picker
  const [showMovePicker, setShowMovePicker] = useState(false);
  const moveItemRef = useRef<BoardItem | null>(null);

  // Analyzing animation (for link/screenshot/text imports)
  const IMPORT_STEPS_MAP: Record<string, string[]> = {
    link: ['Reading link', 'Extracting place info', 'Finding details'],
    screenshot: ['Analyzing image', 'Identifying place', 'Finding details'],
    text: ['Analyzing text', 'Identifying place', 'Finding details'],
  };
  const [importing, setImporting] = useState(false);
  const [importType, setImportType] = useState<'link' | 'screenshot' | 'text'>('link');
  const [importStep, setImportStep] = useState(0);
  const [importPct, setImportPct] = useState(0);
  const importProgressWidth = useSharedValue(0);

  useEffect(() => {
    if (!importing) { setImportStep(0); setImportPct(0); importProgressWidth.value = 0; return; }
    let step = 0;
    const steps = IMPORT_STEPS_MAP[importType] ?? IMPORT_STEPS_MAP.link;
    const stepInterval = setInterval(() => { step++; if (step < steps.length) setImportStep(step); }, 3000);
    const pctInterval = setInterval(() => {
      setImportPct((p) => {
        const increment = Math.max(0.1, (100 - p) * 0.02);
        const next = Math.min(p + increment, 99);
        importProgressWidth.value = withTiming(next / 100, { duration: 150 });
        return next;
      });
    }, 130);
    return () => { clearInterval(stepInterval); clearInterval(pctInterval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importing]);

  const importBarStyle = useAnimatedStyle(() => ({ width: `${importProgressWidth.value * 100}%` }));

  // Reveal state — show identified place before adding
  const [revealData, setRevealData] = useState<{
    title: string;
    destination?: string;
    category?: string;
    type: string;
    description?: string;
    notes?: string;
    source?: string;
    sourceType: 'link' | 'screenshot' | 'text' | 'explore';
    mediaUri?: string;
    mediaType?: string;
    placeId?: string;
    address?: string;
    lat?: number;
    lng?: number;
    rating?: number;
  } | null>(null);

  // Board items are stored in insertion order; display as-is (user can reorder)
  const displayItems = board?.items ?? [];

  // All items are selectable — previously-planned items can be added to other trips too
  const unplannedItems = useMemo(
    () => (board?.items ?? []),
    [board?.items],
  );

  // plannedItems removed — all items are now selectable in unplannedItems

  // Fetch photos from shared cache for items that have placeId but no local image
  // Stabilize dependency to avoid re-fetching on every unrelated boards change
  const photoKey = useMemo(
    () => (board?.items ?? []).filter((i) => i.placeId && !i.mediaUri).map((i) => i.placeId).join(','),
    [board?.items],
  );
  const [resolvedPhotos, setResolvedPhotos] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!photoKey) return;
    const placeIds = photoKey.split(',');
    prefetchPhotosFromCache(placeIds).then(() => {
      const urls: Record<string, string> = {};
      for (const id of placeIds) {
        const url = getCachedPhotoUrl(id);
        if (url) urls[id] = url;
      }
      if (Object.keys(urls).length > 0) setResolvedPhotos(urls);
    });
  }, [photoKey]);

  // For items with no image AND no placeId, resolve via Google Places to get a placeId
  // (which then enables the photo cache above). Saves the result so it only happens once.
  const needsResolutionKey = useMemo(
    () => (board?.items ?? [])
      .filter((i) => !i.mediaUri && !i.placeId)
      .map((i) => i.id)
      .join(','),
    [board?.items],
  );
  // Resolved data keyed by item ID — persists after resolution completes
  const resolvedByItemRef = useRef<Record<string, NormalizedPlace & { photoRef?: string }>>({});
  const resolvingPromisesRef = useRef<Record<string, Promise<void>>>({});
  useEffect(() => {
    if (!needsResolutionKey || !board) return;
    const items = board.items.filter((i) => !i.mediaUri && !i.placeId && !resolvingPromisesRef.current[i.id] && !resolvedByItemRef.current[i.id]);
    if (items.length === 0) return;
    for (const item of items) {
      resolvingPromisesRef.current[item.id] = (async () => {
        try {
          // Use item's lat/lng to skip geocoding when available
          const loc = (item.lat != null && item.lng != null)
            ? { type: 'current' as const, lat: item.lat, lng: item.lng, label: item.destination || '' }
            : { type: 'custom' as const, query: item.destination || 'world', label: item.destination || '' };
          const results = await searchExplorePlaces(item.title, loc);
          if (results.length > 0) {
            const match = results[0];
            updateBoardItem(board.id, item.id, {
              placeId: match.placeId,
              address: match.address,
              lat: match.lat ?? undefined,
              lng: match.lng ?? undefined,
              rating: match.rating,
              reviewCount: match.reviewCount,
              openNow: match.openNow,
              openingHours: match.openingHours,
              website: match.website,
              phone: match.phone,
              priceLevel: match.priceLevel,
              googleMapsUri: match.googleMapsUri,
            });
            // Store search result immediately so taps can use it right away
            resolvedByItemRef.current[item.id] = { ...match };
            if (match.placeId) {
              const details = await fetchPlaceDetails(match.placeId);
              if (details) {
                const norm = normalizeGooglePlace(details);
                const photos = details.photos as Record<string, unknown>[] | undefined;
                const resolved = { ...norm, photoRef: photos?.[0]?.name as string | undefined };
                detailsCache.current[match.placeId] = resolved;
                resolvedByItemRef.current[item.id] = resolved;
              }
            }
          }
        } catch {
          // Skip this item
        } finally {
          delete resolvingPromisesRef.current[item.id];
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsResolutionKey]);

  // Pre-fetch full Google Place Details for all items with placeIds so tapping is instant
  const detailsCache = useRef<Record<string, NormalizedPlace & { photoRef?: string }>>({});
  const detailsFetchedKey = useMemo(
    () => (board?.items ?? []).filter((i) => i.placeId).map((i) => i.placeId).join(','),
    [board?.items],
  );
  const detailsFetchingIdsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!detailsFetchedKey || !board) return;
    const items = board.items.filter((i) => i.placeId && !detailsCache.current[i.placeId!] && !detailsFetchingIdsRef.current.has(i.placeId!));
    if (items.length === 0) return;
    items.forEach((i) => detailsFetchingIdsRef.current.add(i.placeId!));
    Promise.all(items.map(async (item) => {
      try {
        const details = await fetchPlaceDetails(item.placeId!);
        if (details) {
          const norm = normalizeGooglePlace(details);
          const photos = details.photos as Record<string, unknown>[] | undefined;
          detailsCache.current[item.placeId!] = {
            ...norm,
            photoRef: photos?.[0]?.name as string | undefined,
          };
        }
      } catch {
        // Skip — will resolve on place-detail screen instead
      } finally {
        detailsFetchingIdsRef.current.delete(item.placeId!);
      }
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsFetchedKey]);

  if (!board) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ThemedText type="headline">Board not found</ThemedText>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }} accessibilityRole="button">
          <ThemedText style={{ color: theme.primary, fontSize: 16, fontWeight: '600' }}>Go back</ThemedText>
        </Pressable>
      </View>
    );
  }

  const boardId_ = board.id;
  const boardName = board.name;

  // Determine dominant destination
  const destCounts: Record<string, number> = {};
  for (const item of board.items) {
    if (item.destination) {
      destCounts[item.destination] = (destCounts[item.destination] ?? 0) + 1;
    }
  }
  const dominantDest = Object.entries(destCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  function buildPlaceUrl(item: BoardItem, cached?: NormalizedPlace & { photoRef?: string }) {
    let url = `/place-detail?name=${encodeURIComponent(cached?.name ?? item.title)}`;
    const placeId = cached?.placeId ?? item.placeId;
    const address = cached?.address ?? item.address;
    const description = cached?.description ?? item.description;
    const rating = cached?.rating ?? item.rating;
    const reviewCount = cached?.reviewCount ?? item.reviewCount;
    const lat = cached?.lat ?? item.lat;
    const lng = cached?.lng ?? item.lng;
    const category = cached?.category ?? item.category;
    const website = cached?.website ?? item.website;
    const phone = cached?.phone ?? item.phone;
    const openingHours = cached?.openingHours ?? item.openingHours;
    const priceLevel = cached?.priceLevel ?? item.priceLevel;
    const googleMapsUri = cached?.googleMapsUri ?? item.googleMapsUri;
    const openNow = cached?.openNow ?? item.openNow;
    const photoRef = cached?.photoRef;

    if (placeId) url += `&placeId=${encodeURIComponent(placeId)}`;
    if (address) url += `&address=${encodeURIComponent(address)}`;
    if (description) url += `&description=${encodeURIComponent(description)}`;
    if (item.destination) url += `&destination=${encodeURIComponent(item.destination)}`;
    if (rating != null) url += `&rating=${rating}`;
    if (reviewCount != null) url += `&reviewCount=${reviewCount}`;
    if (lat != null) url += `&lat=${lat}`;
    if (lng != null) url += `&lng=${lng}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    if (website) url += `&website=${encodeURIComponent(website)}`;
    if (phone) url += `&phone=${encodeURIComponent(phone)}`;
    if (openingHours && openingHours.length > 0) url += `&hours=${encodeURIComponent(JSON.stringify(openingHours))}`;
    if (priceLevel != null) url += `&priceLevel=${priceLevel}`;
    if (googleMapsUri) url += `&googleMapsUri=${encodeURIComponent(googleMapsUri)}`;
    if (openNow != null) url += `&openNow=${openNow}`;
    if (photoRef) url += `&photoRef=${encodeURIComponent(photoRef)}`;
    if (item.mediaUri) url += `&imageUrl=${encodeURIComponent(item.mediaUri)}`;
    if (item.notes) url += `&notes=${encodeURIComponent(item.notes)}`;
    return url;
  }

  async function runImport(type: 'link' | 'screenshot' | 'text', action: () => Promise<void>) {
    setImportType(type);
    setImporting(true);
    try {
      await action();
    } finally {
      setImporting(false);
    }
  }

  /** Check if an AI import result is actually usable */
  function isValidResult(result: import('@/services/ai').ImportPlaceResult): boolean {
    if (!result || typeof result !== 'object') return false;
    // The only hard requirement: a non-empty name
    const name = String(result.name ?? '').trim();
    return name.length > 0;
  }

  function buildRevealItem(result: import('@/services/ai').ImportPlaceResult, extra: { source?: string; sourceType: 'link' | 'screenshot' | 'text'; mediaUri?: string; mediaType?: string }) {
    const mediaUri = extra.mediaUri || result.photoUrl;
    const mediaType = extra.mediaType || (mediaUri ? 'image' : undefined);

    return {
      title: result.name,
      destination: result.location,
      category: result.category,
      type: (result.category === 'restaurant' || result.category === 'cafe') ? 'food' : 'activity',
      description: result.description,
      notes: result.notes,
      source: extra.source,
      sourceType: extra.sourceType,
      mediaUri,
      mediaType,
      placeId: result.placeId,
      address: result.address,
      lat: result.lat,
      lng: result.lng,
      rating: result.rating,
    };
  }

  async function handlePasteLink() {
    if (!gate.allowed) { gate.showUpgrade(); return; }
    const clip = await Clipboard.getStringAsync();
    const prefill = clip.trim().startsWith('http') ? clip.trim() : '';
    Alert.prompt('Paste a link', 'Paste a URL to a place (Google Maps, Yelp, Booking.com, etc.)', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add',
        onPress: (input: string | undefined) => {
          const val = (input ?? '').trim();
          if (!val) return;
          runImport('link', async () => {
            try {
              const result = await importPlaceAI({ content: val, contentType: 'url' });
              console.log('[link import] result:', JSON.stringify(result).slice(0, 500));
              if (isValidResult(result)) {
                setRevealData(buildRevealItem(result, { source: val, sourceType: 'link' }));
                Clipboard.setStringAsync('');
              } else {
                Alert.alert('Could not identify place', result.notes || 'No place found from that link. Try pasting the place name directly using "Paste text" instead.');
              }
            } catch (err: any) {
              console.error('[link import] error:', err);
              Alert.alert('Import failed', err?.message || 'Something went wrong. Try again.');
            }
          });
        },
      },
    ], 'plain-text', prefill);
  }

  async function handleAddScreenshot() {
    if (!gate.allowed) { gate.showUpgrade(); return; }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast('Photo library access is required', 'error');
      return;
    }
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
    });
    if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) return;
    const asset = pickerResult.assets[0];
    if (!asset.base64) {
      showToast('Could not read image data', 'error');
      return;
    }
    await runImport('screenshot', async () => {
      const base64 = asset.base64!;
      const mimeType = asset.mimeType ?? (asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg');
      const imported = await importPlaceAI({ content: base64, contentType: 'image_base64', mimeType });
      if (isValidResult(imported)) {
        setRevealData(buildRevealItem(imported, { sourceType: 'screenshot', mediaUri: asset.uri, mediaType: 'image' }));
      } else {
        showToast('Could not identify a place from that image', 'error');
      }
    });
  }

  function handleAddNote() {
    if (!gate.allowed) { gate.showUpgrade(); return; }
    Alert.prompt('Paste text', 'Type or paste a place name or idea', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add',
        onPress: (input: string | undefined) => {
          const text = (input ?? '').trim();
          if (!text) return;
          runImport('text', async () => {
            try {
              const result = await importPlaceAI({ content: text, contentType: 'text' });
              if (isValidResult(result)) {
                const item = buildRevealItem(result, { sourceType: 'text' });
                item.notes = result.notes ?? text;
                setRevealData(item);
              } else {
                // Not identifiable — add as plain note directly
                addItemToBoard(boardId_, {
                  title: text.slice(0, 60),
                  sourceType: 'text',
                  type: 'activity',
                  notes: text,
                });
                showToast('Added note', 'success');
              }
            } catch {
              addItemToBoard(boardId_, {
                title: text.slice(0, 60),
                sourceType: 'text',
                type: 'activity',
                notes: text,
              });
              showToast('Added note', 'success');
            }
          });
        },
      },
    ], 'plain-text');
  }

  function handleItemPress(item: BoardItem) {
    // Use cached details if available (by placeId or by item ID)
    const cached = (item.placeId && detailsCache.current[item.placeId])
      ? detailsCache.current[item.placeId]
      : resolvedByItemRef.current[item.id];
    router.push(buildPlaceUrl(item, cached) as any);
  }

  function handleConfirmReveal() {
    if (!revealData) return;
    const item: Omit<BoardItem, 'id' | 'addedAt'> = {
      title: revealData.title,
      destination: revealData.destination,
      category: revealData.category,
      type: (revealData.type || 'activity') as BoardItem['type'],
      description: revealData.description,
      notes: revealData.notes,
      source: revealData.source,
      sourceType: revealData.sourceType as BoardItem['sourceType'],
      mediaUri: revealData.mediaUri,
      mediaType: revealData.mediaType as BoardItem['mediaType'],
      placeId: revealData.placeId,
      address: revealData.address,
      lat: revealData.lat,
      lng: revealData.lng,
      rating: revealData.rating,
    };
    addItemToBoard(boardId_, item);
    showToast(`Added ${revealData.title}`, 'success');
    setRevealData(null);
  }

  function handleDismissReveal() {
    setRevealData(null);
  }

  function handleRename() {
    const name = renameName.trim();
    if (!name) return;
    renameBoard(boardId_, name);
    setShowRename(false);
    setShowMenu(false);
  }

  function handleDelete() {
    Alert.alert('Delete board?', `Delete "${boardName}" and all its items? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteBoard(boardId_);
          router.back();
        },
      },
    ]);
    setShowMenu(false);
  }

  // ─── Three trip action handlers ───

  function handleGenerateAI() {
    setShowTripActions(false);
    const dest = dominantDest ?? '';
    router.push(`/add-trip?initialDest=${encodeURIComponent(dest)}&fromBoardId=${encodeURIComponent(boardId_)}` as any);
  }

  function handleStartFromScratch() {
    setShowTripActions(false);
    const dest = dominantDest ?? '';
    router.push(`/add-trip?initialDest=${encodeURIComponent(dest)}&fromBoardId=${encodeURIComponent(boardId_)}&mode=detailed` as any);
  }

  function handleOpenAddToTrip() {
    setShowTripActions(false);
    // Pre-select all unplanned items
    setSelectedItems(new Set(unplannedItems.map((i) => i.id)));
    setSelectedTripId(null);
    setShowAddToTrip(true);
  }

  function toggleItemSelection(itemId: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function handleConfirmAddToTrip() {
    if (!selectedTripId || selectedItems.size === 0 || !board) return;
    const trip = trips.find((t) => t.id === selectedTripId);
    if (!trip) return;

    const totalDays = getTripDayCount(trip.startDate, trip.endDate);
    const itemsToAdd = board.items.filter((i) => selectedItems.has(i.id));

    // Distribute items across days round-robin, using smart time slotting
    let currentActivities = [...trip.activities];
    let dayIndex = 0;

    for (const item of itemsToAdd) {
      const day = (dayIndex % totalDays) + 1;
      const actType = (item.category === 'food' || item.type === 'food') ? 'food' as const : 'activity' as const;
      const time = suggestTimeForActivity(currentActivities, day, actType);

      const newAct = {
        title: item.title,
        day,
        time,
        type: actType,
        duration: item.duration ?? (actType === 'food' ? 60 : 90),
        category: item.category,
        cost: item.cost,
        description: item.description,
        placeId: item.placeId,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
      };

      addActivity(selectedTripId, newAct);
      // Track what we've added so suggestTimeForActivity accounts for it
      currentActivities = [...currentActivities, { ...newAct, id: `temp-${item.id}` }];
      markItemPlanned(boardId_, item.id, selectedTripId);
      dayIndex++;
    }

    setShowAddToTrip(false);
    Alert.alert(
      'Added!',
      `${itemsToAdd.length} ${itemsToAdd.length === 1 ? 'place' : 'places'} added to ${trip.destination}.`,
      [{ text: 'View trip', onPress: () => router.push(`/(tabs)/trip/${selectedTripId}` as any) }, { text: 'OK' }],
    );
  }

  // ─── Item long-press actions ───

  function handleItemLongPress(item: BoardItem) {
    setActionItem(item);
  }

  function handleRemoveItem() {
    if (!actionItem || !board) return;
    const title = actionItem.title;
    Alert.alert('Remove?', `Remove "${title}" from this board?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeItemFromBoard(board.id, actionItem.id) },
    ]);
    setActionItem(null);
  }

  function handleStartEdit() {
    if (!actionItem) return;
    setEditTitle(actionItem.title);
    setEditNotes(actionItem.notes ?? '');
    setEditCategory(actionItem.category ?? '');
    setEditItem(actionItem);
    setActionItem(null);
  }

  function handleSaveEdit() {
    if (!editItem || !board) return;
    const title = editTitle.trim();
    if (!title) return;
    updateBoardItem(board.id, editItem.id, {
      title,
      notes: editNotes.trim() || undefined,
      category: editCategory.trim() || undefined,
    });
    setEditItem(null);
  }

  function handleStartMove() {
    if (!actionItem) return;
    moveItemRef.current = actionItem;
    setActionItem(null);
    setShowMovePicker(true);
  }

  function handleMoveToBoard(toBoardId: string) {
    const item = moveItemRef.current;
    if (!item || !board) return;
    moveItemToBoard(board.id, toBoardId, item.id);
    moveItemRef.current = null;
    setShowMovePicker(false);
  }


  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBackBtn} hitSlop={12} accessibilityRole="button">
          <SymbolView name="chevron.left" size={16} tintColor={theme.primary} />
          <ThemedText style={[styles.headerBackText, { color: theme.primary }]}>Boards</ThemedText>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setShowMenu(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Board options"
        >
          <SymbolView name="ellipsis.circle" size={22} tintColor={theme.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
      >
        {/* Board title — always visible */}
        <ThemedText type="title" style={styles.boardTitle}>{board.name}</ThemedText>

        {/* Analyzing overlay */}
        {importing && (
          <Animated.View entering={FadeIn.duration(200)} style={styles.analyzingSection}>
            <ThemedText style={[styles.analyzingPct, { color: theme.primary }]}>{Math.round(importPct)}%</ThemedText>
            <View style={[styles.analyzingBar, { backgroundColor: theme.backgroundElement }]}>
              <Animated.View style={[styles.analyzingFill, { backgroundColor: theme.primary }, importBarStyle]} />
            </View>
            <Animated.View key={importStep} entering={FadeInDown.duration(250)}>
              <ThemedText style={[styles.analyzingLabel, { color: theme.textSecondary }]}>
                {(IMPORT_STEPS_MAP[importType] ?? IMPORT_STEPS_MAP.link)[importStep]}
              </ThemedText>
            </Animated.View>
          </Animated.View>
        )}

        {!importing && board.items.length === 0 ? (
          /* ── Empty board ── */
          <Animated.View entering={FadeIn.duration(400)} style={styles.emptyState}>
            <ThemedText style={[styles.emptyDesc, { color: theme.textSecondary }]}>
              Add places to get started.
            </ThemedText>

            <View style={styles.emptyOptionsList}>
              <Pressable
                onPress={() => handlePasteLink()}
                style={({ pressed }) => [styles.emptyOption, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
              >
                <View style={[styles.emptyOptionIcon, { backgroundColor: theme.primaryMuted }]}>
                  <SymbolView name="link" size={20} tintColor={theme.primary} />
                </View>
                <View style={styles.emptyOptionText}>
                  <ThemedText style={styles.emptyOptionTitle}>Paste a link</ThemedText>
                  <ThemedText style={[styles.emptyOptionDesc, { color: theme.textSecondary }]}>Add a place from any URL</ThemedText>
                </View>
                <SymbolView name="chevron.right" size={12} tintColor={theme.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => handleAddScreenshot()}
                style={({ pressed }) => [styles.emptyOption, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
              >
                <View style={[styles.emptyOptionIcon, { backgroundColor: theme.primaryMuted }]}>
                  <SymbolView name="photo" size={20} tintColor={theme.primary} />
                </View>
                <View style={styles.emptyOptionText}>
                  <ThemedText style={styles.emptyOptionTitle}>Add a screenshot</ThemedText>
                  <ThemedText style={[styles.emptyOptionDesc, { color: theme.textSecondary }]}>AI identifies the place for you</ThemedText>
                </View>
                <SymbolView name="chevron.right" size={12} tintColor={theme.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => handleAddNote()}
                style={({ pressed }) => [styles.emptyOption, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
              >
                <View style={[styles.emptyOptionIcon, { backgroundColor: theme.primaryMuted }]}>
                  <SymbolView name="text.bubble" size={20} tintColor={theme.primary} />
                </View>
                <View style={styles.emptyOptionText}>
                  <ThemedText style={styles.emptyOptionTitle}>Paste text</ThemedText>
                  <ThemedText style={[styles.emptyOptionDesc, { color: theme.textSecondary }]}>Type or paste a place name or idea</ThemedText>
                </View>
                <SymbolView name="chevron.right" size={12} tintColor={theme.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => router.push('/(tabs)/explore' as any)}
                style={({ pressed }) => [styles.emptyOption, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
              >
                <View style={[styles.emptyOptionIcon, { backgroundColor: theme.primaryMuted }]}>
                  <SymbolView name="magnifyingglass" size={20} tintColor={theme.primary} />
                </View>
                <View style={styles.emptyOptionText}>
                  <ThemedText style={styles.emptyOptionTitle}>Explore places</ThemedText>
                  <ThemedText style={[styles.emptyOptionDesc, { color: theme.textSecondary }]}>Search and browse destinations</ThemedText>
                </View>
                <SymbolView name="chevron.right" size={12} tintColor={theme.textSecondary} />
              </Pressable>
            </View>
          </Animated.View>
        ) : !importing ? (
          <>
            {/* Compact add row */}
            <View style={styles.addRow}>
              <Pressable
                onPress={() => handlePasteLink()}
                style={({ pressed }) => [styles.addBtn, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
              >
                <SymbolView name="link" size={16} tintColor={theme.text} />
                <ThemedText style={styles.addBtnLabel}>Link</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => handleAddScreenshot()}
                style={({ pressed }) => [styles.addBtn, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
              >
                <SymbolView name="photo" size={16} tintColor={theme.text} />
                <ThemedText style={styles.addBtnLabel}>Photo</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => handleAddNote()}
                style={({ pressed }) => [styles.addBtn, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
              >
                <SymbolView name="text.bubble" size={16} tintColor={theme.text} />
                <ThemedText style={styles.addBtnLabel}>Text</ThemedText>
              </Pressable>
            </View>

            {/* Plan a trip button */}
            <Pressable
              onPress={() => setShowTripActions(true)}
              style={({ pressed }) => [styles.planTripBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.9 : 1 }]}
              accessibilityRole="button"
            >
              <SymbolView name="sparkles" size={16} tintColor="#fff" />
              <ThemedText style={styles.planTripText}>Plan a trip</ThemedText>
            </Pressable>

            {/* Item count */}
            <ThemedText style={[styles.itemCount, { color: theme.textSecondary }]}>
              {board.items.length} {board.items.length === 1 ? 'pin' : 'pins'}
            </ThemedText>

            {/* Pinterest-style grid with drag-and-drop */}
            <DraggablePinGrid
              items={displayItems}
              pinWidth={pinWidth}
              onItemPress={handleItemPress}
              onItemLongPress={handleItemLongPress}
              onReorder={(ids) => setBoardItemOrder(boardId_, ids)}
              resolvedPhotos={resolvedPhotos}
              scrollRef={scrollViewRef}
              scrollOffsetRef={scrollOffsetRef}
            />
          </>
        ) : null}
      </ScrollView>

      {/* ─── Trip Actions Sheet ─── */}
      <Modal visible={showTripActions} transparent animationType="fade" onRequestClose={() => setShowTripActions(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setShowTripActions(false)} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Pressable
            style={[styles.menuSheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.menuHandle, { backgroundColor: theme.border }]} />
            <ThemedText type="subtitle" style={{ textAlign: 'center', marginBottom: 16 }}>Plan a trip</ThemedText>

            <Pressable
              onPress={handleGenerateAI}
              style={({ pressed }) => [styles.tripActionCard, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.88 : 1 }]}
              accessibilityRole="button"
            >
              <View style={[styles.tripActionIcon, { backgroundColor: theme.primaryMuted }]}>
                <SymbolView name="sparkles" size={20} tintColor={theme.primary} />
              </View>
              <View style={styles.tripActionInfo}>
                <ThemedText style={styles.tripActionTitle}>Generate with AI</ThemedText>
                <ThemedText style={[styles.tripActionDesc, { color: theme.textSecondary }]}>
                  AI builds a full itinerary around your saved places
                </ThemedText>
              </View>
              <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
            </Pressable>

            <Pressable
              onPress={handleOpenAddToTrip}
              style={({ pressed }) => [styles.tripActionCard, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.88 : 1 }]}
              accessibilityRole="button"
            >
              <View style={[styles.tripActionIcon, { backgroundColor: theme.primaryMuted }]}>
                <SymbolView name="plus.rectangle.on.folder" size={20} tintColor={theme.primary} />
              </View>
              <View style={styles.tripActionInfo}>
                <ThemedText style={styles.tripActionTitle}>Add to existing trip</ThemedText>
                <ThemedText style={[styles.tripActionDesc, { color: theme.textSecondary }]}>
                  Add places to a trip you've already created
                </ThemedText>
              </View>
              <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
            </Pressable>

            <Pressable
              onPress={handleStartFromScratch}
              style={({ pressed }) => [styles.tripActionCard, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.88 : 1 }]}
              accessibilityRole="button"
            >
              <View style={[styles.tripActionIcon, { backgroundColor: theme.primaryMuted }]}>
                <SymbolView name="hammer.fill" size={20} tintColor={theme.primary} />
              </View>
              <View style={styles.tripActionInfo}>
                <ThemedText style={styles.tripActionTitle}>Build your own trip</ThemedText>
                <ThemedText style={[styles.tripActionDesc, { color: theme.textSecondary }]}>
                  Create a trip manually with your board places included
                </ThemedText>
              </View>
              <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => setShowTripActions(false)}
              style={[styles.menuCancel, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
            >
              <ThemedText style={{ fontWeight: '600' }}>Cancel</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── Add to Existing Trip Modal ─── */}
      <Modal visible={showAddToTrip} transparent animationType="slide" onRequestClose={() => setShowAddToTrip(false)}>
        <View style={[styles.addToTripContainer, { backgroundColor: theme.background }]}>
          {/* Header */}
          <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
            <Pressable onPress={() => setShowAddToTrip(false)} style={styles.headerBackBtn} hitSlop={12} accessibilityRole="button">
              <ThemedText style={[styles.headerBackText, { color: theme.primary }]}>Cancel</ThemedText>
            </Pressable>
            <ThemedText style={styles.headerTitle}>Add to Trip</ThemedText>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* Trip picker */}
            <ThemedText type="sectionTitle" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              Select a trip
            </ThemedText>
            {trips.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <ThemedText style={{ color: theme.textSecondary, fontSize: 15 }}>
                  No trips planned yet
                </ThemedText>
              </View>
            )}
            {trips.map((trip, i) => {
              const isSelected = selectedTripId === trip.id;
              return (
                <Animated.View key={trip.id} entering={FadeInDown.delay(i * 40).springify()}>
                  <Pressable
                    onPress={() => setSelectedTripId(trip.id)}
                    style={({ pressed }) => [
                      styles.tripPickerCard,
                      {
                        backgroundColor: isSelected ? theme.primaryMuted : theme.backgroundElement,
                        borderColor: isSelected ? theme.primary : theme.border,
                        opacity: pressed ? 0.92 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText style={styles.tripPickerName}>{trip.title ?? trip.destination}</ThemedText>
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>{trip.country}</ThemedText>
                    </View>
                    {isSelected && <SymbolView name="checkmark" size={16} tintColor={theme.primary} />}
                  </Pressable>
                </Animated.View>
              );
            })}

            {/* Item selection */}
            {selectedTripId && (
              <Animated.View entering={FadeIn.duration(200)}>
                <View style={styles.selectHeader}>
                  <ThemedText type="sectionTitle" style={[styles.sectionLabel, { color: theme.textSecondary, marginBottom: 0 }]}>
                    Select places ({selectedItems.size})
                  </ThemedText>
                  <Pressable
                    onPress={() => {
                      if (selectedItems.size === unplannedItems.length) {
                        setSelectedItems(new Set());
                      } else {
                        setSelectedItems(new Set(unplannedItems.map((i) => i.id)));
                      }
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <ThemedText style={[styles.selectAllText, { color: theme.primary }]}>
                      {selectedItems.size === unplannedItems.length ? 'Deselect all' : 'Select all'}
                    </ThemedText>
                  </Pressable>
                </View>

                {unplannedItems.map((item, i) => {
                  const checked = selectedItems.has(item.id);
                  const existingTripName = item.plannedTripId
                    ? (trips.find((t) => t.id === item.plannedTripId)?.title ?? trips.find((t) => t.id === item.plannedTripId)?.destination)
                    : null;
                  return (
                    <Animated.View key={item.id} entering={FadeInDown.delay(i * 30).springify()}>
                      <Pressable
                        onPress={() => toggleItemSelection(item.id)}
                        style={({ pressed }) => [
                          styles.checkItem,
                          {
                            backgroundColor: checked ? theme.primaryMuted : theme.backgroundElement,
                            borderColor: checked ? theme.primary : theme.border,
                            opacity: pressed ? 0.92 : 1,
                          },
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                      >
                        <View style={[
                          styles.checkbox,
                          { borderColor: checked ? theme.primary : theme.textSecondary, backgroundColor: checked ? theme.primary : 'transparent' },
                        ]}>
                          {checked && <SymbolView name="checkmark" size={10} tintColor="#fff" />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.checkItemTitle} numberOfLines={1}>{item.title}</ThemedText>
                          {existingTripName ? (
                            <ThemedText type="small" style={{ color: theme.textSecondary }}>Also in {existingTripName}</ThemedText>
                          ) : item.destination ? (
                            <ThemedText type="small" style={{ color: theme.textSecondary }}>{item.destination}</ThemedText>
                          ) : null}
                        </View>
                      </Pressable>
                    </Animated.View>
                  );
                })}

                {unplannedItems.length === 0 && (
                  <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                    <ThemedText style={{ color: theme.textSecondary }}>No items in this board</ThemedText>
                  </View>
                )}
              </Animated.View>
            )}
          </ScrollView>

          {/* Confirm button */}
          {selectedTripId && selectedItems.size > 0 && (
            <View style={[styles.fabContainer, { paddingBottom: insets.bottom + 16 }]}>
              <Pressable
                onPress={handleConfirmAddToTrip}
                style={({ pressed }) => [styles.fab, { backgroundColor: theme.primary, opacity: pressed ? 0.9 : 1 }]}
                accessibilityRole="button"
              >
                <ThemedText style={styles.fabText}>
                  Add {selectedItems.size} {selectedItems.size === 1 ? 'place' : 'places'}
                </ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      {/* ─── Item Action Sheet ─── */}
      <Modal visible={!!actionItem} transparent animationType="fade" onRequestClose={() => setActionItem(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setActionItem(null)} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Pressable
            style={[styles.menuSheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.menuHandle, { backgroundColor: theme.border }]} />
            <ThemedText type="subtitle" style={{ textAlign: 'center', marginBottom: 16 }} numberOfLines={1}>
              {actionItem?.title}
            </ThemedText>

            <Pressable onPress={handleStartEdit} style={styles.menuOption} accessibilityRole="button">
              <SymbolView name="pencil" size={20} tintColor={theme.text} />
              <ThemedText style={styles.menuOptionText}>Edit</ThemedText>
            </Pressable>
            <View style={[styles.menuSeparator, { backgroundColor: theme.border }]} />
            <Pressable onPress={handleStartMove} style={styles.menuOption} accessibilityRole="button">
              <SymbolView name="arrow.right.square" size={20} tintColor={theme.text} />
              <ThemedText style={styles.menuOptionText}>Move to board</ThemedText>
            </Pressable>
            <View style={[styles.menuSeparator, { backgroundColor: theme.border }]} />
            <Pressable onPress={handleRemoveItem} style={styles.menuOption} accessibilityRole="button">
              <SymbolView name="trash" size={20} tintColor="#EF4444" />
              <ThemedText style={[styles.menuOptionText, { color: '#EF4444' }]}>Remove</ThemedText>
            </Pressable>

            <Pressable
              onPress={() => setActionItem(null)}
              style={[styles.menuCancel, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
            >
              <ThemedText style={{ fontWeight: '600' }}>Cancel</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── Edit Item Modal ─── */}
      <Modal visible={!!editItem} transparent animationType="fade" onRequestClose={() => setEditItem(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.menuBackdrop} onPress={() => setEditItem(null)} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Pressable
            style={[styles.menuSheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.menuHandle, { backgroundColor: theme.border }]} />
            <ThemedText type="subtitle" style={{ textAlign: 'center', marginBottom: 16 }}>Edit item</ThemedText>

            <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 4 }}>Title</ThemedText>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              style={[styles.renameInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              returnKeyType="next"
              autoFocus
            />

            <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 4 }}>Category</ThemedText>
            <TextInput
              value={editCategory}
              onChangeText={setEditCategory}
              placeholder="e.g. food, museum, park"
              placeholderTextColor={theme.textSecondary}
              style={[styles.renameInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              returnKeyType="next"
            />

            <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 4 }}>Notes</ThemedText>
            <TextInput
              value={editNotes}
              onChangeText={setEditNotes}
              placeholder="Add notes..."
              placeholderTextColor={theme.textSecondary}
              style={[styles.renameInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border, minHeight: 60 }]}
              multiline
            />

            <View style={styles.renameActions}>
              <Pressable onPress={() => setEditItem(null)} style={styles.renameCancelBtn} accessibilityRole="button">
                <ThemedText style={{ color: theme.textSecondary, fontWeight: '600' }}>Cancel</ThemedText>
              </Pressable>
              <Pressable onPress={handleSaveEdit} style={[styles.renameConfirmBtn, { backgroundColor: theme.primary }]} accessibilityRole="button">
                <ThemedText style={{ color: '#fff', fontWeight: '600' }}>Save</ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Move to Board Picker ─── */}
      <BoardPicker
        visible={showMovePicker}
        onSelect={handleMoveToBoard}
        onClose={() => { setShowMovePicker(false); moveItemRef.current = null; }}
        excludeBoardId={boardId_}
      />

      {/* ─── Options menu ─── */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.menuBackdrop} onPress={() => setShowMenu(false)} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Pressable
            style={[styles.menuSheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 }]}
            onPress={(e) => e.stopPropagation()}
            accessibilityRole="button"
            accessibilityLabel="Options"
          >
            <View style={[styles.menuHandle, { backgroundColor: theme.border }]} />

            {showRename ? (
              <View style={styles.renameSection}>
                <ThemedText type="subtitle" style={{ textAlign: 'center', marginBottom: 12 }}>Rename board</ThemedText>
                <TextInput
                  value={renameName}
                  onChangeText={setRenameName}
                  style={[styles.renameInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  returnKeyType="done"
                  onSubmitEditing={handleRename}
                  autoFocus
                />
                <View style={styles.renameActions}>
                  <Pressable onPress={() => setShowRename(false)} style={styles.renameCancelBtn} accessibilityRole="button">
                    <ThemedText style={{ color: theme.textSecondary, fontWeight: '600' }}>Cancel</ThemedText>
                  </Pressable>
                  <Pressable onPress={handleRename} style={[styles.renameConfirmBtn, { backgroundColor: theme.primary }]} accessibilityRole="button">
                    <ThemedText style={{ color: '#fff', fontWeight: '600' }}>Save</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <Pressable onPress={() => setShowRename(true)} style={styles.menuOption} accessibilityRole="button">
                  <SymbolView name="pencil" size={20} tintColor={theme.text} />
                  <ThemedText style={styles.menuOptionText}>Rename board</ThemedText>
                </Pressable>
                <View style={[styles.menuSeparator, { backgroundColor: theme.border }]} />
                <Pressable onPress={handleDelete} style={styles.menuOption} accessibilityRole="button">
                  <SymbolView name="trash" size={20} tintColor="#EF4444" />
                  <ThemedText style={[styles.menuOptionText, { color: '#EF4444' }]}>Delete board</ThemedText>
                </Pressable>
              </>
            )}

            {!showRename && (
              <Pressable
                onPress={() => { setShowMenu(false); setShowRename(false); }}
                style={[styles.menuCancel, { backgroundColor: theme.backgroundElement }]}
                accessibilityRole="button"
              >
                <ThemedText style={{ fontWeight: '600' }}>Cancel</ThemedText>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Reveal Modal ─── */}
      <Modal visible={!!revealData} transparent animationType="slide" onRequestClose={handleDismissReveal}>
        <View style={[styles.revealBackdrop, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.revealSheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.menuHandle, { backgroundColor: theme.border }]} />

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.revealScrollContent}>
              {revealData?.mediaUri && (
                <ExpoImage
                  source={{ uri: revealData.mediaUri }}
                  style={styles.revealImage}
                  contentFit="cover"
                  contentPosition={{ top: '35%', left: '50%' }}
                  cachePolicy="memory-disk"
                />
              )}

              <View style={styles.revealBadgeRow}>
                <View style={[styles.revealBadge, { backgroundColor: theme.primaryMuted }]}>
                  <SymbolView
                    name={(CATEGORY_ICONS[revealData?.category ?? ''] ?? CATEGORY_ICONS[revealData?.type ?? ''] ?? 'mappin') as any}
                    size={14}
                    tintColor={theme.primary}
                  />
                  <ThemedText style={[styles.revealBadgeText, { color: theme.primary }]}>
                    {revealData?.category || revealData?.type || 'place'}
                  </ThemedText>
                </View>
                {revealData?.rating != null && (
                  <View style={styles.revealRating}>
                    <SymbolView name="star.fill" size={12} tintColor="#F59E0B" />
                    <ThemedText style={styles.revealRatingText}>{revealData.rating.toFixed(1)}</ThemedText>
                  </View>
                )}
              </View>

              <ThemedText style={styles.revealTitle}>{revealData?.title}</ThemedText>

              {revealData?.destination ? (
                <View style={styles.revealRow}>
                  <SymbolView name="mappin" size={14} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.revealRowText, { color: theme.textSecondary }]} numberOfLines={1}>{revealData.destination}</ThemedText>
                </View>
              ) : null}

              {revealData?.address && revealData.address !== revealData.destination ? (
                <View style={styles.revealRow}>
                  <SymbolView name="location" size={14} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.revealRowText, { color: theme.textSecondary }]} numberOfLines={2}>{revealData.address}</ThemedText>
                </View>
              ) : null}

              {revealData?.description ? (
                <ThemedText style={[styles.revealDesc, { color: theme.textSecondary }]}>
                  {revealData.description}
                </ThemedText>
              ) : null}

              {revealData?.notes && revealData.notes !== revealData.description ? (
                <View style={[styles.revealNotesBox, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={[styles.revealNotes, { color: theme.textSecondary }]} numberOfLines={3}>
                    {revealData.notes}
                  </ThemedText>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.revealActions}>
              <Pressable
                onPress={handleDismissReveal}
                style={[styles.revealDismissBtn, { borderColor: theme.border }]}
                accessibilityRole="button"
              >
                <ThemedText style={[styles.revealDismissBtnText, { color: theme.textSecondary }]}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={handleConfirmReveal}
                style={[styles.revealConfirmBtn, { backgroundColor: theme.primary }]}
                accessibilityRole="button"
              >
                <SymbolView name="plus" size={16} tintColor="#fff" />
                <ThemedText style={styles.revealConfirmBtnText}>Add to board</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  headerBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  boardTitle: { fontSize: 26, fontWeight: '700', marginBottom: 12 },
  headerBackText: { fontSize: 17, fontWeight: '500' },
  scrollContent: { padding: Spacing.four },


  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 32,
    gap: 6,
  },
  emptyDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20, marginBottom: 12 },
  emptyOptionsList: {
    width: '100%',
    gap: 10,
  },
  emptyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: Radius.md,
    gap: 12,
  },
  emptyOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyOptionText: {
    flex: 1,
    gap: 2,
  },
  emptyOptionTitle: { fontSize: 15, fontWeight: '600' },
  emptyOptionDesc: { fontSize: 13, lineHeight: 17 },

  // Analyzing progress
  analyzingSection: { alignItems: 'center' as const, paddingVertical: 60, paddingHorizontal: 20, gap: 12 },
  analyzingPct: { fontSize: 36, lineHeight: 44, fontWeight: '800' as const, fontVariant: ['tabular-nums'] as any },
  analyzingBar: { width: '80%' as const, height: 6, borderRadius: 3, overflow: 'hidden' as const },
  analyzingFill: { height: 6, borderRadius: 3 },
  analyzingLabel: { fontSize: 14, fontWeight: '500' as const, marginTop: 4 },

  // Reveal modal
  revealBackdrop: { flex: 1, justifyContent: 'flex-end' as const },
  revealSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12, maxHeight: '85%' as any },
  revealScrollContent: { gap: 12, paddingBottom: 16 },
  revealImage: { width: '100%' as const, height: 240, borderRadius: 12, overflow: 'hidden' as const },
  revealBadgeRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  revealBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  revealBadgeText: { fontSize: 13, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  revealRating: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  revealRatingText: { fontSize: 14, fontWeight: '600' as const },
  revealTitle: { fontSize: 24, fontWeight: '700' as const },
  revealRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  revealRowText: { fontSize: 14, fontWeight: '500' as const, flex: 1 },
  revealDesc: { fontSize: 14, lineHeight: 20 },
  revealNotesBox: { padding: 12, borderRadius: 10 },
  revealNotes: { fontSize: 13, lineHeight: 18, fontStyle: 'italic' as const },
  revealActions: { flexDirection: 'row' as const, gap: 12, marginTop: 4 },
  revealDismissBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
  revealDismissBtnText: { fontSize: 16, fontWeight: '600' as const },
  revealConfirmBtn: { flex: 2, flexDirection: 'row' as const, paddingVertical: 14, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6 },
  revealConfirmBtnText: { fontSize: 16, fontWeight: '600' as const, color: '#fff' },

  // Compact add row
  addRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.sm,
    paddingVertical: 10,
  },
  addBtnLabel: { fontSize: 13, fontWeight: '600' },

  // Plan a trip inline button
  planTripBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: Radius.md,
    marginBottom: 20,
  },
  planTripText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Item count
  itemCount: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 14,
  },

  // Pin grid
  gridContainer: {
    flexDirection: 'row',
    gap: COLUMN_GAP,
  },
  gridColumn: {
    flex: 1,
    gap: COLUMN_GAP,
  },
  pinWrapper: {
    width: '100%',
  },
  pinCard: {
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  pinCardDragging: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  pinImage: {
    width: '100%',
  },
  pinPlaceholder: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinInfo: {
    padding: 10,
    gap: 2,
  },
  pinInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  pinTitle: { fontSize: 13, fontWeight: '700', lineHeight: 17 },
  pinMenuBtn: {
    padding: 2,
    marginTop: -1,
  },
  pinDest: { fontSize: 11 },
  pinNotes: { fontSize: 11, fontStyle: 'italic', marginTop: 3 },
  plannedDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // FAB
  fabContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: Radius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  fabText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  // Trip action sheet
  tripActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: Radius.md,
    marginBottom: 8,
  },
  tripActionIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripActionInfo: { flex: 1, gap: 2 },
  tripActionTitle: { fontSize: 15, fontWeight: '600' },
  tripActionDesc: { fontSize: 12, lineHeight: 16 },

  // Add to trip modal
  addToTripContainer: { flex: 1 },
  sectionLabel: { marginBottom: 10 },
  tripPickerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    marginBottom: 8,
    gap: 10,
  },
  tripPickerName: { fontSize: 15, fontWeight: '600' },

  // Item checklist
  selectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 10,
  },
  selectAllText: { fontSize: 14, fontWeight: '600' },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    marginBottom: 6,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkItemTitle: { fontSize: 14, fontWeight: '600' },

  // Menu
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: 12,
    paddingHorizontal: Spacing.four,
  },
  menuHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
  },
  menuOptionText: { fontSize: 16, fontWeight: '500' },
  menuSeparator: {
    height: StyleSheet.hairlineWidth,
  },
  menuCancel: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
  },

  // Rename
  renameSection: { paddingVertical: 8 },
  renameInput: {
    fontSize: 17,
    fontWeight: '500',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.sm,
    borderWidth: 1,
    marginBottom: 16,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  renameCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  renameConfirmBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
});
