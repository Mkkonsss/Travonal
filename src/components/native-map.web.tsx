/**
 * NativeMap — web stub.
 *
 * On web, map rendering is handled inline by each consumer using
 * WebView/Leaflet or iframes. This stub prevents react-native-maps
 * from being bundled for web builds.
 */

import React, { forwardRef } from 'react';
import type { NativeMapProps, NativeMapRef } from './native-map-types';

const NativeMap = forwardRef<NativeMapRef, NativeMapProps>(function NativeMap() {
  return null;
});

export default NativeMap;
