"use client";
import { useEffect, useRef, useState } from "react";

const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

// true / false as the phone's connection comes and goes
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(isOnline());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

// Runs `callback` (latest version) whenever the connection comes back
export function useReconnect(callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    const handle = () => callbackRef.current?.();
    window.addEventListener("online", handle);
    return () => window.removeEventListener("online", handle);
  }, []);
}
