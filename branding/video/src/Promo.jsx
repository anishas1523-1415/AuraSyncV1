import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", { weights: ["400", "500", "700", "800", "900"] });

export const FPS = 30;
const BAR = 72; // 100 BPM: one bar = 2.4 s = 72 frames, so every cut lands on the beat

// Scene timeline, in bars
const SCENES = [
  { id: "intro", bars: 2 },
  { id: "home", bars: 3, clip: "home", from: 0.4, title: ["Pick a", "mood."], sub: "Chill, workout, focus, Tamil: every vibe floats on one screen.", tilt: -6 },
  { id: "trending", bars: 3, clip: "trending", from: 1.2, title: ["Every hit,", "its own float."], sub: "Trending Now, across languages, alive on screen.", tilt: 6 },
  { id: "tamil", bars: 3, clip: "tamil", from: 1.6, title: ["Tamil hits", "drift by."], sub: "Slow, endless, never in each other's way.", tilt: -5 },
  { id: "player", bars: 3, clip: "player", from: 0.6, title: ["Swipe.", "Skip. Feel it."], sub: "A full-screen player made for your thumb.", tilt: 5 },
  { id: "queue", bars: 2, clip: "queue", from: 1, title: ["Your queue,", "in sync."], sub: "One tap fills Up Next with songs that match the mood.", tilt: -5 },
  { id: "discover", bars: 3, clip: "discover", from: 1, title: ["Discover,", "endlessly."], sub: "A feed of real songs, fresh every time you open it.", tilt: 5 },
  { id: "share", bars: 2, title: ["Share it like", "a story."], sub: "Every song becomes a card, ready for your friends." },
  { id: "profile", bars: 2, clip: "profile", from: 1, title: ["Your aura,", "everywhere."], sub: "Sign in once. Likes, playlists and history follow you.", tilt: -5 },
  { id: "outro", bars: 2 },
];
export const PROMO_FRAMES = SCENES.reduce((sum, s) => sum + s.bars * BAR, 0);

