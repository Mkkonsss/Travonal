/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    // CSS / assets must come before the @/ catch-all
    '\\.(css|less|scss)$': '<rootDir>/src/__mocks__/empty.js',
    // Specific component mocks (hooks that use RN APIs)
    '^@/hooks/use-theme$': '<rootDir>/src/__mocks__/empty.js',
    // General @/ path alias
    '^@/(.*)$': '<rootDir>/src/$1',
    // React Native and related modules
    '^react-native$': '<rootDir>/src/__mocks__/react-native.js',
    '^react-native-reanimated$': '<rootDir>/src/__mocks__/react-native-reanimated.js',
    '^react-native-safe-area-context$': '<rootDir>/src/__mocks__/empty.js',
    '^expo-haptics$': '<rootDir>/src/__mocks__/empty.js',
    '^expo-router$': '<rootDir>/src/__mocks__/empty.js',
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/__mocks__/empty.js',
    '^expo-file-system$': '<rootDir>/src/__mocks__/expo-file-system.js',
    '^expo-video$': '<rootDir>/src/__mocks__/expo-video.js',
    '^expo-notifications$': '<rootDir>/src/__mocks__/expo-notifications.js',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      diagnostics: false,
    }],
  },
};
