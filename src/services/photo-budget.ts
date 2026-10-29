/**
 * Pacing for photo requests to the ai-toveli edge function.
 *
 * The backend turns a user away after 60 photo requests a minute (photos have their own allowance,
 * separate from everything else), and a screen full of places asks for a photo each. Photos keep to
 * 50 so the backend never has to refuse them. When it refuses anyway, every photo request waits
 * until it lets us in again instead of giving up on the photo.
 */

const WINDOW_MS = 60_000;
/** Photo requests allowed in any one minute */
const PHOTO_BUDGET = 50;

const recent: number[] = [];
let pausedUntil = 0;

/** Resolves when a photo request may go out. */
export async function photoRequestSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (recent.length > 0 && recent[0] <= now - WINDOW_MS) recent.shift();
    const wait = Math.max(
      pausedUntil - now,
      recent.length >= PHOTO_BUDGET ? recent[0] + WINDOW_MS - now : 0,
    );
    if (wait <= 0) {
      recent.push(now);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** The backend refused a request for going over its limit — hold photo requests for `seconds`. */
export function pausePhotoRequests(seconds: number): void {
  pausedUntil = Math.max(pausedUntil, Date.now() + seconds * 1000);
}
