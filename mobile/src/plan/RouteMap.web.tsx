import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";
import type { Itinerary, Point } from "@shared/schema";
import { API_URL } from "@/lib/config";
import { useStore } from "@/lib/store";
import { T } from "@/ui/kit";
import { color, font, radius } from "@/ui/theme";
import { bounds, mapModel } from "./map-model";

/**
 * Browser map. With a Google key on the server it shows a real Google map image with the
 * route and numbered stops; without one (or if the image fails) a schematic sketch, so the
 * app still works with no credentials. Native builds render an interactive map.
 */
export function RouteMap({ plan, selected, onSelect }: { plan: Itinerary; selected?: string; onSelect: (id: string) => void }) {
  const { status } = useStore();
  const [failed, setFailed] = useState(false);
  const model = useMemo(() => mapModel(plan), [plan]);
  const [tilesFailed, setTilesFailed] = useState(false);
  if (status?.tiles && !tilesFailed && !plan.demo) return <TileMap plan={plan} selected={selected} onSelect={onSelect} onError={() => setTilesFailed(true)} />;
  if (status?.staticMap && !failed && !plan.demo) return <GoogleMapImage plan={plan} onSelect={onSelect} onError={() => setFailed(true)} />;
  return <Sketch plan={plan} model={model} selected={selected} onSelect={onSelect} />;
}

// Web Mercator: world pixel coordinates at a zoom level, 256 px tiles.
const TILE = 256;
const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};

/**
 * A real Google map: tiles fetched through the server (key never in the browser), with
 * the route and numbered stops drawn on top, zoomed to fit the whole plan.
 */
function TileMap({ plan, selected, onSelect, onError }: { plan: Itinerary; selected?: string; onSelect: (id: string) => void; onError: () => void }) {
  const model = useMemo(() => mapModel(plan), [plan]);
  const [width, setWidth] = useState(600);
  const H = 260;
  const legendSpace = 40;
  const view = useMemo(() => {
    const pts = model.paths.flatMap((p) => p.points).concat(model.stops.map((s) => s.point));
    const b = bounds(pts.length ? pts : [plan.request.area.center]);
    // Largest zoom at which every stop and route fits, with room for pins and the legend.
    let z = 17;
    while (z > 3) {
      const w = worldX(b.maxLng, z) - worldX(b.minLng, z);
      const h = worldY(b.minLat, z) - worldY(b.maxLat, z);
      if (w <= width - 80 && h <= H - legendSpace - 70) break;
      z--;
    }
    const cx = (worldX(b.minLng, z) + worldX(b.maxLng, z)) / 2;
    const cy = (worldY(b.maxLat, z) + worldY(b.minLat, z)) / 2 + legendSpace / 2;
    const left = cx - width / 2;
    const top = cy - H / 2;
    const tiles: { x: number; y: number; px: number; py: number }[] = [];
    const n = 2 ** z;
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + H) / TILE); ty++)
      for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++)
        if (ty >= 0 && ty < n) tiles.push({ x: ((tx % n) + n) % n, y: ty, px: tx * TILE - left, py: ty * TILE - top });
    const at = (p: Point) => ({ x: worldX(p.lng, z) - left, y: worldY(p.lat, z) - top });
    return { z, tiles, at };
  }, [model, plan.request.area.center, width]);
  return (
    <View style={s.wrap} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width) || 600)} accessibilityLabel={`Map of ${model.stops.length} stops`}>
      {view.tiles.map((t) => (
        <Image
          key={`${view.z}/${t.x}/${t.y}/${t.px}`}
          source={{ uri: `${API_URL}/api/tiles/${view.z}/${t.x}/${t.y}` }}
          onError={onError}
          style={{ position: "absolute", left: t.px, top: t.py, width: TILE, height: TILE }}
          accessibilityIgnoresInvertColors
        />
      ))}
      <Svg width={width} height={H} style={StyleSheet.absoluteFill}>
        {model.paths.map((p, i) => (
          <Polyline
            key={i}
            points={p.points.map((pt) => { const q = view.at(pt); return `${q.x},${q.y}`; }).join(" ")}
            fill="none"
            stroke={color.ink}
            strokeWidth={4}
            strokeOpacity={0.85}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={p.verified ? undefined : "8 8"}
          />
        ))}
        {model.stops.map((st) => {
          const q = view.at(st.point);
          return (
            <G key={st.id} onPress={() => onSelect(st.id)}>
              <Circle cx={q.x} cy={q.y} r={14} fill={selected === st.id ? color.ink : color.coral} stroke={color.paper} strokeWidth={3} />
              <SvgText x={q.x} y={q.y + 5} fontSize={13} fontFamily={font.bodyBold} fontWeight="700" fill={selected === st.id ? color.paper : color.ink} textAnchor="middle">
                {String(st.n)}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      <View style={s.legend}>
        {model.stops.map((st) => (
          <Pressable key={st.id} onPress={() => onSelect(st.id)} accessibilityRole="button" accessibilityLabel={`Stop ${st.n}: ${st.name}`} style={s.legendItem}>
            <T v="smallStrong" style={{ fontSize: 13 }} numberOfLines={1}>
              {st.n}. {st.name}
            </T>
          </Pressable>
        ))}
      </View>
      <View style={s.credit} pointerEvents="none">
        <T v="small" style={{ fontSize: 13 }} tone={color.muted}>
          Map data ©{new Date().getFullYear()} Google
        </T>
      </View>
    </View>
  );
}

function GoogleMapImage({ plan, onSelect, onError }: { plan: Itinerary; onSelect: (id: string) => void; onError: () => void }) {
  const model = useMemo(() => mapModel(plan), [plan]);
  const src = useMemo(() => {
    const fmt = (p: Point) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    const paths = plan.stops.slice(1).map((s, i) => plan.legs.find((l) => l.from === plan.stops[i].placeId && l.to === s.placeId && l.verified)?.polyline ?? "");
    const q = new URLSearchParams({ stops: plan.stops.map((s) => fmt(s.place.point)).join(";"), w: "600", h: "260" });
    const joined = paths.join(" ");
    // Very long routes are drawn as straight lines rather than exceed the URL limit.
    if (joined.trim() && joined.length < 10000) q.set("paths", joined);
    return `${API_URL}/api/staticmap?${q}`;
  }, [plan]);
  return (
    <View style={s.wrap} accessibilityLabel={`Map of ${model.stops.length} stops`}>
      <Image source={{ uri: src }} onError={onError} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityIgnoresInvertColors />
      <View style={s.legend}>
        {model.stops.map((st) => (
          <Pressable key={st.id} onPress={() => onSelect(st.id)} accessibilityRole="button" accessibilityLabel={`Stop ${st.n}: ${st.name}`} style={s.legendItem}>
            <T v="smallStrong" style={{ fontSize: 13 }} numberOfLines={1}>
              {st.n}. {st.name}
            </T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Sketch({ plan, model, selected, onSelect }: { plan: Itinerary; model: ReturnType<typeof mapModel>; selected?: string; onSelect: (id: string) => void }) {
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
            <T v="smallStrong" style={{ fontSize: 13 }} numberOfLines={1}>
              {st.n}. {st.name}
            </T>
          </Pressable>
        ))}
      </View>
      <View style={s.note}>
        <T v="small" style={{ fontSize: 13 }}>
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
  credit: { position: "absolute", right: 8, top: 8, backgroundColor: "rgba(255,255,255,0.85)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  legendItem: { backgroundColor: color.paper, paddingHorizontal: 10, minHeight: 36, justifyContent: "center", borderRadius: radius.pill, maxWidth: 180 },
});
