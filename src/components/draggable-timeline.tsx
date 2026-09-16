/**
 * Draggable activity timeline for a single day.
 *
 * - Drag handle (≡) to pick up and reorder within the day
 * - Swipe left → Replace / Remove actions
 * - Swipe right → Book action
 * - On drop, times are reassigned to preserve the new order
 * - Locked/fixed activities cannot be dragged or swiped to remove
 */

import { useCallback, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { NestableDraggableFlatList, RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/context/trips';

interface DraggableTimelineProps {
  activities: Activity[];
  day: number;
  onReorder: (day: number, reorderedActivities: Activity[]) => void;
  renderItem: (activity: Activity, idx: number, total: number, drag: () => void, isActive: boolean) => React.ReactNode;
  /** Swipe-left: replace action */
  onSwipeReplace?: (activity: Activity) => void;
  /** Swipe-left: remove action */
  onSwipeRemove?: (activity: Activity) => void;
  /** Swipe-right: book action */
  onSwipeBook?: (activity: Activity) => void;
}

export function DraggableTimeline({
  activities,
  day,
  onReorder,
  renderItem: renderItemProp,
  onSwipeReplace,
  onSwipeRemove,
  onSwipeBook,
}: DraggableTimelineProps) {
  const theme = useTheme();
  const openSwipeableRef = useRef<Swipeable | null>(null);

  const closeOpenSwipeable = useCallback(() => {
    if (openSwipeableRef.current) {
      openSwipeableRef.current.close();
      openSwipeableRef.current = null;
    }
  }, []);

  const renderItem = useCallback(({ item, drag, isActive, getIndex }: RenderItemParams<Activity>) => {
    const idx = getIndex() ?? 0;
    const isLocked = !!(item.locked || item.fixed);

    const handleDrag = isLocked ? () => {} : () => {
      closeOpenSwipeable();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      drag();
    };

    const content = renderItemProp(item, idx, activities.length, handleDrag, isActive);

    // Wrap in swipeable if not currently dragging
    if (isActive || isLocked) {
      return (
        <ScaleDecorator activeScale={1.04}>
          <View style={[
            isActive && styles.itemActive,
            isActive && {
              backgroundColor: theme.background,
              shadowColor: theme.primary,
            },
          ]}>
            {content}
          </View>
        </ScaleDecorator>
      );
    }

    return (
      <ScaleDecorator activeScale={1.04}>
        <SwipeableRow
          activity={item}
          theme={theme}
          openSwipeableRef={openSwipeableRef}
          onCloseOther={closeOpenSwipeable}
          onReplace={onSwipeReplace}
          onRemove={onSwipeRemove}
          onBook={onSwipeBook}
        >
          {content}
        </SwipeableRow>
      </ScaleDecorator>
    );
  }, [activities.length, renderItemProp, theme, closeOpenSwipeable, onSwipeReplace, onSwipeRemove, onSwipeBook]);

  const handleDragEnd = useCallback(({ data }: { data: Activity[] }) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const originalTimes = activities.map((a) => a.time);
    const reordered = data.map((activity, i) => ({
      ...activity,
      time: originalTimes[i] ?? activity.time,
    }));
    onReorder(day, reordered);
  }, [activities, day, onReorder]);

  const keyExtractor = useCallback((item: Activity) => item.id, []);

  return (
    <NestableDraggableFlatList
      data={activities}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      onDragEnd={handleDragEnd}
      activationDistance={10}
    />
  );
}

/** Swipeable wrapper for a single activity row */
function SwipeableRow({
  activity,
  theme,
  openSwipeableRef,
  onCloseOther,
  onReplace,
  onRemove,
  onBook,
  children,
}: {
  activity: Activity;
  theme: ReturnType<typeof useTheme>;
  openSwipeableRef: React.MutableRefObject<Swipeable | null>;
  onCloseOther: () => void;
  onReplace?: (activity: Activity) => void;
  onRemove?: (activity: Activity) => void;
  onBook?: (activity: Activity) => void;
  children: React.ReactNode;
}) {
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = useCallback((_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    const translateReplace = dragX.interpolate({
      inputRange: [-160, -80, 0],
      outputRange: [0, 40, 80],
      extrapolate: 'clamp',
    });
    const translateRemove = dragX.interpolate({
      inputRange: [-160, -80, 0],
      outputRange: [0, 40, 160],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.swipeActions}>
        {onReplace && (
          <Animated.View style={{ transform: [{ translateX: translateReplace }] }}>
            <Pressable
              onPress={() => {
                swipeRef.current?.close();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onReplace(activity);
              }}
              style={[styles.swipeBtn, styles.swipeBtnReplace]}
            >
              <SymbolView name="arrow.triangle.2.circlepath" size={20} tintColor="#fff" />
              <ThemedText style={styles.swipeBtnText}>Replace</ThemedText>
            </Pressable>
          </Animated.View>
        )}
        {onRemove && (
          <Animated.View style={{ transform: [{ translateX: translateRemove }] }}>
            <Pressable
              onPress={() => {
                swipeRef.current?.close();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onRemove(activity);
              }}
              style={[styles.swipeBtn, styles.swipeBtnRemove]}
            >
              <SymbolView name="trash" size={20} tintColor="#fff" />
              <ThemedText style={styles.swipeBtnText}>Remove</ThemedText>
            </Pressable>
          </Animated.View>
        )}
      </View>
    );
  }, [activity, onReplace, onRemove]);

  const renderLeftActions = useCallback((_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    if (!onBook) return null;
    const translateX = dragX.interpolate({
      inputRange: [0, 80],
      outputRange: [-80, 0],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View style={[styles.swipeLeftAction, { transform: [{ translateX }] }]}>
        <Pressable
          onPress={() => {
            swipeRef.current?.close();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onBook(activity);
          }}
          style={[styles.swipeBtn, styles.swipeBtnBook]}
        >
          <SymbolView name="link" size={20} tintColor="#fff" />
          <ThemedText style={styles.swipeBtnText}>Book</ThemedText>
        </Pressable>
      </Animated.View>
    );
  }, [activity, onBook]);

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      rightThreshold={40}
      leftThreshold={40}
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      onSwipeableWillOpen={() => {
        onCloseOther();
        openSwipeableRef.current = swipeRef.current;
      }}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  itemActive: {
    borderRadius: 16,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
      },
      android: {
        elevation: 8,
      },
    }),
    zIndex: 999,
  },
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  swipeLeftAction: {
    justifyContent: 'center',
  },
  swipeBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
    paddingVertical: 12,
    gap: 4,
  },
  swipeBtnReplace: {
    backgroundColor: '#F59E0B',
  },
  swipeBtnRemove: {
    backgroundColor: '#EF4444',
  },
  swipeBtnBook: {
    backgroundColor: '#10B981',
  },
  swipeBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
