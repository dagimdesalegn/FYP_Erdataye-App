// Web stub — react-native-maps is not supported on web
// These exports are never actually rendered on web (web routes use .web.tsx files),
// but they prevent the Metro bundler from crashing when it parses app/ route files.
import React from 'react';
import { View } from 'react-native';

export const PROVIDER_GOOGLE = 'google';

export const Marker = (_props: any) => null;

export const MapView = React.forwardRef((props: any, ref: any) => (
  <View ref={ref} style={props.style} />
));

MapView.displayName = 'MapViewWebStub';

export default MapView;
