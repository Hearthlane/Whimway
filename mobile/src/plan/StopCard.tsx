import { Image } from "expo-image";
import { DateTime } from "luxon";
import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeInDown, LinearTransition, ZoomIn } from "react-native-reanimated";
import { safeUrl } from "@shared/geo";
import { stopDirectionsUrl } from "@shared/navigation";
import type { Itinerary, ItineraryStop } from "@shared/schema";
import { API_URL } from "@/lib/config";
import { money } from "@/lib/copy";
import { Badge, Icon, Press, T, tap, type IconName } from "@/ui/kit";
import { color, motion, radius, shadow, space } from "@/ui/theme";
import { StopArt } from "./StopArt";

export function priceLabel(stop: ItineraryStop) {
  const p = stop.place.price;
  if (p.high === null) return "Price unknown";
  if (p.high === 0) return "Free";
  return p.low === p.high || p.low === null ? `about ${money(p.high, p.currency)} each` : `${money(p.low, p.currency)}–${money(p.high, p.currency)} each`;
}

function HoursBadge({ stop }: { stop: ItineraryStop }) {
  if (stop.hoursConfidence === "applicable") return <Badge tone="mint" icon="check" label="Open then" />;
  if (stop.hoursConfidence === "typical") return <Badge tone="yellow" icon="clock" label="Usually open, confirm" />;
  return <Badge tone="coral" icon="help-circle" label="Hours unknown" />;
}

export type Leg = { minutes: number; meters?: number; verified: boolean };

