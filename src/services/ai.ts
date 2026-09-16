/**
 * Travonal AI Service
 *
 * Thin client that calls the Supabase Edge Function `ai-travonal`.
 * All trip/profile context is sent from the device — the edge function
 * is a stateless Claude proxy, keeping the Anthropic API key server-side.
 *
 * Architecture: Mobile → ai.ts → Supabase Edge Function → Claude Sonnet 4.6
 */

import { supabase } from './supabase';
import type { Trip, Activity } from '@/context/trips';
import type { TravelProfile } from '@/context/profile';

const EDGE_FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ai-travonal`;

// ─── Core fetch helper ────────────────────────────────────────────────────────

async function callEdgeFunction<T>(action: string, payload: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

  let response: Response;
  try {
    response = await fetch(EDGE_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ action, payload }),
    });
  } catch (err: unknown) {
    // Network error — likely offline
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Network') || msg.includes('network') || msg.includes('fetch')) {
      throw new Error('No internet connection. AI features require an active connection.');
    }
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  if (response.status === 429) {
    let retryAfter = 60;
    try {
      const errJson = await response.json();
      if (errJson.retry_after) retryAfter = errJson.retry_after;
    } catch { /* ignore */ }
    const mins = Math.ceil(retryAfter / 60);
    throw new Error(`You're browsing too fast! Try again in ${mins} minute${mins > 1 ? 's' : ''}.`);
  }

  // Usage limit — server denied the action due to subscription/usage gate
  if (response.status === 403) {
    let errJson: Record<string, unknown> = {};
    try { errJson = await response.json(); } catch { /* ignore */ }
    if (errJson.code === 'USAGE_LIMIT') {
      const err = new Error(String(errJson.error ?? 'Usage limit reached.'));
      (err as any).code = 'USAGE_LIMIT';
      (err as any).isPlus = errJson.is_plus ?? false;
      throw err;
    }
    throw new Error(String(errJson.error ?? 'Access denied.'));
  }

  if (!response.ok) {
    let errorMsg = 'AI request failed (HTTP ' + response.status + ')';
    try {
      const errJson = await response.json();
      if (errJson.error) errorMsg = errJson.error;
    } catch {
      // Could not parse error body
    }
    throw new Error(errorMsg);
  }

  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error ?? 'AI request failed');
  }
  return json.data as T;
}

// ─── 1. Trip Generation ───────────────────────────────────────────────────────

export interface GenerateTripResult {
  activities: Omit<Activity, 'id'>[];
}

export async function generateTripAI(params: {
  trip: Trip;
  profile: TravelProfile;
  memory: { detail: string }[];
}): Promise<GenerateTripResult> {
  return callEdgeFunction('generate_trip', params);
}

// ─── 2. Chat / Ask Travonal ───────────────────────────────────────────────────

export type TripAction =
  // Activity operations
  | { type: 'add_activity'; tripId: string; activity: Omit<Activity, 'id'> }
  | { type: 'remove_activity'; tripId: string; activityId: string }
  | { type: 'update_activity'; tripId: string; activityId: string; updates: Partial<Activity> }
  | { type: 'move_activity'; tripId: string; activityId: string; newDay: number; newTime: string }
  | { type: 'replace_activity'; tripId: string; oldActivityId: string; newActivity: Omit<Activity, 'id'> }
  | { type: 'swap_days'; tripId: string; day1: number; day2: number }
  // Trip management
  | { type: 'create_trip'; trip: Omit<Trip, 'id' | 'activities'>; activities: Omit<Activity, 'id'>[] }
  | { type: 'update_trip'; tripId: string; updates: Partial<Pick<Trip, 'title' | 'destination' | 'country' | 'startDate' | 'endDate' | 'notes' | 'emoji' | 'datesKnown'>> }
  | { type: 'delete_trip'; tripId: string }
  // Reservation management
  | { type: 'add_reservation'; tripId: string; reservation: { type: string; title: string; day?: number; date?: string; time?: string; confirmationNumber?: string; address?: string; price?: number; currency?: string; notes?: string } }
  | { type: 'remove_reservation'; tripId: string; reservationId: string }
  // Reservation updates
  | { type: 'update_reservation'; tripId: string; reservationId: string; updates: Partial<{ type: string; title: string; day: number; date: string; time: string; confirmationNumber: string; address: string; bookingUrl: string; price: number; currency: string; notes: string }> }
  // Board management
  | { type: 'save_to_board'; boardId: string; item: { title: string; type: 'activity' | 'food' | 'hotel' | 'flight'; sourceType: 'explore'; placeId?: string; address?: string; lat?: number; lng?: number; rating?: number; destination?: string; category?: string; cost?: string } }
  | { type: 'create_board'; name: string }
  | { type: 'rename_board'; boardId: string; name: string }
  | { type: 'delete_board'; boardId: string }
  | { type: 'remove_board_item'; boardId: string; itemId: string }
  | { type: 'move_board_to_trip'; boardId: string; tripId: string; itemIds: string[] }
  // Activity lock
  | { type: 'toggle_lock'; tripId: string; activityId: string }
  // Profile updates
  | { type: 'update_profile'; updates: Partial<TravelProfile> }
  // Navigation
  | { type: 'navigate'; route: string };