const GRADIENT_TEXT = {
  background: "linear-gradient(135deg, #ffffff 0%, #e9d5ff 45%, #f9a8d4 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

// ─── Backdrop: the app's night sky with slow aurora glows ───
function Aurora() {
  const frame = useCurrentFrame();
  const orb = (x, y, size, color, speed, phase) => ({
    position: "absolute",
    width: size,
    height: size,
    left: x + Math.sin(frame / speed + phase) * 120,
    top: y + Math.cos(frame / (speed * 1.3) + phase) * 140,
    borderRadius: "50%",
    background: color,
    filter: "blur(140px)",
    opacity: 0.55,
  });
  return (
    <AbsoluteFill style={{ background: "linear-gradient(180deg, #0b1020 0%, #0d1424 45%, #090d18 100%)", overflow: "hidden" }}>
      <div style={orb(-200, 120, 760, "#8a2be2", 70, 0)} />
      <div style={orb(560, 980, 700, "#ec4899", 85, 2)} />
      <div style={orb(160, 1420, 560, "#11998e", 95, 4)} />
      <div style={orb(620, -160, 520, "#4f46e5", 75, 1)} />
      {/* fine grain so the gradients don't band */}
      <AbsoluteFill style={{ opacity: 0.05, backgroundImage: "radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)", backgroundSize: "4px 4px" }} />
    </AbsoluteFill>
  );
}

// ─── A phone playing one of the screen recordings, floating in 3D ───
function Phone({ clip, from, tilt = 0, duration }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
  const exit = interpolate(frame, [duration - 14, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const floatY = Math.sin(frame / 22) * 14;
  const width = 580;
  const height = Math.round(width / 0.45);
  return (
    <div
      style={{
        position: "absolute",
        left: (1080 - width) / 2,
        top: 560,
        width,
        height,
        transform: `perspective(2200px) translateY(${(1 - enter) * 700 + floatY + exit * -120}px) rotateY(${tilt * (1 - exit)}deg) rotateX(${4 - enter * 4}deg) scale(${0.86 + enter * 0.14 - exit * 0.08})`,
        opacity: 1 - exit,
        borderRadius: 78,
        padding: 14,
        background: "linear-gradient(145deg, #2a2a35, #0b0b10 60%, #1b1b24)",
        boxShadow: "0 60px 140px rgba(0,0,0,0.65), 0 0 90px rgba(168,85,247,0.35), inset 0 0 0 2px rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ width: "100%", height: "100%", borderRadius: 66, overflow: "hidden", background: "#000", position: "relative" }}>
        <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} startFrom={Math.round(from * FPS)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {/* glass reflection */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(255,255,255,0.10) 0%, transparent 32%, transparent 70%, rgba(255,255,255,0.04) 100%)" }} />
      </div>
    </div>
  );
}

// ─── Headline: words rise in one after another ───
function Headline({ lines, sub, duration }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame, [duration - 12, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let wordIndex = 0;
  return (
    <div style={{ position: "absolute", top: 150, left: 80, right: 80, opacity: out }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", flexWrap: "wrap", gap: "0 26px", lineHeight: 1.02 }}>
          {line.split(" ").map((word) => {
            const delay = 4 + wordIndex++ * 4;
            const s = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 120 } });
            return (
              <span
                key={word + delay}
                style={{
                  fontFamily, fontWeight: 900, fontSize: 112, letterSpacing: -3,
                  display: "inline-block",
                  transform: `translateY(${(1 - s) * 80}px)`,
                  opacity: s,
                  filter: `blur(${(1 - s) * 10}px)`,
                  ...GRADIENT_TEXT,
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      ))}
      {sub && (
        <p
          style={{
            fontFamily, fontWeight: 500, fontSize: 34, color: "rgba(255,255,255,0.72)", marginTop: 26, lineHeight: 1.35, maxWidth: 860,
            opacity: interpolate(frame, [16, 30], [0, 1], { extrapolateRight: "clamp" }),
            transform: `translateY(${interpolate(frame, [16, 30], [20, 0], { extrapolateRight: "clamp" })}px)`,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Brand mark: emblem + gradient wordmark ───
function BrandMark({ scale = 1, frame, fps, delay = 0 }) {
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 80 } });
  const word = "AuraSynq";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${scale})` }}>
      <Img
        src={staticFile("logo-emblem.png")}
        style={{
          width: 300, height: 244,
          transform: `scale(${0.6 + s * 0.4}) rotate(${(1 - s) * -12}deg)`,
          opacity: s,
          filter: `drop-shadow(0 0 ${40 + Math.sin(frame / 8) * 12}px rgba(168,85,247,0.75))`,
        }}
      />
      <div style={{ display: "flex", marginTop: 26 }}>
        {word.split("").map((ch, i) => {
          const cs = spring({ frame: frame - delay - 12 - i * 2.5, fps, config: { damping: 15, stiffness: 140 } });
          return (
            <span
              key={i}
              style={{
                fontFamily, fontWeight: 900, fontSize: 138, letterSpacing: -4, display: "inline-block",
                transform: `translateY(${(1 - cs) * 60}px)`, opacity: cs,
                background: "linear-gradient(135deg, #a855f7, #ec4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Intro({ duration }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tagline = interpolate(frame, [44, 62], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const out = interpolate(frame, [duration - 12, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const zoom = interpolate(frame, [0, duration], [1.04, 1], { easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out, transform: `scale(${zoom})` }}>
      <BrandMark frame={frame} fps={fps} />
      <p style={{ fontFamily, fontWeight: 500, fontSize: 44, color: "rgba(255,255,255,0.78)", marginTop: 34, opacity: tagline, transform: `translateY(${(1 - tagline) * 24}px)`, letterSpacing: 0.5 }}>
        Music that floats around you
      </p>
    </AbsoluteFill>
  );
}

function ShareScene({ duration }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 6, fps, config: { damping: 14, stiffness: 80 } });
  const out = interpolate(frame, [duration - 14, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const floatY = Math.sin(frame / 20) * 12;
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Headline lines={["Share it like", "a story."]} sub="Every song becomes a card, ready for your friends." duration={duration + 20} />
      <div
        style={{
          position: "absolute", left: 1080 / 2 - 290, top: 640, width: 580, height: 1031,
          borderRadius: 44, overflow: "hidden",
          transform: `perspective(2000px) translateY(${(1 - s) * 600 + floatY}px) rotateZ(${(1 - s) * 10 - 3}deg) rotateY(${-8 + s * 4}deg)`,
          boxShadow: "0 50px 120px rgba(0,0,0,0.6), 0 0 80px rgba(236,72,153,0.35)",
        }}
      >
        <Img src={staticFile("share-card.png")} style={{ width: "100%", height: "100%" }} />
      </div>
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: 1720, display: "flex", justifyContent: "center",
          opacity: interpolate(frame, [30, 44], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <span style={{ fontFamily, fontWeight: 700, fontSize: 32, color: "#f0abfc", padding: "14px 30px", borderRadius: 40, background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.4)" }}>
          aurasynq.web.app
        </span>
      </div>
    </AbsoluteFill>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line = (start) => interpolate(frame, [start, start + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <BrandMark frame={frame} fps={fps} scale={0.9} />
      <p style={{ fontFamily, fontWeight: 700, fontSize: 46, color: "white", marginTop: 40, opacity: line(36), transform: `translateY(${(1 - line(36)) * 20}px)` }}>
        Your music. Your aura.
      </p>
      <p style={{ fontFamily, fontWeight: 600, fontSize: 32, color: "rgba(255,255,255,0.6)", marginTop: 22, opacity: line(52), letterSpacing: 4, textTransform: "uppercase" }}>
        Coming soon on Android
      </p>
      <p style={{ fontFamily, fontWeight: 700, fontSize: 32, color: "#f0abfc", marginTop: 18, opacity: line(60) }}>
        aurasynq.web.app
      </p>
    </AbsoluteFill>
  );
}

// A bright sweep across each cut, on the beat
function BeatFlash({ at }) {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [at - 3, at, at + 8], [0, 0.35, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 45%, rgba(236,72,153,0.9), rgba(168,85,247,0.4) 45%, transparent 70%)", opacity: o, pointerEvents: "none" }} />;
}

export function Promo() {
  let start = 0;
  const cuts = [];
  return (
    <AbsoluteFill style={{ background: "#090d18" }}>
      <Aurora />
      <Audio src={staticFile("soundtrack.wav")} />
      {SCENES.map((scene) => {
        const duration = scene.bars * BAR;
        const from = start;
        start += duration;
        if (from > 0) cuts.push(from);
        // Scenes overlap their neighbours by a few frames for smooth hand-offs
        const pad = scene.id === "outro" ? 0 : 10;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration + pad}>
            {scene.id === "intro" && <Intro duration={duration + pad} />}
            {scene.id === "outro" && <Outro />}
            {scene.id === "share" && <ShareScene duration={duration + pad} />}
            {scene.clip && (
              <>
                <Phone clip={scene.clip} from={scene.from} tilt={scene.tilt} duration={duration + pad} />
                <Headline lines={scene.title} sub={scene.sub} duration={duration + pad} />
              </>
            )}
          </Sequence>
        );
      })}
      {cuts.map((at) => <BeatFlash key={at} at={at} />)}
      {/* cinematic vignette */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
}
