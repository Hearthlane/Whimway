import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";
import type { Itinerary } from "@shared/schema";
import { T } from "@/ui/kit";
import { color, font, radius } from "@/ui/theme";
import { bounds, mapModel } from "./map-model";

/**
 * Web fallback: a schematic route sketch (no map tiles, not to scale) so the app
 * stays credential-free in the browser. Native builds render a real map.
 */
export function RouteMap({ plan, selected, onSelect }: { plan: Itinerary; selected?: string; onSelect: (id: string) => void }) {
  const model = useMemo(() => mapModel(plan), [plan]);
  const W = 600;
  const H = 240;
  const pad = 40;
  const all = model.paths.flatMap((p) => p.points).concat(model.stops.map((s) => s.point));
  const b = bounds(all.length ? all : [plan.request.area.center]);
  const latSpan = Math.max(b.maxLat - b.minLat, 0.002);
  const lngSpan = Math.max(b.maxLng - b.minLng, 0.002);
  // Leave room at the bottom for the stop legend so pins are never covered.
  const legendSpace = 44;
  const k = Math.min((W - pad * 2) / lngSpan, (H - pad * 2 - legendSpace) / (latSpan * 1.38));
  const x = (lng: number) => W / 2 + (lng - (b.minLng + b.maxLng) / 2) * k;
  const y = (lat: number) => (H - legendSpace) / 2 - (lat - (b.minLat + b.maxLat) / 2) * k * 1.38;
  // Nudge pins that would overlap (venues in the same building) so each stays tappable.
  const pins: { x: number; y: number }[] = [];
  const pinAt = (pt: { lat: number; lng: number }) => {
    let px = x(pt.lng);
    let py = y(pt.lat);
    while (pins.some((q) => Math.hypot(q.x - px, q.y - py) < 30)) {
      px += 22;
      py -= 14;
    }
    pins.push({ x: px, y: py });
    return { px, py };
  };
  const placed = model.stops.map((st) => ({ ...st, ...pinAt(st.point) }));
  return (
    <View style={s.wrap} accessibilityLabel={`Route sketch of ${model.stops.length} stops, not to scale`}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <Rect x={0} y={0} width={W} height={H} fill={color.mintTint} />
        {Array.from({ length: 9 }, (_, i) => (
          <Line key={`v${i}`} x1={(i * W) / 8} y1={0} x2={(i * W) / 8} y2={H} stroke="#DCE6FB" strokeWidth={1} />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <Line key={`h${i}`} x1={0} y1={(i * H) / 4} x2={W} y2={(i * H) / 4} stroke="#DCE6FB" strokeWidth={1} />
        ))}
        {model.paths.map((p, i) => (
          <Polyline
            key={i}
            points={p.points.map((pt) => `${x(pt.lng)},${y(pt.lat)}`).join(" ")}
            fill="none"
            stroke={color.ink}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={p.verified ? undefined : "8 8"}
          />
        ))}
        {placed.map((st) => (
          <G key={st.id} onPress={() => onSelect(st.id)}>
            <Circle cx={st.px} cy={st.py} r={16} fill={selected === st.id ? color.ink : color.coral} stroke={color.paper} strokeWidth={3} />
            <SvgText x={st.px} y={st.py + 5} fontSize={14} fontFamily={font.bodyBold} fontWeight="700" fill={selected === st.id ? color.paper : color.ink} textAnchor="middle">
              {String(st.n)}
            </SvgText>
          </G>
        ))}
      </Svg>
      <View style={s.legend}>
        {model.stops.map((st) => (
          <Pressable key={st.id} onPress={() => onSelect(st.id)} accessibilityRole="button" accessibilityLabel={`Stop ${st.n}: ${st.name}`} style={s.legendItem}>
            <T v="smallStrong" style={{ fontSize: 11 }} numberOfLines={1}>
              {st.n}. {st.name}
            </T>
          </Pressable>
        ))}
      </View>
      <View style={s.note}>
        <T v="small" style={{ fontSize: 11 }}>
          Route sketch · not to scale
        </T>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { height: 240, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: color.line, backgroundColor: color.mintTint },
  note: { position: "absolute", right: 10, top: 10, backgroundColor: color.paper, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  legend: { position: "absolute", left: 10, bottom: 10, right: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  legendItem: { backgroundColor: color.paper, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, maxWidth: 180 },
});
