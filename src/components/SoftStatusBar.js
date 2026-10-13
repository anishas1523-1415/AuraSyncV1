"use client";
import { useEffect, useState } from "react";

// The Android app hides the system status bar (its icons can only be bright white or black) and
// shows this quieter one instead: time on the left, date and battery on the right, in a dim
// white that doesn't pull the eye. Swiping down from the top still brings the system bar back.
const formatTime = (date) => `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")}`;
const formatDate = (date) => date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export default function SoftStatusBar() {
  const [now, setNow] = useState(null);
  const [battery, setBattery] = useState(null);

  useEffect(() => {
    setNow(new Date());
    // Tick on the minute so the clock never lags behind the real one
    let timer = setTimeout(function tick() {
      setNow(new Date());
      timer = setTimeout(tick, 60000 - (Date.now() % 60000));
    }, 60000 - (Date.now() % 60000));
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let manager = null;
    const update = () => manager && setBattery({ level: Math.round(manager.level * 100), charging: manager.charging });
    navigator.getBattery?.().then((b) => {
      manager = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    }).catch(() => {});
    return () => {
      manager?.removeEventListener("levelchange", update);
      manager?.removeEventListener("chargingchange", update);
    };
  }, []);

  if (!now) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "max(env(safe-area-inset-top, 0px), 28px)",
        zIndex: 4000,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        fontSize: "12px",
        fontWeight: 500,
        letterSpacing: "0.3px",
        color: "rgba(255, 255, 255, 0.42)",
        pointerEvents: "none",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span>{formatTime(now)}</span>
      <span>
        {formatDate(now)}
        {battery && ` · ${battery.charging ? "⚡" : ""}${battery.level}%`}
      </span>
    </div>
  );
}
