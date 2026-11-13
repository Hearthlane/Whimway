import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PlanSpec, type Itinerary } from "@shared/schema";
import { decodeShare } from "@shared/share-link";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, Icon, IconButton, Notice, T } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

const newId = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Resolve either kind of Whimway share link to a (redacted) plan spec. */
async function resolve(link: string): Promise<PlanSpec> {
  const text = link.trim();
  const fragment = text.match(/\/p#([A-Za-z0-9_-]+)/)?.[1];
  if (fragment) return decodeShare(fragment);
  const short = text.match(/\/s\/([0-9a-f-]{36})/i)?.[1];
  if (short) return PlanSpec.parse(await api(`shared/${short}`));
  throw new Error("That doesn’t look like a Whimway plan link. It should contain /p# or /s/.");
}

/**
 * Open someone's shared plan in the app and keep your own copy.
 * Reached from Saved, or by deep link: whimway://import?link=<url-encoded share link>
 */
export default function Import() {
  const params = useLocalSearchParams<{ link?: string }>();
  const store = useStore();
  const [link, setLink] = useState(params.link ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const open = async (value = link) => {
    setBusy(true);
    setError("");
    try {
      const spec = await resolve(value);
      const live = await api<Itinerary>("hydrate", spec);
      const copy: Itinerary = { ...live, id: newId(), title: live.title, summary: "A plan someone shared with you — yours to tweak." };
      store.remember(copy, { saved: true });
      store.track("shared_plan_copied", { via: value.includes("/s/") ? "account" : "link", surface: "app" });
      router.replace(`/plan/${copy.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.link) void open(params.link);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.link]);

  return (
    <SafeAreaView style={s.page}>
      <View style={s.top}>
        <IconButton icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/saved"))} />
      </View>
      <View style={s.body}>
        <View style={s.icon}>
          <Icon name="link" size={24} />
        </View>
        <T v="title" accessibilityRole="header">
          Open a shared plan
        </T>
        <T v="body" tone={color.muted}>
          Paste a Whimway link a friend sent you. You’ll get your own copy to edit, save and go.
        </T>
        <TextInput
          testID="import-link"
          value={link}
          onChangeText={setLink}
          placeholder="https://…/p#…"
          placeholderTextColor={color.faint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Shared plan link"
          style={s.input}
          multiline
        />
        <Button testID="import-open" label="Open plan" icon="arrow-right" busy={busy} disabled={link.trim().length < 10} onPress={() => open()} />
        {error ? (
          <Notice tone="coral" icon="alert-circle">
            {error}
          </Notice>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.canvas },
  top: { padding: space.lg },
  body: { padding: space.xl, gap: space.lg, maxWidth: 560, width: "100%", alignSelf: "center" },
  icon: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.mintTint, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 90, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.paper, padding: space.md, fontFamily: font.body, fontSize: 15, color: color.ink, textAlignVertical: "top" },
});
