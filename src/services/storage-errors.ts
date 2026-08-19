/**
 * Storage error handling: retry logic, deduplication, and dismiss.
 * Exported for direct testing.
 */

/** Retry a storage operation up to maxRetries times with backoff. */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Tracks which storage operations have a pending error to prevent
 * duplicate alerts. Successful retry clears the error state.
 */
const pendingErrors = new Set<string>();

/** Queued errors waiting to be displayed (only one alert at a time). */
const errorQueue: { operation: string; retryFn: () => Promise<void> }[] = [];
let isShowingAlert = false;

/** Error callback signature — UI layer provides the actual display. */
export type StorageErrorCallback = (
  operation: string,
  onRetry: () => void,
  onDismiss: () => void,
) => void;

let errorCallback: StorageErrorCallback | null = null;

/** Register the UI-level error display (called once at app init). */
export function setStorageErrorCallback(cb: StorageErrorCallback) {
  errorCallback = cb;
}

function showNextError() {
  if (isShowingAlert || errorQueue.length === 0 || !errorCallback) return;

  const next = errorQueue.shift()!;
  isShowingAlert = true;

  const onRetry = () => {
    next.retryFn()
      .then(() => {
        // Raw write succeeded — clear pending state
        pendingErrors.delete(next.operation);
        isShowingAlert = false;
        showNextError();
      })
      .catch(() => {
        // Retry failed — re-queue the operation so the user can try again
        errorQueue.push({ operation: next.operation, retryFn: next.retryFn });
        isShowingAlert = false;
        showNextError();
      });
  };

  const onDismiss = () => {
    pendingErrors.delete(next.operation);
    isShowingAlert = false;
    showNextError();
  };

  errorCallback(next.operation, onRetry, onDismiss);
}

/**
 * Report a storage error with deduplication and queuing.
 * - Skips if the same operation already has a pending error.
 * - Queues so only one alert shows at a time. Different operations are not lost.
 * - retryFn must reject/throw if persistence still fails.
 */
export function reportStorageError(operation: string, retryFn: () => Promise<void>): void {
  if (pendingErrors.has(operation)) return;

  pendingErrors.add(operation);
  console.warn(`Storage error reported for: ${operation}`);

  errorQueue.push({ operation, retryFn });
  showNextError();
}

/** Clear a specific operation's error state (e.g. after successful save). */
export function clearStorageError(operation: string): void {
  pendingErrors.delete(operation);
}

/** Check if an operation currently has a pending error. For testing. */
export function hasStorageError(operation: string): boolean {
  return pendingErrors.has(operation);
}

/** Reset all error state. For testing. */
export function resetStorageErrors(): void {
  pendingErrors.clear();
  errorQueue.length = 0;
  isShowingAlert = false;
}

/** Get queue length. For testing. */
export function getErrorQueueLength(): number {
  return errorQueue.length;
}
