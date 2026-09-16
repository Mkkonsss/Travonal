import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import { Image as ExpoImage } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import NativeMap from '@/components/native-map';
import type { NativeMapRef, NativeMapMarker, NativeMapPolyline } from '@/components/native-map-types';
import { useTheme } from '@/hooks/use-theme';
import { Activity } from '@/context/trips';
import { getPlacePhoto } from '@/services/free-photos';
import { DAY_COLORS, getCategoryPathData, getCategorySvgHtml, DEFAULT_SVG_HTML } from '@/constants/map-icons';

interface TripMapProps {
  activities: Activity[];
  destination: string;
  totalDays: number;
  onActivityPress?: (activity: Activity) => void;
}

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Web-only: getCategoryIcon returns HTML SVG for Leaflet markers
function getCategoryIcon(category: string): string {
  return getCategorySvgHtml(category);
}

function buildTripMapHtml(
  activities: { title: string; day: number; time: string; lat: number; lng: number; idx: number; svgIcon: string }[],
  totalDays: number,
): string {
  const placesJson = JSON.stringify(activities.map((a) => ({
    title: a.title.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    day: a.day,
    time: a.time,
    lat: a.lat,
    lng: a.lng,
    idx: a.idx,
    svg: a.svgIcon,
  })));
  const colorsJson = JSON.stringify(DAY_COLORS);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body,#map{width:100%;height:100%;}
body{background:#f0f0f0;}
.leaflet-tile-pane{filter:saturate(0.25) brightness(1.05) contrast(0.95)}
.leaflet-control-zoom{display:none!important;}
.leaflet-control-attribution{font-size:9px!important;opacity:0.5!important;background:transparent!important;}
.leaflet-control-attribution a{color:#999!important;}
.pin-marker{
  display:flex;align-items:center;justify-content:center;
  width:28px;height:28px;border-radius:50%;
  background:#fff;
  border:2px solid #d1d5db;
  box-shadow:0 1px 4px rgba(0,0,0,0.15);
  transition:transform 0.15s,border-color 0.15s;
}
.pin-marker.active{transform:scale(1.3);border-color:#111;box-shadow:0 2px 8px rgba(0,0,0,0.25)}
.pin-marker svg{width:13px;height:13px}
.leaflet-popup-content-wrapper{border-radius:14px;padding:0;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.18)}
.leaflet-popup-content{margin:0;min-width:200px;max-width:240px}
.leaflet-popup-tip{border-top-color:#fff}
.popup-card{font-family:-apple-system,BlinkMacSystemFont,sans-serif}
.popup-body{padding:10px 12px}
.popup-name{font-size:13px;font-weight:700;margin-bottom:2px}
.popup-day{font-size:11px;color:#6B7280}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script>
var ACTS=${placesJson};
var COLORS=${colorsJson};
var markers=[];

(function(){
  if(!ACTS.length) return;

  var map=L.map('map',{zoomControl:false,attributionControl:true});

  L.tileLayer('${OSM_TILES}',{
    maxZoom:19,
    attribution:'\\u00a9 <a href="https://openstreetmap.org/">OSM</a>'
  }).addTo(map);

  var bounds=L.latLngBounds(ACTS.map(function(a){return [a.lat,a.lng];}));
  map.fitBounds(bounds,{padding:[50,50]});

  // Group by day for polylines
  var byDay={};
  ACTS.forEach(function(a){
    if(!byDay[a.day])byDay[a.day]=[];
    byDay[a.day].push(a);
  });

  Object.keys(byDay).forEach(function(d){
    var dayActs=byDay[d].sort(function(a,b){return a.time.localeCompare(b.time);});
    if(dayActs.length>1){
      var latlngs=dayActs.map(function(a){return [a.lat,a.lng];});
      L.polyline(latlngs,{
        color:COLORS[(d-1)%COLORS.length],
        weight:2.5,
        opacity:0.45,
        dashArray:'6 4',
      }).addTo(map);
    }
  });

  // Add markers with category SVG icons and day-colored borders
  ACTS.forEach(function(a,i){
    var color=COLORS[(a.day-1)%COLORS.length];
    var svgHtml='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'+decodeURIComponent(a.svg).replace(/%23/g,'#')+'</svg>';
    var icon=L.divIcon({
      className:'',
      html:'<div class="pin-marker" id="mk'+i+'" style="border-color:'+color+'">'+svgHtml+'</div>',
      iconSize:[28,28],
      iconAnchor:[14,14],
    });
    var mk=L.marker([a.lat,a.lng],{icon:icon}).addTo(map);
    mk.on('click',function(){
      mk.bindPopup('<div class="popup-card"><div class="popup-body"><div class="popup-name">'+a.title+'</div><div class="popup-day">Day '+a.day+' \\u00B7 '+a.time+'</div></div></div>',{maxWidth:240,closeButton:true});
      mk.openPopup();
      window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'highlight',idx:i}));
    });
    markers.push(mk);
  });

  window.highlightMarker=function(i){
    markers.forEach(function(m,j){
      var el=document.getElementById('mk'+j);
      if(el)el.className=j===i?'pin-marker active':'pin-marker';
      if(el)el.style.borderColor=j===i?'#111':COLORS[(ACTS[j].day-1)%COLORS.length];
    });
    if(markers[i]){
      map.panTo(markers[i].getLatLng(),{animate:true,duration:0.3});
    }
  };

  window.setPhotoUrl=function(idx,url){};
})();
<\/script>
</body>
</html>`;
}

// ---------- Shimmer ----------

function ShimmerPlaceholder({ style }: { style?: object }) {
  const theme = useTheme();
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800 }), -1, true);
  }, [opacity]);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.cardPhoto, { backgroundColor: theme.backgroundElement }, style, animStyle]} />
  );
}

// ---------- Card Photo ----------

function CardPhoto({ activity }: { activity: Activity }) {
  const theme = useTheme();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!activity.placeId) return;
    let cancelled = false;
    getPlacePhoto({
      cacheKey: activity.placeId,
      photoRef: activity.placeId,
      name: activity.title,
      category: activity.category ?? 'other',
    }).then((r) => { if (!cancelled && r) setUrl(r.url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activity.placeId, activity.title]);

  if (url) {
    return <ExpoImage source={{ uri: url }} style={styles.cardPhoto} contentFit="cover" cachePolicy="memory-disk" />;
  }
  return <ShimmerPlaceholder />;
}

// ---------- Main Component ----------

const CARD_WIDTH = 272;
const CARD_GAP = 12;

export function TripMap({ activities, destination, totalDays, onActivityPress }: TripMapProps) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const nativeMapRef = useRef<NativeMapRef>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [activeMarkerIndex, setActiveMarkerIndex] = useState<number | undefined>();
  const isWeb = Platform.OS === 'web';

  const geoActivities = useMemo(() => {
    return activities
      .filter((a) => a.lat != null && a.lng != null)
      .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
      .map((a, i) => ({
        ...a,
        idx: i,
        lat: a.lat!,
        lng: a.lng!,
        svgIcon: getCategoryIcon(a.category ?? (a.type === 'food' ? 'food/restaurant' : a.type === 'hotel' ? 'stay/hotel' : 'activity/attraction')),
      }));
  }, [activities]);

  // Native map markers
  const nativeMarkers = useMemo<NativeMapMarker[]>(() => {
    if (isWeb) return [];
    return geoActivities.map((a) => ({
      key: a.id,
      latitude: a.lat,
      longitude: a.lng,
      title: a.title,
      subtitle: `Day ${a.day} \u00B7 ${a.time}`,
      color: DAY_COLORS[(a.day - 1) % DAY_COLORS.length],
      svgPathData: getCategoryPathData(
        a.category ?? (a.type === 'food' ? 'food/restaurant' : a.type === 'hotel' ? 'stay/hotel' : 'activity/attraction'),
      ),
    }));
  }, [geoActivities, isWeb]);

  // Native map polylines (connect activities within each day)
  const nativePolylines = useMemo<NativeMapPolyline[]>(() => {
    if (isWeb) return [];
    const byDay: Record<number, typeof geoActivities> = {};
    geoActivities.forEach((a) => {
      if (!byDay[a.day]) byDay[a.day] = [];
      byDay[a.day].push(a);
    });
    return Object.entries(byDay)
      .filter(([, acts]) => acts.length > 1)
      .map(([day, acts]) => ({
        key: `day-${day}`,
        coordinates: [...acts]
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((a) => ({ latitude: a.lat, longitude: a.lng })),
        color: DAY_COLORS[(parseInt(day, 10) - 1) % DAY_COLORS.length],
        strokeWidth: 2.5,
        lineDashPattern: [6, 4],
      }));
  }, [geoActivities, isWeb]);

  if (geoActivities.length === 0) {
    return (
      <View style={styles.fallback}>
        <SymbolView name="map.fill" size={48} tintColor={theme.text} />
        <ThemedText style={styles.fallbackTitle}>Map view</ThemedText>
        <ThemedText style={[styles.fallbackSub, { color: theme.textSecondary }]}>
          No activities with locations yet. Activities from AI or Explore will appear on the map.
        </ThemedText>
      </View>
    );
  }

  // Web: build Leaflet HTML
  const html = isWeb ? buildTripMapHtml(geoActivities, totalDays) : '';

  function handleMapMessage(event: { nativeEvent: { data: string } }) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'highlight' && msg.idx != null) {
        scrollRef.current?.scrollTo({ x: msg.idx * (CARD_WIDTH + CARD_GAP), animated: true });
      }
    } catch {}
  }

  function handleCardScroll(event: { nativeEvent: { contentOffset: { x: number } } }) {
    const x = event.nativeEvent.contentOffset.x;
    const idx = Math.round(x / (CARD_WIDTH + CARD_GAP));
    if (idx >= 0 && idx < geoActivities.length) {
      if (isWeb) {
        webViewRef.current?.injectJavaScript(`highlightMarker(${idx});true;`);
      } else {
        setActiveMarkerIndex(idx);
        nativeMapRef.current?.animateToMarker(idx);
      }
    }
  }

  if (isWeb) {
    return (
      <View style={styles.container}>
        <iframe
          srcDoc={html}
          style={{ width: '100%', height: '100%', border: 'none' } as any}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Full-bleed native map (Apple Maps on iOS, Google Maps on Android) */}
      <NativeMap
        ref={nativeMapRef}
        markers={nativeMarkers}
        polylines={nativePolylines}
        onMarkerPress={(idx) => {
          setActiveMarkerIndex(idx);
          scrollRef.current?.scrollTo({ x: idx * (CARD_WIDTH + CARD_GAP), animated: true });
        }}
        activeMarkerIndex={activeMarkerIndex}
        initialPadding={{ top: 50, right: 50, bottom: 200, left: 50 }}
      />

      {/* Destination + count badge */}
      <View style={[styles.locationBadge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <SymbolView name="mappin" size={14} tintColor="#fff" />
          <ThemedText style={[styles.locationText, { color: '#fff' }]}>
            {destination} {'\u00B7'} {geoActivities.length} {geoActivities.length === 1 ? 'place' : 'places'}
          </ThemedText>
        </View>
      </View>

      {/* Floating card carousel */}
      <View style={styles.cardPanel}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cardScroll}
          snapToInterval={CARD_WIDTH + CARD_GAP}
          decelerationRate="fast"
          onMomentumScrollEnd={handleCardScroll}
        >
          {geoActivities.map((activity, i) => (
            <Pressable
              key={activity.id}
              onPress={() => onActivityPress?.(activity)}
              style={[styles.card, { backgroundColor: '#1c1c1e' }]}
              accessibilityRole="button"
              accessibilityLabel={activity.title}
            >
              <CardPhoto activity={activity} />
              <View style={styles.cardBody}>
                <ThemedText style={[styles.cardName, { color: '#fff' }]} numberOfLines={1}>{activity.title}</ThemedText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={[styles.dayDot, { backgroundColor: DAY_COLORS[(activity.day - 1) % DAY_COLORS.length] }]} />
                  <ThemedText style={[styles.cardDay, { color: '#aaa' }]}>
                    Day {activity.day} {'\u00B7'} {activity.time}
                  </ThemedText>
                </View>
                {activity.address && (
                  <ThemedText style={[styles.cardAddr, { color: '#aaa' }]} numberOfLines={1}>
                    {activity.address}
                  </ThemedText>
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative' as const,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  fallbackTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  fallbackSub: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  locationBadge: {
    position: 'absolute',
    top: 12,
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    zIndex: 10,
  },
  locationText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardPanel: {
    position: 'absolute',
    bottom: 34,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  cardScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  cardPhoto: {
    width: CARD_WIDTH,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    padding: 12,
    gap: 3,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '600',
  },
  dayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardDay: {
    fontSize: 12,
  },
  cardAddr: {
    fontSize: 11,
  },
});
