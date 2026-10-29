// Mock expo-web-browser for Jest (node environment)
module.exports = {
  openBrowserAsync: jest.fn().mockResolvedValue({ type: 'dismiss' }),
  openAuthSessionAsync: jest.fn().mockResolvedValue({ type: 'dismiss' }),
  maybeCompleteAuthSession: jest.fn().mockReturnValue({ type: 'failed' }),
  WebBrowserPresentationStyle: { AUTOMATIC: 0 },
};
