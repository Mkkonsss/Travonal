import { createContext, useContext, ReactNode } from 'react';
import { useSharedValue, SharedValue } from 'react-native-reanimated';

const FabContext = createContext<SharedValue<number> | null>(null);

export function FabProvider({ children }: { children: ReactNode }) {
  const fabVisible = useSharedValue(1);
  return (
    <FabContext.Provider value={fabVisible}>
      {children}
    </FabContext.Provider>
  );
}

export function useFabVisible() {
  const ctx = useContext(FabContext);
  if (!ctx) throw new Error('useFabVisible must be used within FabProvider');
  return ctx;
}
