/**
 * SwipeableActivityRow — wraps a timeline activity row with swipe gestures.
 *
 * Swipe left → Replace (orange) + Remove (red)
 * Swipe right → Book (green)
 */

import { useCallback, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import type { Activity } from '@/context/trips';

interface SwipeableActivityRowProps {
  activity: Activity;
  children: React.ReactNode;
  onReplace?: (activity: Activity) => void;
  onRemove?: (activity: Activity) => void;
  onBook?: (activity: Activity) => void;
  /** Ref callback so parent can close this swipeable */
  onSwipeOpen?: (ref: Swipeable) => void;
}

export function SwipeableActivityRow({
  activity,
  children,
  onReplace,
  onRemove,
  onBook,
  onSwipeOpen,
}: SwipeableActivityRowProps) {
  const swipeRef = useRef<Swipeable>(null);
  const isProtected = !!(activity.locked || activity.fixed);
  const [rowHeight, setRowHeight] = useState(64);
  const hasTriggeredHapticRight = useRef(false);
  const hasTriggeredHapticLeft = useRef(false);

  const onRowLayout = useCallback((e: LayoutChangeEvent) => {
    setRowHeight(e.nativeEvent.layout.height);
  }, []);

  // Square button size = row height, capped at a reasonable max
  const btnSize = Math.min(rowHeight, 80);

  const renderRightActions = useCallback(
    (progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
      if (isProtected) return null;

      const hasReplace = !!onReplace;
      const hasRemove = !!onRemove;
      const totalWidth = (hasReplace ? btnSize : 0) + (hasRemove ? btnSize : 0);

      const translateReplace = dragX.interpolate({
        inputRange: [-totalWidth, 0],
        outputRange: [0, totalWidth],
        extrapolate: 'clamp',
      });
      const translateRemove = dragX.interpolate({
        inputRange: [-totalWidth, 0],
        outputRange: [0, totalWidth],
        extrapolate: 'clamp',
      });

      // Scale in: buttons grow from 0.5 → 1 as swipe progresses
      const scale = progress.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.5, 0.85, 1],
        extrapolate: 'clamp',
      });

      // Haptic when buttons fully revealed
      progress.addListener(({ value }) => {
        if (value >= 0.95 && !hasTriggeredHapticRight.current) {
          hasTriggeredHapticRight.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (value < 0.5) {
          hasTriggeredHapticRight.current = false;
        }
      });

      return (
        <View style={[styles.rightActions, { width: totalWidth }]}>
          {hasReplace && (
            <Animated.View style={{ transform: [{ translateX: translateReplace }, { scale }] }}>
              <Pressable
                onPress={() => {
                  swipeRef.current?.close();
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onReplace(activity);
                }}
                style={[styles.actionBtn, styles.replaceBtn, { width: btnSize, height: btnSize }]}
              >
                <SymbolView name="arrow.triangle.2.circlepath" size={18} tintColor="#fff" />
                <ThemedText style={styles.actionLabel}>Replace</ThemedText>
              </Pressable>
            </Animated.View>
          )}
          {hasRemove && (
            <Animated.View style={{ transform: [{ translateX: translateRemove }, { scale }] }}>
              <Pressable
                onPress={() => {
                  swipeRef.current?.close();
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onRemove(activity);
                }}
                style={[styles.actionBtn, styles.removeBtn, { width: btnSize, height: btnSize }]}
              >
                <SymbolView name="trash" size={18} tintColor="#fff" />
                <ThemedText style={styles.actionLabel}>Remove</ThemedText>
              </Pressable>
            </Animated.View>
          )}
        </View>
      );
    },
    [activity, isProtected, onReplace, onRemove, btnSize],
  );

  const renderLeftActions = useCallback(
    (progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
      if (!onBook) return null;

      const translateX = dragX.interpolate({
        inputRange: [0, btnSize],
        outputRange: [-btnSize, 0],
        extrapolate: 'clamp',
      });

      const scale = progress.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.5, 0.85, 1],
        extrapolate: 'clamp',
      });

      // Haptic when book button fully revealed
      progress.addListener(({ value }) => {
        if (value >= 0.95 && !hasTriggeredHapticLeft.current) {
          hasTriggeredHapticLeft.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (value < 0.5) {
          hasTriggeredHapticLeft.current = false;
        }
      });

      return (
        <View style={[styles.leftActions, { width: btnSize + 20 }]}>
          <Animated.View style={{ transform: [{ translateX }, { scale }] }}>
            <Pressable
              onPress={() => {
                swipeRef.current?.close();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onBook(activity);
              }}
              style={[styles.actionBtn, styles.bookBtn, { width: btnSize, height: btnSize }]}
            >
              <SymbolView name="link" size={18} tintColor="#fff" />
              <ThemedText style={styles.actionLabel}>Book</ThemedText>
            </Pressable>
          </Animated.View>
        </View>
      );
    },
    [activity, onBook, btnSize],
  );

  // Don't wrap protected activities in swipeable
  if (isProtected && !onBook) {
    return <>{children}</>;
  }

  return (
    <View onLayout={onRowLayout}>
      <Swipeable
        ref={swipeRef}
        friction={1.2}
        overshootLeft={false}
        overshootRight={false}
        overshootFriction={8}
        rightThreshold={20}
        leftThreshold={20}
        renderRightActions={renderRightActions}
        renderLeftActions={renderLeftActions}
        onSwipeableWillOpen={() => {
          if (swipeRef.current) onSwipeOpen?.(swipeRef.current);
        }}
      >
        {children}
      </Swipeable>
    </View>
  );
}

const styles = StyleSheet.create({
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftActions: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  actionBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    gap: 4,
  },
  replaceBtn: {
    backgroundColor: '#F59E0B',
  },
  removeBtn: {
    backgroundColor: '#EF4444',
  },
  bookBtn: {
    backgroundColor: '#10B981',
  },
  actionLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
});
