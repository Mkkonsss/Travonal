// Mock expo-notifications for Jest (node environment)
module.exports = {
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('mock-id'),
};
