import Constants from "expo-constants";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { areaByKey } from "@shared/areas";
import { TasteProfile } from "@shared/profile";
import { api } from "@/lib/api";
import { supabase } from "@/lib/auth";
import { cloudConfigured, SHARE_ORIGIN } from "@/lib/config";
import { companionCopy, modeCopy, vibeCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { SignIn } from "@/account/SignIn";
import { FREE, isPlus, plansLeft } from "@shared/plus";
import { Button, Card, Chip, IconButton, Notice, T } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

/** Settings: preferences, account, privacy and data. Reached from the gear on your profile. */
export default function Settings() {
  const store = useStore();
  const { profile, session, setProfile } = store;
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"device" | "account" | null>(null);
  const plus = isPlus(profile);
  // Fine-tuning and favourites are open to everyone unless Plus limits are switched on.
  const open = store.unlocked;
  const loved = Object.entries(profile.affinity).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.top}>
          <IconButton icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))} />
          <T v="title" accessibilityRole="header">
            Settings
          </T>
        </View>

        {store.limits ? (
        <Card style={[{ gap: space.md }, plus && { borderColor: color.ink }]}>
          <View style={s.rowBetween}>
            <T v="heading">{plus ? "Whimway Plus" : "Free plan"}</T>
            <Button testID="plus-open" kind={plus ? "ghost" : "primary"} label={plus ? "Manage" : "See Plus"} onPress={() => router.push("/plus")} />
          </View>
          <T v="small" tone={color.muted}>
            {plus
              ? "Unlimited plans and edits, favourites, fine-tuning and surprise mode. Demo purchase, no payment taken."
              : `${Math.min(FREE.plansPerMonth, plansLeft(profile))} of ${FREE.plansPerMonth} free plans left this month, ${FREE.magicEditsPerPlan} Magic Edits per plan.`}
          </T>
        </Card>
        ) : null}

        <Card style={{ gap: space.md }}>
          <View style={s.rowBetween}>
            <T v="heading">Fine-tune</T>
            {open ? null : <Chip label="Plus" tone="lavender" />}
          </View>
          <T v="smallStrong">Pace</T>
          <View style={s.chips}>
            {(["relaxed", "balanced", "packed"] as const).map((pace) => (
              <Chip
                key={pace}
                testID={`pace-${pace}`}
                label={{ relaxed: "Relaxed, 2 stops", balanced: "Balanced, 3 stops", packed: "Packed, 4 stops" }[pace]}
                selected={profile.pace === pace}
                onPress={() => (open ? setProfile({ ...profile, pace }) : router.push({ pathname: "/plus", params: { reason: "tune" } }))}
              />
            ))}
          </View>
          <View style={s.rowBetween}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong">Alcohol-free nights</T>
              <T v="small" tone={color.muted}>
                Leave out bars and breweries.
              </T>
            </View>
            <Switch
              value={profile.alcoholFree}
              onValueChange={(alcoholFree) => (open ? setProfile({ ...profile, alcoholFree }) : router.push({ pathname: "/plus", params: { reason: "tune" } }))}
              trackColor={{ true: color.ink, false: color.line }}
              thumbColor={color.paper}
              accessibilityLabel="Alcohol-free nights"
            />
          </View>
        </Card>

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
          <T v="heading">Account</T>
          {!cloudConfigured ? (
            <Notice icon="cloud-off">Accounts aren’t configured on this build. Everything is saved on this device.</Notice>
          ) : session ? (
            <>
              <T v="body">Signed in as {session.user.email}</T>
              <T v="small" tone={color.muted}>
                Your taste profile syncs, and shared links are short and revocable.
              </T>
              {message ? <Notice icon="check-circle">{message}</Notice> : null}
              <Button kind="ghost" label="Sign out" icon="log-out" onPress={() => (setMessage(""), void supabase?.auth.signOut())} />
              <T v="small" tone={color.faint}>
                Signing out keeps everything on this device.
              </T>
            </>
          ) : (
            <>
              <T v="small" tone={color.muted}>
                Optional. Sign in to keep your taste, people and saved plans on every device. No password — we email you a 6-digit code.
              </T>
              <SignIn
                onSignedIn={(r) =>
                  setMessage(r.plans ? `Signed in. ${r.plans} saved plan${r.plans === 1 ? "" : "s"} added from your account.` : "Signed in. Your profile is synced.")
                }
              />
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
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  statTile: { flexGrow: 1, flexBasis: "45%", backgroundColor: color.canvas, borderRadius: radius.md, padding: space.md },
  page: { padding: space.xl, paddingBottom: space.xxxl, gap: space.lg, maxWidth: 680, width: "100%", alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: space.md },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.canvas, paddingHorizontal: space.lg, fontFamily: font.body, fontSize: 16, color: color.ink },
  favRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  confirm: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: color.coralTint },
});
