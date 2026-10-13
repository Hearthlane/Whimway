"use client";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  Sparkles,
  MapPin,
  Clock,
  Footprints,
  MoveUpRight,
  Utensils,
  TreePine,
  Palette,
  ShoppingBag,
  Plus,
} from "lucide-react";
import { LocationSearch } from "./location-search";
import type { Location, PlanSpec } from "@/lib/schema";
import { api, type Status } from "@/lib/client";
import { getLocal } from "@/lib/storage";
export function Home() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [location, setLocation] = useState<Location>();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<Status>();
  const [recent, setRecent] = useState<PlanSpec[]>([]);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    api<Status>("status")
      .then(setStatus)
      .catch(() => {});
    setRecent(Object.values(getLocal()).slice(-3).reverse());
  }, []);
  function start(surprise = false, interest?: string) {
    sessionStorage.setItem(
      "whimway:entry",
      JSON.stringify({
        location,
        prompt: surprise
          ? "Surprise me with a memorable little adventure."
          : prompt,
        interest,
        demo,
      }),
    );
    router.push("/create");
  }
  return (
    <div className="home">
      <section className="hero wrap">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-spark">✦</span> LESS PLANNING. MORE LIVING.
          </div>
          <h1>
            Your next
            <br />
            favourite day
            <br /> starts{" "}
            <span className="hero-here">
              here.
              <svg viewBox="0 0 210 15" aria-hidden="true">
                <path
                  d="M4 10Q90-3 205 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>
          <p className="hero-description">
            That little café. A new neighbourhood.
            <br className="desktop-break" /> A day that turns into a story.
            Let’s find yours.
          </p>
          <div className="hero-planner">
            <label className="input-label">Where are we wandering?</label>
            <LocationSearch
              value={location}
              onChange={setLocation}
              demo={demo}
            />
            <div className="prompt-field">
              <Sparkles size={19} />
              <input
                aria-label="Describe your outing"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A coffee date, a fun afternoon, something new…"
                onKeyDown={(e) => e.key === "Enter" && start()}
              />
            </div>
            <div className="hero-actions">
              <button className="button primary" onClick={() => start()}>
                Find my kind of day
                <ArrowUpRight size={19} />
              </button>
              <button className="surprise-button" onClick={() => start(true)}>
                <Sparkles size={16} />
                Surprise me
              </button>
            </div>
          </div>
          <div className="hero-footnote">
            <span className="overlap-dots">
              <i />
              <i />
              <i />
            </span>
            A little spontaneous. Entirely your kind of thing.
          </div>
          {status?.demo ? (
            <label className="demo-toggle">
              <input
                type="checkbox"
                checked={demo}
                onChange={(e) => setDemo(e.target.checked)}
              />
              Development preview · synthetic test data
            </label>
          ) : null}
        </div>
        <motion.div
          className="hero-visual"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.45 }}
        >
          <div className="orbit-text">GO SOMEWHERE GOOD ↗</div>
          <div className="hero-image-card">
            <img
              src="/outing.svg"
              alt="Original illustration of friends discovering a waterfront café"
            />
            <div className="hero-image-caption">
              <span>
                <MapPin size={14} />
                Out there, a good day is waiting.
              </span>
              <span>ILLUSTRATION</span>
            </div>
          </div>
          <div className="floating-plan">
            <span className="floating-icon">
              <Footprints size={22} />
            </span>
            <div>
              <strong>A little wander. A lot to love.</strong>
              <span>
                <Clock size={12} /> A few hours, well spent
              </span>
            </div>
            <span className="floating-arrow">
              <ArrowUpRight size={18} />
            </span>
          </div>
          <div className="floating-note">
            <Sparkles size={20} />
            <span>
              Follow your
              <br />
              <strong>“why not?”</strong>
            </span>
          </div>
          <span className="hero-star star-one">✦</span>
          <span className="hero-star star-two">✳</span>
          <svg
            className="hero-squiggle"
            viewBox="0 0 170 70"
            aria-hidden="true"
          >
            <path
              d="M3 50q35-45 63-13t39-14q14-35 42-4"
              fill="none"
              stroke="#192630"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="m135 5 18 13-23 4"
              fill="none"
              stroke="#192630"
              strokeWidth="3"
            />
          </svg>
        </motion.div>
      </section>
      <section className="mood-strip">
        <div className="wrap mood-inner">
          <span>What’s your kind of day?</span>
          {[
            {
              name: "A bite & a wander",
              interest: "Food & drinks",
              Icon: Utensils,
            },
            {
              name: "Fresh-air feelings",
              interest: "Outdoors",
              Icon: TreePine,
            },
            {
              name: "A little culture",
              interest: "Arts & culture",
              Icon: Palette,
            },
            {
              name: "Unexpected finds",
              interest: "Shopping",
              Icon: ShoppingBag,
            },
          ].map(({ name, interest, Icon }) => (
            <button key={name} onClick={() => start(false, interest)}>
              <Icon size={18} />
              {name}
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      </section>
      <section className="inspiration wrap">
        <div className="section-heading">
          <div>
            <div className="eyebrow">A LITTLE INSPIRATION</div>
            <h2>
              Anywhere can be <span className="serif">a good idea.</span>
            </h2>
          </div>
          <Link href="/create" className="text-link">
            Pick your own place
            <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="inspiration-grid">
          {[
            {
              city: "Toronto",
              title: "Big city. Little discoveries.",
              tone: "mint",
              search: "CF Toronto Eaton Centre",
              note: "Café corners & culture",
              zone: "America/Toronto",
              currency: "CAD",
              lat: 43.6544,
              lng: -79.3807,
            },
            {
              city: "Tokyo",
              title: "Take the scenic detour.",
              tone: "lavender",
              search: "Shibuya, Tokyo",
              note: "Side streets & surprises",
              zone: "Asia/Tokyo",
              currency: "JPY",
              lat: 35.6595,
              lng: 139.7005,
            },
            {
              city: "Paris",
              title: "A slower kind of afternoon.",
              tone: "peach",
              search: "Le Marais, Paris",
              note: "Art, gardens & good company",
              zone: "Europe/Paris",
              currency: "EUR",
              lat: 48.8575,
              lng: 2.3623,
            },
          ].map((card, i) => (
            <button
              key={card.city}
              className={`inspiration-card ${card.tone}`}
              onClick={() => {
                sessionStorage.setItem(
                  "whimway:entry",
                  JSON.stringify({
                    location: {
                      name: card.search,
                      center: { lat: card.lat, lng: card.lng },
                      timezone: card.zone,
                      currency: card.currency,
                    },
                    prompt: card.note,
                    demo: false,
                  }),
                );
                router.push("/create");
              }}
            >
              <div className={`city-art city-${i}`} aria-hidden="true">
                <div className="art-sun" />
                <div className="art-building b1" />
                <div className="art-building b2" />
                <div className="art-building b3" />
                <div className="art-tree" />
                <span className="city-letter">{card.city}</span>
                <span className="art-label">
                  CITY INSPIRATION · ILLUSTRATION
                </span>
              </div>
              <div className="inspiration-content">
                <span className="card-place">
                  <MapPin size={13} />
                  {card.city}
                </span>
                <h3>{card.title}</h3>
                <span>{card.note}</span>
                <i>
                  <MoveUpRight size={21} />
                </i>
              </div>
            </button>
          ))}
        </div>
      </section>
      {recent.length ? (
        <section className="wrap recent-section">
          <div className="section-heading">
            <h2>Your next chapter.</h2>
            <Link href="/saved" className="text-link">
              All saved outings
              <ArrowRight size={17} />
            </Link>
          </div>
          <div className="recent-grid">
            {recent.map((s) => (
              <Link className="recent-card" key={s.id} href={`/plan/${s.id}`}>
                <span className="recent-icon">
                  <MapPin size={21} />
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>
                    {s.request.location.name} · {s.stops.length} stops
                    {s.demo ? " · Test fixture" : ""}
                  </p>
                </div>
                <ArrowUpRight size={18} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <section className="home-manifesto wrap">
        <span>✦</span>
        <h2>
          The best plans leave
          <br />a little room for <span className="serif">wonder.</span>
        </h2>
        <p>
          You choose the place and the pace.
          <br />
          Whimway connects the dots.
        </p>
        <Link className="button dark" href="/create">
          Let’s go somewhere
          <Plus size={18} />
        </Link>
      </section>
    </div>
  );
}
