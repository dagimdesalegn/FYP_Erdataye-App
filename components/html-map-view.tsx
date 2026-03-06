/**
 * HtmlMapView — renders an HTML map string inside a WebView (native) or iframe (web).
 * Provides a single cross-platform API for all map screens.
 */
import React, { useState } from 'react';
import { Platform, StyleProp, Text, View, ViewStyle } from 'react-native';

interface HtmlMapViewProps {
  /** data: URI or inline HTML source produced by buildMapHtml / buildDriverPatientMapHtml */
  html: string;
  /** Optional style applied to the container */
  style?: StyleProp<ViewStyle>;
  /** Title for web iframe accessibility */
  title?: string;
}

export function HtmlMapView({ html, style, title = 'Map' }: HtmlMapViewProps) {
  const [hasError, setHasError] = useState(false);

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

  // Google Maps embed URLs require being inside an iframe.
  // Wrap the embed URL in a minimal HTML document with a full-size iframe.
  const iframeHtml = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden}
iframe{width:100%;height:100%;border:none}</style></head>
<body><iframe src="${html}" allowfullscreen loading="eager"></iframe></body></html>`;

  return (
    <View style={style}>
      {hasError ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            backgroundColor: '#0B0F1A',
            borderRadius: 12,
          }}>
          <Text style={{ color: '#E2E8F0', textAlign: 'center' }}>
            Map failed to load. Check your internet connection.
          </Text>
        </View>
      ) : (
        <WebView
          source={{ html: iframeHtml }}
          style={{ flex: 1, backgroundColor: 'transparent' }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          geolocationEnabled
          startInLoadingState
          scalesPageToFit={false}
          scrollEnabled={false}
          overScrollMode="never"
          mixedContentMode="always"
          onError={() => setHasError(true)}
        />
      )}
    </View>
  );
}
