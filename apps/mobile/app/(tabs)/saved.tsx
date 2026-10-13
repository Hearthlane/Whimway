import React, { useCallback, useEffect, useState } from "react";
import { Text, View, Pressable, Linking } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Bookmark, Trash2, ArrowUpRight, Heart } from "lucide-react-native";
import { api } from "../../src/services/api";
import {
  getSavedPlans,
  savePlan,
  removePlan,
  getFavoritePlaces,
  removeFavoritePlace,
  type FavoritePlaceRef,
} from "../../src/services/storage";
import { getFavoritePlaceDetails } from "../../src/services/favorites";
import {
  Screen,
  styles,
  Button,
  Chip,
  Notice,
  Sheet,
  Reveal,
} from "../../src/components/ui";
import { PlacePhoto } from "../../src/components/PlacePhoto";
import { RouteArt } from "../../src/components/RouteArt";
import { useApp } from "../../src/state/AppState";
import { defaultStart } from "../../src/core/planning";
import { colors as c } from "../../src/design/theme";
import { safeUrl } from "../../../../lib/geo";
import type {
  CandidatePlace,
  Location,
  PlanSpec,
} from "../../../../lib/schema";

export default function Saved() {
  const [plans, setPlans] = useState<PlanSpec[]>([]),
    [favorites, setFavorites] = useState<FavoritePlaceRef[]>([]);
  const [cloud, setCloud] = useState<string[]>([]),
    [error, setError] = useState(""),
    [pending, setPending] = useState<PlanSpec>();
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [collection, setCollection] = useState<"plans" | "places">("plans");
  const [visiblePlaces, setVisiblePlaces] = useState(12);
  const { setDraft, preferences } = useApp();
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      let active = true;
      setLoading(true);
      setError("");
      setCloud([]);
      void (async () => {
        try {
          const [local, favoriteRefs] = await Promise.all([
            getSavedPlans(),
            getFavoritePlaces(),
          ]);
          if (!active) return;
          setPlans(local);
          setFavorites(favoriteRefs);
          const status = await api<{ user: unknown; cloud: boolean }>(
            "status",
            undefined,
            { signal: controller.signal },
          );
          if (status.user && status.cloud) {
            const rows = await api<{ spec: PlanSpec }[]>("plans", undefined, {
              signal: controller.signal,
            });
            if (!active) return;
            const map = new Map(local.map((p) => [p.id, p]));
            for (const row of rows) {
              if ((map.get(row.spec.id)?.revision ?? -1) < row.spec.revision) {
                await savePlan(row.spec);
                map.set(row.spec.id, row.spec);
              }
              if (!active) return;
            }
            setCloud(rows.map((r) => r.spec.id));
            setPlans([...map.values()]);
          }
        } catch (e) {
          if (active && !controller.signal.aborted)
            setError((e as Error).message);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
        controller.abort();
      };
    }, []),
  );
  async function remove() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      if (cloud.includes(pending.id))
        await api("plans/" + pending.id, undefined, { method: "DELETE" });
      await removePlan(pending.id);
      setPlans((rows) => rows.filter((p) => p.id !== pending.id));
      setPending(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function forget(ref: FavoritePlaceRef) {
    try {
      await removeFavoritePlace(ref);
      setFavorites((rows) =>
        rows.filter(
          (item) => item.placeId !== ref.placeId || item.demo !== ref.demo,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function explore(ref: FavoritePlaceRef) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const location = await api<Location>(
        "location?id=" +
          encodeURIComponent(
            ref.demo ? (ref.sourceLocationId ?? ref.placeId) : ref.placeId,
          ) +
          (ref.demo ? "&demo=true" : ""),
      );
      const useBudget =
        preferences?.enabled &&
        preferences.budgetCurrency === location.currency;
      setDraft({
        prompt: "",
        location,
        demo: ref.demo,
        known: [
          "location",
          ...(preferences?.enabled && preferences.interests.length
            ? ["interests"]
            : []),
          ...(useBudget ? ["budget"] : []),
        ],
        ...defaultStart(location),
        ...(preferences?.enabled
          ? {
              interests: preferences.interests,
              mode: preferences.mode,
              dietary: preferences.dietary,
              accessibility: preferences.accessibility,
              excludedPlaceIds: preferences.disliked,
            }
          : {}),
        ...(useBudget ? { budget: preferences!.budget } : {}),
      });
      router.push("/planner");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Text style={styles.eyebrow}>GOOD DAYS, KEPT CLOSE</Text>
      <Text style={[styles.title, { marginVertical: 20 }]}>
        A little collection{"\n"}of possibilities.
      </Text>
      <View style={[styles.row, { flexWrap: "wrap", marginBottom: 14 }]}>
        <Chip
          label={`Plans · ${plans.length}`}
          selected={collection === "plans"}
          onPress={() => setCollection("plans")}
        />
        <Chip
          label={`Favorite places · ${favorites.length}`}
          selected={collection === "places"}
          onPress={() => setCollection("places")}
        />
      </View>
      <Notice message={error} error />
      {loading ? (
        <Text style={styles.body}>Opening your collection…</Text>
      ) : null}
      {collection === "plans" ? (
        <>
          {!plans.length && !loading ? (
            <View style={{ gap: 22, marginTop: 12 }}>
              <RouteArt />
              <Text style={styles.heading}>Your next good day lives here.</Text>
              <Text style={styles.body}>
                Every generated plan saves on this device. An account keeps the
                plans you choose to sync.
              </Text>
              <Button
                title="Find my kind of day"
                onPress={() => router.push("/")}
              />
            </View>
          ) : null}
          {plans.map((plan, index) => (
            <Reveal key={plan.id} delay={Math.min(index * 60, 240)}>
              <View
                style={{
                  paddingVertical: 24,
                  borderBottomWidth: 1,
                  borderColor: c.line,
                  gap: 12,
                }}
              >
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 18,
                      backgroundColor: index % 2 ? c.lavender : c.mint,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Bookmark size={20} color={c.ink} />
                  </View>
                  <Text style={styles.eyebrow}>
                    {plan.demo
                      ? "DEVELOPMENT FIXTURE"
                      : cloud.includes(plan.id)
                        ? "ACCOUNT + DEVICE"
                        : "THIS DEVICE"}
                  </Text>
                  <Pressable
                    accessibilityLabel={"Delete " + plan.title}
                    accessibilityRole="button"
                    onPress={() => setPending(plan)}
                    style={{ padding: 12 }}
                  >
                    <Trash2 size={18} color={c.ink} />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/plan/" + plan.id)}
                  style={{ gap: 8 }}
                >
                  <Text style={styles.heading}>{plan.title}</Text>
                  <Text style={styles.body}>
                    {plan.request.date} · {plan.stops.length} stops
                  </Text>
                  <View style={styles.row}>
                    <Text style={styles.label}>Open my day</Text>
                    <ArrowUpRight size={18} color={c.ink} />
                  </View>
                </Pressable>
              </View>
            </Reveal>
          ))}
        </>
      ) : (
        <>
          {!favorites.length && !loading ? (
            <View style={{ gap: 16, paddingVertical: 24 }}>
              <Heart size={32} color={c.ink} />
              <Text style={styles.heading}>Keep the places that click.</Text>
              <Text style={styles.body}>
                Save a favorite from any stop’s menu. Current place details load
                when you reopen your collection.
              </Text>
            </View>
          ) : null}
          {favorites.slice(0, visiblePlaces).map((ref) => (
            <FavoritePlace
              key={`${ref.demo}-${ref.placeId}`}
              reference={ref}
              onRemove={() => void forget(ref)}
              onExplore={() => void explore(ref)}
              busy={busy}
            />
          ))}
          {favorites.length > visiblePlaces ? (
            <Button
              secondary
              title="Show more favorite places"
              onPress={() => setVisiblePlaces((n) => n + 12)}
            />
          ) : null}
        </>
      )}
      {plans.length || favorites.length ? (
        <View style={{ marginTop: 24 }}>
          <Button title="Plan something new" onPress={() => router.push("/")} />
        </View>
      ) : null}
      <Sheet
        visible={!!pending}
        title="Let this plan go?"
        onClose={() => setPending(undefined)}
      >
        <Text style={styles.body}>
          Deletes this device copy, any synced cloud copy and its share links.
          Reminders are cancelled. Favorite places stay in your collection.
        </Text>
        <Button title="Delete plan" busy={busy} onPress={() => void remove()} />
        <Button
          secondary
          title="Keep it"
          disabled={busy}
          onPress={() => setPending(undefined)}
        />
      </Sheet>
    </Screen>
  );
}

function FavoritePlace({
  reference,
  onRemove,
  onExplore,
  busy,
}: {
  reference: FavoritePlaceRef;
  onRemove: () => void;
  onExplore: () => void;
  busy: boolean;
}) {
  const [place, setPlace] = useState<CandidatePlace>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [details, setDetails] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void getFavoritePlaceDetails(reference, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setPlace(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [reference, retry]);
  const website = safeUrl(place?.website),
    maps = reference.demo ? undefined : safeUrl(place?.mapsUrl);
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderColor: c.line,
        paddingVertical: 24,
        gap: 12,
      }}
    >
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Heart size={21} color={c.ink} />
        <Text style={[styles.heading, { flex: 1 }]}>
          {place?.name ?? "Saved place"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"Remove favorite " + (place?.name ?? "place")}
          onPress={onRemove}
          style={{ padding: 12 }}
        >
          <Trash2 size={18} color={c.ink} />
        </Pressable>
      </View>
      {place ? (
        <>
          <Text style={styles.body}>
            {reference.demo ? "Synthetic development place" : place.category}
          </Text>
          <Button
            secondary
            title="View place"
            onPress={() => setDetails(true)}
          />
        </>
      ) : error ? (
        <>
          <Notice message={error} error />
          <Button
            secondary
            title="Refresh place details"
            onPress={() => setRetry((n) => n + 1)}
          />
        </>
      ) : (
        <Text style={styles.body}>Refreshing current place details…</Text>
      )}
      <Sheet
        visible={details}
        title={place?.name ?? "Saved place"}
        onClose={() => setDetails(false)}
      >
        {place ? (
          <>
            <PlacePhoto place={place} demo={reference.demo} />
            <Text style={styles.body}>{place.address}</Text>
            <Text style={styles.body}>
              {place.hours.length
                ? place.hours.join("\n")
                : "Hours unavailable. Check with the venue before going."}
            </Text>
            {website ? (
              <Button
                secondary
                title="Venue website"
                onPress={() =>
                  void Linking.openURL(website).catch((e) =>
                    setError(e.message),
                  )
                }
              />
            ) : null}
            {maps ? (
              <Button
                secondary
                title="View in Google Maps"
                onPress={() =>
                  void Linking.openURL(maps).catch((e) => setError(e.message))
                }
              />
            ) : null}
            <Button
              title="Plan around this place"
              busy={busy}
              onPress={() => {
                setDetails(false);
                onExplore();
              }}
            />
            <Text style={[styles.body, { fontSize: 12 }]}>
              Place details supplied by{" "}
              {reference.demo ? "development fixtures" : "Google Maps"}. Hours
              and availability can change.
            </Text>
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
