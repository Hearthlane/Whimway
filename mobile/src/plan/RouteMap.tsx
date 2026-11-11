import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import type { Itinerary } from "@shared/schema";
import { T } from "@/ui/kit";
import { color, radius } from "@/ui/theme";
import { mapModel } from "./map-model";

/** Native map: Apple Maps on iOS, Google Maps on Android (needs an Android Maps key in app config). */
export function RouteMap({ plan, selected, onSelect }: { plan: Itinerary; selected?: string; onSelect: (id: string) => void }) {
  const model = useMemo(() => mapModel(plan), [plan]);
  const ref = useRef<MapView>(null);
  useEffect(() => {
    const coords = model.paths.flatMap((p) => p.points).concat(model.stops.map((s) => s.point));
    if (!coords.length) return;
    const t = setTimeout(
      () =>
        ref.current?.fitToCoordinates(
          coords.map((p) => ({ latitude: p.lat, longitude: p.lng })),
          { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: false },
        ),
      50,
    );
    return () => clearTimeout(t);
  }, [model]);
  const first = model.stops[0]?.point ?? plan.request.area.center;
  return (
    <View style={s.wrap} accessibilityLabel={`Map of ${model.stops.length} stops`}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: first.lat, longitude: first.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
      >
        {model.paths.map((p, i) => (
          <Polyline
            key={i}
            coordinates={p.points.map((x) => ({ latitude: x.lat, longitude: x.lng }))}
            strokeColor={color.ink}
            strokeWidth={4}
            lineDashPattern={p.verified ? undefined : [8, 8]}
          />
        ))}
        {model.stops.map((st) => (
          <Marker key={st.id} coordinate={{ latitude: st.point.lat, longitude: st.point.lng }} onPress={() => onSelect(st.id)} title={st.name} tracksViewChanges={false}>
            <View style={[s.pin, selected === st.id && s.pinOn]}>
              <T v="smallStrong" tone={selected === st.id ? color.paper : color.ink}>
                {st.n}
              </T>
            </View>
          </Marker>
        ))}
      </MapView>
      {model.paths.some((p) => !p.verified) ? (
        <View style={s.note}>
          <T v="small" style={{ fontSize: 11 }}>
            Dashed = estimated path
          </T>
        </View>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { height: 240, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: color.line, backgroundColor: color.mintTint },
  pin: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.coral, borderWidth: 3, borderColor: color.paper, alignItems: "center", justifyContent: "center" },
  pinOn: { backgroundColor: color.ink },
  note: { position: "absolute", left: 10, bottom: 10, backgroundColor: color.paper, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
});
