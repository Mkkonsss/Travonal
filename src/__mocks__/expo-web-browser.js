// Mock expo-web-browser for Jest (node environment)
module.exports = {
  openBrowserAsync: jest.fn().mockResolvedValue({ type: 'dismiss' }),
  WebBrowserPresentationStyle: { AUTOMATIC: 0 },
};