export interface ChatPlace {
  name: string;
  address?: string;
  rating?: number | null;
  ratingCount?: number | null;
  placeId?: string;
  lat?: number | null;
  lng?: number | null;
  types?: string[];
  photoRefs?: string[];
}

export interface ChatResult {
  message: string;
  actions: TripAction[];
  places?: ChatPlace[];
  suggestions?: string[];
  context?: string;
}

export async function chatAI(params: {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  tripContext: string;
  profile: TravelProfile;
  activeTripId?: string;
  activeTrip?: Trip;
}): Promise<ChatResult> {
  return callEdgeFunction('chat', params);
}

// ─── 3. Smart Trip Editing ────────────────────────────────────────────────────

export interface EditTripResult {
  activities: Activity[];
}

export async function editTripAI(params: {
  trip: Trip;
  instruction: string;
  day?: number;
  profile: TravelProfile;
}): Promise<EditTripResult> {
  return callEdgeFunction('edit_trip', params);
}

// ─── 4. Profile Enhancement ───────────────────────────────────────────────────

export interface EnhanceProfileResult {
  summary: string;
  insights: string[];
  recommendationStyle: string;
}

export async function enhanceProfileAI(params: {
  profile: TravelProfile;
  memory: { detail: string }[];
}): Promise<EnhanceProfileResult> {
  return callEdgeFunction('enhance_profile', params);
}

// ─── 5. Import / Identify Place ───────────────────────────────────────────────

export interface ImportPlaceResult {
  found: boolean;
  confidence?: number;
  name: string;
  location: string;
  country: string;
  category: string;
  description: string;
  notes?: string;
  emoji?: string;
  address?: string;
  rating?: number;
  lat?: number;
  lng?: number;
  placeId?: string;
  verified?: boolean;
  /** Photo URL from Google Places */
  photoUrl?: string;
  /** Multi-place results from text extraction */
  places?: ImportPlaceResult[];
}

export async function importPlaceAI(params: {
  content: string;
  contentType: 'url' | 'text' | 'image_description' | 'image_base64';
  /** MIME type for image_base64 content, e.g. 'image/png' or 'image/jpeg' */
  mimeType?: string;
}): Promise<ImportPlaceResult> {
  return callEdgeFunction('import_place', params);
}

// ─── 5b. Import Booking (place + booking details) ────────────────────────────

export interface ImportBookingResult extends ImportPlaceResult {
  confirmationNumber?: string;
  bookingDate?: string;
  checkoutDate?: string;
  bookingTime?: string;
  price?: number;
  currency?: string;
  reservationType?: string;
}

export async function importBookingAI(params: {
  content: string;
  contentType: 'url' | 'text';
}): Promise<ImportBookingResult> {
  return callEdgeFunction('import_booking', params);
}

// ─── 6. Explore Ranking ───────────────────────────────────────────────────────

export interface RankedPlace {
  index: number;
  score: number;
  reason: string;
}

export interface RankPlacesResult {
  ranked: RankedPlace[];
}

export async function rankPlacesAI(params: {
  places: Record<string, unknown>[];
  profile: TravelProfile;
  tripContext?: string;
}): Promise<RankPlacesResult> {
  return callEdgeFunction('rank_places', params);
}

// ─── 7. Google Places ─────────────────────────────────────────────────────────

export interface GooglePlaceResult {
  name: string;
  address?: string;
  rating?: number;
  ratingCount?: number;
  types?: string[];
  placeId?: string;
  lat?: number | null;
  lng?: number | null;
  openNow?: boolean | null;
}

export interface GooglePlacesResponse {
  places: GooglePlaceResult[];
}

export async function googlePlacesAI(params: {
  query: string;
  location?: string;
  placeType?: string;
}): Promise<GooglePlacesResponse> {
  return callEdgeFunction('google_places', params);
}

// ─── 8. Natural Language Place Search ────────────────────────────────────────

export interface NaturalSearchSuggestion {
  title: string;
  category: string;
  type: string;
  description: string;
  cost: string;
  tags: string[];
}

export interface NaturalSearchResult {
  suggestions: NaturalSearchSuggestion[];
}

export async function naturalSearchAI(params: {
  query: string;
  destination: string;
  profile: TravelProfile;
}): Promise<NaturalSearchResult> {
  return callEdgeFunction('natural_search', params);
}

// ─── 9. Place Photo ─────────────────────────────────────────────────────────

export interface PlacePhotoResult {
  url: string;
}

// Cached Google Places API key — fetched once per session, then URL building
// happens client-side (eliminates a ~300ms round-trip per photo).
let _photoApiKey: string | null = null;

async function getPhotoApiKey(): Promise<string> {
  if (_photoApiKey) return _photoApiKey;
  const result = await callEdgeFunction<{ key: string }>('get_photo_key', {});
  _photoApiKey = result.key;
  return _photoApiKey;
}

