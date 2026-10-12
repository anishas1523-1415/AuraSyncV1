"use client";
import { useEffect, useRef, useState } from "react";
import { CloudSlash, WifiHigh } from "@phosphor-icons/react";
import { useOnline } from "@/lib/network";

// A small glass pill under the status bar: "offline" while the connection is gone, then a short
// "back online" when it returns
export default function NetworkBanner() {
  const online = useOnline();
  const [showBack, setShowBack] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      setShowBack(false);
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    setShowBack(true);
    const timer = setTimeout(() => setShowBack(false), 2500);
    return () => clearTimeout(timer);
  }, [online]);

  if (online && !showBack) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: "calc(10px + env(safe-area-inset-top, 0px))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 3000,
        display: "flex",
        alignItems: "center",
        gap: "0.45rem",
        padding: "0.45rem 0.9rem",
        borderRadius: "20px",
        fontSize: "0.78rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
        color: online ? "#00ffcc" : "white",
        background: online ? "rgba(0, 255, 204, 0.12)" : "rgba(244, 63, 94, 0.18)",
        border: `1px solid ${online ? "rgba(0, 255, 204, 0.35)" : "rgba(244, 63, 94, 0.4)"}`,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
      }}
    >
      {online ? <WifiHigh size={16} weight="bold" /> : <CloudSlash size={16} weight="bold" />}
      {online ? "Back online" : "You're offline · downloaded songs still play"}
    </div>
  );
}
