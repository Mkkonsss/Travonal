import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { TimePickerButton } from '@/components/time-picker';
import { SelectionSheet, SelectionOption } from '@/components/selection-sheet';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Reservation, ReservationType, Trip, useTrips } from '@/context/trips';
import { useToast } from '@/context/toast';
import {
  importBookingAI, ImportBookingResult, ParsedBooking,
  getBookingEmailAI, getParsedBookingsAI, dismissParsedBookingAI, markBookingImportedAI,
  getGmailAuthUrlAI, getGmailStatusAI, syncGmailAI, disconnectGmailAI,
} from '@/services/ai';
import { getPlacePhoto } from '@/services/free-photos';
import { sortTripsForPicker } from '@/services/trip-helpers';

// ── Helpers ──

type TripState = 'upcoming' | 'active' | 'past' | 'draft' | 'planned';

function getCurrSymbol(cur: string) {
  const map: Record<string, string> = { USD: '$', EUR: '\u20AC', GBP: '\u00A3', JPY: '\u00A5', CAD: 'C$', AUD: 'A$' };
  return map[cur] ?? cur + ' ';
}

const TYPE_SYMBOLS: Record<string, string> = {
  hotel: 'bed.double.fill',
  flight: 'airplane',
  restaurant: 'fork.knife',
  activity: 'star.fill',
  train: 'tram.fill',
  other: 'doc.text.fill',
};

