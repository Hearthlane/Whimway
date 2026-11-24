import { useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { Placement, Surface } from "@shared/sponsored";
import type { Point } from "@shared/schema";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Icon, Press, T, tap } from "@/ui/kit";
import { color, radius, space } from "@/ui/theme";

/**
 * One clearly labelled sponsored placement for a surface, or nothing. Shown only when a
 * real campaign fits the place and category; counts a view once and a tap when opened.
 */
export function Sponsored({ surface, point, category }: { surface: Surface; point: Point; category?: string }) {
  const store = useStore();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const seen = useRef<string | null>(null);
  const key = `${surface}|${point.lat.toFixed(3)}|${point.lng.toFixed(3)}|${category ?? ""}`;

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ surface, lat: String(point.lat), lng: String(point.lng), ...(category ? { category } : {}) });
    api<Placement[]>(`sponsored?${q}`)
      .then((list) => live && setPlacement(list[0] ?? null))
      .catch(() => live && setPlacement(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const record = (kind: "impression" | "click") => {
    if (!placement || !store.installId) return;
    void api("sponsored/event", { placementId: placement.id, campaignId: placement.campaignId, kind, installId: store.installId }).catch(() => undefined);
  };
  useEffect(() => {
    if (placement && seen.current !== placement.id) {
      seen.current = placement.id;
      record("impression");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement]);

  if (!placement) return null;
  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Press
        testID={`sponsored-${surface}`}
        accessibilityRole="link"
        accessibilityLabel={`Sponsored by ${placement.business.name}. ${placement.headline}. ${placement.cta}`}
        scaleTo={0.985}
        onPress={() => {
          tap();
          record("click");
          void Linking.openURL(placement.url);
        }}
        style={s.card}
      >
        <View style={s.top}>
          <View style={s.label}>
            <T v="smallStrong" style={{ fontSize: 13 }} tone={color.muted}>
              Sponsored
            </T>
          </View>
          <T v="small" tone={color.muted} numberOfLines={1} style={{ flex: 1 }}>
            {placement.business.name}
          </T>
        </View>
        <T v="bodyStrong" style={{ fontSize: 17 }}>
          {placement.headline}
        </T>
        {placement.body ? (
          <T v="small" tone={color.inkSoft}>
            {placement.body}
          </T>
        ) : null}
        <View style={s.cta}>
          <T v="smallStrong" tone={color.coralText}>
            {placement.cta}
          </T>
          <Icon name="external-link" size={14} tint={color.coralText} />
        </View>
      </Press>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line, borderStyle: "dashed" },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  label: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.line },
  cta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
});
