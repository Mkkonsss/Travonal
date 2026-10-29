/**
 * An airplane window with a looping real video behind the glass (first onboarding slide).
 *
 * The clip is muted and mixes with other audio, so it never interrupts the user's music.
 * With Reduce Motion on, it shows a still frame instead and the window doesn't float.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const VIDEO = require('@/assets/videos/onboarding-window.mp4');
const POSTER = require('@/assets/images/onboarding-window-poster.jpg');

const BEZEL = 0.07; // frame thickness, as a share of the window width

export function AirplaneWindowVideo({
  width,
  active = true,
  isDark = false,
}: {
  width: number;
  /** Pause the clip while its slide is off screen */
  active?: boolean;
  isDark?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [firstFrameShown, setFirstFrameShown] = useState(false);
  const height = width * 1.4;
  const inset = width * BEZEL;

  const player = useVideoPlayer(reduceMotion ? null : VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
  });

  useEffect(() => {
    if (reduceMotion) return;
    if (active) player.play();
    else player.pause();
  }, [active, player, reduceMotion]);

  // Gentle float, like the window is drifting with the plane
  const float = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    float.value = withRepeat(withTiming(1, { duration: 4500, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [float, reduceMotion]);
  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -8 * float.value }] }));

  const frameColors = isDark
    ? (['#3A4253', '#2A3140', '#1E2430'] as const)
    : (['#FFFFFF', '#EEF1F5', '#D9DEE6'] as const);

  return (
    <Animated.View style={[styles.shadow, { width, height, borderRadius: width / 2 }, floatStyle]}>
      <LinearGradient
        colors={frameColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.frame, { borderRadius: width / 2, padding: inset }]}
      >
        <View
          style={[
            styles.pane,
            { borderRadius: (width - inset * 2) / 2, borderColor: isDark ? '#1A1F29' : '#CBD2DC' },
          ]}
        >
          {!reduceMotion && (
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              nativeControls={false}
              onFirstFrameRender={() => setFirstFrameShown(true)}
            />
          )}
          {/* Still frame for Reduce Motion, and so the window is never blank while the video loads */}
          {(reduceMotion || !firstFrameShown) && (
            <ExpoImage source={POSTER} style={StyleSheet.absoluteFill} contentFit="cover" />
          )}
          {/* Pulled-up window blind */}
          <LinearGradient
            colors={isDark ? ['#4A5263', '#3A4253'] : ['#F8FAFC', '#E5E9EF']}
            style={[styles.blind, { height: height * 0.075 }]}
          >
            <View style={[styles.blindHandle, { backgroundColor: isDark ? '#2A3140' : '#CBD2DC' }]} />
          </LinearGradient>
          {/* Soft reflection on the glass */}
          <LinearGradient
            colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.45, y: 0.35 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10,
  },
  frame: {
    flex: 1,
  },
  pane: {
    flex: 1,
    overflow: 'hidden',
    borderWidth: 3,
    backgroundColor: '#3B82C4',
  },
  blind: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 5,
    shadowColor: '#0F172A',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 3 },
  },
  blindHandle: {
    width: 30,
    height: 4,
    borderRadius: 2,
  },
});
