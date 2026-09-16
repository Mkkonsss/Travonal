import { useCallback, useRef } from 'react';
import { withTiming } from 'react-native-reanimated';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useFabVisible } from '@/context/fab';

export function useFabOnScroll() {
  const fabVisible = useFabVisible();
  const lastY = useRef(0);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const delta = y - lastY.current;
      lastY.current = y;

      if (delta > 8 && y > 80) {
        // Scrolling down past threshold — hide
        fabVisible.value = withTiming(0, { duration: 200 });
      } else if (delta < -5 || y < 80) {
        // Scrolling up, or near top — show
        fabVisible.value = withTiming(1, { duration: 200 });
      }
    },
    [fabVisible],
  );

  return { onScroll, scrollEventThrottle: 16 };
}
