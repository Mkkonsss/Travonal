import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { useTheme } from '@/hooks/use-theme';
import { useToast, ToastType } from '@/context/toast';
import { Spacing } from '@/constants/theme';

const ICON_NAMES: Record<ToastType, string> = {
  success: 'checkmark.circle.fill',
  error: 'xmark.circle.fill',
  info: 'info.circle.fill',
};

export function Toast() {
  const { toast, dismiss } = useToast();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-100);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.8);

  useEffect(() => {
    if (toast) {
      translateY.value = withSpring(0, { damping: 14, stiffness: 150 });
      opacity.value = withTiming(1, { duration: 200 });
      scale.value = withSequence(
        withTiming(1.05, { duration: 200 }),
        withSpring(1, { damping: 12 }),
      );
    } else {
      opacity.value = withTiming(0, { duration: 200 });
      scale.value = withTiming(0.9, { duration: 150 });
      translateY.value = withDelay(
        200,
        withTiming(-100, { duration: 1 }, () => {
          runOnJS(dismiss)();
        }),
      );
    }
  }, [toast, translateY, opacity, scale, dismiss]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!toast) return null;

  const bgColor =
    toast.type === 'error'
      ? theme.danger
      : toast.type === 'success'
        ? theme.live
        : theme.primary;

  return (
    <Animated.View
      style={[
        styles.container,
        animatedStyle,
        { top: insets.top + Spacing.two, backgroundColor: bgColor },
      ]}
      pointerEvents="none"
    >
      <SymbolView name={ICON_NAMES[toast.type]} size={16} tintColor="#FFFFFF" style={styles.icon} />
      <Text style={[styles.text, { color: '#FFFFFF' }]} numberOfLines={2}>
        {toast.text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    zIndex: 9999,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  icon: {
    marginRight: Spacing.two,
  },
  text: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
});
