const fs = require("fs");

function patchPatientEmergency() {
  const p = "app/patient-emergency.tsx";
  let s = fs.readFileSync(p, "utf8");
  s = s.replace('import React, { useEffect, useMemo, useState } from "react";', 'import React, { useEffect, useState } from "react";');
  s = s.replace(/\n\s*const nearestDistanceKm = useMemo\([\s\S]*?\n\s*\}, \[nearestDistanceKm\]\);\n/, "\n");
  s = s.replace("  >([]);\n\n  const scaleAnim = React.useRef(new Animated.Value(1)).current;", "  >([]);\n  const locationWatcherRef = React.useRef<Location.LocationSubscription | null>(\n    null,\n  );\n\n  const scaleAnim = React.useRef(new Animated.Value(1)).current;");
  s = s.replace(/useEffect\(\(\) => \{\n\s*checkActiveEmergency\(\);\n\s*requestLocationPermission\(\);\n\s*loadNearbyAmbulances\(\);\n\s*\/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\n\s*\}, \[user\?\.id\]\);/, `useEffect(() => {\n    checkActiveEmergency();\n    startRealtimeLocationTracking();\n    loadNearbyAmbulances();\n    return () => {\n      locationWatcherRef.current?.remove();\n      locationWatcherRef.current = null;\n    };\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [user?.id]);`);
  s = s.replace(/const requestLocationPermission = async \(\) => \{[\s\S]*?\n\s*\};\n\n\s*const handleSOS = async \(\) => \{/, `const applyLiveLocation = (coords: Location.LocationObjectCoords) => {\n    setLocation((prev) => {\n      const next = { latitude: coords.latitude, longitude: coords.longitude };\n      if (!prev) return next;\n      const latDiff = Math.abs(prev.latitude - next.latitude);\n      const lngDiff = Math.abs(prev.longitude - next.longitude);\n      return latDiff > 0.00005 || lngDiff > 0.00005 ? next : prev;\n    });\n  };\n\n  const startRealtimeLocationTracking = async () => {\n    try {\n      let permission = await Location.getForegroundPermissionsAsync();\n      if (permission.status !== "granted") {\n        permission = await Location.requestForegroundPermissionsAsync();\n      }\n      if (permission.status !== "granted") {\n        const msg =\n          "Location permission is required to request emergency services";\n        showError("Permission Denied", msg);\n        return;\n      }\n\n      const currentLocation = await Location.getCurrentPositionAsync({\n        accuracy: Location.Accuracy.Balanced,\n      });\n      applyLiveLocation(currentLocation.coords);\n\n      locationWatcherRef.current?.remove();\n      locationWatcherRef.current = await Location.watchPositionAsync(\n        {\n          accuracy: Location.Accuracy.Balanced,\n          timeInterval: 5000,\n          distanceInterval: 15,\n        },\n        (updated) => {\n          applyLiveLocation(updated.coords);\n        },\n      );\n    } catch (error) {\n      console.error("Error getting location:", error);\n      const msg =\n        "Could not get your location. Please enable location services.";\n      showError("Location Error", msg);\n    }\n  };\n\n  const handleSOS = async () => {`);
  s = s.replace(/\n\s*\{nearbyAmbulances\.length > 0\s*&&\s*\([\s\S]*?\n\s*\)\}\n(?=\s*\{nearbyAmbulances\.slice\(0, 3\))/, "\n");
  fs.writeFileSync(p, s, "utf8");
}

function patchHelp() {
  const p = "app/help.tsx";
  let s = fs.readFileSync(p, "utf8");
  s = s.replace("  const [profileName, setProfileName] = React.useState<string>(\n    user?.fullName || \"\",\n  );", "  const locationWatcherRef = React.useRef<Location.LocationSubscription | null>(\n    null,\n  );\n  const [profileName, setProfileName] = React.useState<string>(\n    user?.fullName || \"\",\n  );");
  s = s.replace("        const position = await Location.getCurrentPositionAsync({\n          accuracy: Location.Accuracy.Highest,\n          mayShowUserSettingsDialog: true,\n        });\n        applyCoords(position.coords);", "        const position = await Location.getCurrentPositionAsync({\n          accuracy: Location.Accuracy.Highest,\n          mayShowUserSettingsDialog: true,\n        });\n        applyCoords(position.coords);\n\n        locationWatcherRef.current?.remove();\n        locationWatcherRef.current = await Location.watchPositionAsync(\n          {\n            accuracy: Location.Accuracy.High,\n            timeInterval: 5000,\n            distanceInterval: 10,\n            mayShowUserSettingsDialog: true,\n          },\n          (update) => applyCoords(update.coords),\n        );");
  s = s.replace("    return () => {\n      cancelled = true;\n    };", "    return () => {\n      cancelled = true;\n      locationWatcherRef.current?.remove();\n      locationWatcherRef.current = null;\n    };");
  fs.writeFileSync(p, s, "utf8");
}

function patchMap() {
  const p = "app/map.tsx";
  let s = fs.readFileSync(p, "utf8");
  s = s.replace("  const [loading, setLoading] = useState(true);", "  const [loading, setLoading] = useState(true);\n  const locationWatcherRef = React.useRef<Location.LocationSubscription | null>(\n    null,\n  );");
  s = s.replace("  useEffect(() => {\n    fetchAllData();", "  useEffect(() => {\n    const startRealtimeLocationWatch = async () => {\n      const permission = await Location.getForegroundPermissionsAsync();\n      if (permission.status !== \"granted\") return;\n      locationWatcherRef.current?.remove();\n      locationWatcherRef.current = await Location.watchPositionAsync(\n        {\n          accuracy: Location.Accuracy.Balanced,\n          timeInterval: 5000,\n          distanceInterval: 15,\n        },\n        (updated) => {\n          setLocation(updated);\n          setLocationError(null);\n        },\n      );\n    };\n\n    fetchAllData();\n    void startRealtimeLocationWatch();");
  s = s.replace("    const locationInterval = setInterval(() => getUserLocation(), 10000);\n    return () => {\n      ambulanceSub.unsubscribe();\n      emergencySub.unsubscribe();\n      clearInterval(locationInterval);\n    };", "    return () => {\n      ambulanceSub.unsubscribe();\n      emergencySub.unsubscribe();\n      locationWatcherRef.current?.remove();\n      locationWatcherRef.current = null;\n    };");
  fs.writeFileSync(p, s, "utf8");
}

patchPatientEmergency();
patchHelp();
patchMap();
console.log("patched files");
