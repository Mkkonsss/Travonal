import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

function getInitialOnline(): boolean {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return navigator.onLine;
  }
  return true;
}

/** Returns `true` when the device appears to have internet connectivity. */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(getInitialOnline);

  useEffect(() => {
    // On web, use navigator.onLine events
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleOnline = () => setOnline(true);
      const handleOffline = () => setOnline(false);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }

    // On native, poll connectivity with a lightweight HEAD request
    let mounted = true;

    async function check() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch('https://clients3.google.com/generate_204', {
          method: 'HEAD',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (mounted) setOnline(true);
      } catch {
        if (mounted) setOnline(false);
      }
    }

    check();
    const interval = setInterval(check, 30_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return online;
}
