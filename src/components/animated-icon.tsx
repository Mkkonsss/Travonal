import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const DURATION = 600;

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: {
      transform: [{ scale: 1 }],
      opacity: 1,
    },
    20: {
      opacity: 1,
    },
    70: {
      opacity: 0,
      easing: Easing.elastic(0.7),
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1 }],
      easing: Easing.elastic(0.7),
    },
  });

  const logo = (
    <Image
      source={require('@/assets/images/logo-light.png')}
      style={styles.splashLogo}
      resizeMode="contain"
    />
  );

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback(() => {
        'worklet';
        // Always hide regardless of whether animation finished cleanly or was interrupted.
        // If we only hide when finished===true the overlay stays at opacity:0 forever,
        // blocking touches and making every pushed screen appear transparent.
        scheduleOnRN(setVisible, false);
      })}
      style={styles.splashOverlay}>
      {logo}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
          // Belt-and-suspenders: hide after max animation duration even if the
          // worklet callback never fires (e.g. component unmounts mid-animation).
          setTimeout(() => setVisible(false), DURATION + 200);
        });
      }}
      style={styles.splashOverlay}>
      {logo}
    </View>
  );
}

export function AnimatedIcon() {
  return (
    <View style={styles.iconContainer}>
      <Image
        source={require('@/assets/images/icon-dark.png')}
        style={styles.iconImage}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  splashLogo: {
    width: 200,
    height: 80,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 128,
    height: 128,
    zIndex: 100,
  },
  iconImage: {
    width: 128,
    height: 128,
    borderRadius: 28,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
