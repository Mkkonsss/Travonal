import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { AFFILIATE_DISCLOSURE } from '@/constants/affiliates';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Activity, Trip } from '@/context/trips';
import { useBookingForwardEmail } from '@/hooks/use-booking-forward-email';


interface Props {
  data: { activity: Activity; trip: Trip; photoUrl?: string } | null;
  onClose: () => void;
  onBook?: (activity: Activity) => void;
  /** e.g. "Book on Booking.com" / "Find stays nearby on Booking.com" */
  bookLabel?: string;
  onRemove?: (activity: Activity) => void;
}

export function UnbookedStaySheet({ data, onClose, onBook, bookLabel = 'Book on Booking.com', onRemove }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  const [mounted, setMounted] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const { label: bookingEmail, copyOrEnable: copyBookingEmail, enabled: forwardingEnabled } = useBookingForwardEmail();

  const sheetAnim = useRef(new Animated.Value(800)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (data) {
      setMounted(true);
      setEmailCopied(false);
      Animated.parallel([
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(sheetAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [data]);

  function close() {
    Animated.parallel([
      Animated.timing(backdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 800, duration: 240, useNativeDriver: true }),
    ]).start(() => {
      setMounted(false);
      onClose();
    });
  }

  async function handleCopyEmail() {
    if (!(await copyBookingEmail())) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  }

  if (!mounted || !data) return null;

  const { activity, photoUrl } = data;

  return (
    <>
      {/* Backdrop */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropAnim, zIndex: 100 },
        ]}
        pointerEvents="box-none"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: theme.background, transform: [{ translateY: sheetAnim }] },
        ]}
      >
        {/* Close button */}
        <Pressable onPress={close} style={styles.closeBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <View style={styles.closeBtnInner}>
            <SymbolView name="xmark" size={12} tintColor="#fff" />
          </View>
        </Pressable>

        {/* Photo header */}
        <View style={styles.photo}>
          {photoUrl ? (
            <ExpoImage
              source={{ uri: photoUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <LinearGradient colors={['#2a2f3d', '#1a1e28']} style={StyleSheet.absoluteFill}>
              <View style={styles.photoPlaceholder}>
                <SymbolView name="building.2.fill" size={40} tintColor="rgba(255,255,255,0.4)" />
              </View>
            </LinearGradient>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.5)']}
            locations={[0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Handle */}
        <View style={[styles.handle, { backgroundColor: theme.border }]} />

        {/* Body */}
        <ScrollView
          style={styles.body}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 16, paddingBottom: insets.bottom + 24 }}
        >
          <ThemedText style={styles.title} numberOfLines={2}>
            {activity.title}
          </ThemedText>

          {onBook && (
            <View style={styles.bookBlock}>
              <Pressable
                onPress={() => { close(); onBook(activity); }}
                style={({ pressed }) => [styles.bookBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={bookLabel}
              >
                <ThemedText style={[styles.bookBtnText, { color: theme.primaryText }]}>{bookLabel}</ThemedText>
              </Pressable>
              <ThemedText style={[styles.disclosure, { color: theme.textSecondary }]}>
                {AFFILIATE_DISCLOSURE}
              </ThemedText>
            </View>
          )}

          <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ExpoImage
              source={require('@/assets/images/onboarding-slide-2.png')}
              style={styles.cardImage}
              contentFit="contain"
            />
            <View style={styles.cardText}>
              <ThemedText style={styles.cardHeading}>Get booking details here</ThemedText>
              <ThemedText style={[styles.cardSub, { color: theme.textSecondary }]}>
                Forward your confirmation email and it'll appear right here.
              </ThemedText>
            </View>
          </View>

          <Pressable
            onPress={handleCopyEmail}
            style={[styles.emailBox, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
            accessibilityRole="button"
            accessibilityLabel="Copy forwarding email address"
          >
            <ThemedText style={[styles.emailText, { color: theme.primary }]} numberOfLines={1}>
              {bookingEmail}
            </ThemedText>
            <SymbolView
              name={emailCopied ? 'checkmark' : forwardingEnabled ? 'square.on.square' : 'sparkles'}
              size={15}
              tintColor={emailCopied ? theme.primary : theme.textSecondary}
            />
          </Pressable>

          {onRemove && (
            <Pressable
              onPress={() => { close(); onRemove(activity); }}
              style={styles.removeBtn}
              accessibilityRole="button"
              accessibilityLabel="Remove stay"
            >
              <ThemedText style={[styles.removeBtnText, { color: theme.danger ?? '#FF3B30' }]}>Remove stay</ThemedText>
            </Pressable>
          )}
        </ScrollView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 101,
    maxHeight: '75%',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
  },
  closeBtnInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    height: 180,
    overflow: 'hidden',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  bookBlock: {
    gap: 8,
  },
  bookBtn: {
    paddingVertical: 14,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  bookBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  disclosure: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  cardImage: {
    width: 56,
    height: 56,
    flexShrink: 0,
    transform: [{ rotate: '12deg' }],
  },
  cardText: {
    flex: 1,
    gap: 3,
  },
  cardHeading: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardSub: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },
  emailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: 8,
  },
  emailText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  removeBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  removeBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
