"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./AuraTour.module.css";

const DONE_KEY = "aurasynq_tour_done";
export const START_TOUR_EVENT = "aurasynq:start-tour";

// Each step spotlights a real element on Home (or none, for the intro, gestures and finish)
const STEPS = [
  { title: "Welcome to AuraSynq", text: "Music that floats around you. Here's a 30-second tour of how it works.", art: "orb" },
  { target: 'a[href="/category/chill"] > div', title: "Pick a mood", text: "Every bubble is a mood. Tap one for a fresh mix of songs: new every time you open it." },
  { target: 'a[href="/trending"] > div', title: "Trending now", text: "Hits from every language, each one floating in its own way. Tap a dial to play it." },
  { target: 'a[href="/trends"] > div', title: "Tamil hits", text: "Tamil favourites that drift slowly across the screen. Catch one to play it." },
  { target: "[class*=mainBtn]", title: "Your Aura Dial", text: "Tap this anytime for Search, Discover, Library, the player and your profile." },
  { target: 'a[href="/society"]', title: "Listen together", text: "Join live rooms with friends, or Blend your taste with someone's into one playlist." },
  { title: "Play like a pro", text: "In the player, swipe the card left to skip and right to go back. Double tap it for lyrics.", art: "gestures" },
  { target: 'a[href="/profile"]', title: "Your aura, synced", text: "Your profile keeps likes, playlists and history synced on every device. Settings live here too." },
  { title: "You're all set", text: "Tap any bubble to start listening. You can replay this tour from Profile.", art: "orb", last: true },
];

const PAD = 10;

export default function AuraTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const rafRef = useRef(0);

  // First visit to Home: start automatically; Profile → "Take the tour" starts it again
  useEffect(() => {
    let done = false;
    try { done = localStorage.getItem(DONE_KEY) === "1"; } catch (e) {}
    if (!done && pathname === "/") {
      const timer = setTimeout(() => { setStep(0); setActive(true); }, 1200);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  useEffect(() => {
    const start = () => {
      if (pathname !== "/") router.push("/");
      setStep(0);
      setTimeout(() => setActive(true), pathname === "/" ? 0 : 900);
    };
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, [pathname]);

  // Follow the spotlighted element every frame (the bubbles float), gliding a fifth of the way
  // toward it each frame: a smooth comet-like move between steps that also tracks the float
  const current = STEPS[step];
  const shownRef = useRef(null);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (!active || !current?.target) { shownRef.current = null; setRect(null); return; }
    const follow = () => {
      const el = document.querySelector(current.target);
      if (el) {
        const r = el.getBoundingClientRect();
        const radius = getComputedStyle(el).borderRadius;
        const round = radius.endsWith("%") ? parseFloat(radius) >= 50 : parseFloat(radius) >= r.width / 2 - 1;
        const goal = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
        const prev = shownRef.current || goal;
        const lerp = (a, b) => a + (b - a) * 0.2;
        const next = { x: lerp(prev.x, goal.x), y: lerp(prev.y, goal.y), w: lerp(prev.w, goal.w), h: lerp(prev.h, goal.h), round };
        shownRef.current = next;
        setRect(next);
      }
      rafRef.current = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, step]);

  if (!active || pathname !== "/") return null;

  const finish = () => {
    try { localStorage.setItem(DONE_KEY, "1"); } catch (e) {}
    setActive(false);
  };
  const next = () => {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(8);
    if (current.last) finish(); else setStep((s) => s + 1);
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Card sits below the spotlight when it's in the top half, above it otherwise
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const cardStyle = !rect
    ? { top: "50%", transform: "translateY(-50%)" }
    : rect.y + rect.h / 2 < vh / 2
      ? { top: Math.min(rect.y + rect.h + 18, vh - 260) }
      : { bottom: Math.max(vh - rect.y + 18, 24) };

  return (
    <div className={styles.overlay} role="dialog" aria-label="AuraSynq tour">
      {rect ? (
        <div
          className={styles.spotlight}
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: rect.round ? "50%" : 22 }}
        />
      ) : (
        <div className={styles.dim} />
      )}

      <div className={styles.card} style={cardStyle} key={step}>
        {current.art === "orb" && <div className={styles.orb} />}
        {current.art === "gestures" && (
          <div className={styles.demo} aria-hidden="true">
            <div className={styles.demoCard}>
              <span className={styles.demoCover} />
              <span className={styles.demoLine} />
              <span className={styles.demoLineShort} />
              <span className={styles.stamp}>SKIP</span>
            </div>
            <span className={styles.finger} />
            <span className={styles.tapRing} />
          </div>
        )}
        <h3>{current.title}</h3>
        <p>{current.text}</p>

        <div className={styles.footer}>
          <div className={styles.orbit} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <span key={i} className={`${styles.planet} ${i === step ? styles.planetNow : i < step ? styles.planetDone : ""}`} />
            ))}
          </div>
          <div className={styles.actions}>
            {!current.last && <button className={styles.skip} onClick={finish}>Skip</button>}
            {step > 0 && !current.last && <button className={styles.back} onClick={back}>Back</button>}
            <button className={styles.next} onClick={next}>{current.last ? "Start listening" : step === 0 ? "Let's go" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
