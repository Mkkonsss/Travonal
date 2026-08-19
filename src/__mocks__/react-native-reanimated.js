module.exports = {
  default: { View: () => null, createAnimatedComponent: (c) => c },
  FadeIn: { duration: () => ({ springify: () => ({}) }) },
  FadeInDown: { delay: () => ({ springify: () => ({}) }), springify: () => ({}) },
  FadeOut: { duration: () => ({}) },
  SlideInDown: { springify: () => ({}) },
  useSharedValue: (v) => ({ value: v }),
  useAnimatedStyle: (fn) => fn(),
  withTiming: (v) => v,
};
