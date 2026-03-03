/**
 * HtmlMapView — renders an HTML map string inside a WebView (native) or iframe (web).
 * Provides a single cross-platform API for all map screens.
 */
import React from 'react';
import { Platform, StyleProp, View, ViewStyle } from 'react-native';

interface HtmlMapViewProps {
  /** data: URI or inline HTML source produced by buildMapHtml / buildDriverPatientMapHtml */
  html: string;
  /** Optional style applied to the container */
  style?: StyleProp<ViewStyle>;
  /** Title for web iframe accessibility */
  title?: string;
}

export function HtmlMapView({ html, style, title = 'Map' }: HtmlMapViewProps) {
  if (Platform.OS === 'web') {
    return (
      <View style={style}>
        <iframe
          src={html}
          style={{ width: '100%', height: '100%', border: 'none', borderRadius: 12, display: 'block' } as any}
          title={title}
          allow="geolocation"
        />
      </View>
    );
  }

  // Native — use react-native-webview
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require('react-native-webview');

  // The html prop from buildMapHtml is a data URI; WebView needs source.uri for data URIs
  return (
    <View style={style}>
      <WebView
        source={{ uri: html }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
        startInLoadingState
        scalesPageToFit={false}
        scrollEnabled={false}
        overScrollMode="never"
      />
    </View>
  );
}
