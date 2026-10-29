/**
 * AI consent — Guideline 5.1.2(i).
 *
 * Personal data may only be sent to a third-party AI (Anthropic) after the user explicitly
 * agrees. The choice is stored per account on this device, and mirrored to Supabase
 * (`user_ai_consent`) so server-side AI — reading forwarded booking emails — can respect it.
 *
 * This module has no UI. The AIConsentProvider registers a "requester" that shows the
 * consent sheet; non-UI code only ever reads the current state.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type AIConsent = 'unknown' | 'granted' | 'denied';

const KEY_PREFIX = '@tripseek/ai_consent:';

let currentUserKey = 'anon';
let current: AIConsent = 'unknown';
let requester: (() => Promise<boolean>) | null = null;
const listeners = new Set<(consent: AIConsent) => void>();

function notify(): void {
  for (const cb of listeners) cb(current);
}

/** Load the saved choice for this account (or a signed-out session). */
export async function loadAIConsent(userId: string | null | undefined): Promise<AIConsent> {
  currentUserKey = userId ?? 'anon';
  let next: AIConsent = 'unknown';
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + currentUserKey);
    if (raw === 'granted' || raw === 'denied') next = raw;
  } catch {
    // Treat unreadable storage as "not asked yet"
  }
  current = next;
  notify();
  return current;
}

export function getAIConsent(): AIConsent {
  return current;
}

export function onAIConsentChange(callback: (consent: AIConsent) => void): () => void {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

/** Save the user's choice locally and on the server (best effort). */
export async function setAIConsent(granted: boolean): Promise<void> {
  current = granted ? 'granted' : 'denied';
  notify();
  try {
    await AsyncStorage.setItem(KEY_PREFIX + currentUserKey, current);
  } catch {
    // The in-memory choice still applies for this session
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      await supabase.from('user_ai_consent').upsert(
        { user_id: session.user.id, granted, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    }
  } catch {
    // Server copy is only used for forwarded emails; it is retried next time the choice changes
  }
}

/** Called by AIConsentProvider so non-UI code can show the consent sheet. */
export function registerAIConsentRequester(fn: () => Promise<boolean>): () => void {
  requester = fn;
  return () => { if (requester === fn) requester = null; };
}

/**
 * Ask for consent if it hasn't been given. Only call this right after the user taps
 * something that uses AI — never on launch or from background work.
 * Resolves true when AI may be used.
 */
export async function requestAIConsent(): Promise<boolean> {
  if (current === 'granted') return true;
  if (!requester) return false;
  return requester();
}

export class AIConsentRequiredError extends Error {
  code = 'AI_CONSENT_REQUIRED' as const;
  constructor() {
    super('Tripseek AI is turned off. You can turn it on in Profile → Settings → Tripseek AI.');
    this.name = 'AIConsentRequiredError';
  }
}

export function isAIConsentError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'AI_CONSENT_REQUIRED';
}
