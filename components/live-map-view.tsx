/**
 * LiveMapView — interactive Leaflet map via WebView (native) / iframe (web).
 * Moves markers smoothly via injectJavaScript / postMessage — no page reloads.
 */
import React, { useEffect, useRef } from "react";
import { Platform, StyleProp, View, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  color?: string;
  label?: string;
  popup?: string;
}

interface LiveMapViewProps {
  markers: MapMarker[];
  showRoute?: boolean;
  style?: StyleProp<ViewStyle>;
  zoom?: number;
}

function buildLeafletHtml(
  markers: MapMarker[],
  showRoute: boolean,
  zoom: number,
): string {
  const center =
    markers.length > 0
      ? [markers[0].latitude, markers[0].longitude]
      : [9.02, 38.75];
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>*{margin:0;padding:0}html,body,#map{width:100%;height:100%;overflow:hidden}</style>
</head><body><div id="map"></div>
<script>
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${center[0]},${center[1]}],${zoom});
L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',{maxZoom:20}).addTo(map);
L.control.attribution({prefix:false}).addTo(map);
var MK={};var RL=null;
function svg(c){return '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="38" viewBox="0 0 26 38"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.8 13 25 13 25s13-15.2 13-25C26 5.8 20.2 0 13 0z" fill="'+c+'" stroke="#fff" stroke-width="1.5"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>';}
function ic(c,lb){return L.divIcon({html:'<div style="position:relative;display:inline-block"><img src="data:image/svg+xml;base64,'+btoa(svg(c||"#DC2626"))+'" width="26" height="38"/>'+(lb?'<div style="position:absolute;top:40px;left:50%;transform:translateX(-50%);white-space:nowrap;font:600 10px system-ui,sans-serif;color:#333;background:#ffffffdd;padding:1px 5px;border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,.25)">'+lb+'</div>':'')+'</div>',iconSize:[26,38],iconAnchor:[13,38],popupAnchor:[0,-38],className:''});}
function up(m){var ll=[m.latitude,m.longitude];if(MK[m.id]){MK[m.id].setLatLng(ll);MK[m.id].setIcon(ic(m.color,m.label))}else{MK[m.id]=L.marker(ll,{icon:ic(m.color,m.label)}).addTo(map);if(m.popup)MK[m.id].bindPopup(m.popup)}}
function dr(pts){if(RL)map.removeLayer(RL);if(pts&&pts.length>=2)RL=L.polyline(pts,{color:'#2563EB',weight:3,opacity:0.6,dashArray:'8,6'}).addTo(map);}
function fit(){var ids=Object.keys(MK);if(ids.length>=2){var g=L.featureGroup(ids.map(function(i){return MK[i]}));map.fitBounds(g.getBounds().pad(0.2))}else if(ids.length===1)map.setView(MK[ids[0]].getLatLng(),${zoom})}
function handleMsg(d){if(d.type==='update'){var ni={};(d.markers||[]).forEach(function(m){ni[m.id]=1;up(m)});Object.keys(MK).forEach(function(id){if(!ni[id]){map.removeLayer(MK[id]);delete MK[id]}});if(d.showRoute){dr((d.markers||[]).map(function(m){return[m.latitude,m.longitude]}))}else{dr(null)}if(d.fit)fit()}}
window.addEventListener('message',function(e){try{handleMsg(typeof e.data==='string'?JSON.parse(e.data):e.data)}catch(x){}});
document.addEventListener('message',function(e){try{handleMsg(typeof e.data==='string'?JSON.parse(e.data):e.data)}catch(x){}});
var init=${JSON.stringify(markers)};
init.forEach(up);
if(${showRoute}&&init.length>=2)dr(init.map(function(m){return[m.latitude,m.longitude]}));
fit();
<\/script></body></html>`;
}

export function LiveMapView({
  markers,
  showRoute = false,
  style,
  zoom = 15,
}: LiveMapViewProps) {
  const webViewRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadedRef = useRef(false);
  const htmlRef = useRef(buildLeafletHtml(markers, showRoute, zoom));
  const prevKeyRef = useRef("");

  useEffect(() => {
    const key = markers
      .map(
        (m) =>
          `${m.id}:${m.latitude.toFixed(5)},${m.longitude.toFixed(5)},${m.color},${m.label}`,
      )
      .join("|");
    if (key === prevKeyRef.current || !loadedRef.current) {
      prevKeyRef.current = key;
      return;
    }
    prevKeyRef.current = key;

    const msg = JSON.stringify({
      type: "update",
      markers,
      showRoute,
      fit: false,
    });

    if (Platform.OS === "web") {
      try {
        (iframeRef.current as any)?.contentWindow?.postMessage(msg, "*");
      } catch {}
    } else {
      webViewRef.current?.injectJavaScript(
        `try{handleMsg(${msg})}catch(e){};true;`,
      );
    }
  });

  const onLoad = () => {
    loadedRef.current = true;
  };

  if (Platform.OS === "web") {
    return (
      <View style={style}>
        <iframe
          ref={iframeRef as any}
          srcDoc={htmlRef.current}
          onLoad={onLoad}
          style={
            {
              width: "100%",
              height: "100%",
              border: "none",
              borderRadius: 12,
              display: "block",
            } as any
          }
          title="Live Map"
        />
      </View>
    );
  }

  return (
    <View style={style}>
      <WebView
        ref={webViewRef}
        source={{ html: htmlRef.current }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        overScrollMode="never"
        onLoad={onLoad}
      />
    </View>
  );
}
