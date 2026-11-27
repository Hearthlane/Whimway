import { DateTime } from "luxon";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { Itinerary } from "@shared/schema";
import { Button, Icon, Press, T, type IconName } from "@/ui/kit";
import { color, motion, radius, space, touch } from "@/ui/theme";

export type Arrange = "earlier" | "later" | "remove" | "longer" | "shorter";

/**
 * Customize: the person arranges the plan by hand. Move the whole plan earlier or later, set
 * how long each stop takes, reorder, remove or add stops. Every change goes back to the
 * server, which re-checks opening hours and travel and updates all the times.
 */
export function EditPanel({
  plan,
  busy,
  onShiftStart,
  onArrange,
  onAdd,
  onDone,
}: {
  plan: Itinerary;
  busy: boolean;
  onShiftStart: (minutes: number) => void;
  onArrange: (index: number, action: Arrange) => void;
  onAdd: () => void;
  onDone: () => void;
}) {
  const zone = plan.request.location.timezone;
  const t = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("h:mm a");
  const start = DateTime.fromISO(`${plan.request.date}T${plan.request.startTime}`, { zone });
  const count = plan.stops.length;
  return (
    <Animated.View entering={FadeIn.duration(motion.standard)} style={s.panel} testID="edit-panel">
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <T v="heading" accessibilityRole="header">
            Customize your plan
          </T>
          <T v="small" tone={color.muted}>
            Times, hours and travel update after each change.
          </T>
        </View>
        <Button kind="dark" label="Done" onPress={onDone} testID="edit-done" />
      </View>

      <View style={s.row}>
        <Icon name="clock" size={18} />
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">Start at {start.toFormat("h:mm a")}</T>
          <T v="small" tone={color.muted}>
            {start.toFormat("cccc d LLLL")}
          </T>
        </View>
        <Step icon="minus" label="Start 30 minutes earlier" disabled={busy} onPress={() => onShiftStart(-30)} testID="start-earlier" />
        <Step icon="plus" label="Start 30 minutes later" disabled={busy} onPress={() => onShiftStart(30)} testID="start-later" />
      </View>

      {plan.stops.map((stop, i) => (
        <View key={stop.placeId} style={s.stop} testID={`edit-stop-${i + 1}`}>
          <View style={s.stopTop}>
            <View style={s.num}>
              <T v="smallStrong">{i + 1}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" numberOfLines={1}>
                {stop.place.name}
              </T>
              <T v="small" tone={color.muted}>
                {t(stop.arrival)} – {t(stop.departure)}
                {stop.locked ? " · locked" : ""}
              </T>
            </View>
          </View>
          <View style={s.controls}>
            <View style={s.duration}>
              <Step icon="minus" label={`15 minutes less at ${stop.place.name}`} disabled={busy || stop.minutes <= 15} onPress={() => onArrange(i, "shorter")} testID={`shorter-${i + 1}`} />
              <T v="smallStrong" style={{ minWidth: 64, textAlign: "center" }}>
                {stop.minutes} min
              </T>
              <Step icon="plus" label={`15 minutes more at ${stop.place.name}`} disabled={busy || stop.minutes >= 180} onPress={() => onArrange(i, "longer")} testID={`longer-${i + 1}`} />
            </View>
            <View style={{ flex: 1 }} />
            <Step icon="arrow-up" label={`Move ${stop.place.name} earlier`} disabled={busy || i === 0} onPress={() => onArrange(i, "earlier")} testID={`up-${i + 1}`} />
            <Step icon="arrow-down" label={`Move ${stop.place.name} later`} disabled={busy || i === count - 1} onPress={() => onArrange(i, "later")} testID={`down-${i + 1}`} />
            <Step icon="trash-2" label={`Remove ${stop.place.name}`} disabled={busy || count <= 1} onPress={() => onArrange(i, "remove")} testID={`remove-${i + 1}`} />
          </View>
        </View>
      ))}

      <Button kind="soft" icon="plus" label="Add a stop" busy={busy} onPress={onAdd} testID="edit-add-stop" />
    </Animated.View>
  );
}

function Step({ icon, label, onPress, disabled, testID }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Press accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.step, disabled && { opacity: 0.35 }]} testID={testID}>
      <Icon name={icon} size={18} />
    </Press>
  );
}

const s = StyleSheet.create({
  panel: { gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 2, borderColor: color.ink },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.line },
  stop: { gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.line },
  stopTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: color.coral, alignItems: "center", justifyContent: "center" },
  controls: { flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" },
  duration: { flexDirection: "row", alignItems: "center", borderRadius: radius.pill, backgroundColor: color.canvas },
  step: { width: touch, height: touch, borderRadius: touch / 2, alignItems: "center", justifyContent: "center" },
});
