import Constants from "expo-constants";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { areaByKey } from "@shared/areas";
import { buildRequest, interpret } from "@shared/intent";
import { DateTime } from "luxon";
import { TasteProfile } from "@shared/profile";
import { api } from "@/lib/api";
import { supabase } from "@/lib/auth";
import { cloudConfigured, SHARE_ORIGIN } from "@/lib/config";
import { companionCopy, modeCopy, vibeCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { Button, Card, Chip, IconButton, Notice, T } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

export default function Profile() {
  const store = useStore();
  const { profile, session, setProfile } = store;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"device" | "account" | null>(null);
  const loved = Object.entries(profile.affinity).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const sendCode = async () => {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setMessage("We couldn’t send a code to that address. Check it and try again.");
    else setStage("code");
  };
  const verify = async () => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) {
      setMessage("That code didn’t work. Codes expire after a few minutes — request a new one if needed.");
      return;
    }
    setMessage("");
    // Merge: pull the account's taste profile if this device has none yet, otherwise push ours.
    try {
      const remote = await api<TasteProfile | null>("taste");
      if (remote && !profile.vibes.length && !Object.keys(profile.affinity).length) setProfile({ ...remote, onboarded: true });
      else await api("taste", profile);
    } catch {
      // Sync is best effort; the device copy is authoritative.
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <T v="hero" accessibilityRole="header">
          {profile.name ? `Hi, ${profile.name}` : "You"}
        </T>

        <Card style={{ gap: space.md }}>
          <View style={s.rowBetween}>
            <T v="heading">Your taste</T>
            <Button kind="ghost" label="Retune" icon="sliders" onPress={() => { setProfile({ ...profile, onboarded: false }); router.replace("/onboarding"); }} />
          </View>
          <View style={s.chips}>
            <Chip icon={companionCopy[profile.companions].icon} label={companionCopy[profile.companions].label} tone="mint" />
            <Chip icon={modeCopy[profile.mode].icon} label={modeCopy[profile.mode].label} tone="mint" />
            <Chip icon="credit-card" label={`~$${profile.budget} pp`} tone="yellow" />
            <Chip icon="map-pin" label={areaByKey(profile.homeArea)?.name ?? "GTA"} tone="mint" />
            {profile.vibes.map((v) => (
              <Chip key={v} icon={vibeCopy[v].icon} label={vibeCopy[v].label} tone="lavender" />
            ))}
          </View>
          <T v="small" tone={color.muted}>
            {Object.keys(profile.polls).length
              ? `${Object.keys(profile.polls).length} quick poll${Object.keys(profile.polls).length === 1 ? "" : "s"} answered — each one sharpens your plans.`
              : "Answer the quick polls on Plan — each one sharpens your recommendations."}
          </T>
          {loved.length ? (
            <T v="small" tone={color.muted}>
              Learned from your feedback: you love {loved.map(([k]) => k).join(", ")}.
            </T>
          ) : (
            <T v="small" tone={color.muted}>
              Rate plans after you go and we’ll learn what you love.
            </T>
          )}
          {profile.disliked.length ? (
            <View style={s.rowBetween}>
              <T v="small" tone={color.muted} style={{ flex: 1 }}>
                Skipping {profile.disliked.length} place{profile.disliked.length > 1 ? "s" : ""} you didn’t enjoy.
              </T>
              <Button kind="ghost" label="Reset" onPress={() => setProfile({ ...profile, disliked: [], affinity: {} })} />
            </View>
          ) : null}
        </Card>

        <Card style={{ gap: space.md }}>
          <T v="heading">Favourite places</T>
          {profile.favourites.length ? (
            profile.favourites.slice(0, 20).map((f) => (
              <View key={f.id} style={s.favRow} testID="favourite">
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong" numberOfLines={1}>
                    {f.name}
                  </T>
                  <T v="small" tone={color.muted} numberOfLines={1}>
                    {[f.category, areaByKey(f.area)?.name].filter(Boolean).join(" · ")}
                  </T>
                </View>
                <Button
                  kind="soft"
                  label="Plan around it"
                  icon="star"
                  onPress={() => {
                    const now = DateTime.now().setZone("America/Toronto");
                    const prompt = `Plan something around ${f.name}`;
                    store.pending.current = {
                      ...buildRequest(prompt, interpret(prompt, now), profile, now, { area: areaByKey(f.area) }),
                      anchorPlaceIds: [f.id],
                      excludedPlaceIds: profile.disliked.filter((id) => id !== f.id),
                    };
                    router.push("/plan/new");
                  }}
                />
                <IconButton icon="x" label={`Remove ${f.name}`} onPress={() => setProfile({ ...profile, favourites: profile.favourites.filter((x) => x.id !== f.id) })} />
              </View>
            ))
          ) : (
            <T v="small" tone={color.muted}>
              Tap the heart on any stop to save it. Then plan a whole night around it in one tap.
            </T>
          )}
        </Card>

        <Card style={{ gap: space.md }}>
          <T v="heading">Account</T>
          {!cloudConfigured ? (
            <Notice icon="cloud-off">Accounts aren’t configured on this build. Everything is saved on this device.</Notice>
          ) : session ? (
            <>
              <T v="body">Signed in as {session.user.email}</T>
              <T v="small" tone={color.muted}>
                Your taste profile syncs, and shared links are short and revocable.
              </T>
              <Button kind="ghost" label="Sign out" icon="log-out" onPress={() => supabase?.auth.signOut()} />
            </>
          ) : (
            <>
              <T v="small" tone={color.muted}>
                Optional. Sign in to sync your taste across devices. No password — we email you a 6-digit code.
              </T>
              {stage === "email" ? (
                <>
                  <T v="smallStrong" nativeID="email-label">
                    Email
                  </T>
                  <TextInput accessibilityLabelledBy="email-label" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" placeholderTextColor={color.faint} style={s.input} />
                  <Button label="Email me a code" busy={busy} disabled={!/.+@.+\..+/.test(email)} onPress={sendCode} />
                </>
              ) : (
                <>
                  <T v="smallStrong" nativeID="code-label">
                    Code sent to {email}
                  </T>
                  <TextInput accessibilityLabelledBy="code-label" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" placeholder="123456" placeholderTextColor={color.faint} style={s.input} maxLength={10} />
                  <Button label="Sign in" busy={busy} disabled={code.trim().length < 6} onPress={verify} />
                  <Button kind="ghost" label="Use a different email" onPress={() => setStage("email")} />
                </>
              )}
              {message ? <Notice tone="coral">{message}</Notice> : null}
            </>
          )}
        </Card>

        <Card style={{ gap: space.md }}>
          <T v="heading">Privacy</T>
          <View style={s.rowBetween}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong">Anonymous usage stats</T>
              <T v="small" tone={color.muted}>
                Events like “plan saved”. Never prompts, places or location.
              </T>
            </View>
            <Switch value={profile.analytics} onValueChange={(analytics) => setProfile(TasteProfile.parse({ ...profile, analytics }))} trackColor={{ true: color.ink, false: color.line }} thumbColor={color.paper} accessibilityLabel="Anonymous usage stats" />
          </View>
          <T v="small" tone={color.muted}>
            Plans are stored on this device as place IDs and your choices. Your prompts go to our server and AI provider only to build the plan.
          </T>
          {confirm === "device" ? (
            <View style={s.confirm}>
              <T v="small" style={{ flex: 1 }}>
                Delete all plans and your taste profile from this device?
              </T>
              <Button kind="ghost" label="Cancel" onPress={() => setConfirm(null)} />
              <Button kind="dark" label="Delete device data" onPress={async () => { await store.resetDevice(); setConfirm(null); router.replace("/onboarding"); }} />
            </View>
          ) : (
            <Button kind="ghost" label="Delete data on this device" icon="trash-2" onPress={() => setConfirm("device")} />
          )}
          {session ? (
            confirm === "account" ? (
              <View style={s.confirm}>
                <T v="small" style={{ flex: 1 }}>
                  Permanently delete your account, cloud plans, shares and feedback?
                </T>
                <Button kind="ghost" label="Cancel" onPress={() => setConfirm(null)} />
                <Button
                  kind="dark"
                  label="Delete account"
                  onPress={async () => {
                    try {
                      await api("account", undefined, { method: "DELETE" });
                      await supabase?.auth.signOut();
                      setConfirm(null);
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  }}
                />
              </View>
            ) : (
              <Button kind="ghost" label="Delete my account" icon="user-x" onPress={() => setConfirm("account")} />
            )
          ) : null}
        </Card>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: space.lg }}>
          <Button kind="ghost" label="Privacy" onPress={() => void WebBrowser.openBrowserAsync(`${SHARE_ORIGIN}/privacy`)} />
          <Button kind="ghost" label="Terms" onPress={() => void WebBrowser.openBrowserAsync(`${SHARE_ORIGIN}/terms`)} />
          <Button kind="ghost" label="Replay intro" onPress={() => { setProfile({ ...profile, onboarded: false }); router.replace("/onboarding"); }} />
        </View>
        <T v="small" tone={color.faint} style={{ textAlign: "center" }}>
          Whimway beta {Constants.expoConfig?.version ?? ""} · Greater Toronto
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { padding: space.xl, paddingBottom: space.xxxl, gap: space.lg, maxWidth: 680, width: "100%", alignSelf: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.canvas, paddingHorizontal: space.lg, fontFamily: font.body, fontSize: 16, color: color.ink },
  favRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  confirm: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: color.coralTint },
});
