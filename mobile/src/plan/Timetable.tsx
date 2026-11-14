import { DateTime } from "luxon";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { Itinerary } from "@shared/schema";
import { modeCopy } from "@/lib/copy";
import { artKind } from "@/plan/StopArt";
import { Icon, Press, T } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

/** What you do at a stop, in a word: "Dinner", "Games", "A walk". */
function activity(stop: Itinerary["stops"][number], hour: number) {
  const kind = artKind(stop.place);
  // A games bar is where you go to play, even though it also pours drinks.
  if (/game|arcade|bowling|amusement_center|karaoke|escape/.test(stop.place.types.join(" "))) return "Games";
  if (kind === "meal") return hour < 11 ? "Breakfast" : hour < 16 ? "Lunch" : "Dinner";
  if (kind === "drinks") return "Drinks";
  if (kind === "cafe") return "Coffee";
  if (kind === "sweet") return "Dessert";
  if (kind === "outdoors") return "A walk";
  if (kind === "play") return "Games";
  if (kind === "shop") return "Browse";
  return stop.place.category[0].toUpperCase() + stop.place.category.slice(1);
}

/**
 * The plan as a timetable: each stop is a time range and what you do there, joined by a
 * rail with the travel between them. Tapping a row selects that stop on the map and below.
 */
export function Timetable({ plan, selected, onSelect }: { plan: Itinerary; selected?: string; onSelect: (placeId: string) => void }) {
  const zone = plan.request.location.timezone;
  const at = (iso: string) => DateTime.fromISO(iso).setZone(zone);
  const verb = plan.request.mode === "TRANSIT" ? "by transit" : modeCopy[plan.request.mode].verb;
  return (
    <View style={s.card} testID="timetable">
      {plan.stops.map((stop, i) => {
        const from = at(stop.arrival);
        const to = at(stop.departure);
        const next = plan.stops[i + 1];
        const on = selected === stop.placeId;
        return (
          <Animated.View key={stop.placeId} entering={FadeInDown.delay(120 + i * 90).duration(360)}>
            <Press
              testID={`timetable-row-${i}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${from.toFormat("h:mm a")} to ${to.toFormat("h:mm a")}: ${activity(stop, from.hour)} at ${stop.place.name}`}
              scaleTo={0.99}
              onPress={() => onSelect(stop.placeId)}
              style={s.row}
            >
              <View style={s.time}>
                <T style={s.clock}>{from.toFormat("h:mm")}</T>
                <T v="small" tone={color.muted} style={s.until}>
                  to {to.toFormat("h:mm a")}
                </T>
              </View>
              <View style={s.rail}>
                <View style={[s.node, on && s.nodeOn]} />
                {next ? <View style={s.solid} /> : null}
              </View>
              <View style={s.what}>
                <T v="small" tone={color.muted}>
                  {activity(stop, from.hour)}
                </T>
                <T v="bodyStrong" style={{ fontSize: 17, lineHeight: 22 }} numberOfLines={2}>
                  {stop.place.name}
                </T>
              </View>
            </Press>
            {next ? (
              <View style={s.row} accessibilityLabel={`${next.travel} minutes ${verb}`}>
                <View style={s.time} />
                <View style={s.rail}>
                  <View style={s.dashed} />
                </View>
                <View style={s.leg}>
                  <Icon name={modeCopy[plan.request.mode].icon} size={13} tint={color.muted} />
                  <T v="small" tone={color.muted}>
                    {next.travel} min {verb}
                  </T>
                </View>
              </View>
            ) : null}
          </Animated.View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.paper, borderRadius: radius.xl, borderWidth: 1, borderColor: color.line, paddingVertical: space.lg, paddingHorizontal: space.lg },
  row: { flexDirection: "row", alignItems: "stretch" },
  time: { width: 86, paddingTop: 1 },
  clock: { fontFamily: font.displayBold, fontSize: 24, lineHeight: 26, letterSpacing: -0.6, color: color.ink, fontVariant: ["tabular-nums"] },
  until: { fontVariant: ["tabular-nums"] },
  rail: { width: 28, alignItems: "center" },
  node: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: color.ink, backgroundColor: color.paper, marginTop: 7 },
  nodeOn: { backgroundColor: color.coral },
  solid: { flex: 1, width: 3, backgroundColor: color.ink, marginTop: 2, minHeight: 24 },
  dashed: { flex: 1, width: 0, borderLeftWidth: 3, borderLeftColor: color.line, borderStyle: "dashed", minHeight: 36 },
  what: { flex: 1, paddingLeft: space.sm, paddingBottom: space.md, gap: 1 },
  leg: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: space.sm },
});
