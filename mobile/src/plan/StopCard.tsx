import { Image } from "expo-image";
import { DateTime } from "luxon";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { safeUrl } from "@shared/geo";
import { stopDirectionsUrl } from "@shared/navigation";
import type { Itinerary, ItineraryStop } from "@shared/schema";
import { API_URL } from "@/lib/config";
import { money } from "@/lib/copy";
import { Badge, Icon, T, tap } from "@/ui/kit";
import { color, radius, space } from "@/ui/theme";

export function priceLabel(stop: ItineraryStop) {
  const p = stop.place.price;
  if (p.high === null) return "Price unknown";
  if (p.high === 0) return "Free";
  return p.low === p.high || p.low === null ? `~${money(p.high, p.currency)} pp` : `${money(p.low, p.currency)}–${money(p.high, p.currency)} pp`;
}

function HoursBadge({ stop }: { stop: ItineraryStop }) {
  if (stop.hoursConfidence === "applicable") return <Badge tone="mint" icon="check" label="Open then" />;
  if (stop.hoursConfidence === "typical") return <Badge tone="yellow" icon="clock" label="Usually open · confirm" />;
  return <Badge tone="coral" icon="help-circle" label="Hours unknown" />;
}

export function StopCard({
  plan,
  index,
  selected,
  isNew,
  onSelect,
  onToggleLock,
  onSwap,
  onOpenLink,
  onReact,
}: {
  plan: Itinerary;
  index: number;
  selected: boolean;
  isNew: boolean;
  onSelect: () => void;
  onToggleLock: () => void;
  onSwap: () => void;
  onOpenLink: (kind: "navigation" | "booking") => void;
  onReact: (value: 1 | -1) => void;
}) {
  const [reaction, setReaction] = useState<1 | -1 | null>(null);
  const reactTo = (value: 1 | -1) => {
    tap(value === 1 ? "success" : "select");
    setReaction(value);
    onReact(value);
  };
  const stop = plan.stops[index];
  const [open, setOpen] = useState(false);
  const zone = plan.request.location.timezone;
  const t = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("h:mm a");
  const photo = stop.place.photos[0];
  const website = safeUrl(stop.place.website);
  const previous = index > 0 ? plan.stops[index - 1].place.point : undefined;
  const directions = plan.demo ? stop.place.mapsUrl : stopDirectionsUrl({ point: stop.place.point, placeId: stop.placeId }, plan.request.mode, previous);
  const open_ = (url: string, kind: "navigation" | "booking") => {
    onOpenLink(kind);
    void Linking.openURL(url);
  };
  return (
    <Animated.View entering={isNew ? FadeIn.duration(500) : undefined} style={[s.card, selected && s.cardOn, isNew && s.cardNew]} testID={`stop-${index + 1}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Stop ${index + 1}, ${stop.place.name}, ${t(stop.arrival)} to ${t(stop.departure)}. ${open ? "Collapse" : "Expand"} details`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap("select");
          setOpen(!open);
          onSelect();
        }}
      >
        {photo ? (
          <View>
            <Image source={{ uri: `${API_URL}/api/photo?name=${encodeURIComponent(photo.name)}` }} style={s.photo} contentFit="cover" transition={250} accessibilityIgnoresInvertColors />
            {photo.authors[0] ? (
              <View style={s.credit}>
                <T v="small" tone={color.paper} style={{ fontSize: 10 }}>
                  Photo: {photo.authors[0].name}
                </T>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={s.body}>
          <View style={s.topRow}>
            <View style={[s.num, selected && { backgroundColor: color.ink }]}>
              <T v="smallStrong" tone={selected ? color.paper : color.ink}>
                {index + 1}
              </T>
            </View>
            <T v="smallStrong" tone={color.muted} style={{ flex: 1 }}>
              {t(stop.arrival)} – {t(stop.departure)}
            </T>
            {isNew ? <Badge tone="coral" icon="star" label="New" /> : null}
            {stop.locked ? <Badge tone="ink" icon="lock" label="Locked" /> : null}
          </View>
          <T v="heading" style={{ marginTop: space.sm }}>
            {stop.place.name}
          </T>
          <T v="small" tone={color.muted} style={{ marginTop: 2 }}>
            {stop.place.category[0].toUpperCase() + stop.place.category.slice(1)} · {priceLabel(stop)}
            {stop.place.rating && !plan.demo ? ` · ★ ${stop.place.rating.toFixed(1)}` : ""}
          </T>
          <T v="body" tone={color.inkSoft} style={{ marginTop: space.sm }} numberOfLines={open ? undefined : 2}>
            {stop.reason}
          </T>
          <View style={[s.row, { marginTop: space.md }]}>
            <HoursBadge stop={stop} />
          </View>
        </View>
      </Pressable>
      {open ? (
        <Animated.View entering={FadeIn.duration(200)} style={s.more}>
          <View style={s.fact}>
            <Icon name="clock" size={14} tint={color.muted} />
            <T v="small" tone={color.inkSoft} style={{ flex: 1 }}>
              {stop.hoursStatus}
              {stop.place.hours[0] ? ` — ${stop.place.hours.slice(0, 1).join("")}` : ""}
            </T>
          </View>
          <View style={s.fact}>
            <Icon name="map-pin" size={14} tint={color.muted} />
            <T v="small" tone={color.inkSoft} style={{ flex: 1 }}>
              {stop.place.address}
            </T>
          </View>
          <View style={s.fact}>
            <Icon name="tag" size={14} tint={color.muted} />
            <T v="small" tone={color.inkSoft} style={{ flex: 1 }}>
              {stop.place.price.high === null ? "No published price — confirm before going." : plan.demo ? "Demo price estimate." : "Published range, not a quote."} Plan for about {stop.minutes} min here.
            </T>
          </View>
          <View style={s.actions}>
            <Action icon="navigation" label={plan.demo ? "Find on Maps" : "Directions"} onPress={() => open_(directions, "navigation")} />
            {website ? <Action icon="external-link" label="Website / book" onPress={() => open_(website, "booking")} /> : null}
            <Action icon={stop.locked ? "unlock" : "lock"} label={stop.locked ? "Unlock" : "Keep this"} onPress={onToggleLock} />
            {!stop.locked ? <Action icon="refresh-cw" label="Swap it" onPress={onSwap} /> : null}
          </View>
          <View style={s.reactRow}>
            <T v="small" tone={color.muted} style={{ flex: 1 }}>
              {reaction === 1 ? "You’re into it — noted." : reaction === -1 ? "Not for you — we’ll skip it." : "Into this one?"}
            </T>
            <Pressable accessibilityRole="button" accessibilityLabel={`Into ${stop.place.name}`} accessibilityState={{ selected: reaction === 1 }} onPress={() => reactTo(1)} style={[s.thumb, reaction === 1 && { backgroundColor: color.mint }]} testID={`react-up-${index + 1}`}>
              <Icon name="thumbs-up" size={16} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Not for us: ${stop.place.name}`} accessibilityState={{ selected: reaction === -1 }} onPress={() => reactTo(-1)} style={[s.thumb, reaction === -1 && { backgroundColor: color.coralTint }]} testID={`react-down-${index + 1}`}>
              <Icon name="thumbs-down" size={16} />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function Action({ icon, label, onPress }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.action, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size={14} />
      <T v="smallStrong">{label}</T>
    </Pressable>
  );
}

export function TravelConnector({ minutes, meters, mode, verified }: { minutes: number; meters?: number; mode: Itinerary["request"]["mode"]; verified: boolean }) {
  const icon = mode === "WALK" ? "navigation" : mode === "TRANSIT" ? "git-commit" : "truck";
  const verb = mode === "WALK" ? "walk" : mode === "TRANSIT" ? "by transit" : "drive";
  return (
    <View style={s.connector} accessibilityLabel={`${minutes} minutes ${verb}`}>
      <View style={s.dash} />
      <View style={s.travelPill}>
        <Icon name={icon} size={13} tint={color.muted} />
        <T v="small" tone={color.muted}>
          {minutes} min {verb}
          {meters ? ` · ${(meters / 1000).toFixed(1)} km` : ""}
          {verified ? "" : " · est."}
        </T>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden" },
  cardOn: { borderColor: color.ink },
  cardNew: { borderColor: color.coral, borderWidth: 2 },
  photo: { width: "100%", height: 150, backgroundColor: color.mintTint },
  credit: { position: "absolute", right: 8, bottom: 8, backgroundColor: "rgba(25,38,48,0.6)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  body: { padding: space.lg },
  topRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: color.coral, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  more: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.md },
  fact: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.canvas },
  reactRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.line },
  thumb: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: color.line, alignItems: "center", justifyContent: "center", backgroundColor: color.paper },
  connector: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: 26, minHeight: 44 },
  dash: { position: "absolute", left: 30, top: 0, bottom: 0, width: 2, backgroundColor: color.line },
  travelPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: color.canvas, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginLeft: 20 },
});
