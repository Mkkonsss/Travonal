import type { StyleProp, ViewStyle } from 'react-native';

export interface NativeMapMarker {
  key: string;
  latitude: number;
  longitude: number;
  title?: string;
  subtitle?: string;
  /** Accent / border color for the pin */
  color?: string;
  /** SVG path `d` attribute for the icon inside the pin */
  svgPathData?: string;
}

export interface NativeMapPolyline {
  key: string;
  coordinates: { latitude: number; longitude: number }[];
  color: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
}

export interface NativeMapRef {
  /** Animate camera to center on the marker at the given index. */
  animateToMarker(index: number): void;
  /** Fit the map to show all markers with the given edge padding. */
  fitToMarkers(padding?: { top: number; right: number; bottom: number; left: number }): void;
}

export interface NativeMapProps {
  markers: NativeMapMarker[];
  polylines?: NativeMapPolyline[];
  onMarkerPress?: (index: number) => void;
  /** Index of the currently highlighted marker (shown scaled-up). */
  activeMarkerIndex?: number;
  style?: StyleProp<ViewStyle>;
  /** Whether the map supports scroll/zoom (default true). */
  interactive?: boolean;
  /** Edge padding used when fitting markers on initial render. */
  initialPadding?: { top: number; right: number; bottom: number; left: number };
  /** Force light or dark map appearance (iOS only). */
  userInterfaceStyle?: 'light' | 'dark';
}
