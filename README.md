# Travonal

AI-powered travel planning app built with Expo (iOS, Android, Web).

## Features

- Create and manage trips with AI-generated itineraries
- Day-by-day activity scheduling with reservations tracking
- Budget management and prep checklists
- Explore destinations with smart filtering
- Real-time AI suggestions via the Pulse system
- Import trips from links or screenshots
- Push notifications for trip updates

## Tech Stack

- **Expo SDK 57** / React 19 / React Native 0.86
- **Expo Router** — file-based navigation with typed routes
- **React Native Reanimated 4** — gesture-driven animations
- **@expo/ui** — native SwiftUI/Compose components
- **AsyncStorage** — local persistence
- **TypeScript 6** with strict mode

## Getting Started

```bash
npm install
npm start        # Opens Expo dev server
npm run ios      # iOS simulator
npm run android  # Android emulator
npm run web      # Browser
```

## Development

```bash
npm run lint     # ESLint
npm test         # Jest
npm test -- --testPathPattern=<file>  # Single test file
```

## Project Structure

```
src/
├── app/           # Expo Router routes
│   └── (tabs)/    # Tab navigation group
├── components/    # Reusable UI components
├── context/       # React Context providers (state management)
├── services/      # Business logic (itinerary engine, storage, notifications)
├── hooks/         # Custom React hooks
└── constants/     # Theme and legal content
```
