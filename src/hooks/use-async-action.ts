import { useCallback, useRef, useState } from 'react';

/**
 * Wraps an async handler to prevent double-taps and provide loading state.
 * While the action is executing, subsequent calls are ignored.
 */
export function useAsyncAction<Args extends unknown[]>(
  handler: (...args: Args) => Promise<void>,
): { execute: (...args: Args) => Promise<void>; loading: boolean } {
  const [loading, setLoading] = useState(false);
  const runningRef = useRef(false);

  const execute = useCallback(
    async (...args: Args) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setLoading(true);
      try {
        await handler(...args);
      } finally {
        runningRef.current = false;
        setLoading(false);
      }
    },
    [handler],
  );

  return { execute, loading };
}
