import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View, Pressable, Linking } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Bookmark, Trash2, ArrowUpRight, Heart } from "lucide-react-native";
import { api } from "../../src/services/api";
import { getAuthClient } from "../../src/services/auth";
import {
  collectionAccount,
  collectionDeleted,
  collectionSynced,
  deleteSavedCollectionPlan,
  emptyCloudCollection,
  syncedAccountForPlan,
  type CloudCollection,
  type CloudStatus,
} from "../../src/core/cloud-collection";
import {
  getSavedPlans,
  savePlan,
  saveRecoveredPlan,
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
import { applySavedPreferences, defaultStart } from "../../src/core/planning";
import {
  canUnlockSavedStops,
  unlockedSavedStops,
} from "../../src/core/saved-recovery";
import { referenceOnlyPlan } from "../../src/services/storage-core";
import { colors as c } from "../../src/design/theme";
import { safeUrl } from "../../../../lib/geo";
import type {
  CandidatePlace,
  Location,
  PlanSpec,
  Itinerary,
} from "../../../../lib/schema";

export default function Saved() {
  const [plans, setPlans] = useState<PlanSpec[]>([]),
    [favorites, setFavorites] = useState<FavoritePlaceRef[]>([]);
  const [cloud, setCloud] = useState<CloudCollection>(emptyCloudCollection),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState<{ plan: PlanSpec; accountId?: string }>();
  const cloudRef = useRef(cloud),
    refresh = useRef<AbortController | null>(null),
    deletion = useRef<AbortController | null>(null),
    exploring = useRef<AbortController | null>(null),
    authEpoch = useRef(0),
    exploreGeneration = useRef(0);
  const [authRevision, setAuthRevision] = useState(0);
  const updateCloud = useCallback(
    (change: (previous: CloudCollection) => CloudCollection) => {
      const next = change(cloudRef.current);
      cloudRef.current = next;
      setCloud(next);
    },
    [],
  );
  const applyCloudStatus = useCallback(
    (status: CloudStatus) => {
      const nextId = status.user?.id ?? null;
      if (
        cloudRef.current.accountId !== undefined &&
        cloudRef.current.accountId !== nextId
      ) {
        deletion.current?.abort();
        setPending(undefined);
        setMessage("");
      }
      updateCloud((previous) => collectionAccount(previous, status));
    },
    [updateCloud],
  );
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [collection, setCollection] = useState<"plans" | "places">("plans");
  const [visiblePlaces, setVisiblePlaces] = useState(12);
  const [openingId, setOpeningId] = useState<string>();
  const [canCancelOpening, setCanCancelOpening] = useState(false);
  const [recovery, setRecovery] = useState<PlanSpec>();
  const opening = useRef<AbortController | null>(null),
    focused = useRef(false);
  const openGeneration = useRef(0);
  const { setDraft, setPlan, preferences } = useApp();
  useEffect(() => {
    const auth = getAuthClient();
    const subscription = auth?.auth.onAuthStateChange((_event, session) => {
      const accountId = session?.user.id ?? null;
      if (cloudRef.current.accountId === accountId) return;
      deletion.current?.abort();
      refresh.current?.abort();
      setPending(undefined);
      setMessage("");
      updateCloud((previous) =>
        collectionAccount(previous, {
          user: accountId ? { id: accountId } : null,
          cloud: previous.enabled,
        }),
      );
      authEpoch.current++;
      setAuthRevision(authEpoch.current);
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, [updateCloud]);
  useFocusEffect(
    useCallback(() => {
      if (authRevision !== authEpoch.current) return;
      const controller = new AbortController();
      refresh.current = controller;
      let active = true;
      focused.current = true;
      setLoading(true);
      setError("");
      setMessage("");
      void (async () => {
        try {
          const [local, favoriteRefs] = await Promise.all([
            getSavedPlans(),
            getFavoritePlaces(),
          ]);
          if (!active || controller.signal.aborted) return;
          setPlans(local);
          setFavorites(favoriteRefs);
          const status = await api<CloudStatus>("status", undefined, {
            signal: controller.signal,
          });
          if (!active || controller.signal.aborted) return;
          applyCloudStatus(status);
          if (status.user && status.cloud) {
            const accountId = status.user.id;
            const rows = await api<{ spec: PlanSpec }[]>("plans", undefined, {
              signal: controller.signal,
            });
            if (
              !active ||
              controller.signal.aborted ||
              cloudRef.current.accountId !== accountId
            )
              return;
            updateCloud((previous) =>
              collectionSynced(
                previous,
                accountId,
                rows.map((r) => r.spec.id),
              ),
            );
            const map = new Map(local.map((p) => [p.id, p]));
            for (const row of rows) {
              if ((map.get(row.spec.id)?.revision ?? -1) < row.spec.revision) {
                await savePlan(row.spec, { signal: controller.signal });
                map.set(row.spec.id, row.spec);
              }
              if (
                !active ||
                controller.signal.aborted ||
                cloudRef.current.accountId !== accountId
              )
                return;
            }
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
        focused.current = false;
        openGeneration.current++;
        opening.current?.abort();
        opening.current = null;
        setOpeningId(undefined);
        setCanCancelOpening(false);
        setBusy(false);
        deletion.current?.abort();
        deletion.current = null;
        exploring.current?.abort();
        exploring.current = null;
        exploreGeneration.current++;
        controller.abort();
      };
    }, [authRevision, applyCloudStatus, updateCloud]),
  );
  async function openSaved(spec: PlanSpec, unlock = false) {
    if (busy || opening.current || deletion.current || exploring.current)
      return;
    const controller = new AbortController();
    const generation = ++openGeneration.current;
    opening.current = controller;
    setOpeningId(spec.id);
    setCanCancelOpening(true);
    setBusy(true);
    setError("");
    if (!unlock) setRecovery(undefined);
    try {
      const candidate = unlock ? unlockedSavedStops(spec) : spec;
      const next = await api<Itinerary>("hydrate", candidate, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || !focused.current) return;
      if (next.id !== spec.id)
        throw new Error(
          "The backend returned a different outing. Please try again.",
        );
      if (unlock) {
        await saveRecoveredPlan(spec, next, controller.signal);
        // The reference has committed successfully. The retry is complete;
        // later screen navigation is no longer cancellation of that retry.
        opening.current = null;
        setCanCancelOpening(false);
        setPlans((rows) =>
          rows.map((row) =>
            row.id === spec.id ? referenceOnlyPlan(next) : row,
          ),
        );
        setRecovery(undefined);
      } else {
        const latest = (await getSavedPlans()).find(
          (row) => row.id === spec.id,
        );
        if (controller.signal.aborted || !focused.current) return;
        if (
          !latest ||
          JSON.stringify(referenceOnlyPlan(latest)) !==
            JSON.stringify(referenceOnlyPlan(spec))
        )
          throw new Error(
            "Your saved plan changed during this request. Open the latest copy and try again.",
          );
      }
      await setPlan(next, { signal: controller.signal, persist: false });
      if (focused.current && !controller.signal.aborted)
        router.push("/plan/" + next.id);
    } catch (e) {
      if (!controller.signal.aborted && focused.current) {
        const failure = e as Error & { code?: string };
        setError(failure.message);
        if (unlock || canUnlockSavedStops(spec, failure)) setRecovery(spec);
      }
    } finally {
      if (opening.current === controller) opening.current = null;
      if (focused.current && openGeneration.current === generation) {
        setOpeningId(undefined);
        setCanCancelOpening(false);
        setBusy(false);
      }
    }
  }
  function cancelOpening() {
    opening.current?.abort();
    // Keep this operation guarded until its cancellation cleanup completes.
  }
  async function remove() {
    if (
      !pending ||
      busy ||
      deletion.current ||
      opening.current ||
      exploring.current
    )
      return;
    const target = pending,
      controller = new AbortController();
    deletion.current = controller;
    refresh.current?.abort();
    setLoading(false);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const scope = await deleteSavedCollectionPlan(
        { planId: target.plan.id, accountId: target.accountId },
        {
          currentAccount: () => cloudRef.current.accountId,
          readStatus: async () => {
            const status = await api<CloudStatus>("status", undefined, {
              signal: controller.signal,
            });
            applyCloudStatus(status);
            return status;
          },
          deleteCloud: async (id) => {
            await api("plans/" + id, undefined, {
              method: "DELETE",
              signal: controller.signal,
            });
          },
          deleteDevice: removePlan,
          cloudDeleted: (accountId, id) => {
            updateCloud((previous) =>
              collectionDeleted(previous, accountId, id),
            );
            setPending((current) =>
              current?.plan.id === id ? { plan: current.plan } : current,
            );
          },
        },
        controller.signal,
      );
      if (controller.signal.aborted || !focused.current) return;
      setPlans((rows) => rows.filter((p) => p.id !== target.plan.id));
      setPending(undefined);
      setMessage(
        scope === "account-and-device"
          ? "Device and account copies deleted, including that account’s share links."
          : "Device copy removed. Cloud copies and share links are unchanged.",
      );
    } catch (e) {
      if (!controller.signal.aborted && focused.current)
        setError((e as Error).message);
    } finally {
      if (deletion.current === controller) {
        deletion.current = null;
        if (focused.current) setBusy(false);
      }
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
    if (busy || exploring.current || opening.current || deletion.current)
      return;
    const controller = new AbortController(),
      generation = ++exploreGeneration.current;
    exploring.current = controller;
    setBusy(true);
    setError("");
    try {
      const location = await api<Location>(
        "location?id=" +
          encodeURIComponent(
            ref.demo ? (ref.sourceLocationId ?? ref.placeId) : ref.placeId,
          ) +
          (ref.demo ? "&demo=true" : ""),
        undefined,
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        !focused.current ||
        generation !== exploreGeneration.current ||
        exploring.current !== controller
      )
        return;
      setDraft(
        applySavedPreferences(
          {
            prompt: "",
            location,
            demo: ref.demo,
            known: ["location"],
            ...defaultStart(location),
          },
          preferences,
        ),
      );
      router.push("/planner");
    } catch (e) {
      if (
        !controller.signal.aborted &&
        focused.current &&
        generation === exploreGeneration.current
      )
        setError((e as Error).message);
    } finally {
      if (exploring.current === controller) exploring.current = null;
      if (focused.current && generation === exploreGeneration.current)
        setBusy(false);
    }
  }
  return (
    <Screen>
      <Text style={styles.eyebrow}>GOOD DAYS, KEPT CLOSE</Text>
      <Text
        maxFontSizeMultiplier={2}
        style={[styles.title, { marginVertical: 20 }]}
      >
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
      <Notice message={message} />
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
                      : syncedAccountForPlan(cloud, plan.id)
                        ? "ACCOUNT + DEVICE"
                        : "THIS DEVICE"}
                  </Text>
                  <Pressable
                    accessibilityLabel={"Delete " + plan.title}
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      setError("");
                      setMessage("");
                      setPending({
                        plan,
                        accountId: syncedAccountForPlan(cloud, plan.id),
                      });
                    }}
                    style={{ padding: 12 }}
                  >
                    <Trash2 size={18} color={c.ink} />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: busy,
                    busy: openingId === plan.id,
                  }}
                  disabled={busy}
                  onPress={() => void openSaved(plan)}
                  style={{ gap: 8 }}
                >
                  <Text style={styles.heading}>{plan.title}</Text>
                  <Text style={styles.body}>
                    {plan.request.date} · {plan.stops.length} stops
                  </Text>
                  <View style={styles.row}>
                    <Text style={styles.label}>
                      {openingId === plan.id
                        ? "Refreshing your saved day…"
                        : "Open my day"}
                    </Text>
                    <ArrowUpRight size={18} color={c.ink} />
                  </View>
                </Pressable>
                {recovery?.id === plan.id ? (
                  <View style={{ gap: 12 }}>
                    <Text style={styles.body}>
                      A locked place could not reopen. This retry unlocks this
                      device’s saved stops; places that are no longer available
                      may be omitted. Your original stays saved if the retry
                      fails.
                    </Text>
                    <Button
                      secondary
                      title="Unlock saved stops and retry"
                      busy={openingId === plan.id}
                      disabled={busy}
                      onPress={() => void openSaved(plan, true)}
                    />
                  </View>
                ) : null}
                {openingId === plan.id && canCancelOpening ? (
                  <Button
                    secondary
                    title="Cancel opening"
                    onPress={cancelOpening}
                  />
                ) : null}
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
        error={error}
        visible={!!pending}
        title="Let this plan go?"
        onDismissStart={() => deletion.current?.abort()}
        onClose={() => {
          deletion.current?.abort();
          setPending(undefined);
        }}
      >
        <Text style={styles.body}>
          {pending?.accountId
            ? "Deletes this device copy and its copy in the account that synced it, including that account’s share links. We verify the same account first. A failed cloud deletion keeps this device copy."
            : "Removes this device copy. Cloud copies and share links stay unchanged. To delete an account copy, sign in to that account and refresh Saved first."}{" "}
          Device reminders are cancelled when this copy is removed. Favorite
          places stay in your collection.
        </Text>
        <Button
          title={
            pending?.accountId
              ? "Delete account and device copies"
              : "Remove device copy"
          }
          busy={busy}
          onPress={() => void remove()}
        />
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
        error={error}
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
