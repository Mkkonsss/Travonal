// Minimal React Native mock for Jest (node environment).
// Only the primitives needed by utility functions are stubbed.
module.exports = {
  StyleSheet: { create: (s) => s },
  Platform: { OS: 'ios', select: (obj) => obj.ios ?? obj.default },
  Pressable: () => null,
  View: () => null,
  Modal: () => null,
  ScrollView: () => null,
  TextInput: () => null,
  Text: () => null,
  Image: () => null,
  Alert: { alert: () => {} },
  Keyboard: { dismiss: () => {} },
};
