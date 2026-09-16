/**
 * ExploreSearchView — browse and search places using Google Places API.
 *
 * Data: Google Places Text Search via Supabase Edge Function.
 * Photos: Google Places Photos with shared Supabase cache + Storage.
 * Geocoding: Photon (Komoot) — no cost, no API key.
 */

import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';

import WebView from 'react-native-webview';
import NativeMap from '@/components/native-map';
import type { NativeMapRef, NativeMapMarker } from '@/components/native-map-types';
import { TimePickerButton } from '@/components/time-picker';
import { SelectionSheet, SelectionOption } from '@/components/selection-sheet';

import { SymbolView } from 'expo-symbols';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { BoardPicker } from '@/components/board-picker';
import { useBoards } from '@/context/boards';
import { useInbox } from '@/context/inbox';
import { useToast } from '@/context/toast';
import { useTheme } from '@/hooks/use-theme';
import { loadRecentSearches, saveRecentSearches } from '@/services/storage';
import { formatDayLabel } from '@/services/trip-helpers';
import {
  NormalizedPlace,
  categoryToActivityType,
  priceLevelLabel,
  formatDistance,
  formatGoogleTypes,
} from '@/services/place-model';
import {
  ExploreLocation,
  CATEGORY_QUERIES,
  fetchExplorePlaces,
  searchExplorePlaces,
} from '@/services/explore-service';
import {
  getPlacePhoto,
  prefetchPhotos,
} from '@/services/free-photos';
import { cityAutocompleteAI, type CityAutocompleteSuggestion } from '@/services/ai';
import { getCategoryPathData } from '@/constants/map-icons';
import { isBookablePlace, getBookableCTA, getPlaceBookingLinks, openBookingLink } from '@/services/booking-links';

// ============ Helpers ============

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatTripDates(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const startLabel = MONTH_SHORT[(sm ?? 1) - 1] + ' ' + sd;
  const endLabel = MONTH_SHORT[(em ?? 1) - 1] + ' ' + ed;
  const yearSuffix = ', ' + ey;
  if (sy === ey && sm === em) {
    return startLabel + '\u2013' + ed + yearSuffix;
  }
  if (sy === ey) {
    return startLabel + '\u2013' + endLabel + yearSuffix;
  }
  return startLabel + ', ' + sy + '\u2013' + endLabel + ', ' + ey;
}

// ============ Constants ============

const CATEGORY_TABS = Object.entries(CATEGORY_QUERIES).map(([id, { label }]) => ({ id, label }));

const SEARCH_SUGGESTIONS = [
  'Best ramen in Tokyo',
  'Quiet cafes',
  'Free things to do',
  'Romantic dinner spots',
  'Street food',
  'Art museums',
  'Outdoor activities',
  'Local hidden gems',
];

// ============ Photo Component ============

function ShimmerPlaceholder({ style }: { style?: object }) {
  const theme = useTheme();
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800 }), -1, true);
  }, [opacity]);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.photoPlaceholder, { backgroundColor: theme.backgroundElement }, style, animStyle]} />
  );
}

