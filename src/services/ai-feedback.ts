/**
 * Feedback and reports on AI replies (Guideline 1.2). Saved to Supabase `ai_feedback`,
 * where reports (rating = 'down') can be reviewed.
 */

import { supabase } from './supabase';

export type AIFeedbackRating = 'up' | 'down';
export type AIReportReason = 'offensive' | 'inaccurate' | 'unsafe' | 'other';
export type AIFeedbackContext = 'chat' | 'trip_chat';

/** Longest reply text stored with a report — enough to review it, without unbounded rows */
const MAX_MESSAGE_LENGTH = 8000;

export async function submitAIFeedback(params: {
  rating: AIFeedbackRating;
  reason?: AIReportReason;
  message: string;
  context: AIFeedbackContext;
}): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return false;
  const { error } = await supabase.from('ai_feedback').insert({
    user_id: session.user.id,
    rating: params.rating,
    reason: params.reason ?? null,
    context: params.context,
    message: params.message.slice(0, MAX_MESSAGE_LENGTH),
  });
  if (error && __DEV__) console.warn('[ai-feedback] insert failed:', error.message);
  return !error;
}
