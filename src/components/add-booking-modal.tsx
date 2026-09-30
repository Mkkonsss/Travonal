import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { TimePickerButton } from '@/components/time-picker';
import { SelectionSheet, SelectionOption } from '@/components/selection-sheet';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Reservation, ReservationType, Trip } from '@/context/trips';
import { useToast } from '@/context/toast';
import { ParsedBooking, getBookingEmailAI } from '@/services/ai';
import { sortTripsForPicker } from '@/services/trip-helpers';

// ── Shared helpers (exported for use by bookings screen) ──

export function getCurrSymbol(cur: string) {
  const map: Record<string, string> = { USD: '$', EUR: '\u20AC', GBP: '\u00A3', JPY: '\u00A5', CAD: 'C$', AUD: 'A$' };
  return map[cur] ?? cur + ' ';
}

export const TYPE_SYMBOLS: Record<string, string> = {
  hotel: 'bed.double.fill',
  flight: 'airplane',
  restaurant: 'fork.knife',
  activity: 'star.fill',
  train: 'tram.fill',
  other: 'doc.text.fill',
};

export const TYPE_LABELS: Record<string, string> = {
  hotel: 'Hotel',
  flight: 'Flight',
  restaurant: 'Restaurant',
  activity: 'Activity',
  train: 'Transport',
  other: 'Other',
};

export function formatBookingDate(dateStr?: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Modal component ──

export interface AddBookingModalProps {
  visible: boolean;
  onClose: () => void;
  editRes: { res: Reservation; tripId: string } | null;
  pendingImport: ParsedBooking | null;
  initialMode?: 'choose' | 'email' | 'manual';
  trips: Trip[];
  onAdd: (tripId: string, payload: Omit<Reservation, 'id' | 'tripId'>) => void;
  onUpdate: (tripId: string, res: Reservation) => void;
  onDelete: (res: Reservation, tripId: string) => void;
  onMarkImported?: (id: string) => void;
  /** When set, skip trip picker and use this trip */
  fixedTripId?: string;
  /** Pre-fill the title (e.g. from a stay activity) */
  fixedTitle?: string;
  /** Pre-fill the type (e.g. 'hotel' for stays) */
  fixedType?: ReservationType;
}

export function AddBookingModal({
  visible, onClose, editRes, pendingImport, initialMode, trips,
  onAdd, onUpdate, onDelete, onMarkImported,
  fixedTripId, fixedTitle, fixedType,
}: AddBookingModalProps) {
  const theme = useTheme();
  const { showToast } = useToast();

  const initData = pendingImport?.booking_data;
  const [addMode, setAddMode] = useState<'choose' | 'email' | 'review' | 'manual'>(editRes ? 'manual' : initData ? 'review' : (initialMode ?? 'choose'));

  // Email forwarding
  const [bookingEmail, setBookingEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);

  // Auto-load email when starting in email mode
  useEffect(() => {
    if (initialMode === 'email') loadBookingEmail();
  }, []);

  // Form fields — pre-fill from edit or pending import
  const typeMap: Record<string, ReservationType> = { restaurant: 'restaurant', hotel: 'hotel', flight: 'flight', train: 'train', activity: 'activity', other: 'other' };
  const [resType, setResType] = useState<ReservationType>(
    editRes?.res.type ?? fixedType ?? (initData?.reservationType ? typeMap[initData.reservationType] ?? 'other' : 'restaurant'),
  );
  const [resTitle, setResTitle] = useState(editRes?.res.title ?? fixedTitle ?? initData?.name ?? '');
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
  const [selectedTripId, setSelectedTripId] = useState<string | null>(fixedTripId ?? editRes?.tripId ?? null);
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
      if (pendingImport?.id && onMarkImported) {
        onMarkImported(pendingImport.id);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onClose();
    };

    if (editRes) {
      doSave(editRes.tripId);
    } else if (fixedTripId) {
      doSave(fixedTripId);
    } else if (selectedTripId) {
      doSave(selectedTripId);
    } else {
      openTripPicker((tripId) => {
        setSelectedTripId(tripId);
        doSave(tripId);
      });
    }
  }

  const showTripPicker = !fixedTripId;

  return (
    <>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
        {/* Modal header */}
        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
          <ThemedText style={styles.modalTitle}>
            {editRes ? 'Edit Booking' : addMode === 'choose' ? 'Add Booking' : addMode === 'email' ? 'Forward Email' : addMode === 'review' ? 'Booking Found' : 'Booking Details'}
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

        {/* STEP 2B: Review extracted info */}
        {!editRes && addMode === 'review' && (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
            <View style={[styles.reviewCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={styles.reviewHeader}>
                <View style={[styles.reviewTypeBadge, { backgroundColor: theme.primaryMuted }]}>
                  <SymbolView name={(TYPE_SYMBOLS[resType] ?? 'doc.text.fill') as any} size={16} tintColor={theme.primary} />
                  <ThemedText style={[styles.reviewTypeText, { color: theme.primary }]}>{TYPE_LABELS[resType] ?? 'Booking'}</ThemedText>
                </View>
              </View>
              <ThemedText style={styles.reviewTitle}>{resTitle || 'Untitled'}</ThemedText>

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
                  <ThemedText style={styles.reviewValue}>{formatBookingDate(resDate)}{resCheckoutDate ? ` \u2013 ${formatBookingDate(resCheckoutDate)}` : ''}</ThemedText>
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

            {/* Trip picker — only when not fixed */}
            {showTripPicker && (
              <>
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
              </>
            )}

            <Pressable
              onPress={handleSave}
              style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Add booking to trip"
            >
              <ThemedText style={[styles.primaryBtnText, { color: theme.primaryText }]}>Add Booking</ThemedText>
            </Pressable>

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
            {/* Trip picker (new booking only, not fixed) */}
            {!editRes && showTripPicker && (
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
            <ThemedText style={[styles.formLabel, editRes || fixedTripId ? { marginTop: 0 } : {}]}>Type</ThemedText>
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

            <ThemedText style={styles.formLabel}>Time (optional)</ThemedText>
            <TimePickerButton value={resTime} onChange={setResTime} />

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

            <ThemedText style={styles.formLabel}>Address (optional)</ThemedText>
            <TextInput
              style={[styles.formInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={resAddress}
              onChangeText={setResAddress}
              placeholder="123 Main St, City"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Address"
            />

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

const styles = StyleSheet.create({
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

  formLabel: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  formInput: {
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  formInputMulti: { minHeight: 72, textAlignVertical: 'top' },

  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.xs },
  typeChipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },

  tripPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: Radius.xs,
    borderWidth: 1,
  },

  primaryBtn: { paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  primaryBtnText: { fontSize: 17, fontWeight: '700' },
  secondaryBtn: { paddingVertical: 14, borderRadius: Radius.md, alignItems: 'center', borderWidth: 1 },
  secondaryBtnText: { fontSize: 15, fontWeight: '600' },

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

});