const TYPE_LABELS: Record<string, string> = {
  hotel: 'Hotel',
  flight: 'Flight',
  restaurant: 'Restaurant',
  activity: 'Activity',
  train: 'Transport',
  other: 'Other',
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTripDates(trip: Trip): string {
  if (trip.datesKnown === false) return 'Dates TBD';
  return `${formatDate(trip.startDate)} \u2013 ${formatDate(trip.endDate)}`;
}

// ── Add/Edit Modal (separate component so state resets on mount) ──

function AddBookingModal({ visible, onClose, editRes, pendingImport, initialMode, trips, onAdd, onUpdate, onDelete, onMarkImported }: {
  visible: boolean;
  onClose: () => void;
  editRes: { res: Reservation; tripId: string } | null;
  pendingImport: ParsedBooking | null;
  initialMode?: 'choose' | 'gmail';
  trips: Trip[];
  onAdd: (tripId: string, payload: Omit<Reservation, 'id' | 'tripId'>) => void;
  onUpdate: (tripId: string, res: Reservation) => void;
  onDelete: (res: Reservation, tripId: string) => void;
  onMarkImported?: (id: string) => void;
}) {
  const theme = useTheme();
  const { showToast } = useToast();

  const initData = pendingImport?.booking_data;
  const [addMode, setAddMode] = useState<'choose' | 'link' | 'email' | 'gmail' | 'review' | 'manual'>(editRes ? 'manual' : initData ? 'review' : (initialMode ?? 'choose'));

  // Email forwarding
  const [bookingEmail, setBookingEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);

  // Gmail sync
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailLastSync, setGmailLastSync] = useState<string | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);

  // Link import
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState('');

  // Analyzing animation
  const ANALYZE_STEPS = ['Reading booking link', 'Extracting details', 'Identifying place'];
  const [analyzeStep, setAnalyzeStep] = useState(0);
  const [percentage, setPercentage] = useState(0);
  const progressWidth = useSharedValue(0);

  useEffect(() => {
    if (!linkLoading) { setAnalyzeStep(0); setPercentage(0); progressWidth.value = 0; return; }
    let step = 0;
    const stepInterval = setInterval(() => { step++; if (step < ANALYZE_STEPS.length) setAnalyzeStep(step); }, 3000);
    const pctInterval = setInterval(() => {
      setPercentage((p) => {
        const increment = Math.max(0.1, (100 - p) * 0.02);
        const next = Math.min(p + increment, 99);
        progressWidth.value = withTiming(next / 100, { duration: 150 });
        return next;
      });
    }, 130);
    return () => { clearInterval(stepInterval); clearInterval(pctInterval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkLoading]);

  const progressBarStyle = useAnimatedStyle(() => ({ width: `${progressWidth.value * 100}%` }));

  // Form fields — pre-fill from edit or pending import
  const typeMap: Record<string, ReservationType> = { restaurant: 'restaurant', hotel: 'hotel', flight: 'flight', train: 'train', activity: 'activity', other: 'other' };
  const [resType, setResType] = useState<ReservationType>(editRes?.res.type ?? (initData?.reservationType ? typeMap[initData.reservationType] ?? 'other' : 'restaurant'));
  const [resTitle, setResTitle] = useState(editRes?.res.title ?? initData?.name ?? '');
  const [resDate, setResDate] = useState(editRes?.res.date ?? initData?.bookingDate ?? '');
  const [resCheckoutDate, setResCheckoutDate] = useState(initData?.checkoutDate ?? '');
  const [resTime, setResTime] = useState(editRes?.res.time ?? initData?.bookingTime ?? '');
  const [resConfirmation, setResConfirmation] = useState(editRes?.res.confirmationNumber ?? initData?.confirmationNumber ?? '');
  const [resBookingUrl, setResBookingUrl] = useState(editRes?.res.bookingUrl ?? '');
  const [resPrice, setResPrice] = useState(editRes?.res.price != null ? String(editRes.res.price) : initData?.price != null ? String(initData.price) : '');
  const [resCurrency, setResCurrency] = useState(editRes?.res.currency ?? initData?.currency ?? 'USD');
  const [resAddress, setResAddress] = useState(editRes?.res.address ?? initData?.address ?? initData?.location ?? '');
  const [resNotes, setResNotes] = useState(editRes?.res.notes ?? initData?.description ?? '');

  // Trip picker
  const [selectedTripId, setSelectedTripId] = useState<string | null>(editRes?.tripId ?? null);
  const [sheetState, setSheetState] = useState<{
    title: string;
    subtitle?: string;
    options: SelectionOption[];
    onSelect: (value: string) => void;
  } | null>(null);

  function openTripPicker(onDone: (tripId: string) => void) {
    if (trips.length === 0) {
      showToast('Create a trip first', 'info');
      return;
    }
    const sorted = sortTripsForPicker(trips);
    if (sorted.length === 1) {
      onDone(sorted[0].id);
      return;
    }
    setSheetState({
      title: 'Add to which trip?',
      options: sorted.map((t) => ({ label: `${t.emoji} ${t.destination}`, value: t.id })),
      onSelect: (id) => { setSheetState(null); onDone(id); },
    });
  }

  async function loadBookingEmail() {
    if (bookingEmail) return;
    setEmailLoading(true);
    try {
      const result = await getBookingEmailAI();
      setBookingEmail(result.email);
    } catch {
      showToast('Could not load forwarding address', 'error');
    }
    setEmailLoading(false);
  }

  async function loadGmailStatus() {
    setGmailLoading(true);
    try {
      const result = await getGmailStatusAI();
      setGmailConnected(result.connected);
      setGmailLastSync(result.lastSync ?? null);
    } catch {
      // Not connected
    }
    setGmailLoading(false);
  }

  async function handleConnectGmail() {
    try {
      const result = await getGmailAuthUrlAI();
      Linking.openURL(result.url);
    } catch {
      showToast('Could not start Gmail connection', 'error');
    }
  }

  async function handleDisconnectGmail() {
    Alert.alert('Disconnect Gmail?', 'New bookings will no longer be imported automatically.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnectGmailAI();
            setGmailConnected(false);
            setGmailLastSync(null);
            showToast('Gmail disconnected', 'success');
          } catch {
            showToast('Could not disconnect Gmail', 'error');
          }
        },
      },
    ]);
  }

  async function handleSyncGmail() {
    setGmailSyncing(true);
    try {
      const result = await syncGmailAI();
      setGmailLastSync(new Date().toISOString());
      if (result.found > 0) {
        showToast(`Found ${result.found} new booking${result.found > 1 ? 's' : ''}`, 'success');
      } else {
        showToast('No new bookings found', 'info');
      }
    } catch {
      showToast('Could not sync Gmail', 'error');
    }
    setGmailSyncing(false);
  }

  async function handleLinkImport() {
    const url = linkUrl.trim();
    if (!url) return;
    setLinkLoading(true);
    setLinkError('');
    try {
      const result: ImportBookingResult = await importBookingAI({ content: url, contentType: 'url' });

      // AI couldn't identify this as a booking
      if (!result.found) {
        setLinkError("This doesn't look like a booking confirmation. Please paste a link from a confirmation email or your booking account.");
        setLinkLoading(false);
        return;
      }

      // Validate this is a real booking confirmation, not just a listing page
      const hasConfirmation = !!result.confirmationNumber;
      const hasBookingDate = !!result.bookingDate;
      const hasPrice = result.price != null && result.price > 0;
      if (!hasConfirmation && !hasBookingDate && !hasPrice) {
        setLinkError("This looks like a listing page, not a booking confirmation. Please paste a link from a confirmation email or your booking account.");
        setLinkLoading(false);
        return;
      }

      setResTitle(result.name || '');
      setResAddress(result.address || result.location || '');
      setResNotes(result.description || '');
      setResBookingUrl(url);
      setResConfirmation(result.confirmationNumber || '');
      setResDate(result.bookingDate || '');
      setResCheckoutDate(result.checkoutDate || '');
      setResTime(result.bookingTime || '');
      if (result.price != null) setResPrice(String(result.price));
      if (result.currency) setResCurrency(result.currency);
      if (result.reservationType) {
        const typeMap: Record<string, ReservationType> = {
          restaurant: 'restaurant', hotel: 'hotel', flight: 'flight',
          train: 'train', activity: 'activity', other: 'other',
        };
        setResType(typeMap[result.reservationType] ?? 'other');
      }
      setLinkLoading(false);
      showToast(`Extracted: ${result.name || 'booking details'}`, 'success');
      setAddMode('review');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not extract details.';
      setLinkError(msg);
      setLinkLoading(false);
    }
  }

  function handleSave() {
    if (!resTitle.trim()) return;

    const doSave = (tripId: string) => {
      const payload: Omit<Reservation, 'id' | 'tripId'> = {
        type: resType,
        title: resTitle.trim(),
        date: resDate.trim() || undefined,
        time: resTime || undefined,
        confirmationNumber: resConfirmation.trim() || undefined,
        bookingUrl: resBookingUrl.trim() || undefined,
        price: resPrice ? parseFloat(resPrice) : undefined,
        currency: resCurrency || undefined,
        address: resAddress.trim() || undefined,
        notes: resCheckoutDate.trim()
          ? [resNotes.trim(), `Check-out: ${resCheckoutDate.trim()}`].filter(Boolean).join('\n') || undefined
          : resNotes.trim() || undefined,
        fixed: true,
      };

      if (editRes) {
        onUpdate(tripId, { ...editRes.res, ...payload });
        showToast('Booking updated', 'success');
      } else {
        onAdd(tripId, payload);
        showToast('Booking added', 'success');
      }
      // Mark pending import as imported
      if (pendingImport?.id && onMarkImported) {
        onMarkImported(pendingImport.id);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onClose();
    };

    if (editRes) {
      doSave(editRes.tripId);
    } else if (selectedTripId) {
      doSave(selectedTripId);
    } else {
      openTripPicker((tripId) => {
        setSelectedTripId(tripId);
        doSave(tripId);
      });
    }
  }

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
        {/* Modal header */}
        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
          <ThemedText style={styles.modalTitle}>
            {editRes ? 'Edit Booking' : addMode === 'choose' ? 'Add Booking' : addMode === 'link' ? 'Paste Confirmation Link' : addMode === 'email' ? 'Forward Email' : addMode === 'gmail' ? 'Gmail Sync' : addMode === 'review' ? 'Booking Found' : 'Booking Details'}
          </ThemedText>
          {!editRes && addMode !== 'choose' ? (
            <Pressable onPress={() => setAddMode('choose')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <SymbolView name="chevron.left" size={14} tintColor={theme.primary} />
              <ThemedText style={[{ fontSize: 14, color: theme.primary, fontWeight: '600' }]}>Back</ThemedText>
            </Pressable>
          ) : (
            <Pressable onPress={onClose} hitSlop={8} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Close">
              <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* STEP 1: Choose entry path */}
        {!editRes && addMode === 'choose' && (
          <ScrollView contentContainerStyle={{ padding: 24, gap: 16, paddingBottom: 40 }}>
            <ThemedText style={[{ fontSize: 15, color: theme.textSecondary, textAlign: 'center' }]}>
              How would you like to add this booking?
            </ThemedText>
            <Pressable
              onPress={() => { setAddMode('email'); loadBookingEmail(); }}
              style={({ pressed }) => [styles.choiceBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Forward confirmation email"
            >
              <View style={styles.choiceBtnIcon}><SymbolView name="envelope.fill" size={24} tintColor={theme.text} /></View>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.choiceBtnTitle}>Forward Email</ThemedText>
                <ThemedText style={[styles.choiceBtnDesc, { color: theme.textSecondary }]}>
                  Forward your confirmation email to import automatically
                </ThemedText>
              </View>
              <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => { setAddMode('gmail'); loadGmailStatus(); }}
              style={({ pressed }) => [styles.choiceBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Connect Gmail"
            >
              <View style={styles.choiceBtnIcon}><Image source={require('@/assets/images/gmail-logo.png')} style={{ width: 24, height: 24 }} /></View>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.choiceBtnTitle}>Connect Gmail</ThemedText>
                <ThemedText style={[styles.choiceBtnDesc, { color: theme.textSecondary }]}>
                  Automatically scan your inbox for bookings
                </ThemedText>
              </View>
              <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => setAddMode('manual')}
              style={({ pressed }) => [styles.choiceBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Enter manually"
            >
              <View style={styles.choiceBtnIcon}><SymbolView name="pencil" size={24} tintColor={theme.text} /></View>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.choiceBtnTitle}>Enter Manually</ThemedText>
                <ThemedText style={[styles.choiceBtnDesc, { color: theme.textSecondary }]}>
                  Fill in all the details yourself
                </ThemedText>
              </View>
              <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
            </Pressable>
          </ScrollView>
        )}

        {/* STEP: Forward Email instructions */}
        {!editRes && addMode === 'email' && (
          <ScrollView contentContainerStyle={{ alignItems: 'center', paddingTop: 120, padding: 32 }}>
            <ThemedText type="headline" style={{ textAlign: 'center', marginBottom: 8 }}>
              Your bookings, all in one place.
            </ThemedText>
            <ThemedText style={{ fontSize: 15, lineHeight: 22, textAlign: 'center', color: theme.textSecondary }}>
              Forward your confirmation emails here and we'll organize everything for you.
            </ThemedText>

            {emailLoading ? (
              <ThemedText style={{ fontSize: 13, color: theme.textSecondary, marginTop: 12 }}>Loading email...</ThemedText>
            ) : bookingEmail ? (
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(bookingEmail);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  setEmailCopied(true);
                  setTimeout(() => setEmailCopied(false), 2000);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: theme.border, marginTop: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Copy forwarding email address"
              >
                <ThemedText style={{ fontSize: 15, fontWeight: '700', color: theme.primary }} numberOfLines={1}>
                  {bookingEmail}
                </ThemedText>
                <SymbolView
                  name={emailCopied ? 'checkmark' : 'square.on.square'}
                  size={14}
                  tintColor={emailCopied ? theme.primary : theme.textSecondary}
                />
              </Pressable>
            ) : (
              <ThemedText style={{ fontSize: 13, color: theme.danger, marginTop: 12 }}>Could not load address</ThemedText>
            )}
          </ScrollView>
        )}

        {/* STEP: Gmail sync */}
        {!editRes && addMode === 'gmail' && (
          <ScrollView contentContainerStyle={{ alignItems: 'center', paddingTop: 120, padding: 32 }}>
            {gmailLoading ? (
              <ThemedText style={{ fontSize: 14, color: theme.textSecondary }}>Checking connection...</ThemedText>
            ) : gmailConnected ? (
              <>
                <ThemedText type="headline" style={{ textAlign: 'center', marginBottom: 8 }}>
                  Gmail connected
                </ThemedText>
                <ThemedText style={{ fontSize: 15, lineHeight: 22, textAlign: 'center', color: theme.textSecondary }}>
                  We'll automatically scan your inbox for booking confirmations and organize them for you.
                </ThemedText>
                {gmailLastSync && (
                  <ThemedText style={{ fontSize: 13, color: theme.textSecondary, marginTop: 12 }}>
                    Last scanned: {new Date(gmailLastSync).toLocaleDateString()}
                  </ThemedText>
                )}
                <Pressable
                  onPress={handleSyncGmail}
                  style={({ pressed }) => [styles.primaryBtn, { backgroundColor: theme.primary, marginTop: 24, opacity: pressed || gmailSyncing ? 0.7 : 1 }]}
                  disabled={gmailSyncing}
                  accessibilityRole="button"
                  accessibilityLabel="Scan inbox now"
                >
                  <ThemedText style={[styles.primaryBtnText, { color: theme.primaryText }]}>
                    {gmailSyncing ? 'Scanning...' : 'Scan Inbox Now'}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleDisconnectGmail}
                  style={{ marginTop: 16 }}
                  accessibilityRole="button"
                  accessibilityLabel="Disconnect Gmail"
                >
                  <ThemedText style={{ fontSize: 14, color: theme.danger }}>Disconnect</ThemedText>
                </Pressable>
              </>
            ) : (
              <>
                <ThemedText type="headline" style={{ textAlign: 'center', marginBottom: 8 }}>
                  Connect your Gmail
                </ThemedText>
                <ThemedText style={{ fontSize: 15, lineHeight: 22, textAlign: 'center', color: theme.textSecondary }}>
                  We'll scan your inbox for booking confirmations and automatically organize them for you.
                </ThemedText>
                <Pressable
                  onPress={handleConnectGmail}
                  style={({ pressed }) => ({
                    flexDirection: 'row' as const,
                    alignItems: 'center' as const,
                    gap: 10,
                    paddingHorizontal: 24,
                    paddingVertical: 14,
                    borderRadius: Radius.xl,
                    backgroundColor: theme.primary,
                    marginTop: 24,
                    opacity: pressed ? 0.85 : 1,
                  })}
                  accessibilityRole="button"
                  accessibilityLabel="Connect Gmail"
                >
                  <Image source={require('@/assets/images/gmail-logo.png')} style={{ width: 20, height: 20 }} />
                  <ThemedText style={{ fontSize: 16, fontWeight: '700', color: theme.primaryText }}>Connect Gmail</ThemedText>
                </Pressable>
              </>
            )}
          </ScrollView>
        )}

        {/* STEP 2A: Booking link path */}
        {!editRes && addMode === 'link' && (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {!linkLoading ? (
              <>
                <ThemedText style={[styles.formLabel, { marginTop: 0 }]}>Confirmation Link</ThemedText>
                <TextInput
                  style={[styles.formInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={linkUrl}
                  onChangeText={setLinkUrl}
                  placeholder="Paste link from confirmation email..."
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoFocus
                  accessibilityLabel="Confirmation link"
                />
                {linkError ? (
                  <ThemedText style={[{ fontSize: 13, color: theme.danger }]}>{linkError}</ThemedText>
                ) : (
                  <ThemedText style={[{ fontSize: 13, color: theme.textSecondary }]}>
                    Paste the link from your booking confirmation email. Works with hotels, flights, restaurants, and more.
                  </ThemedText>
                )}
                <Pressable
                  onPress={handleLinkImport}
                  style={[styles.primaryBtn, { backgroundColor: theme.primary, opacity: linkUrl.trim() ? 1 : 0.4 }]}
                  disabled={!linkUrl.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Extract booking info"
                >
                  <ThemedText style={[styles.primaryBtnText, { color: theme.primaryText }]}>Extract Booking Info</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => { setResBookingUrl(linkUrl.trim()); setAddMode('manual'); }}
                  style={[styles.secondaryBtn, { borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Skip and enter manually"
                >
                  <ThemedText style={[styles.secondaryBtnText, { color: theme.textSecondary }]}>Skip — enter details manually</ThemedText>
                </Pressable>
              </>
            ) : (
              <View style={styles.analyzingSection}>
                <ThemedText style={[styles.analyzingPct, { color: theme.primary }]}>{Math.round(percentage)}%</ThemedText>
                <View style={[styles.analyzingBar, { backgroundColor: theme.backgroundElement }]}>
                  <Animated.View style={[styles.analyzingFill, { backgroundColor: theme.primary }, progressBarStyle]} />
                </View>
                <Animated.View key={analyzeStep} entering={FadeInDown.duration(250)}>
                  <ThemedText style={[styles.analyzingLabel, { color: theme.textSecondary }]}>{ANALYZE_STEPS[analyzeStep]}</ThemedText>
                </Animated.View>
              </View>
            )}
          </ScrollView>
        )}

        {/* STEP 2B: Review extracted info */}
        {!editRes && addMode === 'review' && (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
            {/* Preview card */}
            <View style={[styles.reviewCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              {/* Type badge + title */}
              <View style={styles.reviewHeader}>
                <View style={[styles.reviewTypeBadge, { backgroundColor: theme.primaryMuted }]}>
                  <SymbolView name={(TYPE_SYMBOLS[resType] ?? 'doc.text.fill') as any} size={16} tintColor={theme.primary} />
                  <ThemedText style={[styles.reviewTypeText, { color: theme.primary }]}>{TYPE_LABELS[resType] ?? 'Booking'}</ThemedText>
                </View>
              </View>
              <ThemedText style={styles.reviewTitle}>{resTitle || 'Untitled'}</ThemedText>

              {/* Detail rows */}
              {resConfirmation ? (
                <View style={styles.reviewRow}>
                  <SymbolView name="doc.on.clipboard" size={15} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Confirmation</ThemedText>
                  <ThemedText style={[styles.reviewValue, { color: theme.primary }]}>{resConfirmation}</ThemedText>
                </View>
              ) : null}
              {resDate ? (
                <View style={styles.reviewRow}>
                  <SymbolView name="calendar" size={15} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Date</ThemedText>
                  <ThemedText style={styles.reviewValue}>{formatDate(resDate)}{resCheckoutDate ? ` \u2013 ${formatDate(resCheckoutDate)}` : ''}</ThemedText>
                </View>
              ) : null}
              {resTime ? (
                <View style={styles.reviewRow}>
                  <SymbolView name="clock" size={15} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Time</ThemedText>
                  <ThemedText style={styles.reviewValue}>{resTime}</ThemedText>
                </View>
              ) : null}
              {resPrice ? (
                <View style={styles.reviewRow}>
                  <SymbolView name="creditcard" size={15} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Price</ThemedText>
                  <ThemedText style={styles.reviewValue}>{getCurrSymbol(resCurrency)}{parseFloat(resPrice).toLocaleString()}</ThemedText>
                </View>
              ) : null}
              {resAddress ? (
                <View style={styles.reviewRow}>
                  <SymbolView name="mappin" size={15} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Address</ThemedText>
                  <ThemedText style={[styles.reviewValue, { flex: 1 }]} numberOfLines={2}>{resAddress}</ThemedText>
                </View>
              ) : null}
              {resBookingUrl ? (
                <View style={styles.reviewRow}>
                  <SymbolView name="link" size={15} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Link</ThemedText>
                  <ThemedText style={[styles.reviewValue, { color: theme.primary, flex: 1 }]} numberOfLines={1}>
                    {resBookingUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 35)}
                  </ThemedText>
                </View>
              ) : null}
              {resNotes ? (
                <View style={styles.reviewRow}>
                  <SymbolView name="note.text" size={15} tintColor={theme.textSecondary} />
                  <ThemedText style={[styles.reviewLabel, { color: theme.textSecondary }]}>Notes</ThemedText>
                  <ThemedText style={[styles.reviewValue, { flex: 1 }]} numberOfLines={2}>{resNotes}</ThemedText>
                </View>
              ) : null}
            </View>

            {/* Trip picker */}
            <ThemedText style={[styles.formLabel, { marginTop: 0 }]}>Add to trip</ThemedText>
            <Pressable
              onPress={() => openTripPicker((id) => setSelectedTripId(id))}
              style={[styles.tripPickerBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Select trip"
            >
              <ThemedText style={[{ fontSize: 15, color: selectedTripId ? theme.text : theme.textSecondary }]}>
                {selectedTripId
                  ? (() => { const t = trips.find((tr) => tr.id === selectedTripId); return t ? `${t.emoji} ${t.destination}` : 'Select trip'; })()
                  : 'Select trip'}
              </ThemedText>
              <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
            </Pressable>

            {/* Add button */}
            <Pressable
              onPress={handleSave}
              style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Add booking to trip"
            >
              <ThemedText style={[styles.primaryBtnText, { color: theme.primaryText }]}>Add Booking</ThemedText>
            </Pressable>

            {/* Edit details link */}
            <Pressable
              onPress={() => setAddMode('manual')}
              style={[styles.secondaryBtn, { borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Edit details manually"
            >
              <ThemedText style={[styles.secondaryBtnText, { color: theme.textSecondary }]}>Edit Details</ThemedText>
            </Pressable>
          </ScrollView>
        )}

        {/* STEP 2C: Manual entry / Edit */}
        {(editRes || addMode === 'manual') && (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {/* Trip picker (new booking only) */}
            {!editRes && (
              <>
                <ThemedText style={[styles.formLabel, { marginTop: 0 }]}>Trip</ThemedText>
                <Pressable
                  onPress={() => openTripPicker((id) => setSelectedTripId(id))}
                  style={[styles.tripPickerBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Select trip"
                >
                  <ThemedText style={[{ fontSize: 15, color: selectedTripId ? theme.text : theme.textSecondary }]}>
                    {selectedTripId
                      ? (() => { const t = trips.find((tr) => tr.id === selectedTripId); return t ? `${t.emoji} ${t.destination}` : 'Select trip'; })()
                      : 'Select trip'}
                  </ThemedText>
                  <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
                </Pressable>
              </>
            )}

            {/* Type picker */}
            <ThemedText style={[styles.formLabel, editRes ? { marginTop: 0 } : {}]}>Type</ThemedText>
            <View style={styles.typeRow}>
              {([
                { value: 'restaurant', symbol: 'fork.knife' },
                { value: 'hotel', symbol: 'bed.double.fill' },
                { value: 'flight', symbol: 'airplane' },
                { value: 'train', symbol: 'tram.fill' },
                { value: 'activity', symbol: 'star.fill' },
                { value: 'other', symbol: 'doc.text.fill' },
              ] as { value: ReservationType; symbol: string }[]).map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setResType(opt.value)}
                  style={[
                    styles.typeChip,
                    { backgroundColor: resType === opt.value ? theme.primary : 'transparent', borderWidth: 1, borderColor: resType === opt.value ? theme.primary : theme.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Type: ${opt.value}`}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <SymbolView name={opt.symbol as any} size={14} tintColor={resType === opt.value ? theme.primaryText : theme.text} />
                    <ThemedText style={[styles.typeChipText, resType === opt.value && { color: theme.primaryText }]}>{opt.value}</ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>

            {/* Title */}
            <ThemedText style={styles.formLabel}>Title *</ThemedText>
            <TextInput
              style={[styles.formInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={resTitle}
              onChangeText={setResTitle}
              placeholder="e.g. Hotel Majestic, United Flight 123"
              placeholderTextColor={theme.textSecondary}
              autoFocus={!editRes && addMode === 'manual' && !resTitle}
              accessibilityLabel="Booking name"
            />

            {/* Date */}
            <ThemedText style={styles.formLabel}>
              {resType === 'hotel' ? 'Check-in date' : resType === 'flight' || resType === 'train' ? 'Departure date' : 'Date'} (YYYY-MM-DD)
            </ThemedText>
            <TextInput
              style={[styles.formInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={resDate}
              onChangeText={setResDate}
              placeholder="2026-08-20"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Date"
            />

            {resType === 'hotel' && (
              <>
                <ThemedText style={styles.formLabel}>Check-out date (YYYY-MM-DD, optional)</ThemedText>
                <TextInput
                  style={[styles.formInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  value={resCheckoutDate}
                  onChangeText={setResCheckoutDate}
                  placeholder="2026-08-25"
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel="Check-out date"
                />
              </>
            )}

            {/* Time */}
            <ThemedText style={styles.formLabel}>Time (optional)</ThemedText>
            <TimePickerButton value={resTime} onChange={setResTime} />

            {/* Confirmation number */}
            <ThemedText style={styles.formLabel}>Confirmation number (optional)</ThemedText>
            <TextInput
              style={[styles.formInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={resConfirmation}
              onChangeText={setResConfirmation}
              placeholder="ABC123"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="characters"
              accessibilityLabel="Confirmation number"
            />

            {/* Booking URL */}
            <ThemedText style={styles.formLabel}>Booking URL (optional)</ThemedText>
            <TextInput
              style={[styles.formInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={resBookingUrl}
              onChangeText={setResBookingUrl}
              placeholder="https://..."
              placeholderTextColor={theme.textSecondary}
              keyboardType="url"
              autoCapitalize="none"
              accessibilityLabel="Booking URL"
            />

            {/* Price */}
            <ThemedText style={styles.formLabel}>Price (optional)</ThemedText>
            <TextInput
              style={[styles.formInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={resPrice}
              onChangeText={setResPrice}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              accessibilityLabel="Price"
            />

            {/* Currency */}
            <ThemedText style={styles.formLabel}>Currency</ThemedText>
            <View style={styles.typeRow}>
              {['USD', 'EUR', 'GBP', 'JPY'].map((cur) => (
                <Pressable
                  key={cur}
                  onPress={() => setResCurrency(cur)}
                  style={[
                    styles.typeChip,
                    { backgroundColor: resCurrency === cur ? theme.primary : 'transparent', borderWidth: 1, borderColor: resCurrency === cur ? theme.primary : theme.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${cur}`}
                >
                  <ThemedText style={[styles.typeChipText, resCurrency === cur && { color: theme.primaryText }]}>{cur}</ThemedText>
                </Pressable>
              ))}
            </View>

            {/* Address */}
            <ThemedText style={styles.formLabel}>Address (optional)</ThemedText>
            <TextInput
              style={[styles.formInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={resAddress}
              onChangeText={setResAddress}
              placeholder="123 Main St, City"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Address"
            />

            {/* Notes */}
            <ThemedText style={styles.formLabel}>Notes (optional)</ThemedText>
            <TextInput
              style={[styles.formInput, styles.formInputMulti, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={resNotes}
              onChangeText={setResNotes}
              placeholder="Additional details..."
              placeholderTextColor={theme.textSecondary}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Notes"
            />

            {/* Save button */}
            <Pressable
              onPress={handleSave}
              style={[styles.primaryBtn, { backgroundColor: theme.primary, opacity: resTitle.trim() ? 1 : 0.4 }]}
              disabled={!resTitle.trim()}
              accessibilityRole="button"
              accessibilityLabel={editRes ? 'Save changes' : 'Add booking'}
            >
              <ThemedText style={[styles.primaryBtnText, { color: theme.primaryText }]}>
                {editRes ? 'Save Changes' : 'Add Booking'}
              </ThemedText>
            </Pressable>

            {/* Delete (edit mode) */}
            {editRes && !editRes.res.cancelled && (
              <Pressable
                onPress={() => onDelete(editRes.res, editRes.tripId)}
                style={[styles.secondaryBtn, { borderColor: theme.danger }]}
                accessibilityRole="button"
                accessibilityLabel="Delete booking"
              >
                <ThemedText style={[styles.secondaryBtnText, { color: theme.danger }]}>Delete Booking</ThemedText>
              </Pressable>
            )}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>

    {sheetState && (
      <SelectionSheet
        visible={!!sheetState}
        title={sheetState.title}
        subtitle={sheetState.subtitle}
        options={sheetState.options}
        onSelect={sheetState.onSelect}
        onClose={() => setSheetState(null)}
      />
    )}
    </>
  );
}

// ── Main Screen ──

export default function BookingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { showToast } = useToast();
  const { trips, getTripState, addReservation, updateReservation, removeReservation } = useTrips();

  // ── Card expansion ──
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // ── Modal ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalInitialMode, setModalInitialMode] = useState<'choose' | 'gmail'>('choose');
  const [editingReservation, setEditingReservation] = useState<{ res: Reservation; tripId: string } | null>(null);

  // ── Booking forwarding email ──
  const [bookingEmail, setBookingEmail] = useState('');
  const [emailCopied, setEmailCopied] = useState(false);
  useEffect(() => {
    getBookingEmailAI().then((r) => setBookingEmail(r.email)).catch(() => {});
  }, []);

  async function handleCopyEmail() {
    if (!bookingEmail) return;
    await Clipboard.setStringAsync(bookingEmail);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  }

  // ── Pending bookings (from email forwarding / Gmail sync) ──
  const [pendingBookings, setPendingBookings] = useState<ParsedBooking[]>([]);

  useEffect(() => {
    getParsedBookingsAI()
      .then((res) => setPendingBookings(res.bookings.filter((b) => b.status === 'pending')))
      .catch(() => { /* not set up yet, ignore */ });
  }, [showAddModal]); // refresh when modal closes

  function handleImportPending(booking: ParsedBooking) {
    const data = booking.booking_data;
    setEditingReservation(null);
    // Pre-fill the modal with this booking's data by opening in review mode
    // We pass the booking data through editRes-like mechanism
    setPendingImportData(booking);
    setShowAddModal(true);
  }

  async function handleDismissPending(booking: ParsedBooking) {
    try {
      await dismissParsedBookingAI(booking.id);
      setPendingBookings((prev) => prev.filter((b) => b.id !== booking.id));
      showToast('Booking dismissed', 'success');
    } catch {
      showToast('Could not dismiss', 'error');
    }
  }

  // ── Pending import data (for pre-filling modal from parsed bookings) ──
  const [pendingImportData, setPendingImportData] = useState<ParsedBooking | null>(null);

  // ── Photos ──
  const [photoMap, setPhotoMap] = useState<Map<string, string>>(new Map());

  // ── Trip grouping ──
  const tripsWithReservations = useMemo(() => {
    const result: { trip: Trip; state: TripState; reservations: Reservation[] }[] = [];
    for (const trip of trips) {
      const reservations = (trip.reservations ?? []).filter((r) => !r.cancelled);
      if (reservations.length === 0) continue;
      result.push({ trip, state: getTripState(trip), reservations });
    }
    // Sort: active first, then upcoming, then past
    const order: Record<TripState, number> = { active: 0, upcoming: 1, planned: 2, draft: 3, past: 4 };
    result.sort((a, b) => order[a.state] - order[b.state]);
    return result;
  }, [trips, getTripState]);

  // Fetch photos for reservations that have linked activities with placeIds
  useEffect(() => {
    const fetchPhotos = async () => {
      const newMap = new Map(photoMap);
      let changed = false;
      for (const { trip, reservations } of tripsWithReservations) {
        for (const res of reservations) {
          if (newMap.has(res.id)) continue;
          // Find linked activity
          const linkedActivity = trip.activities.find((a) => a.reservationId === res.id);
          const photoRef = linkedActivity?.placeId ? undefined : undefined;
          const name = res.title;
          try {
            const photo = await getPlacePhoto({
              cacheKey: `booking-${res.id}`,
              name,
              category: res.type === 'hotel' ? 'stay' : res.type === 'restaurant' ? 'food' : 'activity',
            });
            if (photo?.url) {
              newMap.set(res.id, photo.url);
              changed = true;
            }
          } catch { /* ignore */ }
        }
      }
      if (changed) setPhotoMap(new Map(newMap));
    };
    if (tripsWithReservations.length > 0) fetchPhotos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripsWithReservations.length]);

  // ── Actions ──

  function openAddModal() {
    setEditingReservation(null);
    setModalInitialMode('choose');
    setShowAddModal(true);
  }

  function openEditModal(res: Reservation, tripId: string) {
    setEditingReservation({ res, tripId });
    setShowAddModal(true);
  }

  function handleDelete(res: Reservation, tripId: string) {
    Alert.alert('Remove booking?', `Remove "${res.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeReservation(tripId, res.id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          showToast('Booking removed', 'success');
          if (expandedCardId === res.id) setExpandedCardId(null);
          setShowAddModal(false);
        },
      },
    ]);
  }

  async function handleCopyConfirmation(text: string) {
    await Clipboard.setStringAsync(text);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showToast('Copied to clipboard', 'success');
  }

  // ── Render ──

  const totalBookings = tripsWithReservations.reduce((sum, g) => sum + g.reservations.length, 0);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name="chevron.left" size={20} tintColor={theme.primary} />
        </Pressable>
        <ThemedText style={styles.headerTitle}>My Bookings</ThemedText>
        <Pressable onPress={openAddModal} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Add booking">
          <SymbolView name="plus" size={20} tintColor={theme.primary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }, totalBookings === 0 && { flexGrow: 1 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Pending imported bookings */}
        {pendingBookings.length > 0 && (
          <View style={styles.tripGroup}>
            <View style={[styles.tripHeader, { backgroundColor: theme.primaryMuted }]}>
              <View style={styles.tripHeaderLeft}>
                <SymbolView name="envelope.badge.fill" size={24} tintColor={theme.primary} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.tripName}>New Bookings</ThemedText>
                  <ThemedText style={[styles.tripDates, { color: theme.textSecondary }]}>Imported from email</ThemedText>
                </View>
              </View>
              <View style={[styles.stateBadge, { backgroundColor: theme.primary + '20' }]}>
                <ThemedText style={[styles.stateBadgeText, { color: theme.primary }]}>{pendingBookings.length} new</ThemedText>
              </View>
            </View>

            {pendingBookings.map((booking) => {
              const data = booking.booking_data;
              const resTypeKey = data.reservationType ?? 'other';
              return (
                <Animated.View key={booking.id} entering={FadeInDown.duration(200)}>
                  <Pressable
                    onPress={() => handleImportPending(booking)}
                    style={[styles.bookingCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Import ${data.name} booking`}
                  >
                    <View style={styles.compactRow}>
                      <View style={[styles.compactPhoto, { backgroundColor: theme.primaryMuted }]}>
                        <SymbolView name={(TYPE_SYMBOLS[resTypeKey] ?? 'doc.text.fill') as any} size={22} tintColor={theme.primary} />
                      </View>
                      <View style={styles.compactInfo}>
                        <View style={styles.compactTitleRow}>
                          <SymbolView name={(TYPE_SYMBOLS[resTypeKey] ?? 'doc.text.fill') as any} size={14} tintColor={theme.textSecondary} />
                          <ThemedText style={styles.compactTitle} numberOfLines={1}>{data.name || 'Unknown booking'}</ThemedText>
                        </View>
                        <ThemedText style={[styles.compactMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                          {[
                            data.bookingDate ? formatDate(data.bookingDate) : null,
                            data.bookingTime,
                            data.confirmationNumber,
                          ].filter(Boolean).join(' \u00B7 ') || (booking.source_email_subject ?? 'Tap to review')}
                        </ThemedText>
                      </View>
                      <Pressable
                        onPress={(e) => { e.stopPropagation?.(); handleDismissPending(booking); }}
                        hitSlop={8}
                        style={{ padding: 4 }}
                        accessibilityRole="button"
                        accessibilityLabel="Dismiss"
                      >
                        <SymbolView name="xmark" size={14} tintColor={theme.textSecondary} />
                      </Pressable>
                      <SymbolView name="chevron.right" size={14} tintColor={theme.primary} />
                    </View>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        )}

        {/* Empty state */}
        {totalBookings === 0 && (
          <Animated.View entering={FadeIn.duration(500)} style={styles.emptyState}>
            <ThemedText type="headline" style={styles.emptyTitle}>
              Your bookings, all in one place.
            </ThemedText>
            <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
              Forward your confirmation emails here and we'll organize everything for you.
            </ThemedText>

            {/* Copyable email address */}
            {bookingEmail ? (
              <Pressable
                onPress={handleCopyEmail}
                style={[styles.emptyEmailBox, { borderColor: theme.border }]}
                accessibilityRole="button"
                accessibilityLabel="Copy forwarding email address"
              >
                <ThemedText style={[styles.emptyEmailText, { color: theme.primary }]} numberOfLines={1}>
                  {bookingEmail}
                </ThemedText>
                <SymbolView
                  name={emailCopied ? 'checkmark' : 'square.on.square'}
                  size={14}
                  tintColor={emailCopied ? theme.primary : theme.textSecondary}
                />
              </Pressable>
            ) : (
              <ThemedText style={[styles.emptyText, { color: theme.textSecondary, fontSize: 13 }]}>Loading email...</ThemedText>
            )}

            {/* Divider */}
            <View style={styles.emptyDivider}>
              <View style={[styles.emptyDividerLine, { backgroundColor: theme.border }]} />
              <ThemedText style={[{ fontSize: 13, color: theme.textSecondary }]}>or</ThemedText>
              <View style={[styles.emptyDividerLine, { backgroundColor: theme.border }]} />
            </View>

            {/* Connect Gmail */}
            <Pressable
              onPress={() => { setModalInitialMode('gmail'); setShowAddModal(true); }}
              style={({ pressed }) => [styles.emptyGmailBtn, { borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Connect Gmail"
            >
              <Image source={require('@/assets/images/gmail-logo.png')} style={{ width: 20, height: 20 }} />
              <ThemedText style={[styles.emptyGmailBtnText, { color: theme.text }]}>Connect Gmail</ThemedText>
            </Pressable>
          </Animated.View>
        )}

        {/* Trip groups */}
        {tripsWithReservations.map(({ trip, state, reservations }) => {
          const stateLabel = state === 'active' ? 'Now' : state === 'upcoming' ? 'Upcoming' : state === 'past' ? 'Past' : '';
          return (
            <Animated.View key={trip.id} entering={FadeIn.duration(300)} style={styles.tripGroup}>
              {/* Trip section header */}
              <Pressable
                onPress={() => router.push(`/(tabs)/trip/${trip.id}` as any)}
                style={[styles.tripHeader, { backgroundColor: theme.backgroundElement }]}
                accessibilityRole="button"
                accessibilityLabel={`View trip to ${trip.destination}`}
              >
                <View style={styles.tripHeaderLeft}>
                  <ThemedText style={styles.tripEmoji}>{trip.emoji}</ThemedText>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.tripName}>{trip.destination}</ThemedText>
                    <ThemedText style={[styles.tripDates, { color: theme.textSecondary }]}>{formatTripDates(trip)}</ThemedText>
                  </View>
                </View>
                <View style={styles.tripHeaderRight}>
                  {stateLabel ? (
                    <View style={[styles.stateBadge, { backgroundColor: state === 'active' ? theme.live + '20' : theme.primaryMuted }]}>
                      <ThemedText style={[styles.stateBadgeText, { color: state === 'active' ? theme.live : theme.textSecondary }]}>{stateLabel}</ThemedText>
                    </View>
                  ) : null}
                  <ThemedText style={[styles.bookingCount, { color: theme.textSecondary }]}>
                    {reservations.length} booking{reservations.length !== 1 ? 's' : ''}
                  </ThemedText>
                </View>
              </Pressable>

              {/* Booking cards */}
              {reservations.map((res) => {
                const isExpanded = expandedCardId === res.id;
                const photoUrl = photoMap.get(res.id);
                return (
                  <Animated.View key={res.id} entering={FadeInDown.duration(200)}>
                    <Pressable
                      onPress={() => setExpandedCardId(isExpanded ? null : res.id)}
                      style={[styles.bookingCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${res.title} booking${isExpanded ? ', tap to collapse' : ', tap to expand'}`}
                    >
                      {/* Compact view — always visible */}
                      <View style={styles.compactRow}>
                        {/* Photo or placeholder */}
                        <View style={[styles.compactPhoto, { backgroundColor: theme.backgroundSelected }]}>
                          {photoUrl ? (
                            <ExpoImage source={{ uri: photoUrl }} style={styles.compactPhotoImg} contentFit="cover" />
                          ) : (
                            <SymbolView name={(TYPE_SYMBOLS[res.type] ?? 'doc.text.fill') as any} size={22} tintColor={theme.textSecondary} />
                          )}
                        </View>
                        <View style={styles.compactInfo}>
                          <View style={styles.compactTitleRow}>
                            <SymbolView name={(TYPE_SYMBOLS[res.type] ?? 'doc.text.fill') as any} size={14} tintColor={theme.textSecondary} />
                            <ThemedText style={styles.compactTitle} numberOfLines={1}>{res.title}</ThemedText>
                          </View>
                          <ThemedText style={[styles.compactMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                            {[
                              res.date ? formatDate(res.date) : null,
                              res.time,
                              res.confirmationNumber,
                            ].filter(Boolean).join(' \u00B7 ') || (TYPE_LABELS[res.type] ?? 'Booking')}
                          </ThemedText>
                        </View>
                        {res.confirmationNumber ? (
                          <View style={[styles.confirmedBadge, { backgroundColor: '#10B981' + '20' }]}>
                            <SymbolView name="checkmark" size={12} tintColor="#10B981" />
                          </View>
                        ) : null}
                        <SymbolView name={isExpanded ? 'chevron.up' : 'chevron.down'} size={14} tintColor={theme.textSecondary} />
                      </View>

                      {/* Expanded view */}
                      {isExpanded && (
                        <Animated.View entering={FadeIn.duration(200)} style={styles.expandedSection}>
                          {/* Full-width photo */}
                          {photoUrl && (
                            <ExpoImage source={{ uri: photoUrl }} style={styles.expandedPhoto} contentFit="cover" />
                          )}

                          {/* Type badge */}
                          <View style={styles.expandedTypeRow}>
                            <View style={[styles.expandedTypeBadge, { backgroundColor: theme.primaryMuted }]}>
                              <SymbolView name={(TYPE_SYMBOLS[res.type] ?? 'doc.text.fill') as any} size={14} tintColor={theme.primary} />
                              <ThemedText style={[styles.expandedTypeText, { color: theme.primary }]}>{TYPE_LABELS[res.type] ?? 'Booking'}</ThemedText>
                            </View>
                          </View>

                          {/* Divider */}
                          <View style={[styles.expandedDivider, { backgroundColor: theme.border }]} />

                          {/* Details rows */}
                          {res.confirmationNumber ? (
                            <Pressable
                              onPress={() => handleCopyConfirmation(res.confirmationNumber!)}
                              style={styles.detailRow}
                              accessibilityRole="button"
                              accessibilityLabel="Copy confirmation number"
                            >
                              <SymbolView name="doc.on.clipboard" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Confirmation</ThemedText>
                              <ThemedText style={[styles.detailValue, { color: theme.primary }]}>{res.confirmationNumber}</ThemedText>
                              <SymbolView name="doc.on.doc" size={14} tintColor={theme.textSecondary} />
                            </Pressable>
                          ) : null}

                          {res.date ? (
                            <View style={styles.detailRow}>
                              <SymbolView name="calendar" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Date</ThemedText>
                              <ThemedText style={styles.detailValue}>{formatDate(res.date)}{res.notes?.includes('Check-out:') ? ` \u2013 ${formatDate(res.notes.split('Check-out: ')[1]?.split('\n')[0])}` : ''}</ThemedText>
                            </View>
                          ) : null}

                          {res.time ? (
                            <View style={styles.detailRow}>
                              <SymbolView name="clock" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Time</ThemedText>
                              <ThemedText style={styles.detailValue}>{res.time}</ThemedText>
                            </View>
                          ) : null}

                          {res.price != null ? (
                            <View style={styles.detailRow}>
                              <SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Price</ThemedText>
                              <ThemedText style={styles.detailValue}>{getCurrSymbol(res.currency ?? 'USD')}{res.price.toLocaleString()}</ThemedText>
                            </View>
                          ) : null}

                          {res.address ? (
                            <View style={styles.detailRow}>
                              <SymbolView name="mappin" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Address</ThemedText>
                              <ThemedText style={[styles.detailValue, { flex: 1 }]} numberOfLines={2}>{res.address}</ThemedText>
                            </View>
                          ) : null}

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
                              <SymbolView name={"arrow.up.right.square" as any} size={14} tintColor={theme.primary} />
                            </Pressable>
                          ) : null}

                          {res.notes && !res.notes.startsWith('Check-out:') ? (
                            <View style={styles.detailRow}>
                              <SymbolView name="note.text" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Notes</ThemedText>
                              <ThemedText style={[styles.detailValue, { flex: 1 }]} numberOfLines={3}>
                                {res.notes.split('\nCheck-out:')[0]}
                              </ThemedText>
                            </View>
                          ) : null}

                          {/* Divider */}
                          <View style={[styles.expandedDivider, { backgroundColor: theme.border }]} />

                          {/* Action buttons */}
                          <View style={styles.expandedActions}>
                            <Pressable
                              onPress={() => openEditModal(res, trip.id)}
                              style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]}
                              accessibilityRole="button"
                              accessibilityLabel="Edit booking"
                            >
                              <SymbolView name="pencil" size={16} tintColor={theme.text} />
                              <ThemedText style={styles.actionBtnText}>Edit</ThemedText>
                            </Pressable>
                            <Pressable
                              onPress={() => handleDelete(res, trip.id)}
                              style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]}
                              accessibilityRole="button"
                              accessibilityLabel="Delete booking"
                            >
                              <SymbolView name="trash" size={16} tintColor={theme.danger} />
                              <ThemedText style={[styles.actionBtnText, { color: theme.danger }]}>Delete</ThemedText>
                            </Pressable>
                          </View>
                        </Animated.View>
                      )}
                    </Pressable>
                  </Animated.View>
                );
              })}
            </Animated.View>
          );
        })}
      </ScrollView>

      {/* ── Add / Edit Modal ── */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowAddModal(false)}
      >
        {showAddModal && (
          <AddBookingModal
            visible={showAddModal}
            onClose={() => { setShowAddModal(false); setPendingImportData(null); }}
            editRes={editingReservation}
            pendingImport={pendingImportData}
            initialMode={modalInitialMode}
            trips={trips}
            onAdd={addReservation}
            onUpdate={updateReservation}
            onDelete={handleDelete}
            onMarkImported={async (id) => {
              try { await markBookingImportedAI(id); } catch { /* ignore */ }
              setPendingBookings((prev) => prev.filter((b) => b.id !== id));
              setPendingImportData(null);
            }}
          />
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  headerBtn: { width: 44, alignItems: 'center', justifyContent: 'center' },

  // Content
  content: { padding: Spacing.four, gap: 20 },

  // Empty state
  emptyState: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingHorizontal: 32, paddingBottom: 60 },
  emptyTitle: { textAlign: 'center' as const, marginBottom: 8 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' as const },
  emptyEmailBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: 4,
  },
  emptyEmailText: { fontSize: 15, fontWeight: '700' as const },
  emptyDivider: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, marginTop: 16, width: '100%' as const },
  emptyDividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  emptyGmailBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: Radius.xl,
    borderWidth: 1,
    marginTop: 12,
  },
  emptyGmailBtnText: { fontSize: 15, fontWeight: '600' as const },

  // Trip group
  tripGroup: { gap: 8 },
  tripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: Radius.md,
  },
  tripHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  tripEmoji: { fontSize: 28 },
  tripName: { fontSize: 16, fontWeight: '700' },
  tripDates: { fontSize: 13, fontWeight: '500' },
  tripHeaderRight: { alignItems: 'flex-end', gap: 4 },
  stateBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.xs },
  stateBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  bookingCount: { fontSize: 12, fontWeight: '500' },

  // Booking card
  bookingCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // Compact row
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  compactPhoto: {
    width: 52,
    height: 52,
    borderRadius: Radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  compactPhotoImg: { width: 52, height: 52 },
  compactInfo: { flex: 1, gap: 3 },
  compactTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  compactMeta: { fontSize: 13, fontWeight: '500' },
  confirmedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Expanded section
  expandedSection: { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
  expandedPhoto: { width: '100%', height: 160, borderRadius: Radius.xs },
  expandedTypeRow: { flexDirection: 'row' },
  expandedTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.xs,
  },
  expandedTypeText: { fontSize: 13, fontWeight: '600' },
  expandedDivider: { height: 1, marginVertical: 2 },

  // Detail rows
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  detailLabel: { fontSize: 13, fontWeight: '600', width: 90 },
  detailValue: { fontSize: 14, fontWeight: '500' },

  // Actions
  expandedActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  actionBtnText: { fontSize: 14, fontWeight: '600' },

  // ── Modal ──
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontWeight: '600' },
  modalClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  // Choice buttons
  choiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 14,
  },
  choiceBtnIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  choiceBtnTitle: { fontSize: 16, fontWeight: '700' },
  choiceBtnDesc: { fontSize: 13, marginTop: 2 },

  // Form
  formLabel: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  formInput: {
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  formInputMulti: { minHeight: 72, textAlignVertical: 'top' },

  // Type picker
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.xs },
  typeChipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },

  // Trip picker button
  tripPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: Radius.xs,
    borderWidth: 1,
  },

  // Buttons
  primaryBtn: { paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  primaryBtnText: { fontSize: 17, fontWeight: '700' },
  secondaryBtn: { paddingVertical: 14, borderRadius: Radius.md, alignItems: 'center', borderWidth: 1 },
  secondaryBtnText: { fontSize: 15, fontWeight: '600' },

  // Review card
  reviewCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  reviewHeader: { flexDirection: 'row' },
  reviewTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.xs,
  },
  reviewTypeText: { fontSize: 13, fontWeight: '600' },
  reviewTitle: { fontSize: 20, fontWeight: '700', marginTop: 2 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  reviewLabel: { fontSize: 13, fontWeight: '600', width: 90 },
  reviewValue: { fontSize: 14, fontWeight: '500' },

  // Analyzing
  analyzingSection: { alignItems: 'center', paddingVertical: 80, gap: 12 },
  analyzingPct: { fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] as any },
  analyzingBar: { width: '80%', height: 6, borderRadius: 3, overflow: 'hidden' },
  analyzingFill: { height: 6, borderRadius: 3 },
  analyzingLabel: { fontSize: 14, fontWeight: '500', marginTop: 4 },

  // Email forwarding
  emailAddressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: Radius.xs,
    borderWidth: 1,
    width: '100%',
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  instructionNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
  },
});
