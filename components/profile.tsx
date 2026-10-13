"use client";
import { useState, useEffect } from "react";
import { UserRound, ArrowUpRight, LogOut, Check, Trash2 } from "lucide-react";
import { api, type Status } from "@/lib/client";
import { interests } from "@/lib/schema";
import { Button, Notice, Modal } from "./ui";
type Preferences = {
  enabled: boolean;
  interests: string[];
  dietary: string;
  accessibility: string;
  mode: "WALK" | "DRIVE";
  budget: number;
  cuisines: string;
  atmosphere: string;
  disliked: string[];
};
const defaults: Preferences = {
  enabled: false,
  interests: [],
  dietary: "",
  accessibility: "",
  mode: "WALK",
  budget: 65,
  cuisines: "",
  atmosphere: "",
  disliked: [],
};
export function Profile() {
  const [status, setStatus] = useState<Status>();
  const [prefs, setPrefs] = useState(defaults);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    try {
      setPrefs({
        ...defaults,
        ...JSON.parse(localStorage.getItem("whimway:preferences") ?? "{}"),
      });
    } catch {}
    api<Status>("status")
      .then(async (s) => {
        setStatus(s);
        if (s.user) {
          try {
            const p = await api<Partial<Preferences>>("profile");
            let combined = { ...defaults, ...p };
            if (localStorage.getItem("whimway:preferences:dirty") === "skips") {
              const local = JSON.parse(
                localStorage.getItem("whimway:preferences") ?? "{}",
              );
              combined = {
                ...combined,
                enabled: true,
                disliked: [
                  ...new Set([
                    ...(p.disliked ?? []),
                    ...(Array.isArray(local.disliked) ? local.disliked : []),
                  ]),
                ].slice(-100),
              };
            }
            setPrefs(combined);
            localStorage.setItem(
              "whimway:preferences",
              JSON.stringify(combined),
            );
          } catch (e) {
            setError((e as Error).message);
          }
        }
      })
      .catch((e) => setError(e.message));
    if (new URLSearchParams(window.location.search).has("authError"))
      setError(
        "The sign-in link expired or could not be verified. Request a new email below.",
      );
  }, []);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("auth/signin", { email });
      setMessage("Check your email for a secure sign-in link.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      localStorage.setItem("whimway:preferences", JSON.stringify(prefs));
      if (status?.user) {
        await api("profile", prefs);
        localStorage.removeItem("whimway:preferences:dirty");
      }
      setMessage(
        status?.user
          ? "Preferences saved to your account and device."
          : "Preferences saved on this device.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    setError("");
    try {
      if (status?.user) await api("profile", undefined, { method: "DELETE" });
      localStorage.removeItem("whimway:preferences");
      localStorage.removeItem("whimway:preferences:dirty");
      setPrefs(defaults);
      setMessage("Saved preferences deleted.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("auth/signout", {});
      setStatus((s) => (s ? { ...s, user: null } : s));
      localStorage.removeItem("whimway:preferences");
      localStorage.removeItem("whimway:preferences:dirty");
      setPrefs(defaults);
      setMessage("Signed out.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deleteAccount() {
    setBusy(true);
    try {
      await api("account", undefined, { method: "DELETE" });
      localStorage.removeItem("whimway:preferences");
      localStorage.removeItem("whimway:preferences:dirty");
      setPrefs(defaults);
      setStatus((s) => (s ? { ...s, user: null } : s));
      setDeleting(false);
      setMessage("Account and associated cloud data deleted.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wrap profile-page">
      <div className="eyebrow">MORE YOU. MORE YOUR KIND OF DAY.</div>
      <h1>
        A little about <span className="serif">you.</span>
      </h1>
      <p className="page-description">
        Only what you choose to share. Always yours to change.
      </p>
      {error ? <Notice error>{error}</Notice> : null}
      {message ? (
        <p className="success-message" role="status">
          {message}
        </p>
      ) : null}
      <div className="profile-layout">
        <section className="account-panel">
          <span className="account-avatar">
            <UserRound size={32} />
          </span>
          <h2>{status?.user ? "You’re right at home." : "Come as you are."}</h2>
          <p>
            {status?.user
              ? status.user.email
              : "Explore and plan as a guest. An account simply keeps your good days together."}
          </p>
          {status?.user ? (
            <>
              <Button className="secondary" onClick={logout}>
                <LogOut size={17} />
                Sign out
              </Button>
              <button
                className="text-link danger-text"
                onClick={() => setDeleting(true)}
              >
                Delete account and cloud data
              </button>
            </>
          ) : (
            <form onSubmit={login}>
              <label className="input-label">
                Email address
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={!status?.cloud}
                />
              </label>
              <Button
                className="primary"
                type="submit"
                busy={busy}
                disabled={!status?.cloud}
              >
                Email me a sign-in link
                <ArrowUpRight size={17} />
              </Button>
              {status && !status.cloud ? (
                <p className="form-hint">
                  Optional accounts are unavailable until Supabase is
                  configured. Device saves still work.
                </p>
              ) : (
                <p className="form-hint">No passwords. No mandatory account.</p>
              )}
            </form>
          )}
          <div className="privacy-note">
            <Check size={18} />
            <p>
              Location permission is requested only when you choose Use my
              location. Precise personal route anchors stay out of shared plans.
            </p>
          </div>
        </section>
        <section className="preference-panel">
          <div className="step-heading">
            <span>✦</span>
            <h2>Your kind of good.</h2>
          </div>
          <label className="switch-row">
            <span>
              <strong>Personalize future plans</strong>
              <small>Use preferences you deliberately save.</small>
            </span>
            <input
              type="checkbox"
              checked={prefs.enabled}
              onChange={(e) =>
                setPrefs({ ...prefs, enabled: e.target.checked })
              }
            />
          </label>
          <label className="input-label">Favourite things to do</label>
          <div className="interest-chips">
            {interests.map((i) => (
              <button
                type="button"
                key={i}
                aria-pressed={prefs.interests.includes(i)}
                className={prefs.interests.includes(i) ? "selected" : ""}
                onClick={() =>
                  setPrefs({
                    ...prefs,
                    interests: prefs.interests.includes(i)
                      ? prefs.interests.filter((x) => x !== i)
                      : [...prefs.interests, i],
                  })
                }
              >
                {i}
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label>
              Favourite cuisines
              <input
                value={prefs.cuisines}
                maxLength={200}
                placeholder="Japanese, Italian, a little of everything…"
                onChange={(e) =>
                  setPrefs({ ...prefs, cuisines: e.target.value })
                }
              />
            </label>
            <label>
              Atmosphere
              <input
                value={prefs.atmosphere}
                maxLength={200}
                placeholder="Quiet, lively, romantic…"
                onChange={(e) =>
                  setPrefs({ ...prefs, atmosphere: e.target.value })
                }
              />
            </label>
            <label>
              Usual budget / person
              <input
                type="number"
                min="0"
                max="1000000"
                value={prefs.budget}
                onChange={(e) =>
                  setPrefs({ ...prefs, budget: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Getting around
              <select
                value={prefs.mode}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    mode: e.target.value as "WALK" | "DRIVE",
                  })
                }
              >
                <option value="WALK">Walking</option>
                <option value="DRIVE">Driving</option>
              </select>
            </label>
            <label>
              Dietary needs
              <input
                value={prefs.dietary}
                maxLength={300}
                onChange={(e) =>
                  setPrefs({ ...prefs, dietary: e.target.value })
                }
              />
            </label>
            <label>
              Accessibility needs
              <input
                value={prefs.accessibility}
                maxLength={300}
                onChange={(e) =>
                  setPrefs({ ...prefs, accessibility: e.target.value })
                }
              />
            </label>
          </div>
          <p className="form-hint">
            {prefs.disliked.length
              ? `${prefs.disliked.length} deliberately skipped place${prefs.disliked.length === 1 ? "" : "s"} remembered. Reset & delete clears this list. `
              : ""}
            Requirements are carried into your form. Venue suitability still
            needs confirmation. Currency comes from the area you select.
          </p>
          <div className="preference-actions">
            <Button className="primary" onClick={save} busy={busy}>
              Save my preferences
              <Check size={17} />
            </Button>
            <Button className="secondary" onClick={reset} disabled={busy}>
              <Trash2 size={16} />
              Reset & delete
            </Button>
          </div>
          <div className="data-controls">
            <h3>Device data</h3>
            <p>Clear local plans, preferences and drafts from this browser.</p>
            <Button
              className="secondary"
              onClick={() => {
                for (const k of [
                  "whimway:plans",
                  "whimway:preferences",
                  "whimway:preferences:dirty",
                ])
                  localStorage.removeItem(k);
                sessionStorage.removeItem("whimway:draft");
                sessionStorage.removeItem("whimway:entry");
                setPrefs(defaults);
                setMessage("Whimway data cleared from this device.");
              }}
            >
              Clear device data
            </Button>
          </div>
        </section>
      </div>
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete your Whimway account?"
        description="Your account, cloud plans, preferences and public share links will be permanently deleted. Device plans remain until you clear device data."
      >
        <div className="share-actions">
          <Button className="danger" busy={busy} onClick={deleteAccount}>
            Delete account
          </Button>
          <Button className="secondary" onClick={() => setDeleting(false)}>
            Keep my account
          </Button>
        </div>
      </Modal>
    </div>
  );
}
