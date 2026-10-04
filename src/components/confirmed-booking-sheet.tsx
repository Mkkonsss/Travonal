import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { getCurrSymbol, TYPE_SYMBOLS, formatBookingDate } from '@/components/add-booking-modal';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Reservation, Trip } from '@/context/trips';

interface Props {
  data: { res: Reservation; trip: Trip; photoUrl?: string } | null;
  onClose: () => void;
  onEdit: (res: Reservation, tripId: string) => void;
  onDelete: (res: Reservation, tripId: string) => void;
}

export function ConfirmedBookingSheet({ data, onClose, onEdit, onDelete }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState(false);
  const [copiedConfirmation, setCopiedConfirmation] = useState<string | null>(null);

  const sheetAnim = useRef(new Animated.Value(800)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (data) {
      setMounted(true);
      setExpandedNotes(false);
      setCopiedConfirmation(null);
      Animated.parallel([
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(sheetAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [data]);

  function close(then?: () => void) {
    Animated.parallel([
      Animated.timing(backdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 800, duration: 240, useNativeDriver: true }),
    ]).start(() => {
      setMounted(false);
      onClose();
      then?.();
    });
  }

  async function handleCopyConfirmation(text: string) {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedConfirmation(text);
    setTimeout(() => setCopiedConfirmation(null), 2000);
  }

  if (!mounted || !data) return null;

  const { res, trip, photoUrl } = data;

  return (
    <>
      {/* Backdrop */}
      <Pressable
        style={styles.backdropPressable}
        onPress={() => close()}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: backdropAnim, backgroundColor: 'rgba(0,0,0,0.5)' }]}
          pointerEvents="none"
        />
      </Pressable>

      {/* Sheet panel */}
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: theme.background, transform: [{ translateY: sheetAnim }] },
        ]}
      >
        {/* X close button overlaid on photo */}
        <Pressable
          onPress={() => close()}
          style={styles.closeBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
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
                <SymbolView
                  name={(TYPE_SYMBOLS[res.type] ?? 'doc.text.fill') as any}
                  size={40}
                  tintColor="rgba(255,255,255,0.4)"
                />
              </View>
            </LinearGradient>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.5)']}
            locations={[0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Handle bar */}
        <View style={[styles.handle, { backgroundColor: theme.border }]} />

        {/* Scrollable details */}
        <ScrollView
          style={styles.details}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingBottom: insets.bottom + 16 }}
        >
          <ThemedText style={{ fontSize: 18, fontWeight: '700', marginBottom: 4 }} numberOfLines={2}>
            {res.title}
          </ThemedText>

          {/* Confirmation # */}
          {res.confirmationNumber ? (
            <Pressable
              onPress={() => handleCopyConfirmation(res.confirmationNumber!)}
              style={styles.detailRow}
              accessibilityRole="button"
              accessibilityLabel="Copy confirmation number"
            >
              <SymbolView name="doc.on.clipboard" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Confirmation</ThemedText>
              <ThemedText style={[styles.detailValue, { color: theme.primary, flex: 1 }]} numberOfLines={1}>
                {res.confirmationNumber}
              </ThemedText>
              <SymbolView
                name={copiedConfirmation === res.confirmationNumber ? 'checkmark' : 'doc.on.doc'}
                size={14}
                tintColor={copiedConfirmation === res.confirmationNumber ? theme.primary : theme.textSecondary}
              />
            </Pressable>
          ) : null}

          {/* Date */}
          {res.date ? (
            <View style={styles.detailRow}>
              <SymbolView name="calendar" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Date</ThemedText>
              <ThemedText style={styles.detailValue}>
                {formatBookingDate(res.date)}
                {res.checkOutDate ? ` \u2013 ${formatBookingDate(res.checkOutDate)}` : ''}
              </ThemedText>
            </View>
          ) : null}

          {/* Time */}
          {res.time ? (
            <View style={styles.detailRow}>
              <SymbolView name="clock" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Time</ThemedText>
              <ThemedText style={styles.detailValue}>{res.time}</ThemedText>
            </View>
          ) : null}

          {/* Price */}
          {res.price != null ? (() => {
            const currSym = getCurrSymbol(res.currency ?? 'USD');
            let perNight: number | null = null;
            if (res.type === 'hotel' && res.date && res.checkOutDate) {
              const nights = Math.round(
                (new Date(res.checkOutDate).getTime() - new Date(res.date).getTime()) / 86_400_000,
              );
              if (nights > 0) perNight = Math.round(res.price / nights);
            }
            return (
              <View style={styles.detailRow}>
                <SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} />
                <ThemedText style={styles.detailLabel}>Price</ThemedText>
                <ThemedText style={styles.detailValue}>
                  {currSym}{res.price.toLocaleString()}
                  {perNight != null ? ` \u00B7 ${currSym}${perNight.toLocaleString()}/night` : ''}
                </ThemedText>
              </View>
            );
          })() : null}

          {/* Room type */}
          {res.roomType ? (
            <View style={styles.detailRow}>
              <SymbolView name="bed.double" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Room</ThemedText>
              <ThemedText style={[styles.detailValue, { flex: 1 }]}>{res.roomType}</ThemedText>
            </View>
          ) : null}

          {/* Address */}
          {res.address ? (
            <Pressable
              onPress={() => {
                const q = encodeURIComponent(res.address!);
                Linking.openURL(Platform.OS === 'ios' ? `maps:?q=${q}` : `geo:0,0?q=${q}`);
              }}
              style={styles.detailRow}
              accessibilityRole="button"
              accessibilityLabel="Open in Maps"
            >
              <SymbolView name="mappin" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Address</ThemedText>
              <ThemedText style={[styles.detailValue, { flex: 1, color: theme.primary }]}>{res.address}</ThemedText>
              <SymbolView name="location.fill" size={14} tintColor={theme.primary} />
            </Pressable>
          ) : null}

          {/* Booking URL */}
          {res.bookingUrl ? (
            <Pressable
              onPress={() => { if (res.bookingUrl) Linking.openURL(res.bookingUrl); }}
              style={styles.detailRow}
              accessibilityRole="button"
              accessibilityLabel="Open booking link"
            >
              <SymbolView name="link" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Link</ThemedText>
              <ThemedText style={[styles.detailValue, { color: theme.primary, flex: 1 }]} numberOfLines={1}>
                {res.bookingUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}...
              </ThemedText>
              <SymbolView name={'arrow.up.right.square' as any} size={14} tintColor={theme.primary} />
            </Pressable>
          ) : null}

          {/* Notes */}
          {res.notes && !res.notes.startsWith('Check-out:') ? (
            <View style={styles.detailRow}>
              <SymbolView name="note.text" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Notes</ThemedText>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.detailValue} numberOfLines={expandedNotes ? undefined : 2}>
                  {res.notes.split('\nCheck-out:')[0]}
                </ThemedText>
                <Pressable onPress={() => setExpandedNotes(!expandedNotes)}>
                  <ThemedText style={[styles.readMoreText, { color: theme.primary }]}>
                    {expandedNotes ? 'Show less' : 'Read more'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {/* Action row */}
          <View style={styles.actions}>
            {(res.type === 'hotel' || res.type === 'restaurant' || res.type === 'activity') && (() => {
              const category = res.type === 'hotel' ? 'stay' : res.type === 'restaurant' ? 'food' : 'activity';
              const linkedAct = trip.activities.find((a) => a.reservationId === res.id);
              const searchDest = res.address || trip.destination;
              let url = `/place-detail?name=${encodeURIComponent(res.title)}&destination=${encodeURIComponent(searchDest)}&tripId=${encodeURIComponent(trip.id)}&category=${encodeURIComponent(category)}`;
              if (res.address) url += `&address=${encodeURIComponent(res.address)}`;
              if (linkedAct?.placeId) url += `&placeId=${encodeURIComponent(linkedAct.placeId)}`;
              if (linkedAct?.lat != null) url += `&lat=${linkedAct.lat}`;
              if (linkedAct?.lng != null) url += `&lng=${linkedAct.lng}`;
              return (
                <Pressable
                  onPress={() => close(() => router.push(url as any))}
                  style={[styles.actionBtn, { backgroundColor: theme.primaryMuted }]}
                  accessibilityRole="button"
                  accessibilityLabel="View place details"
                >
                  <SymbolView name="mappin.and.ellipse" size={16} tintColor={theme.primary} />
                  <ThemedText style={[styles.actionBtnText, { color: theme.primary }]}>View Place</ThemedText>
                </Pressable>
              );
            })()}

            <Pressable
              onPress={() => close(() => onEdit(res, trip.id))}
              style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]}
              accessibilityRole="button"
              accessibilityLabel="Edit booking"
            >
              <SymbolView name="pencil" size={16} tintColor={theme.text} />
              <ThemedText style={styles.actionBtnText}>Edit</ThemedText>
            </Pressable>

            <Pressable
              onPress={() => {
                Alert.alert('Remove booking?', `Remove "${res.title}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => {
                      onDelete(res, trip.id);
                      close();
                    },
                  },
                ]);
              }}
              style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]}
              accessibilityRole="button"
              accessibilityLabel="Delete booking"
            >
              <SymbolView name="trash" size={16} tintColor={theme.danger} />
              <ThemedText style={[styles.actionBtnText, { color: theme.danger }]}>Delete</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 101,
    maxHeight: '85%',
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
    height: 200,
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
  details: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '600',
    width: 90,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    marginVertical: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  readMoreText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
});
