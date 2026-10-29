/**
 * Full-width looping view out of a plane window, behind the top of the first onboarding slide.
 * It fades down into the screen background and dissolves away as the user swipes to slide 2.
 *
 * The clip is muted and mixes with other audio, so it never interrupts the user's music.
 * With Reduce Motion on, it shows a still frame instead.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';

const VIDEO = require('@/assets/videos/onboarding-window.mp4');
const POSTER = require('@/assets/images/onboarding-window-poster.jpg');

export function OnboardingSkyVideo({
  width,
  height,
  scrollX,
  active,
  background,
}: {
  width: number;
  height: number;
  /** Horizontal scroll position of the slides, so the view can fade out during the swipe */
  scrollX: SharedValue<number>;
  /** Pause the clip while slide 1 is off screen */
  active: boolean;
  /** Screen background colour the bottom fades into */
  background: string;
}) {
  const reduceMotion = useReducedMotion();
  const [firstFrameShown, setFirstFrameShown] = useState(false);

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

  // Stay put and dissolve as the user swipes to slide 2 (gone by ~75% of the swipe),
  // rather than sliding off like a hard-edged panel
  const fadeWithSwipe = useAnimatedStyle(() => {
    const progress = Math.max(0, Math.min(1, scrollX.value / (width * 0.75)));
    return { opacity: 1 - progress * progress * (3 - 2 * progress) };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.container, { width, height }, fadeWithSwipe]}>
      {!reduceMotion && (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          onFirstFrameRender={() => setFirstFrameShown(true)}
        />
      )}
      {/* Still frame for Reduce Motion, and so the top is never blank while the video loads */}
      {(reduceMotion || !firstFrameShown) && (
        <ExpoImage source={POSTER} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
      {/* Slight shade at the top so the logo and status bar stay readable over bright sky */}
      <LinearGradient
        colors={['rgba(0,0,0,0.28)', 'rgba(0,0,0,0)']}
        style={[styles.topShade, { height: height * 0.22 }]}
      />
      {/* Fade down into the screen background, eased so there's no visible start line */}
      <View style={[styles.fade, { height: height * 0.6 }]}>
        <LinearGradient
          colors={FADE_STOPS.map(([, alpha]) => withAlpha(background, alpha)) as [string, string, ...string[]]}
          locations={FADE_STOPS.map(([at]) => at) as [number, number, ...number[]]}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </Animated.View>
  );
}

/** [position, opacity] pairs along an ease-in-out curve, fully solid by 90% of the fade */
const FADE_STOPS: [number, number][] = Array.from({ length: 11 }, (_, i) => {
  const t = i / 10;
  return [t * 0.9, t * t * (3 - 2 * t)];
});
FADE_STOPS.push([1, 1]);

/** The background colour at the given opacity (fading to plain "transparent" looks grey on iOS). */
function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }
  return `rgba(255,255,255,${alpha.toFixed(3)})`;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
  topShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
