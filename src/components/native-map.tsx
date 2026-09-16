/**
 * NativeMap — renders an Apple Maps (iOS) / Google Maps (Android) view
 * using react-native-maps. Category icons are rendered via react-native-svg.
 *
 * Web builds import native-map.web.tsx instead (returns null — web map
 * rendering is handled inline by each consumer with WebView/Leaflet).
 */

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';

import type { NativeMapProps, NativeMapRef } from './native-map-types';

const NativeMap = forwardRef<NativeMapRef, NativeMapProps>(function NativeMap(
  {
    markers,
    polylines = [],
    onMarkerPress,
    activeMarkerIndex,
    style,
    interactive = true,
    initialPadding,
    userInterfaceStyle,
  },
  ref,
) {
  const mapRef = useRef<MapView>(null);

  useImperativeHandle(ref, () => ({
    animateToMarker(index: number) {
      const m = markers[index];
      if (!m || !mapRef.current) return;
      mapRef.current.animateCamera(
        { center: { latitude: m.latitude, longitude: m.longitude } },
        { duration: 300 },
      );
    },
    fitToMarkers(padding) {
      if (!mapRef.current || markers.length === 0) return;
      mapRef.current.fitToCoordinates(
        markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude })),
        {
          edgePadding: padding ?? initialPadding ?? { top: 50, right: 50, bottom: 50, left: 50 },
          animated: true,
        },
      );
    },
  }));

  // Compute initial region from marker bounds
  const initialRegion =
    markers.length > 0
      ? (() => {
          const lats = markers.map((m) => m.latitude);
          const lngs = markers.map((m) => m.longitude);
          const minLat = Math.min(...lats);
          const maxLat = Math.max(...lats);
          const minLng = Math.min(...lngs);
          const maxLng = Math.max(...lngs);
          return {
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2,
            latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.005),
            longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.005),
          };
        })()
      : { latitude: 0, longitude: 0, latitudeDelta: 90, longitudeDelta: 180 };

  return (
    <MapView
      ref={mapRef}
      style={[StyleSheet.absoluteFill, style]}
      initialRegion={initialRegion}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={false}
      showsUserLocation={false}
      showsCompass={false}
      showsScale={false}
      toolbarEnabled={false}
      userInterfaceStyle={userInterfaceStyle}
    >
      {polylines.map((pl) => (
        <Polyline
          key={pl.key}
          coordinates={pl.coordinates}
          strokeColor={pl.color}
          strokeWidth={pl.strokeWidth ?? 2.5}
          lineDashPattern={pl.lineDashPattern}
        />
      ))}
      {markers.map((marker, index) => {
        const isActive = activeMarkerIndex === index;
        return (
          <Marker
            key={marker.key}
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            onPress={() => onMarkerPress?.(index)}
            tracksViewChanges={isActive}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View
              style={[
                pinStyles.container,
                { borderColor: marker.color ?? '#555' },
                isActive && pinStyles.active,
                isActive && { borderColor: '#fff' },
              ]}
            >
              {marker.svgPathData ? (
                <Svg viewBox="0 0 24 24" width={13} height={13}>
                  <Path d={marker.svgPathData} fill="#e5e5e5" />
                </Svg>
              ) : null}
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
});

export default NativeMap;

const pinStyles = StyleSheet.create({
  container: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1c1c1e',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  active: {
    transform: [{ scale: 1.3 }],
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
});
