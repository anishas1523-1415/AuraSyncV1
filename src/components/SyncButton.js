"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, Check } from "@phosphor-icons/react";
import styles from "./SyncButton.module.css";

// Fetches a fresh batch (new songs, new order). Spins while syncing, glows teal once done.
export default function SyncButton({ onSync, size = "md", floating = false, label = "Sync", className = "" }) {
  const [state, setState] = useState("idle"); // idle | syncing | synced
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleClick = async (e) => {
    e.stopPropagation();
    if (state === "syncing") return;
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
    setState("syncing");
    let ok = false;
    try {
      ok = (await onSync()) !== false;
    } catch (err) {
      console.warn("AuraSynq: sync failed", err);
    }
    if (!ok) {
      setState("idle");
      return;
    }
    setState("synced");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 1800);
  };

  return (
    <button
      type="button"
      className={[
        styles.syncBtn,
        size === "sm" ? styles.small : "",
        floating ? styles.floating : "",
        state === "synced" ? styles.synced : "",
        className,
      ].join(" ")}
      onClick={handleClick}
      disabled={state === "syncing"}
      title="Sync fresh songs"
    >
      {state === "synced"
        ? <Check size={size === "sm" ? 13 : 17} weight="bold" />
        : <ArrowsClockwise size={size === "sm" ? 13 : 17} weight="bold" className={state === "syncing" ? styles.spinning : ""} />}
      {!floating && <span>{state === "syncing" ? "Syncing" : state === "synced" ? "Synced" : label}</span>}
    </button>
  );
}