export function StopCard({
  plan,
  index,
  selected,
  isNew,
  nextLeg,
  onSelect,
  onToggleLock,
  onSwap,
  onOpenLink,
  onReact,
  favourite,
  onFavourite,
  onBook,
  crowd,
}: {
  plan: Itinerary;
  index: number;
  selected: boolean;
  isNew: boolean;
  /** Travel from this stop to the next one; absent on the last stop. */
  nextLeg?: Leg;
  onSelect: () => void;
  onToggleLock: () => void;
  onSwap: () => void;
  onOpenLink: (kind: "navigation" | "booking") => void;
  onReact: (value: 1 | -1) => void;
  favourite: boolean;
  onFavourite: () => void;
  /** Opens the booking options for this stop. */
  onBook: () => void;
  /** Community rating for this venue (only present once 5+ people have reacted). */
  crowd?: { up: number; down: number };
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
  const mode = plan.request.mode;
  const verb = mode === "WALK" ? "walk" : mode === "TRANSIT" ? "by transit" : "drive";
  const category = stop.place.category[0].toUpperCase() + stop.place.category.slice(1);

  return (
    <Animated.View
      // One orchestrated reveal: stops arrive in order along the route.
      entering={isNew ? ZoomIn.duration(motion.standard) : FadeInDown.delay(120 + index * 110).duration(motion.slow)}
      layout={LinearTransition.duration(motion.standard)}
      style={s.row}
      testID={`stop-${index + 1}`}
    >
      <View style={s.rail}>
        <View style={[s.node, selected && s.nodeOn]}>
          <T v="smallStrong" tone={selected ? color.paper : color.ink}>
            {index + 1}
          </T>
        </View>
        {nextLeg ? <View style={s.railLine} /> : null}
      </View>

      <View style={{ flex: 1, paddingBottom: nextLeg ? space.sm : 0 }}>
        <View style={s.timeRow}>
          <T v="bodyStrong">{t(stop.arrival)}</T>
          <T v="small" tone={color.muted} style={{ flex: 1 }}>
            until {t(stop.departure)}
          </T>
          {isNew ? <Badge tone="coral" icon="star" label="New" /> : null}
          {stop.locked ? <Badge tone="ink" icon="lock" label="Kept" /> : null}
        </View>

        <View style={[s.card, selected && s.cardOn, isNew && s.cardNew]}>
          <Press
            scaleTo={0.985}
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
            ) : (
              <StopArt place={stop.place} height={104} />
            )}
            {favourite ? (
              <View style={s.heart}>
                <Icon name="heart" size={14} tint={color.coralText} />
              </View>
            ) : null}
            <View style={s.body}>
              <T v="heading">{stop.place.name}</T>
              <T v="small" tone={color.muted} style={{ marginTop: 2 }}>
                {category}, {priceLabel(stop)}
                {stop.place.rating && !plan.demo ? `, rated ${stop.place.rating.toFixed(1)}` : ""}
              </T>
              <T v="body" tone={color.inkSoft} style={{ marginTop: space.sm }} numberOfLines={open ? undefined : 2}>
                {stop.reason}
              </T>
              {crowd && crowd.up + crowd.down >= 5 ? (
                <View style={s.crowd} testID={`crowd-${index + 1}`}>
                  <Icon name="users" size={13} tint={color.success} />
                  <T v="small" tone={color.success}>
                    {Math.round((crowd.up / (crowd.up + crowd.down)) * 100)}% of {crowd.up + crowd.down} people on Whimway liked this
                  </T>
                </View>
              ) : null}
              <View style={s.footRow}>
                <HoursBadge stop={stop} />
                <View style={{ flex: 1 }} />
                <T v="small" tone={color.muted}>
                  {open ? "Less" : "Details"}
                </T>
                <Icon name={open ? "chevron-up" : "chevron-down"} size={16} tint={color.muted} />
              </View>
            </View>
          </Press>

          {open ? (
            <Animated.View entering={FadeIn.duration(motion.standard)} style={s.more}>
              <Fact icon="clock">
                {stop.hoursStatus}
                {stop.place.hours[0] ? `. ${stop.place.hours[0]}` : ""}
              </Fact>
              <Fact icon="map-pin">{stop.place.address}</Fact>
              <Fact icon="tag">
                {stop.place.price.high === null ? "No published price. Confirm before going." : plan.demo ? "Demo price estimate." : "Published range, not a quote."} Plan for about {stop.minutes} minutes here.
              </Fact>
              <View style={s.actions}>
                <Action icon="calendar" label="Book or go" onPress={onBook} primary />
                <Action icon="heart" label={favourite ? "Saved place" : "Save place"} onPress={onFavourite} active={favourite} />
                <Action icon={stop.locked ? "unlock" : "lock"} label={stop.locked ? "Unlock" : "Keep this"} onPress={onToggleLock} />
                {!stop.locked ? <Action icon="refresh-cw" label="Swap it" onPress={onSwap} /> : null}
              </View>
              <View style={s.reactRow}>
                <T v="small" tone={color.muted} style={{ flex: 1 }}>
                  {reaction === 1 ? "You’re into it. Noted." : reaction === -1 ? "Not for you. We’ll skip it." : "Into this one?"}
                </T>
                <Press scaleTo={0.85} accessibilityRole="button" accessibilityLabel={`Into ${stop.place.name}`} accessibilityState={{ selected: reaction === 1 }} onPress={() => reactTo(1)} style={[s.thumb, reaction === 1 && { backgroundColor: color.mint, borderColor: color.mint }]} testID={`react-up-${index + 1}`}>
                  <Icon name="thumbs-up" size={16} />
                </Press>
                <Press scaleTo={0.85} accessibilityRole="button" accessibilityLabel={`Not for us: ${stop.place.name}`} accessibilityState={{ selected: reaction === -1 }} onPress={() => reactTo(-1)} style={[s.thumb, reaction === -1 && { backgroundColor: color.coralTint, borderColor: color.coral }]} testID={`react-down-${index + 1}`}>
                  <Icon name="thumbs-down" size={16} />
                </Press>
              </View>
            </Animated.View>
          ) : null}
        </View>

        {nextLeg ? (
          <View style={s.leg} accessibilityLabel={`Then ${nextLeg.minutes} minutes ${verb}`}>
            <Icon name={mode === "WALK" ? "navigation" : mode === "TRANSIT" ? "git-commit" : "truck"} size={13} tint={color.muted} />
            <T v="small" tone={color.muted}>
              {nextLeg.minutes} min {verb}
              {nextLeg.meters ? `, ${(nextLeg.meters / 1000).toFixed(1)} km` : ""}
              {nextLeg.verified ? "" : " (estimate)"}
            </T>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function Fact({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <View style={s.fact}>
      <Icon name={icon} size={14} tint={color.muted} />
      <T v="small" tone={color.inkSoft} style={{ flex: 1 }}>
        {children}
      </T>
    </View>
  );
}

function Action({ icon, label, onPress, active, primary }: { icon: IconName; label: string; onPress: () => void; active?: boolean; primary?: boolean }) {
  return (
    <Press accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} style={[s.action, active && { backgroundColor: color.coralTint, borderColor: color.coral }, primary && { backgroundColor: color.ink, borderColor: color.ink }]}>
      <Icon name={icon} size={14} tint={primary ? color.paper : active ? color.coralText : color.ink} />
      <T v="smallStrong" tone={primary ? color.paper : color.ink}>
        {label}
      </T>
    </Press>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md },
  rail: { width: 32, alignItems: "center" },
  node: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.coral, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: color.canvas },
  nodeOn: { backgroundColor: color.ink },
  railLine: { flex: 1, width: 2, backgroundColor: color.line, marginVertical: 2, borderRadius: 1 },
  timeRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm, minHeight: 32, paddingTop: 5, marginBottom: space.sm },
  card: { backgroundColor: color.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden", ...shadow.card },
  cardOn: { borderColor: color.ink },
  cardNew: { borderColor: color.coral, borderWidth: 2 },
  photo: { width: "100%", height: 150, backgroundColor: color.mintTint },
  credit: { position: "absolute", right: 8, bottom: 8, backgroundColor: "rgba(25,38,48,0.6)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  heart: { position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: color.paper, alignItems: "center", justifyContent: "center" },
  body: { padding: space.lg },
  crowd: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space.sm },
  footRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: space.md },
  more: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.md },
  fact: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.canvas },
  reactRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.line },
  thumb: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: color.line, alignItems: "center", justifyContent: "center", backgroundColor: color.paper },
  leg: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: space.md, paddingLeft: 4 },
});
