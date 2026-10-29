import * as Clipboard from 'expo-clipboard';

import { BOOKING_FORWARD_EMAIL } from '@/constants/legal';
import { useAIConsent } from '@/context/ai-consent';

/**
 * The booking forwarding address. Forwarded emails are read by our AI provider, so the address
 * only appears once Tripseek AI is on (Guideline 5.1.2(i)); until then the same spot offers to
 * turn it on.
 */
export function useBookingForwardEmail() {
  const { consent, requestConsent } = useAIConsent();
  const enabled = consent === 'granted';

  return {
    enabled,
    /** The address, or a prompt to turn Tripseek AI on */
    label: enabled ? BOOKING_FORWARD_EMAIL : 'Turn on Tripseek AI to forward emails',
    /** Copies the address. If AI is off, shows the consent sheet instead and returns false. */
    copyOrEnable: async (): Promise<boolean> => {
      if (!enabled) {
        await requestConsent();
        return false;
      }
      await Clipboard.setStringAsync(BOOKING_FORWARD_EMAIL);
      return true;
    },
  };
}
