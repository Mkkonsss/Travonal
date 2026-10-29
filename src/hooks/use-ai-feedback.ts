import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { useToast } from '@/context/toast';
import {
  submitAIFeedback,
  type AIFeedbackContext,
  type AIFeedbackRating,
  type AIReportReason,
} from '@/services/ai-feedback';

/**
 * 👍 / 👎 and "Report response" for AI replies (Guideline 1.2 — users must be able to
 * report offensive AI-generated content). Shared by the main chat and the trip chat.
 */
export function useAIFeedback(context: AIFeedbackContext) {
  const { showToast } = useToast();
  const [ratings, setRatings] = useState<Record<string, AIFeedbackRating>>({});

  const report = useCallback((messageId: string, text: string) => {
    const send = async (reason: AIReportReason) => {
      setRatings((prev) => ({ ...prev, [messageId]: 'down' }));
      await submitAIFeedback({ rating: 'down', reason, message: text, context });
      showToast('Thanks, we’ll review it.', 'success');
    };
    Alert.alert('What went wrong?', 'Your report helps us improve Tripseek AI.', [
      { text: 'Offensive', onPress: () => send('offensive') },
      { text: 'Inaccurate', onPress: () => send('inaccurate') },
      { text: 'Unsafe', onPress: () => send('unsafe') },
      { text: 'Something else', onPress: () => send('other') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [context, showToast]);

  const thumbsUp = useCallback((messageId: string, text: string) => {
    if (ratings[messageId] === 'up') return;
    Haptics.selectionAsync();
    setRatings((prev) => ({ ...prev, [messageId]: 'up' }));
    submitAIFeedback({ rating: 'up', message: text, context });
  }, [context, ratings]);

  /** Press-and-hold menu on an AI reply: Copy / Report response */
  const openMenu = useCallback((messageId: string, text: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const copy = async () => {
      await Clipboard.setStringAsync(text);
      showToast('Copied', 'success');
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Copy', 'Report response', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
        (index) => {
          if (index === 0) copy();
          if (index === 1) report(messageId, text);
        },
      );
    } else {
      Alert.alert('', undefined, [
        { text: 'Copy', onPress: copy },
        { text: 'Report response', style: 'destructive', onPress: () => report(messageId, text) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [report, showToast]);

  return { ratings, thumbsUp, report, openMenu };
}
