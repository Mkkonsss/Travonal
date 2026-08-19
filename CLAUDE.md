# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm start          # Start Expo dev server (universal)
npm run ios        # Start with iOS simulator
npm run android    # Start with Android emulator
npm run web        # Start for web
npm run lint       # Run ESLint via expo lint
npm test           # Run Jest tests
npm test -- --testPathPattern=<file>  # Run a single test file
```

## Architecture

**Travonal** is an AI-powered travel planning app built with Expo SDK 57 / React 19.

### Routing

File-based routing via Expo Router. All routes live in `src/app/`:
- `(tabs)/` — Tab group: `index`, `explore`, `plan`, `profile`, `trips`, `trip/[id]`
- Top-level screens: `onboarding`, `add-trip`, `chat`, `generating-trip`, `import-link`, `import-screenshot`, `inbox`, `place-detail`, `place-trip`

### State Management

Nine React Context providers are nested in `src/app/_layout.tsx`. Key contexts:
- `TripsProvider` (`src/context/trips.tsx`) — core trip/activity data with undo/redo via `ChangeRecord`
- `ProfileProvider` — user identity and preferences
- `MemoryProvider` — persisted user preferences
- `TripPulseProvider`, `PulseHistoryProvider` — AI suggestion state
- `InboxProvider`, `SavedPlacesProvider` — secondary data

### Service Layer

`src/services/` contains pure business logic (no UI):
- `storage.ts` — AsyncStorage persistence
- `itinerary-engine.ts` — itinerary generation
- `transformation-service.ts` — AI trip modifications
- `trip-pulse.ts`, `pulse-history-ops.ts` — pulse/AI suggestion logic
- `notifications.ts` — push notification setup

### Key Patterns

- **Platform variants**: `.web.tsx` / `.native.tsx` suffixes for platform-specific implementations (e.g. `animated-icon.web.tsx`, `app-tabs.web.tsx`, `use-color-scheme.web.ts`)
- **Path alias**: `@/*` maps to `src/*`; `@/assets/*` maps to `assets/*`
- **Typed routes**: Enabled via `experiments.typedRoutes` in `app.json`
- **Animations**: react-native-reanimated 4 (worklets) throughout
- **Theme**: Centralized in `src/constants/theme.ts`, consumed via `src/hooks/use-theme.ts`

### Testing

Tests live in `src/__tests__/**/*.test.ts`. Jest uses `ts-jest` with Node environment. Mocks for RN, Reanimated, AsyncStorage, and Expo modules are in `src/__mocks__/`.
