import { DateTime } from "luxon";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { Itinerary } from "@shared/schema";
import { modeCopy } from "@/lib/copy";
import { PlaceImage } from "@/plan/PlaceImage";
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
const length = (minutes: number) => (minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} hr` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`);
const fills = [color.coralTint, color.mintTint, color.lavenderTint];

/**
 * The plan as a day-planner page: start and end times down the left, one block per stop
 * sized by how long you're there, and the travel between them. Tapping a block selects
 * that stop on the map and in the details below.
 */
export function Timetable({ plan, selected, onSelect }: { plan: Itinerary; selected?: string; onSelect: (placeId: string) => void }) {
  const zone = plan.request.location.timezone;
  const at = (iso: string) => DateTime.fromISO(iso).setZone(zone);
  const verb = plan.request.mode === "TRANSIT" ? "by transit" : modeCopy[plan.request.mode].verb;
  return (
    <View testID="timetable">
      {plan.stops.map((stop, i) => {
        const from = at(stop.arrival);
        const to = at(stop.departure);
        const minutes = Math.max(15, Math.round(to.diff(from, "minutes").minutes));
        const next = plan.stops[i + 1];
        const on = selected === stop.placeId;
        return (
          <Animated.View key={stop.placeId} entering={FadeInDown.delay(120 + i * 90).duration(360)}>
            <View style={s.row}>
              <View style={s.times}>
                <View>
                  <T style={s.clock}>{from.toFormat("h:mm")}</T>
                  <T v="small" tone={color.muted} style={s.meridiem}>
                    {from.toFormat("a")}
                  </T>
                </View>
                <T v="small" tone={color.muted} style={s.end}>
                  {to.toFormat("h:mm")}
                </T>
              </View>
              <Press
                testID={`timetable-row-${i}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${from.toFormat("h:mm a")} to ${to.toFormat("h:mm a")}: ${activity(stop, from.hour)} at ${stop.place.name}`}
                scaleTo={0.985}
                onPress={() => onSelect(stop.placeId)}
                style={[s.block, { backgroundColor: fills[i % fills.length], minHeight: Math.min(190, 84 + minutes * 0.45) }, on && s.blockOn]}
              >
                <View style={s.text}>
                  <T style={s.doing}>{activity(stop, from.hour)}</T>
                  <T v="bodyStrong" numberOfLines={2} tone={color.inkSoft}>
                    {stop.place.name}
                  </T>
                  <T v="small" tone={color.muted} style={{ marginTop: "auto" }}>
                    {length(minutes)}
                  </T>
                </View>
                <PlaceImage place={stop.place} style={s.photo} />
              </Press>
            </View>
            {next ? (
              <View style={s.row} accessibilityLabel={`${next.travel} minutes ${verb}`}>
                <View style={s.times} />
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
  row: { flexDirection: "row", alignItems: "stretch", gap: space.md },
  times: { width: 58, justifyContent: "space-between", paddingVertical: 2 },
  clock: { fontFamily: font.displayBold, fontSize: 22, lineHeight: 24, letterSpacing: -0.6, color: color.ink, fontVariant: ["tabular-nums"] },
  meridiem: { fontSize: 12, lineHeight: 14 },
  end: { fontVariant: ["tabular-nums"] },
  block: { flex: 1, flexDirection: "row", gap: space.md, borderRadius: radius.lg, padding: space.md, borderWidth: 2, borderColor: "transparent" },
  blockOn: { borderColor: color.ink },
  text: { flex: 1, gap: 2 },
  doing: { fontFamily: font.displayBold, fontSize: 21, lineHeight: 24, letterSpacing: -0.5, color: color.ink },
  photo: { width: 76, alignSelf: "stretch", minHeight: 60, borderRadius: radius.md, backgroundColor: color.line },
  leg: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingLeft: space.md },
});
