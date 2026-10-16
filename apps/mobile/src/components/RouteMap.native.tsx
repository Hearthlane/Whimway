import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
} from "react-native-maps";
import { colors, fonts } from "../design/theme";
import {
  areaRegion,
  mapCoordinate,
  routeCoordinates,
} from "../services/map-geometry";
import type { RouteMapProps } from "./RouteMap.types";

export type { RouteMapProps } from "./RouteMap.types";
export function RouteMap({
  plan,
  center,
  radius,
  selectedId,
  onSelectStop,
  onSelectPoint,
  userLocation,
  showUserLocation = false,
  guideLeg,
  style,
}: RouteMapProps) {
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false),
    [cameraFollowing, setCameraFollowing] = useState(true),
    [reduced, setReduced] = useState(false),
    [trackMarkers, setTrackMarkers] = useState(true);
  const area = center ?? plan?.request.area.center;
  const areaRadius = radius ?? plan?.request.area.radius ?? 1500;
  const configured =
    Constants.expoConfig?.extra?.nativeMapsConfigured?.[Platform.OS] === true;
  const coordinates = useMemo(
    () => plan?.stops.map((stop) => mapCoordinate(stop.place.point)) ?? [],
    [plan],
  );
  const routes = useMemo(
    () =>
      (plan?.legs ?? [])
        .map((leg, i) => ({
          key: `${leg.from}-${leg.to}-${i}`,
          coordinates: routeCoordinates(leg),
        }))
        .filter((route) => route.coordinates.length > 1),
    [plan],
  );
  const guide = useMemo(
    () => (guideLeg ? routeCoordinates(guideLeg) : []),
    [guideLeg],
  );
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      mounted = false;
      listener.remove();
    };
  }, []);
  useEffect(() => {
    setTrackMarkers(true);
    const timer = setTimeout(() => setTrackMarkers(false), 650);
    return () => clearTimeout(timer);
  }, [selectedId, plan?.revision, ready]);
  useEffect(() => {
    if (!ready || !selectedId) return;
    const stop = plan?.stops.find((item) => item.placeId === selectedId);
    if (stop)
      map.current?.animateToRegion(
        areaRegion(stop.place.point, 650),
        reduced ? 0 : 450,
      );
  }, [ready, selectedId, plan, reduced]);
  useEffect(() => {
    if (ready && showUserLocation && userLocation && cameraFollowing)
      map.current?.animateToRegion(
        areaRegion(userLocation, 500),
        reduced ? 0 : 400,
      );
  }, [ready, showUserLocation, userLocation, cameraFollowing, reduced]);
  const fit = () => {
    setCameraFollowing(false);
    if (coordinates.length > 1)
      map.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: 65, right: 45, bottom: 80, left: 45 },
        animated: !reduced,
      });
    else if (area)
      map.current?.animateToRegion(
        areaRegion(area, areaRadius),
        reduced ? 0 : 450,
      );
  };
  if (!configured || !area)
    return (
      <View style={[style, styles.unavailable]} accessibilityRole="summary">
        <Text style={styles.title}>Map unavailable</Text>
        <Text style={styles.explanation}>
          {plan
            ? "Follow your stops and day details below."
            : "Search for a place or use Near me to keep exploring."}
        </Text>
      </View>
    );
  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={areaRegion(area, areaRadius)}
        onMapReady={() => {
          setReady(true);
          if (coordinates.length > 1)
            map.current?.fitToCoordinates(coordinates, {
              edgePadding: { top: 65, right: 45, bottom: 80, left: 45 },
              animated: false,
            });
        }}
        onPress={
          onSelectPoint
            ? (event) => {
                if (event.nativeEvent.action !== "marker-press")
                  onSelectPoint({
                    lat: event.nativeEvent.coordinate.latitude,
                    lng: event.nativeEvent.coordinate.longitude,
                  });
              }
            : undefined
        }
        showsUserLocation={showUserLocation}
        onPanDrag={() => setCameraFollowing(false)}
        showsMyLocationButton={false}
        showsCompass
        showsScale
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        customMapStyle={[
          { featureType: "poi.business", stylers: [{ visibility: "off" }] },
          {
            featureType: "landscape",
            elementType: "geometry",
            stylers: [{ color: "#F2F4EE" }],
          },
          {
            featureType: "water",
            elementType: "geometry",
            stylers: [{ color: "#C7E6EA" }],
          },
        ]}
      >
        <Circle
          center={mapCoordinate(area)}
          radius={areaRadius}
          strokeColor="#7358B6"
          strokeWidth={1.5}
          fillColor="rgba(184,164,245,0.09)"
        />
        {routes.map((route) => (
          <Polyline
            key={route.key}
            coordinates={route.coordinates}
            strokeColor={colors.ink}
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
          />
        ))}
        {guide.length > 1 ? (
          <Polyline
            coordinates={guide}
            strokeColor="#C54532"
            strokeWidth={5}
            lineCap="round"
          />
        ) : null}
        {plan?.stops.map((stop, index) => (
          <Marker
            key={stop.placeId}
            coordinate={mapCoordinate(stop.place.point)}
            title={`${index + 1}. ${stop.place.name}`}
            description={`${stop.minutes} min`}
            tracksViewChanges={trackMarkers}
            onPress={() => onSelectStop?.(stop.placeId)}
            zIndex={selectedId === stop.placeId ? 20 : 10}
          >
            <View
              style={[
                styles.marker,
                selectedId === stop.placeId && styles.selectedMarker,
              ]}
            >
              <Text style={styles.markerNumber}>{index + 1}</Text>
            </View>
          </Marker>
        ))}
        {!plan && onSelectPoint ? (
          <Marker
            coordinate={mapCoordinate(area)}
            pinColor="#C54532"
            title="Selected exploration area"
          />
        ) : null}
      </MapView>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show entire route"
          onPress={fit}
          style={styles.control}
        >
          <Text style={styles.controlText}>Fit route</Text>
        </Pressable>
        {userLocation ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recenter map on your location"
            onPress={() => {
              setCameraFollowing(true);
              map.current?.animateToRegion(
                areaRegion(userLocation, 500),
                reduced ? 0 : 450,
              );
            }}
            style={styles.control}
          >
            <Text style={styles.controlText}>My location</Text>
          </Pressable>
        ) : null}
      </View>
      {plan && plan.legs.some((leg) => !leg.verified) ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Some route segments are unavailable.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
export default RouteMap;
const styles = StyleSheet.create({
  container: {
    height: 320,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: colors.mint,
  },
  unavailable: {
    // Unavailable maps are notices, even when a caller reserves map height.
    height: "auto",
    minHeight: 0,
    flex: 0,
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "auto",
    aspectRatio: undefined,
    borderRadius: 18,
    backgroundColor: colors.mint,
    padding: 16,
    gap: 4,
  },
  title: { fontFamily: fonts.medium, color: colors.ink, fontSize: 16 },
  explanation: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontSize: 14,
    lineHeight: 21,
  },
  controls: { position: "absolute", top: 12, right: 12, gap: 8 },
  control: {
    minHeight: 44,
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  controlText: { color: colors.ink, fontFamily: fonts.medium, fontSize: 12 },
  marker: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  selectedMarker: { backgroundColor: "#C54532", transform: [{ scale: 1.15 }] },
  markerNumber: { color: colors.white, fontFamily: fonts.medium, fontSize: 14 },
  notice: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 60,
    borderRadius: 12,
    backgroundColor: colors.white,
    padding: 10,
  },
  noticeText: { color: colors.muted, fontSize: 12, fontFamily: fonts.body },
});
