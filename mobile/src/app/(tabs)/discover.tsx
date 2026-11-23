import { router } from "expo-router";
import { DateTime } from "luxon";
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { areaByKey, areas, nearestArea } from "@shared/areas";
import { activities, cuisines } from "@shared/guide";
import { buildRequest, interpret } from "@shared/intent";
import type { CandidatePlace } from "@shared/schema";
import { api } from "@/lib/api";
import { money } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { PlaceImage } from "@/plan/PlaceImage";
import { Sponsored } from "@/plan/Sponsored";
import { Button, Chip, Icon, Notice, Press, Sheet, T, tap } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

/**
 * Browse real places by category or by what you type, in any beta area, open at the time
 * you pick. Any place can be saved, opened in Maps, or turned into a plan.
 */
const ZONE = "America/Toronto";
type Place = CandidatePlace & { meters: number };
type Sort = "closest" | "rated" | "cheapest";
const groups = [...activities, ...cuisines];
const whenOptions = [
  { key: "now", label: "Now" },
  { key: "tonight", label: "Tonight" },
  { key: "morning", label: "Tomorrow morning" },
  { key: "tomorrow", label: "Tomorrow evening" },
  { key: "weekend", label: "This weekend" },
] as const;
const km = (m: number) => (m < 950 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1)} km`);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function Discover() {
  const store = useStore();
  const { profile } = store;
  const [group, setGroup] = useState<string>(profile.interests.includes("Food & drinks") ? "sweet" : "games");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [areaKey, setAreaKey] = useState(profile.homeArea || "downtown");
  const [when, setWhen] = useState<(typeof whenOptions)[number]["key"]>("tonight");
  const [sort, setSort] = useState<Sort>("closest");
  const [result, setResult] = useState<{ key: string; places: Place[]; widened: boolean } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Place | null>(null);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  const request = useMemo(() => {
    const now = DateTime.now().setZone(ZONE);
    const area = areaByKey(areaKey) ?? areas[0];
    const base = buildRequest("", interpret("", now), profile, now, { area });
    const start =
      when === "now"
        ? now.plus({ minutes: 30 - (now.minute % 30) })
        : when === "tonight"
          ? now.set({ hour: Math.max(18, now.hour + 1), minute: 0 })
          : when === "morning"
            ? now.plus({ days: 1 }).set({ hour: 10, minute: 0 })
            : when === "weekend"
              ? (now.weekday >= 6 && now.hour < 15 ? now.plus({ hours: 1 }) : now.plus({ days: (6 - now.weekday + 7) % 7 || 7 })).set({ hour: now.weekday >= 6 && now.hour < 15 ? now.hour + 1 : 11, minute: 0 })
              : now.plus({ days: 1 }).set({ hour: 18, minute: 30 });
    const late = start.hour >= 23 || start.day !== now.day;
    const at = (when === "now" || when === "tonight") && late ? now.plus({ days: 1 }).set({ hour: 18, minute: 30 }) : start;
    return { ...base, date: at.toISODate()!, startTime: at.toFormat("HH:mm"), duration: 180, anchorPlaceIds: [] };
    // Re-derive when the person changes area or time, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, when, profile.budget, profile.mode]);

  const key = `${query ? `q:${query}` : group}|${areaKey}|${request.date}|${request.startTime}`;
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(async () => {
      setError("");
      try {
        const res = await api<{ places: Place[]; widened: boolean }>("guide/options", {
          request,
          group: query ? "custom" : group,
          text: query || undefined,
          // Browsing only needs places open when you'd arrive, and more of them.
          openFor: 60,
          limit: 12,
          demo: store.demo,
        });
        if (live) setResult({ key, ...res });
      } catch (e) {
        if (live) setError((e as Error).message || "Couldn’t load places.");
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const places = result?.key === key ? result.places : null;
  const sorted = useMemo(() => {
    if (!places) return null;
    const list = [...places];
    if (sort === "rated") list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    else if (sort === "cheapest") list.sort((a, b) => (a.price.high ?? 999) - (b.price.high ?? 999));
    else list.sort((a, b) => a.meters - b.meters);
    return list;
  }, [places, sort]);

  const search = () => {
    const q = typed.trim();
    if (q.length < 2) return;
    tap("select");
    setQuery(q);
    store.track("plan_requested", { words: q.split(/\s+/).length, edited: 0, discover: true });
  };
  const pickGroup = (key: string) => {
    tap("select");
    setQuery("");
    setTyped("");
    setGroup(key);
  };
  const isFavourite = (p: Place) => profile.favourites.some((f) => f.id === p.id);
  const toggleFavourite = (p: Place) => {
    const cat = p.category.toLowerCase().slice(0, 60);
    const has = isFavourite(p);
    store.setProfile({
      ...profile,
      favourites: has
        ? profile.favourites.filter((f) => f.id !== p.id)
        : [{ id: p.id, name: p.name.slice(0, 120), area: nearestArea(p.point)?.key, category: cat }, ...profile.favourites].slice(0, 100),
      affinity: has ? profile.affinity : { ...profile.affinity, [cat]: Math.min(3, (profile.affinity[cat] ?? 0) + 0.3) },
    });
  };
  const planAround = (p: Place) => {
    setOpen(null);
    store.setPending({ ...request, duration: 210, anchorPlaceIds: [p.id], excludedPlaceIds: profile.disliked.filter((id) => id !== p.id), prompt: `Plan something around ${p.name}` });
    store.track("plan_requested", { words: 0, edited: 0, anchored: true });
    router.push("/options");
  };
  const label = query ? `“${query}”` : groups.find((g) => g.key === group)?.label ?? "";
  const area = areaByKey(areaKey) ?? areas[0];

  return (
    <SafeAreaView style={s.page} edges={["top"]}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" stickyHeaderIndices={[1]}>
        <View style={{ gap: space.xs }}>
          <T v="hero" accessibilityRole="header">
            Discover
          </T>
          <T v="body" tone={color.muted}>
            Real places in {area.name}, open {when === "now" ? "right now" : when === "tonight" ? "tonight" : when === "morning" ? "tomorrow morning" : when === "weekend" ? "this weekend" : "tomorrow evening"}.
          </T>
        </View>

        <View style={s.sticky}>
          <View style={s.search}>
            <Icon name="search" size={18} tint={color.muted} />
            <TextInput
              ref={input}
              testID="discover-search"
              value={typed}
              onChangeText={setTyped}
              onSubmitEditing={search}
              returnKeyType="search"
              placeholder="Search ramen, bowling, a rooftop…"
              placeholderTextColor={color.faint}
              accessibilityLabel="Search places"
              maxLength={60}
              style={s.input}
            />
            {typed ? (
              <Press accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => (setTyped(""), setQuery(""))} hitSlop={8}>
                <Icon name="x" size={16} tint={color.muted} />
              </Press>
            ) : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.row}>
            {groups.map((g) => (
              <Chip key={g.key} testID={`discover-cat-${g.key}`} label={g.label} selected={!query && group === g.key} onPress={() => pickGroup(g.key)} />
            ))}
          </ScrollView>
        </View>

        <View style={{ gap: space.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.row}>
            {whenOptions.map((w) => (
              <Chip key={w.key} icon="clock" label={w.label} selected={when === w.key} onPress={() => setWhen(w.key)} testID={`discover-when-${w.key}`} />
            ))}
            <View style={s.divider} />
            {areas.map((a) => (
              <Chip key={a.key} icon="map-pin" label={a.name} selected={areaKey === a.key} onPress={() => setAreaKey(a.key)} />
            ))}
          </ScrollView>
        </View>

        <View style={s.head}>
          <T v="heading" numberOfLines={1} style={{ flex: 1 }}>
            {label}
          </T>
          <View style={s.sorts}>
            {(["closest", "rated", "cheapest"] as const).map((k) => (
              <Press key={k} accessibilityRole="button" accessibilityState={{ selected: sort === k }} onPress={() => setSort(k)} style={[s.sort, sort === k && s.sortOn]} testID={`discover-sort-${k}`}>
                <T v="smallStrong" tone={sort === k ? color.paper : color.muted}>
                  {k === "closest" ? "Closest" : k === "rated" ? "Top rated" : "Cheapest"}
                </T>
              </Press>
            ))}
          </View>
        </View>

        {error ? (
          <View style={{ gap: space.md }}>
            <Notice tone="coral" icon="wifi-off">
              {error}
            </Notice>
            <Button kind="soft" label="Try again" icon="refresh-cw" onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : !sorted ? (
          <View style={{ gap: space.md }} accessibilityLabel="Finding places">
            {[0, 1, 2, 3].map((i) => (
              <Animated.View key={i} entering={FadeIn.delay(i * 80).duration(300)} style={s.skeleton} />
            ))}
          </View>
        ) : !sorted.length ? (
          <View style={s.empty}>
            <Icon name="compass" size={28} tint={color.muted} />
            <T v="bodyStrong">Nothing like that is open then</T>
            <T v="small" tone={color.muted} style={{ textAlign: "center" }}>
              Try another time, a nearby area, or a different word.
            </T>
            <Button kind="soft" label="Search again" onPress={() => input.current?.focus()} />
          </View>
        ) : (
          <View style={{ gap: space.md }}>
            {result?.widened && sorted[0].meters > 4000 ? <Notice icon="map">Not much close by, so these are a little farther out.</Notice> : null}
            {sorted.map((p, i) => (
              <Animated.View key={p.id} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(300)} style={{ gap: space.md }}>
                <Press testID={`discover-place-${i}`} accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.category}, ${km(p.meters)} away`} scaleTo={0.985} onPress={() => setOpen(p)} style={s.place}>
                  <PlaceImage place={p} chosen={query ? undefined : group} style={s.photo} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <T v="bodyStrong" numberOfLines={1} style={{ fontSize: 16 }}>
                      {p.name}
                    </T>
                    <T v="small" tone={color.muted} numberOfLines={1}>
                      {cap(p.category)}
                    </T>
                    <View style={s.facts}>
                      <T v="smallStrong">{km(p.meters)}</T>
                      <View style={s.dot} />
                      <T v="smallStrong">{p.price.high == null ? "Price varies" : p.price.high === 0 ? "Free" : `${money(p.price.low ?? 0)}–${money(p.price.high)}`}</T>
                      {p.rating ? (
                        <>
                          <View style={s.dot} />
                          <Icon name="star" size={12} tint={color.warning} />
                          <T v="smallStrong">{p.rating.toFixed(1)}</T>
                        </>
                      ) : null}
                    </View>
                  </View>
                  {isFavourite(p) ? <Icon name="heart" size={16} tint={color.coralText} /> : <Icon name="chevron-right" size={18} tint={color.faint} />}
                </Press>
                {i === 2 ? <Sponsored surface="discover" point={request.area.center} category={query ? undefined : group} /> : null}
              </Animated.View>
            ))}
            {sorted.some((p) => !p.photos[0]) ? (
              <T v="small" tone={color.faint} style={{ textAlign: "center" }}>
                Some photos show the kind of place, not the venue itself.
              </T>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open?.name ?? ""}>
        {open ? (
          <View style={{ gap: space.lg }}>
            <PlaceImage place={open} chosen={query ? undefined : group} style={s.hero} />
            <View style={{ gap: space.xs }}>
              <T v="body" tone={color.muted}>
                {cap(open.category)} · {km(open.meters)} away
              </T>
              {open.address && !open.address.startsWith("Demo") ? (
                <T v="small" tone={color.muted}>
                  {open.address}
                </T>
              ) : null}
              <T v="small" tone={color.muted}>
                {[open.rating ? `★ ${open.rating.toFixed(1)}${open.reviews ? ` from ${open.reviews.toLocaleString()} reviews` : ""}` : "", open.price.high == null ? "Price varies" : open.price.high === 0 ? "Free" : `${money(open.price.low ?? 0)}–${money(open.price.high)} per person`].filter(Boolean).join(" · ")}
              </T>
              {open.hours.find((h) => h.startsWith(DateTime.fromISO(request.date).toFormat("cccc"))) ? (
                <T v="small" tone={color.muted}>
                  {open.hours.find((h) => h.startsWith(DateTime.fromISO(request.date).toFormat("cccc")))}
                </T>
              ) : null}
            </View>
            <Button testID="discover-plan-around" label="Plan around this place" icon="arrow-right" onPress={() => planAround(open)} />
            <View style={s.actions}>
              <Button kind="soft" label={isFavourite(open) ? "Saved" : "Save place"} icon="heart" onPress={() => toggleFavourite(open)} style={{ flex: 1 }} />
              <Button kind="soft" label="Open in Maps" icon="map" onPress={() => void Linking.openURL(open.mapsUrl)} style={{ flex: 1 }} />
            </View>
            {open.website ? <Button kind="ghost" label="Website" icon="external-link" onPress={() => void Linking.openURL(open.website!)} /> : null}
            <T v="small" tone={color.faint}>
              Hours and prices come from the listing and can change. Check before you go.
            </T>
          </View>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.canvas },
  body: { padding: space.xl, paddingTop: space.lg, gap: space.lg, maxWidth: 640, width: "100%", alignSelf: "center", paddingBottom: space.xxxl },
  sticky: { gap: space.md, backgroundColor: color.canvas, paddingVertical: space.sm },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: color.paper, borderWidth: 1.5, borderColor: color.line },
  input: { flex: 1, fontFamily: font.body, fontSize: 16, color: color.ink, paddingVertical: space.sm },
  bleed: { marginHorizontal: -space.xl },
  row: { gap: space.sm, paddingHorizontal: space.xl, alignItems: "center" },
  divider: { width: 1, height: 24, backgroundColor: color.line, marginHorizontal: space.xs },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  sorts: { flexDirection: "row", gap: 4, backgroundColor: color.paper, borderRadius: radius.pill, padding: 3, borderWidth: 1, borderColor: color.line },
  sort: { paddingHorizontal: space.md, minHeight: 32, justifyContent: "center", borderRadius: radius.pill },
  sortOn: { backgroundColor: color.ink },
  place: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, paddingRight: space.lg, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  photo: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: color.line },
  hero: { width: "100%", height: 180, borderRadius: radius.lg, backgroundColor: color.line },
  facts: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: color.faint },
  skeleton: { height: 100, borderRadius: radius.lg, backgroundColor: color.line, opacity: 0.6 },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: space.xxl },
  actions: { flexDirection: "row", gap: space.sm },
});
