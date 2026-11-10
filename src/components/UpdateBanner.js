"use client";
import { useEffect, useState } from "react";
import { ArrowCircleUp, X } from "@phosphor-icons/react";
import { isMobileApp } from "@/lib/api";

// New versions of the Android app are published to Astral Studio (Anish's own app store), which
// lists every release in apps.json. On each launch the app compares its own version with the newest
// one there and, if it is behind, offers a button to the AuraSynq page to download the update.
const CATALOG_URL = "https://astral-studio.web.app/apps.json";
const UPDATE_PAGE = "https://astral-studio.web.app/app.html?id=aurasynq";
const APP_ID = "aurasynq";

// "1.0.10" > "1.0.9": compare each dot-separated part as a number
function isNewer(latest, installed) {
  const a = String(latest).split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(installed).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

export default function UpdateBanner() {
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    if (!isMobileApp) return;
    let cancelled = false;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const { version: installed } = await App.getInfo();
        const res = await fetch(CATALOG_URL, { cache: "no-store" });
        if (!res.ok) return;
        const catalog = await res.json();
        const latest = catalog.apps?.find((a) => a.id === APP_ID)?.versions?.[0];
        if (!latest || !isNewer(latest.version, installed)) return;
        // "Later" hides it until the app is next opened, not forever
        if (sessionStorage.getItem("aurasynq_update_later") === latest.version) return;
        if (!cancelled) setUpdate({ ...latest, installed });
      } catch {
        // Offline or the store is unreachable: try again next launch
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!update) return null;

  const later = () => {
    try { sessionStorage.setItem("aurasynq_update_later", update.version); } catch {}
    setUpdate(null);
  };

  return (
    <div
      role="dialog"
      aria-label="Update available"
      style={{
        position: "fixed",
        left: "12px",
        right: "12px",
        bottom: "calc(150px + env(safe-area-inset-bottom, 0px))",
        zIndex: 3100,
        padding: "1rem 1rem 0.9rem",
        borderRadius: "18px",
        color: "white",
        background: "rgba(20, 16, 40, 0.88)",
        border: "1px solid rgba(0, 255, 204, 0.35)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.45)",
      }}
    >
      <button
        onClick={later}
        aria-label="Later"
        style={{ position: "absolute", top: "10px", right: "10px", background: "none", border: "none", color: "rgba(255,255,255,0.6)", padding: "4px" }}
      >
        <X size={18} weight="bold" />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem", paddingRight: "1.5rem" }}>
        <ArrowCircleUp size={26} weight="fill" color="#00ffcc" />
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.98rem" }}>AuraSynq {update.version} is available</div>
          <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)" }}>
            You have {update.installed}{update.size ? ` · ${update.size} download` : ""}
          </div>
        </div>
      </div>
      {update.notes && (
        <p style={{ margin: "0 0 0.8rem", fontSize: "0.82rem", lineHeight: 1.4, color: "rgba(255,255,255,0.8)", maxHeight: "4.2em", overflow: "hidden" }}>
          {update.notes}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <button
          onClick={later}
          style={{ flex: 1, padding: "0.65rem", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "white", fontWeight: 600 }}
        >
          Later
        </button>
        {/* Capacitor hands links outside the app to the phone's browser, where the APK downloads */}
        <a
          href={UPDATE_PAGE}
          target="_blank"
          rel="noopener noreferrer"
          onClick={later}
          style={{ flex: 2, padding: "0.65rem", borderRadius: "12px", background: "#00ffcc", color: "#0b0b14", fontWeight: 700, textAlign: "center", textDecoration: "none" }}
        >
          Update
        </a>
      </div>
    </div>
  );
}
