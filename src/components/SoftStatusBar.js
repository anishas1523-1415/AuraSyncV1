"use client";
import { useEffect, useState } from "react";

// The Android app hides the system status bar (its icons can only be bright white or black) and
// shows this quieter one instead: time on the left; date, network and battery on the right, in a
// dim white that doesn't pull the eye. A swipe down shows the system bar for ~3 s (MainActivity).
// The native side reports the camera cutout (--cutout-left/right/center-width), so on punch-hole
// and notch phones the text moves clear of the camera.
const formatTime = (date) => `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")}`;
const formatDate = (date) => date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

const networkLabel = () => {
  if (typeof navigator === "undefined") return "";
  if (navigator.onLine === false) return "Offline";
  const c = navigator.connection;
  if (!c) return "";
  if (c.type === "wifi") return "Wi-Fi";
  if (c.type === "none") return "Offline";
  const g = String(c.effectiveType || "").toUpperCase(); // 4G / 3G / 2G (5G reports as 4G)
  return c.type === "cellular" || g ? g.replace("SLOW-", "") : "";
};

export default function SoftStatusBar() {
  const [now, setNow] = useState(null);
  const [battery, setBattery] = useState(null);
  const [network, setNetwork] = useState("");

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

  useEffect(() => {
    const update = () => setNetwork(networkLabel());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    navigator.connection?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      navigator.connection?.removeEventListener?.("change", update);
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
        gap: "var(--cutout-center-width, 0px)",
        // Clear of rounded corners, and of a corner punch-hole when there is one
        paddingLeft: "calc(max(24px, env(safe-area-inset-left, 0px)) + var(--cutout-left, 0px))",
        paddingRight: "calc(max(24px, env(safe-area-inset-right, 0px)) + var(--cutout-right, 0px))",
        fontSize: "12px",
        fontWeight: 500,
        letterSpacing: "0.3px",
        color: "rgba(255, 255, 255, 0.42)",
        pointerEvents: "none",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      <span>{formatTime(now)}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {formatDate(now)}
        {network && ` · ${network}`}
        {battery && ` · ${battery.charging ? "⚡" : ""}${battery.level}%`}
      </span>
    </div>
  );
}