export async function getPlacePhotoAI(params: {
  reference: string;
  maxWidth?: number;
}): Promise<PlacePhotoResult> {
  const maxW = params.maxWidth || 1024;
  const key = await getPhotoApiKey();
  const url = `https://places.googleapis.com/v1/${params.reference}/media?maxWidthPx=${maxW}&key=${key}`;
  return { url };
}

// ─── 10. Place Details ──────────────────────────────────────────────────────

export async function getPlaceDetailsAI(params: {
  placeId: string;
}): Promise<Record<string, unknown>> {
  return callEdgeFunction('place_details', params);
}

// ─── 12. City Autocomplete ──────────────────────────────────────────────────

export interface CityAutocompleteSuggestion {
  /** Full display name e.g. "Los Angeles, CA, USA" */
  display: string;
  /** Short city name e.g. "Los Angeles" */
  city: string;
}

export interface CityAutocompleteResult {
  suggestions: CityAutocompleteSuggestion[];
}

export async function cityAutocompleteAI(params: {
  query: string;
}): Promise<CityAutocompleteResult> {
  return callEdgeFunction('city_autocomplete', params);
}

// ─── 13. Places Nearby ──────────────────────────────────────────────────────

export async function getPlacesNearbyAI(params: {
  lat?: number;
  lng?: number;
  radius?: number;
  type?: string;
  keyword?: string;
}): Promise<{ places: Record<string, unknown>[] }> {
  return callEdgeFunction('places_nearby', params);
}

// ─── 14. Prepare Fix (Trip Pulse background solutions) ────────────────────────

export interface PrepareFixResult {
  activities: Omit<Activity, 'id'>[];
  summary: string;
  changes: string[];
}

export async function prepareFixAI(params: {
  trip: Trip;
  alert: { type: string; message: string; day?: number; activityId?: string };
  profile: TravelProfile;
  memory?: { detail: string }[];
}): Promise<PrepareFixResult> {
  return callEdgeFunction('prepare_fix', params);
}

// ─── 15. Trip Analysis ──────────────────────────────────────────────────────

export interface TripAnalysisCategory {
  id: string;
  label: string;
  score: number; // 1-5
  emoji: string;
  summary: string;
  suggestions: {
    text: string;
    actionCommand?: string; // TravonalCommand to run
    actionDay?: number;
  }[];
}

export interface TripAnalysisResult {
  overallScore: number; // 1-5
  overallSummary: string;
  categories: TripAnalysisCategory[];
}

export async function analyzeTripAI(params: {
  trip: Trip;
  profile: TravelProfile;
}): Promise<TripAnalysisResult> {
  return callEdgeFunction('analyze_trip', params);
}

// ─── 16. Generate Place Description ─────────────────────────────────────────

/** Generate an AI description for a place (cached on activity after first call) */
export async function generateDescriptionAI(params: {
  name: string;
  location?: string;
  category?: string;
  type?: string;
}): Promise<{ description: string }> {
  return callEdgeFunction('generate_description', params);
}

// ─── 17. Parsed Bookings (email forwarding + Gmail sync) ───────────────────

export interface ParsedBooking {
  id: string;
  status: 'pending' | 'imported' | 'dismissed';
  booking_data: ImportBookingResult;
  source_email_subject?: string;
  source_email_from?: string;
  created_at: string;
}

/** Get the user's unique booking forwarding email address */
export async function getBookingEmailAI(): Promise<{ email: string }> {
  return callEdgeFunction('get_booking_email', {});
}

/** Get parsed bookings that arrived via email forwarding or Gmail sync */
export async function getParsedBookingsAI(): Promise<{ bookings: ParsedBooking[] }> {
  return callEdgeFunction('get_parsed_bookings', {});
}

/** Dismiss a parsed booking (mark as not needed) */
export async function dismissParsedBookingAI(id: string): Promise<void> {
  return callEdgeFunction('dismiss_parsed_booking', { id });
}

/** Mark a parsed booking as imported */
export async function markBookingImportedAI(id: string): Promise<void> {
  return callEdgeFunction('mark_booking_imported', { id });
}

// ─── 17. Gmail Sync ────────────────────────────────────────────────────────

/** Get Gmail OAuth authorization URL */
export async function getGmailAuthUrlAI(): Promise<{ url: string }> {
  return callEdgeFunction('gmail_auth_url', {});
}

/** Exchange Gmail OAuth code for tokens */
export async function exchangeGmailCodeAI(code: string): Promise<void> {
  return callEdgeFunction('gmail_exchange_code', { code });
}

/** Disconnect Gmail sync */
export async function disconnectGmailAI(): Promise<void> {
  return callEdgeFunction('gmail_disconnect', {});
}

/** Check Gmail connection status */
export async function getGmailStatusAI(): Promise<{ connected: boolean; lastSync?: string }> {
  return callEdgeFunction('gmail_status', {});
}

/** Trigger a Gmail sync to scan for new bookings */
export async function syncGmailAI(): Promise<{ found: number }> {
  return callEdgeFunction('gmail_sync', {});
}

