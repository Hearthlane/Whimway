import React, { useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  Text,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Crypto from "expo-crypto";
import { MapPin, LocateFixed, Map } from "lucide-react-native";
import { api } from "../services/api";
import { requestCurrentLocation } from "../services/location";
import type { Location } from "../../../../lib/schema";
import { colors as c } from "../design/theme";
import { styles, Notice, Sheet, Button } from "./ui";
import RouteMap from "./RouteMap";
export function LocationSearch({
  value,
  onChange,
  demo = false,
  initialQuery = "",
  onBusyChange,
}: {
  value?: Location;
  onChange: (l: Location) => void;
  demo?: boolean;
  initialQuery?: string;
  onBusyChange?: (resolving: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; text: string }[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const busy = searchBusy || actionBusy;
  const [error, setError] = useState("");
  const [map, setMap] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number }>();
  const request = useRef<AbortController | null>(null);
  const action = useRef<AbortController | null>(null);
  const session = useRef(Crypto.randomUUID());
  const reduced = useReducedMotion();
  const focus = useSharedValue(0);
  const focusSurface = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [c.line, c.ink]),
    backgroundColor: interpolateColor(
      focus.value,
      [0, 1],
      [c.white, "#FFFEFB"],
    ),
  }));
  const focusRing = useAnimatedStyle(() => ({ opacity: focus.value * 0.85 }));
  function showFocus(active: boolean) {
    focus.set(
      reduced
        ? Number(active)
        : withTiming(Number(active), {
            duration: 160,
            easing: Easing.out(Easing.cubic),
          }),
    );
  }
  function setResolving(value: boolean) {
    setActionBusy(value);
    onBusyChange?.(value);
  }
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);
  useEffect(() => {
    request.current?.abort();
    setResults([]);
    setError("");
    if (query.trim().length < 2) {
      setSearchBusy(false);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setSearchBusy(true);
    const timer = setTimeout(() => {
      api<{ id: string; text: string }[]>(
        "autocomplete?q=" +
          encodeURIComponent(query.trim()) +
          "&session=" +
          session.current +
          (demo ? "&demo=true" : ""),
        undefined,
        { signal: controller.signal },
      )
        .then((items) => {
          if (!controller.signal.aborted) setResults(items);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted && request.current === controller)
            setSearchBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, demo]);
  useEffect(
    () => () => {
      request.current?.abort();
      action.current?.abort();
      onBusyChange?.(false);
    },
    [onBusyChange],
  );
  async function choose(id: string) {
    request.current?.abort();
    action.current?.abort();
    const controller = new AbortController();
    action.current = controller;
    setSearchBusy(false);
    setResolving(true);
    setError("");
    try {
      const location = await api<Location>(
        "location?id=" +
          encodeURIComponent(id) +
          "&session=" +
          session.current +
          (demo ? "&demo=true" : ""),
        undefined,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      onChange(location);
      setQuery("");
      setResults([]);
      session.current = Crypto.randomUUID();
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  }
  async function resolve(point?: { lat: number; lng: number }) {
    request.current?.abort();
    action.current?.abort();
    const controller = new AbortController();
    action.current = controller;
    setSearchBusy(false);
    setResolving(true);
    setError("");
    try {
      const selected = point || (await requestCurrentLocation());
      if (controller.signal.aborted) return;
      const location = await api<Location>("point", selected, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      onChange(location);
      setMap(false);
      setQuery("");
      session.current = Crypto.randomUUID();
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      {value ? (
        <View
          style={[
            styles.row,
            { padding: 14, backgroundColor: c.mint, borderRadius: 16 },
          ]}
        >
          <MapPin color={c.ink} size={20} />
          <Text style={[styles.label, { flex: 1 }]}>{value.name}</Text>
        </View>
      ) : null}
      <Animated.View
        style={[
          styles.row,
          {
            backgroundColor: c.white,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: c.line,
            paddingHorizontal: 16,
          },
          focusSurface,
        ]}
      >
        <Animated.View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            {
              position: "absolute",
              top: -4,
              left: -4,
              right: -4,
              bottom: -4,
              borderRadius: 22,
              borderWidth: 2,
              borderColor: c.lavender,
            },
            focusRing,
          ]}
        />
        <MapPin color={c.muted} size={20} />
        <TextInput
          accessibilityLabel="Search a place"
          editable={!actionBusy}
          value={query}
          onChangeText={setQuery}
          onFocus={() => showFocus(true)}
          onBlur={() => showFocus(false)}
          placeholder="City, neighbourhood, anywhere…"
          placeholderTextColor={c.muted}
          style={[
            styles.input,
            Platform.OS === "web" && { outlineWidth: 0 },
            {
              flex: 1,
              borderWidth: 0,
              paddingHorizontal: 0,
              backgroundColor: "transparent",
            },
          ]}
        />
        {busy ? <ActivityIndicator color={c.ink} /> : null}
      </Animated.View>
      {results.map((result) => (
        <Pressable
          key={result.id}
          accessibilityRole="button"
          disabled={actionBusy}
          onPress={() => void choose(result.id)}
          style={{ padding: 16, backgroundColor: c.white, borderRadius: 16 }}
        >
          <Text style={styles.label}>{result.text}</Text>
        </Pressable>
      ))}
      {query.length >= 2 && !busy && !results.length && !error ? (
        <Text style={styles.body}>
          No matches yet. Try a city or a nearby landmark.
        </Text>
      ) : null}
      <View style={[styles.row, { gap: 24, flexWrap: "wrap" }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void resolve()}
          disabled={actionBusy}
          style={[styles.row, { minHeight: 44 }]}
        >
          <LocateFixed size={17} color={c.ink} />
          <Text style={styles.label}>Near me</Text>
        </Pressable>
        {Platform.OS !== "web" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setMap(true)}
            disabled={actionBusy}
            style={[styles.row, { minHeight: 44 }]}
          >
            <Map size={17} color={c.ink} />
            <Text style={styles.label}>Choose on map</Text>
          </Pressable>
        ) : null}
      </View>
      <Notice message={error} error />
      <Sheet
        error={error}
        visible={map}
        title="Drop your starting pin"
        onClose={() => setMap(false)}
      >
        <Text style={styles.body}>
          Tap the map to choose an exploration area.
        </Text>
        <RouteMap
          center={pin || value?.center || { lat: 43.6532, lng: -79.3832 }}
          onSelectPoint={setPin}
          style={{ height: 340, borderRadius: 20 }}
        />
        <Button
          title="Explore around this pin"
          disabled={!pin}
          busy={busy}
          onPress={() => void resolve(pin)}
        />
      </Sheet>
    </View>
  );
}