function PlacePhotoImage({
  place,
  style,
}: {
  place: NormalizedPlace;
  style?: object;
}) {
  const theme = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (error) return;
    let cancelled = false;

    const photoRef = place.photos?.[0]?.reference;

    getPlacePhoto({
      cacheKey: place.placeId ?? place.name,
      photoRef,
      name: place.name,
      category: place.category,
    }).then((result) => {
      if (!cancelled) {
        if (result) setUrl(result.url);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) { setError(true); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [place.placeId, place.name, error]);

  if (url && !error) {
    return (
      <ExpoImage
        source={{ uri: url }}
        style={[styles.photoPlaceholder, style]}
        contentFit="cover"
        cachePolicy="memory-disk"
        onError={() => setError(true)}
      />
    );
  }

  if (loading) {
    return <ShimmerPlaceholder style={style} />;
  }

  return (
    <View style={[styles.photoPlaceholder, { backgroundColor: theme.backgroundElement }, style]}>
      <SymbolView name="camera" size={22} tintColor={theme.textSecondary} style={{ opacity: 0.4 }} />
    </View>
  );
}

// ============ LocationSelector ============

function LocationSelector({ location, onPress }: { location: ExploreLocation | null; onPress: () => void }) {
  const theme = useTheme();
  const label = location?.label ?? 'Choose a location';
  return (
    <Pressable
      onPress={onPress}
      style={[styles.locationSelector, { borderColor: theme.border }]}
      accessibilityRole="button"
      accessibilityLabel="Change explore location"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <SymbolView name="mappin" size={14} tintColor={theme.primary} />
        <ThemedText style={styles.locationLabel}>{label}</ThemedText>
        <SymbolView name="chevron.down" size={10} tintColor={theme.text} />
      </View>
    </Pressable>
  );
}

// ============ PlaceCard ============

function ExplorePlaceCard({
  place,
  onPress,
  onSaveToBoard,
  onAdd,
  destination,
}: {
  place: NormalizedPlace;
  onPress: () => void;
  onSaveToBoard: () => void;
  onAdd: () => void;
  destination: string;
}) {
  const theme = useTheme();

  // Build category label from Google types, with fallback to category name
  const formattedTypes = place.googleTypes?.length ? formatGoogleTypes(place.googleTypes) : '';
  const fallbackLabel = place.category.split('/').pop() ?? place.category;
  const catLabel = formattedTypes || (fallbackLabel === 'other' ? 'Place' : fallbackLabel.charAt(0).toUpperCase() + fallbackLabel.slice(1));

  const priceLabel = priceLevelLabel(place.priceLevel, place.category);
  const distLabel = formatDistance(place.distance);

  return (
    <Pressable
      onPress={onPress}
      style={[styles.placeCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
      accessibilityRole="button"
      accessibilityLabel={place.name}
    >
      <View style={styles.cardRow}>
        <PlacePhotoImage place={place} style={styles.cardPhoto} />
        <View style={styles.cardContent}>
          <View style={styles.cardTopRow}>
            <ThemedText style={styles.cardName} numberOfLines={1}>{place.name}</ThemedText>
            <Pressable
              onPress={(e) => { e.stopPropagation(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSaveToBoard(); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Save to board"
            >
              <SymbolView name="bookmark" size={20} tintColor="#9CA3AF" />
            </Pressable>
          </View>

          {place.address && (
            <ThemedText style={[styles.cardMeta, { color: theme.textSecondary }]} numberOfLines={1}>
              {place.address}
            </ThemedText>
          )}

          <View style={styles.cardMetaRow}>
            {place.rating != null && (
              <>
                <SymbolView name="star.fill" size={12} tintColor="#F59E0B" />
                <ThemedText style={styles.ratingNum}>{place.rating.toFixed(1)}</ThemedText>
                {place.reviewCount != null && (
                  <ThemedText style={[styles.reviewCount, { color: theme.textSecondary }]}>({place.reviewCount})</ThemedText>
                )}
              </>
            )}
            {priceLabel ? <ThemedText style={[styles.priceLabel, { color: theme.primary }]}>{priceLabel}</ThemedText> : null}
            {distLabel ? <ThemedText style={[styles.distLabel, { color: theme.textSecondary }]}>{distLabel}</ThemedText> : null}
            {place.openNow != null && (
              <ThemedText style={[styles.openStatus, { color: place.openNow ? '#22C55E' : '#DC2626' }]}>
                {place.openNow ? 'Open' : 'Closed'}
              </ThemedText>
            )}
          </View>

          <View style={styles.cardBottomRow}>
            <View style={[styles.catChip, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={styles.catChipText} numberOfLines={1}>{catLabel}</ThemedText>
            </View>
            {isBookablePlace({ category: place.category, reservable: place.reservable, priceLevel: place.priceLevel }) ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  const links = getPlaceBookingLinks(place.name, place.category, destination);
                  if (links[0]) openBookingLink(links[0].url);
                }}
                style={[styles.viewBtn, { backgroundColor: theme.primary, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 }]}
                accessibilityRole="button"
                accessibilityLabel={getBookableCTA(place.category) ?? undefined}
              >
                <ThemedText style={[styles.viewBtnText, { color: theme.primaryText }]}>{getBookableCTA(place.category)?.replace('Get ', '')}</ThemedText>
              </Pressable>
            ) : (
              <Pressable
                onPress={onPress}
                style={styles.viewBtn}
                accessibilityRole="button"
                accessibilityLabel={`View ${place.name}`}
              >
                <ThemedText style={[styles.viewBtnText, { color: theme.primary }]}>View {'\u203A'}</ThemedText>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ============ MapPreview ============

// SVG icons for map markers — clear, instantly recognizable symbols
const CATEGORY_SVG: Record<string, string> = {
  // Knife + fork
  'food/restaurant': '<path d="M8.1 13.34l2.83-2.83L3.91 3.5a4.008 4.008 0 000 5.66l4.19 4.18zm6.78-1.81c1.53.71 3.68.21 5.27-1.38 1.91-1.91 2.28-4.65.81-6.12-1.46-1.46-4.2-1.1-6.12.81-1.59 1.59-2.09 3.74-1.38 5.27L3.7 19.87l1.41 1.41L12 14.41l6.88 6.88 1.41-1.41L13.41 13l1.47-1.47z" fill="%23333"/>',
  // Coffee cup
  'food/cafe': '<path d="M18.5 3H6c-1.1 0-2 .9-2 2v5.71c0 3.83 2.95 7.18 6.78 7.29 3.96.12 7.22-3.06 7.22-7V8h.5c1.93 0 3.5-1.57 3.5-3.5S20.43 3 18.5 3zM16 5v3h-2V5h2zm2.5 3H18V5h.5c.83 0 1.5.67 1.5 1.5S19.33 8 18.5 8zM4 19h16v2H4v-2z" fill="%23333"/>',
  // Wine glass
  'food/bar': '<path d="M6 3v6c0 2.97 2.16 5.43 5 5.91V19H7v2h10v-2h-4v-4.09c2.84-.48 5-2.94 5-5.91V3H6zm10 6c0 .37-.04.72-.12 1.06l-.01.02C15.23 12.36 13.31 14 11 14V5h5v4z" fill="%23333"/>',
  // Croissant/bread
  'food/bakery': '<path d="M20.5 10.94c.13-.32.1-.23.15-.39.3-1.21-.34-2.47-1.5-2.93l-2.01-.8c-.46-.18-.95-.21-1.41-.12-.11-.33-.29-.63-.52-.89-.48-.52-1.15-.81-1.85-.81h-2.71c-.71 0-1.38.29-1.85.81-.24.26-.42.56-.53.88-.46-.09-.95-.06-1.41.12l-2.01.8c-1.16.46-1.8 1.72-1.5 2.93l.15.38C2.52 12.13 2 13.51 2 15c0 3.31 2.69 6 6 6h8c3.31 0 6-2.69 6-6 0-1.49-.52-2.87-1.5-4.06zM12 4c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2z" fill="%23333"/>',
  'food/other': '<path d="M8.1 13.34l2.83-2.83L3.91 3.5a4.008 4.008 0 000 5.66l4.19 4.18zm6.78-1.81c1.53.71 3.68.21 5.27-1.38 1.91-1.91 2.28-4.65.81-6.12-1.46-1.46-4.2-1.1-6.12.81-1.59 1.59-2.09 3.74-1.38 5.27L3.7 19.87l1.41 1.41L12 14.41l6.88 6.88 1.41-1.41L13.41 13l1.47-1.47z" fill="%23333"/>',
  // Bed
  'stay/hotel': '<path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z" fill="%23333"/>',
  'stay/hostel': '<path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z" fill="%23333"/>',
  'stay/other': '<path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z" fill="%23333"/>',
  // Camera
  'activity/museum': '<path d="M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM9.21 3L7.4 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2h-3.4L14.79 3H9.21zm2.79 14c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" fill="%23333"/>',
  // Tree
  'activity/park': '<path d="M17 12h2L12 2 5.05 12H7l-3.9 6h8.9v4h2v-4h8.9L17 12z" fill="%23333"/>',
  // Map pin / landmark
  'activity/attraction': '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="%23333"/>',
  // Ticket
  'activity/entertainment': '<path d="M22 10V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v4c1.1 0 2 .9 2 2s-.9 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2s.9-2 2-2zm-9 7.5h-2v-2h2v2zm0-4.5h-2v-2h2v2zm0-4.5h-2v-2h2v2z" fill="%23333"/>',
  // Running person
  'activity/sport': '<path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L5.09 9.48v5h2v-3.5l1.8-.7-1.6 8.1-4.7-1-.4 2 7 1.5z" fill="%23333"/>',
  'activity/other': '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="%23333"/>',
  // Shopping bag
  'shopping': '<path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h2v2c0 .55.45 1 1 1s1-.45 1-1V8h4v2c0 .55.45 1 1 1s1-.45 1-1V8h2v12z" fill="%23333"/>',
  'other': '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="%23333"/>',
};
const DEFAULT_SVG = '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="%23333"/>';

function getCategoryIcon(category: string): string {
  return CATEGORY_SVG[category] ?? CATEGORY_SVG[category.split('/')[0] + '/other'] ?? DEFAULT_SVG;
}

function buildMapHtml(
  places: { name: string; lat: number; lng: number; idx: number; svgIcon: string; rating?: number; address?: string }[],
  centerLat: number,
  centerLng: number,
): string {
  const placesJson = JSON.stringify(places.map((p) => ({
    name: p.name.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    lat: p.lat,
    lng: p.lng,
    idx: p.idx,
    rating: p.rating ?? null,
    address: (p.address ?? '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    svg: p.svgIcon,
  })));

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f0f0f0}
#map{width:100%;height:100vh}
.leaflet-tile-pane{filter:saturate(0.25) brightness(1.05) contrast(0.95)}
.pin-marker{
  display:flex;align-items:center;justify-content:center;
  width:26px;height:26px;border-radius:50%;
  background:#fff;
  border:1.5px solid #d1d5db;
  box-shadow:0 1px 4px rgba(0,0,0,0.15);
  transition:transform 0.15s,border-color 0.15s;
}
.pin-marker.active{transform:scale(1.3);border-color:#111;box-shadow:0 2px 8px rgba(0,0,0,0.25)}
.pin-marker svg{width:13px;height:13px}
.leaflet-popup-content-wrapper{border-radius:14px;padding:0;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.18)}
.leaflet-popup-content{margin:0;min-width:230px;max-width:260px}
.leaflet-popup-tip{border-top-color:#fff}
.popup-card{font-family:-apple-system,BlinkMacSystemFont,sans-serif}
.popup-img{width:100%;height:130px;object-fit:cover;display:block;background:#f3f4f6}
.popup-body{padding:10px 12px}
.popup-name{font-size:14px;font-weight:700;margin-bottom:3px}
.popup-rating{font-size:12px;color:#F59E0B;margin-bottom:2px}
.popup-addr{font-size:11px;color:#6B7280;line-height:1.3}
</style>
</head><body><div id="map"></div><script>
var places=${placesJson};
var photoUrls={};
var map=L.map('map',{zoomControl:false,attributionControl:false});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var markers=[];
places.forEach(function(p,i){
  var svgHtml='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'+decodeURIComponent(p.svg).replace(/%23/g,'#')+'</svg>';
  var icon=L.divIcon({className:'',html:'<div class="pin-marker" id="mk'+i+'">'+svgHtml+'</div>',iconSize:[26,26],iconAnchor:[13,13]});
  var mk=L.marker([p.lat,p.lng],{icon:icon}).addTo(map);
  mk._placeIdx=i;
  mk.on('click',function(){
    updatePopup(mk,p,i);
    mk.openPopup();
    window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'highlight',idx:p.idx}));
  });
  markers.push(mk);
});
function updatePopup(mk,p,i){
  var url=photoUrls[i]||'';
  var imgHtml=url?'<img class="popup-img" src="'+url+'" onerror="this.style.display=\\'none\\'"/>':'';
  var ratingHtml=p.rating?'<div class="popup-rating">\\u2605 '+p.rating.toFixed(1)+'</div>':'';
  var addrHtml=p.address?'<div class="popup-addr">'+p.address+'</div>':'';
  mk.bindPopup('<div class="popup-card">'+imgHtml+'<div class="popup-body"><div class="popup-name">'+p.name+'</div>'+ratingHtml+addrHtml+'</div></div>',{maxWidth:260,closeButton:true});
}
if(places.length>1){
  var g=L.featureGroup(markers);
  map.fitBounds(g.getBounds().pad(0.15));
}else if(places.length===1){
  map.setView([places[0].lat,places[0].lng],14);
}else{
  map.setView([${centerLat},${centerLng}],13);
}
window.highlightMarker=function(i){
  markers.forEach(function(m,j){
    var el=document.getElementById('mk'+j);
    if(el)el.className=j===i?'pin-marker active':'pin-marker';
  });
  if(markers[i]){
    map.panTo(markers[i].getLatLng(),{animate:true,duration:0.3});
    updatePopup(markers[i],places[i],i);
    markers[i].openPopup();
  }
};
window.setPhotoUrl=function(idx,url){
  photoUrls[idx]=url;
};
</script></body></html>`;
}

/** Map card photo — uses same photo service as explore cards */
function MapCardPhoto({ place, style }: { place: NormalizedPlace; style?: object }) {
  const theme = useTheme();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const photoRef = place.photos?.[0]?.reference;
    if (!photoRef) return;
    let cancelled = false;
    getPlacePhoto({
      cacheKey: place.placeId ?? place.name,
      photoRef,
      name: place.name,
      category: place.category,
    }).then((r) => { if (!cancelled && r) setUrl(r.url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [place.placeId, place.name]);

  if (url) {
    return <ExpoImage source={{ uri: url }} style={[styles.mapCardPhoto, style]} contentFit="cover" cachePolicy="memory-disk" />;
  }
  return <ShimmerPlaceholder style={[styles.mapCardPhoto, style] as any} />;
}

function MapPreview({
  places,
  location,
  onNavigateToDetail,
  onAddToTrip,
  onToggleSave,
}: {
  places: NormalizedPlace[];
  location: ExploreLocation | null;
  onNavigateToDetail: (place: NormalizedPlace) => void;
  onAddToTrip: (place: NormalizedPlace) => void;
  onToggleSave: (place: NormalizedPlace) => void;
}) {
  const theme = useTheme();
  const isWeb = Platform.OS === 'web';
  const [fullScreen, setFullScreen] = useState(false);
  const [activeMarkerIndex, setActiveMarkerIndex] = useState<number | undefined>();
  const fullScreenScrollRef = useRef<ScrollView>(null);
  const fullScreenWebViewRef = useRef<WebView>(null);
  const nativeMapRef = useRef<NativeMapRef>(null);
  const cardWidth = 272;
  const cardGap = 12;

  const geoPlaces = places.filter((p): p is NormalizedPlace & { lat: number; lng: number } => p.lat != null && p.lng != null);
  if (geoPlaces.length === 0) return null;

  const centerLat = geoPlaces.reduce((s, p) => s + p.lat, 0) / geoPlaces.length;
  const centerLng = geoPlaces.reduce((s, p) => s + p.lng, 0) / geoPlaces.length;

  // Web map data
  const mapPlaces = isWeb ? geoPlaces.map((p, i) => ({
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    idx: i,
    svgIcon: getCategoryIcon(p.category),
    rating: p.rating,
    address: p.address,
  })) : [];
  const previewHtml = isWeb ? buildMapHtml(mapPlaces, centerLat, centerLng) : '';
  const fullHtml = isWeb ? buildMapHtml(mapPlaces, centerLat, centerLng) : '';

  // Native map markers
  const nativeMarkers: NativeMapMarker[] = isWeb ? [] : geoPlaces.map((p, i) => ({
    key: p.placeId ?? `marker-${i}`,
    latitude: p.lat,
    longitude: p.lng,
    title: p.name,
    subtitle: p.address,
    svgPathData: getCategoryPathData(p.category),
  }));

  // Load photos and inject URLs into the WebView for popups (web only)
  const photosLoadedRef = useRef(false);
  useEffect(() => {
    if (!isWeb || !fullScreen || photosLoadedRef.current) return;
    photosLoadedRef.current = true;
    geoPlaces.forEach((place, i) => {
      const photoRef = place.photos?.[0]?.reference;
      if (!photoRef) return;
      getPlacePhoto({
        cacheKey: place.placeId ?? place.name,
        photoRef,
        name: place.name,
        category: place.category,
      }).then((r) => {
        if (r?.url) {
          const escaped = r.url.replace(/'/g, "\\'");
          fullScreenWebViewRef.current?.injectJavaScript(`setPhotoUrl(${i},'${escaped}');true;`);
        }
      }).catch(() => {});
    });
  }, [fullScreen]);

  function handleMapMessage(event: { nativeEvent: { data: string } }) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'highlight' && msg.idx != null) {
        fullScreenScrollRef.current?.scrollTo({ x: msg.idx * (cardWidth + cardGap), animated: true });
      }
    } catch {}
  }

  function handleCardScroll(event: { nativeEvent: { contentOffset: { x: number } } }) {
    const x = event.nativeEvent.contentOffset.x;
    const idx = Math.round(x / (cardWidth + cardGap));
    if (idx >= 0 && idx < geoPlaces.length) {
      if (isWeb) {
        fullScreenWebViewRef.current?.injectJavaScript(`highlightMarker(${idx});true;`);
      } else {
        setActiveMarkerIndex(idx);
        nativeMapRef.current?.animateToMarker(idx);
      }
    }
  }

  function handleNativeMarkerPress(idx: number) {
    setActiveMarkerIndex(idx);
    fullScreenScrollRef.current?.scrollTo({ x: idx * (cardWidth + cardGap), animated: true });
  }

  // Shared card carousel for the fullscreen map
  const cardCarousel = (
    <View style={styles.mapCardPanel}>
      <ScrollView
        ref={fullScreenScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.mapCardScroll}
        snapToInterval={cardWidth + cardGap}
        decelerationRate="fast"
        onMomentumScrollEnd={handleCardScroll}
      >
        {geoPlaces.map((place, i) => (
          <Pressable
            key={place.placeId ?? `map-card-${i}`}
            onPress={() => { setFullScreen(false); onNavigateToDetail(place); }}
            style={[styles.mapCard, { backgroundColor: '#1c1c1e' }]}
            accessibilityRole="button"
            accessibilityLabel={place.name}
          >
            <MapCardPhoto place={place} />
            <View style={styles.mapCardBody}>
              <ThemedText style={[styles.mapCardName, { color: '#fff' }]} numberOfLines={1}>{place.name}</ThemedText>
              {place.rating != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <SymbolView name="star.fill" size={12} tintColor="#F59E0B" />
                  <ThemedText style={[styles.mapCardRating, { color: '#F59E0B' }]}>
                    {place.rating.toFixed(1)}
                    {place.reviewCount != null ? ` (${place.reviewCount})` : ''}
                  </ThemedText>
                </View>
              )}
              {place.address && (
                <ThemedText style={[styles.mapCardAddr, { color: '#aaa' }]} numberOfLines={1}>
                  {place.address}
                </ThemedText>
              )}
              <View style={styles.mapCardActions}>
                {isBookablePlace({ category: place.category, reservable: place.reservable, priceLevel: place.priceLevel }) ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      const links = getPlaceBookingLinks(place.name, place.category, location?.label ?? '');
                      if (links[0]) openBookingLink(links[0].url);
                    }}
                    style={[styles.mapCardAddBtn, { backgroundColor: '#fff' }]}
                    accessibilityRole="button"
                  >
                    <ThemedText style={[styles.mapCardAddText, { color: '#000' }]}>{getBookableCTA(place.category)}</ThemedText>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      onPress={(e) => { e.stopPropagation(); onAddToTrip(place); }}
                      style={[styles.mapCardAddBtn, { backgroundColor: '#fff' }]}
                      accessibilityRole="button"
                    >
                      <ThemedText style={[styles.mapCardAddText, { color: '#000' }]}>Add to trip</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={(e) => { e.stopPropagation(); onToggleSave(place); }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Save to board"
                    >
                      <SymbolView name="bookmark" size={18} tintColor="#aaa" />
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <>
      {/* Compact map preview */}
      <Pressable
        onPress={() => setFullScreen(true)}
        style={[styles.mapContainer, { borderColor: theme.border }]}
        accessibilityRole="button"
        accessibilityLabel="Expand map"
      >
        <View style={styles.mapPreviewWrap}>
          {isWeb ? (
            <WebView
              source={{ html: previewHtml }}
              style={{ flex: 1 }}
              scrollEnabled={false}
              javaScriptEnabled
              originWhitelist={['*']}
            />
          ) : (
            <NativeMap
              key={`${centerLat.toFixed(3)},${centerLng.toFixed(3)}`}
              markers={nativeMarkers}
              interactive={false}
              userInterfaceStyle="dark"
            />
          )}
          {/* Expand button overlay */}
          <View style={styles.mapExpandBtn}>
            <View style={styles.mapExpandInner}>
              <SymbolView name="arrow.up.left.and.arrow.down.right" size={14} tintColor="#fff" />
            </View>
          </View>
          {/* Place count badge */}
          <View style={styles.mapCountBadge}>
            <ThemedText style={styles.mapCountText}>
              {geoPlaces.length} {geoPlaces.length === 1 ? 'place' : 'places'}
            </ThemedText>
          </View>
        </View>
      </Pressable>

      {/* Full-screen map modal */}
      <Modal visible={fullScreen} animationType="slide" onRequestClose={() => setFullScreen(false)}>
        <View style={styles.mapFullScreen}>
          {/* Map fills entire screen */}
          {isWeb ? (
            <WebView
              ref={fullScreenWebViewRef}
              source={{ html: fullHtml }}
              style={StyleSheet.absoluteFill}
              javaScriptEnabled
              originWhitelist={['*']}
              onMessage={handleMapMessage}
            />
          ) : (
            <NativeMap
              ref={nativeMapRef}
              markers={nativeMarkers}
              onMarkerPress={handleNativeMarkerPress}
              activeMarkerIndex={activeMarkerIndex}
              initialPadding={{ top: 60, right: 50, bottom: 250, left: 50 }}
              userInterfaceStyle="dark"
            />
          )}

          {/* Close button */}
          <Pressable
            onPress={() => setFullScreen(false)}
            style={styles.mapCloseBtn}
            accessibilityRole="button"
            accessibilityLabel="Close map"
          >
            <SymbolView name="xmark" size={16} tintColor="#fff" />
          </Pressable>

          {/* Location label */}
          <View style={styles.mapLocationBadge}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <SymbolView name="mappin" size={14} tintColor="#fff" />
              <ThemedText style={styles.mapLocationText}>
                {location?.label ?? 'Explore'} {'\u00B7'} {geoPlaces.length} places
              </ThemedText>
            </View>
          </View>

          {/* Floating card carousel at the bottom */}
          {cardCarousel}
        </View>
      </Modal>
    </>
  );
}

// ============ Main Component ============

export function ExploreSearchView() {
  const router = useRouter();
  const { tripId: paramTripId, day: paramDay } = useLocalSearchParams<{ tripId?: string; day?: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { showToast } = useToast();
  const { trips, addActivity, getTripState } = useTrips();
  const { profile } = useProfile();
  const { savedPlaces, savePlace, unsavePlace, isSaved } = useInbox();
  const { addItemToBoard } = useBoards();
  const [boardPickerVisible, setBoardPickerVisible] = useState(false);
  const [pendingBoardPlace, setPendingBoardPlace] = useState<NormalizedPlace | null>(null);

  // Location
  const [exploreLocation, setExploreLocation] = useState<ExploreLocation | null>(null);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [customCityInput, setCustomCityInput] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<CityAutocompleteSuggestion[]>([]);
  const [citySearching, setCitySearching] = useState(false);
  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cityPickedRef = useRef(false);

  // Category
  const [activeCategory, setActiveCategory] = useState('for_you');

  // Search
  const [search, setSearch] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Places data
  const [places, setPlaces] = useState<NormalizedPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<NormalizedPlace[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Add to trip
  const [pendingAdd, setPendingAdd] = useState<{
    tripId: string;
    day: number;
    place: NormalizedPlace;
    time: string;
    duration: number;
  } | null>(null);
  const [sheetState, setSheetState] = useState<{
    title: string;
    subtitle?: string;
    options: SelectionOption[];
    onSelect: (value: string) => void;
  } | null>(null);

  // Saved places modal
  const [savedModalOpen, setSavedModalOpen] = useState(false);

  // Hide suggestions when navigating away
  useFocusEffect(
    useCallback(() => {
      return () => {
        setSearchFocused(false);
        Keyboard.dismiss();
      };
    }, []),
  );

  // Load persisted state on mount
  useEffect(() => {
    (async () => {
      const savedSearches = await loadRecentSearches();
      if (savedSearches.length > 0) setRecentSearches(savedSearches);
    })();
  }, []);

  // Persist recent searches
  useEffect(() => {
    if (recentSearches.length > 0) saveRecentSearches(recentSearches);
  }, [recentSearches]);

  // Default explore location: device GPS → reverse geocode → city name.
  useEffect(() => {
    if (exploreLocation) return;

    let cancelled = false;

    async function detectLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted' && !cancelled) {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (cancelled) return;
          const [geo] = await Location.reverseGeocodeAsync(pos.coords);
          if (cancelled) return;
          const city = geo?.city ?? geo?.subregion ?? geo?.region ?? null;
          if (city) {
            setExploreLocation({
              type: 'current',
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              label: city,
            });
            return;
          }
        }
      } catch {
        // permission denied or unavailable — fall through to trip fallback
      }

      if (cancelled) return;
      const fallback = trips.find((t) => {
        const s = getTripState(t);
        return s === 'active' || s === 'upcoming';
      });
      if (fallback && !cancelled) {
        setExploreLocation({
          type: 'trip',
          tripId: fallback.id,
          destination: fallback.destination,
          label: fallback.destination,
        });
      }
    }

    detectLocation();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch places when location or category changes
  useEffect(() => {
    if (!exploreLocation) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchExplorePlaces(exploreLocation, activeCategory, { interests: profile.interests })
      .then((results) => {
        if (cancelled) return;
        setPlaces(results);

        // Prefetch photos (cache + Google) for all results
        prefetchPhotos(
          results.map((p) => ({
            cacheKey: p.placeId ?? p.name,
            photoRef: p.photos?.[0]?.reference,
            name: p.name,
            category: p.category,
          })),
        );
      })
      .catch((e) => {
        console.error('[Explore] fetch failed:', e?.message ?? e);
        if (!cancelled) {
          setPlaces([]);
          showToast('Could not load places — check your internet connection', 'error');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreLocation, activeCategory]);

  // Debounced search
  useEffect(() => {
    if (!search.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      if (!exploreLocation) {
        setSearchLoading(false);
        return;
      }
      searchExplorePlaces(search.trim(), exploreLocation)
        .then((results) => setSearchResults(results))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 400);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search, exploreLocation]);

  // City autocomplete for location sheet (AI-powered, same as trip survey)
  useEffect(() => {
    if (cityPickedRef.current) { cityPickedRef.current = false; return; }
    const query = customCityInput.trim();
    if (query.length < 2) {
      setCitySuggestions([]);
      return;
    }
    if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
    cityDebounceRef.current = setTimeout(async () => {
      setCitySearching(true);
      try {
        const result = await cityAutocompleteAI({ query });
        setCitySuggestions(result.suggestions.slice(0, 5));
      } catch {
        // Silently ignore autocomplete failures
      } finally {
        setCitySearching(false);
      }
    }, 400);
    return () => { if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current); };
  }, [customCityInput]);

  const isSearching = search.trim().length > 0;
  const displayPlaces = isSearching ? searchResults : places;

  // ---- Location helpers ----

  async function handleNearMe() {
    setLocationSheetOpen(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Permission', 'Enable location in Settings for nearby recommendations.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [addr] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      const label = addr?.city ?? addr?.region ?? 'Current location';
      setExploreLocation({ type: 'current', lat: loc.coords.latitude, lng: loc.coords.longitude, label });
    } catch {
      showToast('Could not determine your location', 'error');
    }
  }

  function handleTripLocation(trip: { id: string; destination: string }) {
    setLocationSheetOpen(false);
    setExploreLocation({ type: 'trip', tripId: trip.id, destination: trip.destination, label: trip.destination });
  }

  function handleCitySuggestion(suggestion: CityAutocompleteSuggestion) {
    cityPickedRef.current = true;
    setLocationSheetOpen(false);
    setExploreLocation({
      type: 'custom',
      query: suggestion.city,
      label: suggestion.display,
    });
    setCustomCityInput('');
    setCitySuggestions([]);
  }

  function handleCustomCity() {
    if (!customCityInput.trim()) return;
    setLocationSheetOpen(false);
    setExploreLocation({ type: 'custom', query: customCityInput.trim(), label: customCityInput.trim() });
    setCustomCityInput('');
    setCitySuggestions([]);
  }

  // ---- Navigation ----

  function navigateToDetail(place: NormalizedPlace) {
    let url = `/place-detail?name=${encodeURIComponent(place.name)}`;
    if (place.placeId) url += `&placeId=${encodeURIComponent(place.placeId)}`;
    if (place.address) url += `&address=${encodeURIComponent(place.address)}`;
    if (place.description) url += `&description=${encodeURIComponent(place.description)}`;
    if (place.rating != null) url += `&rating=${place.rating}`;
    if (place.reviewCount != null) url += `&reviewCount=${place.reviewCount}`;
    if (place.lat != null) url += `&lat=${place.lat}`;
    if (place.lng != null) url += `&lng=${place.lng}`;
    if (place.category) url += `&category=${encodeURIComponent(place.category)}`;
    if (place.website) url += `&website=${encodeURIComponent(place.website)}`;
    if (place.phone) url += `&phone=${encodeURIComponent(place.phone)}`;
    if (place.openingHours && place.openingHours.length > 0) {
      url += `&hours=${encodeURIComponent(JSON.stringify(place.openingHours))}`;
    }
    if (place.priceLevel != null) url += `&priceLevel=${place.priceLevel}`;
    if (place.googleMapsUri) url += `&googleMapsUri=${encodeURIComponent(place.googleMapsUri)}`;
    if (place.openNow != null) url += `&openNow=${place.openNow}`;
    const dest = exploreLocation?.label ?? '';
    if (dest) url += `&destination=${encodeURIComponent(dest)}`;
    if (paramTripId && paramDay) {
      url += `&tripId=${encodeURIComponent(paramTripId)}&day=${encodeURIComponent(paramDay)}`;
    }
    router.push(url as any);
  }

  // ---- Add to trip ----

  function handleAddToTrip(place: NormalizedPlace) {
    if (trips.length === 0) {
      showToast('Plan a trip first, then add activities', 'info');
      return;
    }

    if (paramTripId && paramDay) {
      const contextTrip = trips.find((t) => t.id === paramTripId);
      if (contextTrip) {
        doAdd(paramTripId, Number(paramDay), place);
        return;
      }
    }

    if (trips.length === 1) {
      showDayPicker(trips[0].id, place);
      return;
    }

    setSheetState({
      title: 'Add to which trip?',
      options: trips.map((trip) => ({ label: trip.destination, value: trip.id })),
      onSelect: (tripId) => {
        setSheetState(null);
        showDayPicker(tripId, place);
      },
    });
  }

  function showDayPicker(tripId: string, place: NormalizedPlace) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;

    const [sy, sm, sd] = trip.startDate.split('-').map(Number);
    const [ey, em, ed] = trip.endDate.split('-').map(Number);
    const totalDays = Math.max(
      1,
      Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1,
    );

    if (totalDays <= 1) {
      doAdd(tripId, 1, place);
      return;
    }

    setSheetState({
      title: 'Which day?',
      subtitle: `Add "${place.name}" to ${trip.destination}`,
      options: Array.from({ length: totalDays }, (_, i) => ({
        label: formatDayLabel(i + 1, trip.startDate, trip.datesKnown),
        value: String(i + 1),
      })),
      onSelect: (dayStr) => {
        setSheetState(null);
        doAdd(tripId, Number(dayStr), place);
      },
    });
  }

  function doAdd(tripId: string, day: number, place: NormalizedPlace) {
    setPendingAdd({
      tripId,
      day,
      place,
      time: '10:00',
      duration: 60,
    });
  }

  function confirmPendingAdd() {
    if (!pendingAdd) return;
    const { tripId, day, place, time, duration } = pendingAdd;
    const trip = trips.find((t) => t.id === tripId);
    const actType = categoryToActivityType(place.category);
    addActivity(tripId, {
      title: place.name,
      day,
      time,
      type: actType,
      duration,
      category: place.category,
      cost: place.priceLevel != null && place.priceLevel <= 1 ? 'budget' : 'moderate',
      description: place.description ?? place.address ?? '',
    });
    setPendingAdd(null);
    showToast(`"${place.name}" added to ${trip?.destination ?? 'trip'} (Day ${day})`, 'success');
  }

  // ---- Save ----

  function handleSaveToBoard(place: NormalizedPlace) {
    setPendingBoardPlace(place);
    setBoardPickerVisible(true);
  }

  function handleBoardSelected(boardId: string) {
    if (!pendingBoardPlace) return;
    const place = pendingBoardPlace;
    const dest = exploreLocation?.label ?? '';
    addItemToBoard(boardId, {
      title: place.name,
      destination: dest,
      type: categoryToActivityType(place.category) as 'activity' | 'food' | 'hotel' | 'flight',
      category: place.category,
      cost: place.priceLevel != null && place.priceLevel <= 1 ? 'budget' : 'moderate',
      duration: 60,
      description: place.description ?? place.address ?? '',
      sourceType: 'explore',
      placeId: place.placeId,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      rating: place.rating,
    });
    showToast(`"${place.name}" saved to board`, 'success');
    setBoardPickerVisible(false);
    setPendingBoardPlace(null);
  }

  function submitSearch() {
    if (!search.trim()) return;
    setRecentSearches((prev) => [search.trim(), ...prev.filter((s) => s !== search.trim())].slice(0, 8));
    setSearchFocused(false);
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <ThemedText type="title">Explore</ThemedText>
          <LocationSelector location={exploreLocation} onPress={() => setLocationSheetOpen(true)} />
        </View>

        {/* Search */}
        <View style={{ zIndex: 20 }}>
          <View style={styles.searchWithSaved}>
            <View style={[styles.searchRow, { borderColor: theme.border, flex: 1 }]}>
              <SymbolView name="magnifyingglass" size={16} tintColor={theme.textSecondary} />
              <TextInput
                ref={searchInputRef}
                style={[styles.searchInput, { color: theme.text }]}
                value={search}
                onChangeText={setSearch}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                onSubmitEditing={() => { submitSearch(); setSearchFocused(false); }}
                placeholder="Search places, activities..."
                placeholderTextColor={theme.textSecondary}
                returnKeyType="search"
                accessibilityLabel="Search places"
              />
              {search.length > 0 && (
                <Pressable onPress={() => { setSearch(''); setSearchResults([]); setSearchFocused(false); searchInputRef.current?.blur(); }} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel="Clear search">
                  <SymbolView name="xmark" size={12} tintColor={theme.textSecondary} />
                </Pressable>
              )}
            </View>
            {savedPlaces.length > 0 && (
              <Pressable
                onPress={() => setSavedModalOpen(true)}
                style={[styles.savedAccessBtn, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                accessibilityRole="button"
                accessibilityLabel="View saved places"
              >
                <SymbolView name="heart.fill" size={16} tintColor={theme.primary} />
              </Pressable>
            )}
          </View>

          {/* Search autocomplete dropdown */}
          {isSearching && (
            <View style={[styles.searchAutocompleteDropdown, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              {/* Query row — always shown as first option */}
              <Pressable
                onPress={() => {
                  submitSearch();
                  Keyboard.dismiss();
                }}
                style={[styles.searchAutocompleteItem, searchResults.length > 0 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${search.trim()}`}
              >
                <View style={styles.searchAutocompleteRow}>
                  <SymbolView name="magnifyingglass" size={16} tintColor={theme.primary} />
                  <ThemedText style={styles.searchAutocompleteName} numberOfLines={1}>
                    {search.trim()}
                  </ThemedText>
                </View>
              </Pressable>

              {/* Place results */}
              {searchResults.slice(0, 5).map((place, i) => {
                const rawCat = formatGoogleTypes(place.googleTypes);
                const catLabel = rawCat ? rawCat.split(' \u00B7 ')[0] : place.category?.split('/').pop() ?? '';
                return (
                  <Pressable
                    key={place.placeId ?? `sr-${i}`}
                    onPress={() => {
                      submitSearch();
                      navigateToDetail(place);
                    }}
                    style={[styles.searchAutocompleteItem, i < Math.min(searchResults.length, 5) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={place.name}
                  >
                    <View style={styles.searchAutocompleteRow}>
                      <SymbolView name="mappin.circle" size={18} tintColor={theme.primary} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={styles.searchAutocompleteName} numberOfLines={1}>{place.name}</ThemedText>
                        <ThemedText style={[styles.searchAutocompleteSub, { color: theme.textSecondary }]} numberOfLines={1}>
                          {[catLabel, place.address].filter(Boolean).join(' \u00B7 ')}
                        </ThemedText>
                      </View>
                      {place.rating != null && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                          <SymbolView name="star.fill" size={11} tintColor="#F59E0B" />
                          <ThemedText style={{ fontSize: 12, fontWeight: '600' }}>{place.rating.toFixed(1)}</ThemedText>
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}

              {/* Loading indicator below query row */}
              {searchLoading && searchResults.length === 0 && (
                <View style={{ padding: 12, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                </View>
              )}
            </View>
          )}
        </View>

        {/* Recent searches */}
        {searchFocused && search.length === 0 && recentSearches.length > 0 && (
          <Animated.View entering={FadeIn.duration(150)}>
            <View style={styles.searchSection}>
              <View style={styles.searchSectionHeader}>
                <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Recent</ThemedText>
                <Pressable onPress={() => { setRecentSearches([]); saveRecentSearches([]); }} accessibilityRole="button" accessibilityLabel="Clear recent searches">
                  <ThemedText style={[styles.clearAllText, { color: theme.primary }]}>Clear</ThemedText>
                </Pressable>
              </View>
              {recentSearches.map((s) => (
                <Pressable key={s} onPress={() => { setSearch(s); setSearchFocused(false); searchInputRef.current?.blur(); }} style={styles.searchSuggestion} accessibilityRole="button" accessibilityLabel={`Search for ${s}`}>
                  <ThemedText style={styles.searchSuggestionText}>{s}</ThemedText>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Import actions */}
        {paramTripId && paramDay ? (
          <View style={[styles.identifyBanner, { backgroundColor: theme.primaryMuted, borderColor: theme.primary + '40' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <SymbolView name="mappin" size={14} tintColor={theme.primary} />
              <ThemedText style={[styles.identifyBannerTitle, { color: theme.primary }]}>
                Adding to Day {paramDay}
              {trips.find((t) => t.id === paramTripId) ? ` \u00B7 ${trips.find((t) => t.id === paramTripId)!.destination}` : ''}
            </ThemedText>
            </View>
          </View>
        ) : null}
        {/* Category tabs */}
        {!isSearching && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll} contentContainerStyle={styles.categoryScrollContent}>
            {CATEGORY_TABS.map((cat) => (
              <Pressable
                key={cat.id}
                onPress={() => setActiveCategory(cat.id)}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${cat.label}`}
                accessibilityState={{ selected: activeCategory === cat.id }}
                style={[styles.categoryTab, {
                  backgroundColor: activeCategory === cat.id ? theme.primary : theme.backgroundElement,
                  borderColor: activeCategory === cat.id ? theme.primary : theme.border,
                }]}
              >
                <ThemedText style={[styles.categoryTabText, activeCategory === cat.id && { color: theme.primaryText }]}>{cat.label}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* No location selected prompt */}
        {!exploreLocation && !isSearching && (
          <View style={styles.emptyState}>
            <ThemedText style={styles.emptyTitle}>Choose a location</ThemedText>
            <ThemedText style={[styles.emptySub, { color: theme.textSecondary }]}>
              Select a trip destination or search a city to discover places
            </ThemedText>
            <Pressable
              onPress={() => setLocationSheetOpen(true)}
              style={[styles.chooseLocationBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Choose location"
            >
              <ThemedText style={[styles.chooseLocationText, { color: theme.primaryText }]}>Choose location</ThemedText>
            </Pressable>
          </View>
        )}

        {/* Map preview */}
        {displayPlaces.length > 0 && (
          <MapPreview
            places={displayPlaces}
            location={exploreLocation}
            onNavigateToDetail={navigateToDetail}
            onAddToTrip={handleAddToTrip}
            onToggleSave={handleSaveToBoard}
          />
        )}

        {/* Loading */}
        {loading && !isSearching && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.textSecondary} />
            <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
              Finding places...
            </ThemedText>
          </View>
        )}

        {/* Place feed */}
        {displayPlaces.length > 0 && (
          <View style={styles.placesList}>
            {displayPlaces.map((place, i) => (
              <ExplorePlaceCard
                key={place.placeId ?? `place-${i}`}
                place={place}
                onPress={() => navigateToDetail(place)}
                onSaveToBoard={() => handleSaveToBoard(place)}
                onAdd={() => handleAddToTrip(place)}
                destination={exploreLocation?.label ?? ''}
              />
            ))}
          </View>
        )}

        {/* Empty state when location is set but no results */}
        {!isSearching && !loading && exploreLocation && displayPlaces.length === 0 && (
          <View style={styles.emptyState}>
            <ThemedText style={styles.emptyTitle}>No places found</ThemedText>
            <ThemedText style={[styles.emptySub, { color: theme.textSecondary }]}>
              Try a different category or location
            </ThemedText>
          </View>
        )}

        {/* Data attribution */}
        {displayPlaces.length > 0 && (
          <ThemedText style={[styles.attribution, { color: theme.textSecondary }]}>
            Data and photos by Google
          </ThemedText>
        )}
      </ScrollView>

      {/* Selection sheet */}
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

      {/* Time & duration picker */}
      {pendingAdd && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPendingAdd(null)}>
          <Pressable style={styles.addModalBackdrop} onPress={() => setPendingAdd(null)} accessibilityRole="button" accessibilityLabel="Close">
            <Pressable style={[styles.addModalSheet, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()} accessibilityRole="button" accessibilityLabel="Add to trip dialog">
              <ThemedText type="subtitle" style={styles.addModalTitle}>Add to trip</ThemedText>
              <ThemedText style={[styles.addModalPlace, { color: theme.textSecondary }]}>
                {pendingAdd.place.name} {'\u00B7'} Day {pendingAdd.day}
              </ThemedText>
              <TimePickerButton
                value={pendingAdd.time}
                onChange={(t) => setPendingAdd((p) => p ? { ...p, time: t } : p)}
                showDuration
                duration={pendingAdd.duration}
                onDurationChange={(d) => setPendingAdd((p) => p ? { ...p, duration: d } : p)}
              />
              <View style={styles.addModalBtns}>
                <Pressable onPress={() => setPendingAdd(null)} style={[styles.addModalCancel, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="Cancel">
                  <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>Cancel</ThemedText>
                </Pressable>
                <Pressable onPress={confirmPendingAdd} style={[styles.addModalConfirm, { backgroundColor: theme.primary }]} accessibilityRole="button" accessibilityLabel="Confirm add to trip">
                  <ThemedText style={{ color: theme.primaryText, fontSize: 15, fontWeight: '700' }}>Add to trip</ThemedText>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Location sheet */}
      <Modal visible={locationSheetOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLocationSheetOpen(false)}>
        <View style={[styles.locationSheet, { backgroundColor: theme.background }]}>
          <View style={[styles.locationSheetHeader, { borderBottomColor: theme.border }]}>
            <ThemedText type="subtitle">Explore location</ThemedText>
            <Pressable onPress={() => setLocationSheetOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <SymbolView name="xmark" size={16} tintColor={theme.primary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Search a city */}
            <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Search a city</ThemedText>
            <View style={{ position: 'relative', zIndex: 10 }}>
              <View style={[styles.customCityRow, { borderColor: theme.border }]}>
                <TextInput
                  style={[styles.customCityInput, { color: theme.text }]}
                  value={customCityInput}
                  onChangeText={setCustomCityInput}
                  placeholder="e.g. Barcelona, Kyoto..."
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="go"
                  onSubmitEditing={handleCustomCity}
                  autoCapitalize="words"
                  accessibilityLabel="Enter a city name"
                />
                {customCityInput.length > 0 && (
                  <Pressable onPress={() => { setCustomCityInput(''); setCitySuggestions([]); }} style={{ padding: 8 }} accessibilityRole="button" accessibilityLabel="Clear city">
                    <SymbolView name="xmark" size={12} tintColor={theme.textSecondary} />
                  </Pressable>
                )}
              </View>
              {citySuggestions.length > 0 && (
                <View style={[styles.cityAutocompleteDropdown, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  {citySuggestions.map((s, i) => (
                    <Pressable
                      key={`${s.city}-${i}`}
                      onPress={() => handleCitySuggestion(s)}
                      style={[styles.cityAutocompleteItem, i < citySuggestions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}
                      accessibilityRole="button"
                      accessibilityLabel={s.display}
                    >
                      <View style={styles.cityAutocompleteRow}>
                        <SymbolView name="mappin.circle" size={18} tintColor={theme.primary} />
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.cityAutocompleteName}>{s.city}</ThemedText>
                          <ThemedText style={[styles.cityAutocompleteSub, { color: theme.textSecondary }]}>{s.display}</ThemedText>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
              {citySearching && customCityInput.length >= 2 && citySuggestions.length === 0 && (
                <ThemedText style={[styles.cityAutocompleteSearching, { color: theme.textSecondary }]}>Searching...</ThemedText>
              )}
            </View>

            {/* Near me */}
            <ThemedText type="eyebrow" style={{ color: theme.textSecondary, marginTop: 8 }}>Near me</ThemedText>
            <Pressable
              onPress={handleNearMe}
              style={[styles.locationOption, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Use current location"
            >
              <SymbolView name="location" size={20} tintColor={theme.primary} />
              <View style={styles.locationOptionInfo}>
                <ThemedText style={styles.locationOptionTitle}>Near me</ThemedText>
                <ThemedText style={[styles.locationOptionSub, { color: theme.textSecondary }]}>Use your current location</ThemedText>
              </View>
            </Pressable>

            {/* Trip destinations */}
            {trips.length > 0 && (
              <>
                <ThemedText type="eyebrow" style={{ color: theme.textSecondary, marginTop: 8 }}>Your trips</ThemedText>
                {trips.map((trip) => (
                  <Pressable
                    key={trip.id}
                    onPress={() => handleTripLocation(trip)}
                    style={[styles.locationOption, {
                      backgroundColor: exploreLocation?.type === 'trip' && exploreLocation.tripId === trip.id ? theme.primaryMuted : theme.backgroundElement,
                      borderColor: exploreLocation?.type === 'trip' && exploreLocation.tripId === trip.id ? theme.primary : theme.border,
                    }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Explore ${trip.destination}`}
                  >
                    <SymbolView name="mappin.circle" size={22} tintColor={theme.primary} />
                    <View style={styles.locationOptionInfo}>
                      <ThemedText style={styles.locationOptionTitle}>{trip.destination}</ThemedText>
                      <ThemedText style={[styles.locationOptionSub, { color: theme.textSecondary }]}>{formatTripDates(trip.startDate, trip.endDate)}</ThemedText>
                    </View>
                  </Pressable>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Saved Places Modal */}
      <Modal visible={savedModalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSavedModalOpen(false)}>
        <View style={[styles.savedModal, { backgroundColor: theme.background }]}>
          <View style={[styles.savedModalHeader, { borderBottomColor: theme.border }]}>
            <ThemedText type="subtitle">Saved places ({savedPlaces.length})</ThemedText>
            <Pressable onPress={() => setSavedModalOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close saved places">
              <SymbolView name="xmark" size={16} tintColor={theme.primary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: 8 }} showsVerticalScrollIndicator={false}>
            {savedPlaces.map((p) => (
              <View key={p.id} style={[styles.savedRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <Pressable
                  onPress={() => {
                    setSavedModalOpen(false);
                    let url = `/place-detail?name=${encodeURIComponent(p.title)}&destination=${encodeURIComponent(p.destination ?? '')}`;
                    if (paramTripId && paramDay) {
                      url += `&tripId=${encodeURIComponent(paramTripId)}&day=${encodeURIComponent(paramDay)}`;
                    }
                    router.push(url as any);
                  }}
                  style={styles.savedInfo}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${p.title}`}
                >
                  <ThemedText style={styles.savedTitle}>{p.title}</ThemedText>
                  <ThemedText style={[styles.savedDest, { color: theme.textSecondary }]}>
                    {p.destination ?? ''} {'\u00B7'} {p.activityType ?? p.type}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={() => unsavePlace(p.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Unsave ${p.title}`}>
                  <SymbolView name="heart.fill" size={16} tintColor="#EF4444" />
                </Pressable>
              </View>
            ))}
            {savedPlaces.length === 0 && (
              <ThemedText style={{ color: theme.textSecondary, textAlign: 'center', paddingTop: 40 }}>No saved places yet.</ThemedText>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Board Picker */}
      <BoardPicker
        visible={boardPickerVisible}
        onSelect={handleBoardSelected}
        onClose={() => { setBoardPickerVisible(false); setPendingBoardPlace(null); }}
      />
    </ThemedView>
  );
}

// ============ Styles ============

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four },

  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.two },
  locationSelector: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  locationLabel: { fontSize: 13, fontWeight: '600' },

  // Search
  searchWithSaved: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  savedAccessBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  savedAccessIcon: { fontSize: 18, lineHeight: 22 },
  searchRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, gap: 8 },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, paddingVertical: 14, fontSize: 16 },
  clearBtn: { padding: 4 },
  clearText: { fontSize: 16, fontWeight: '300' },

  // Search suggestions
  searchSection: { marginBottom: 12, gap: 4 },
  searchSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  clearAllText: { fontSize: 13, fontWeight: '500' },
  searchSuggestion: { paddingVertical: 10, paddingHorizontal: 4 },
  searchSuggestionText: { fontSize: 15 },

  // Category tabs
  categoryScroll: { marginBottom: 12 },
  categoryScrollContent: { gap: 8, paddingVertical: 4 },
  categoryTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  categoryTabText: { fontSize: 13, fontWeight: '600' },

  // Import
  importCompactRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  importCompactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 8 },
  importCompactIcon: { fontSize: 14, lineHeight: 20 },
  importCompactLabel: { fontSize: 13, fontWeight: '500' },
  identifyBanner: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 12, gap: 6 },
  identifyBannerTitle: { fontSize: 14, fontWeight: '700' },
  identifyBtnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },

  // Map — compact preview
  mapContainer: { borderRadius: 14, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  mapPreviewWrap: { height: 180, position: 'relative' },
  mapExpandBtn: { position: 'absolute', top: 10, right: 10, zIndex: 2 },
  mapExpandInner: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  mapExpandIcon: { fontSize: 14 },
  mapCountBadge: { position: 'absolute', bottom: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  mapCountText: { fontSize: 11, fontWeight: '600', color: '#fff' },

  // Map — full screen modal
  mapFullScreen: { flex: 1, position: 'relative', backgroundColor: '#000' },
  mapCloseBtn: { position: 'absolute', top: 54, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  mapCloseBtnText: { fontSize: 16, fontWeight: '600' },
  mapLocationBadge: { position: 'absolute', top: 54, right: 16, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 10 },
  mapLocationText: { fontSize: 12, fontWeight: '600', color: '#fff' },

  // Map — floating card carousel
  mapCardPanel: { position: 'absolute', bottom: 34, left: 0, right: 0, zIndex: 10 },
  mapCardScroll: { paddingHorizontal: 16, gap: 12 },
  mapCard: { width: 272, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 6 },
  mapCardPhoto: { width: 272, height: 100, alignItems: 'center', justifyContent: 'center' },
  mapCardBody: { padding: 12, gap: 3 },
  mapCardName: { fontSize: 14, fontWeight: '600' },
  mapCardRating: { fontSize: 12, color: '#F59E0B' },
  mapCardAddr: { fontSize: 11 },
  mapCardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  mapCardAddBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14 },
  mapCardAddText: { fontSize: 12, fontWeight: '600' },
  mapCardSaveIcon: { fontSize: 20 },

  // Place cards
  placesList: { gap: 12 },
  placeCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  cardRow: { flexDirection: 'row', minHeight: 110 },
  cardPhoto: { width: 100 },
  photoPlaceholder: { width: 100, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  placeholderIcon: { fontSize: 22, opacity: 0.4 },
  cardContent: { flex: 1, padding: 12, gap: 4 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardName: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  cardMeta: { fontSize: 12 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  ratingStar: { fontSize: 13, color: '#F59E0B' },
  ratingNum: { fontSize: 13, fontWeight: '700' },
  reviewCount: { fontSize: 11 },
  priceLabel: { fontSize: 12, fontWeight: '700', marginLeft: 4 },
  distLabel: { fontSize: 11, marginLeft: 4 },
  cardBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  catChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, flexShrink: 1 },
  catChipText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  openStatus: { fontSize: 11, fontWeight: '600', marginLeft: 4 },

  // Save / View
  saveIcon: { fontSize: 20 },
  viewBtn: { paddingHorizontal: 2, paddingVertical: 4 },
  viewBtnText: { fontSize: 13, fontWeight: '600' },

  // Sections
  sectionTitle: { marginTop: Spacing.three, marginBottom: 8 },

  // Loading
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 24 },
  loadingText: { fontSize: 14 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '600' },
  emptySub: { fontSize: 14, textAlign: 'center' },
  chooseLocationBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  chooseLocationText: { fontSize: 15, fontWeight: '600' },

  // Attribution
  attribution: { fontSize: 10, textAlign: 'center', marginTop: 16, marginBottom: 8 },

  // Location sheet
  locationSheet: { flex: 1 },
  locationSheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.four, paddingTop: 20, borderBottomWidth: 1 },
  locationSheetClose: { fontSize: 20, fontWeight: '400' },
  locationOption: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  locationOptionIcon: { fontSize: 22, lineHeight: 28 },
  locationOptionInfo: { flex: 1, gap: 2 },
  locationOptionTitle: { fontSize: 15, fontWeight: '600' },
  locationOptionSub: { fontSize: 12 },
  customCityRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingLeft: 12, overflow: 'hidden' },
  customCityInput: { flex: 1, paddingVertical: 12, fontSize: 15 },
  customCityBtn: { paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  customCityBtnText: { fontSize: 14, fontWeight: '600' },

  // City autocomplete dropdown
  cityAutocompleteDropdown: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  cityAutocompleteItem: { paddingHorizontal: 14, paddingVertical: 11 },
  cityAutocompleteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cityAutocompleteName: { fontSize: 15, fontWeight: '500' },
  cityAutocompleteSub: { fontSize: 12, marginTop: 2 },
  cityAutocompleteSearching: { fontSize: 12, marginTop: 4, paddingHorizontal: 4 },

  // Search autocomplete dropdown
  searchAutocompleteDropdown: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  searchAutocompleteItem: { paddingHorizontal: 14, paddingVertical: 11 },
  searchAutocompleteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchAutocompleteName: { fontSize: 15, fontWeight: '500' },
  searchAutocompleteSub: { fontSize: 12, marginTop: 2 },

  // Saved
  savedModal: { flex: 1 },
  savedModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.four, paddingTop: 20, borderBottomWidth: 1 },
  savedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, padding: 14 },
  savedInfo: { flex: 1, gap: 2 },
  savedTitle: { fontSize: 15, fontWeight: '600' },
  savedDest: { fontSize: 13 },

  // Add to trip modal
  addModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  addModalSheet: { borderRadius: 20, padding: 24, width: '100%', maxWidth: 360, gap: 14 },
  addModalTitle: { textAlign: 'center' },
  addModalPlace: { textAlign: 'center', fontSize: 14 },
  addModalBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  addModalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  addModalConfirm: { flex: 2, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
});
