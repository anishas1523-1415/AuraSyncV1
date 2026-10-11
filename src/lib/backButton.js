"use client";
// Android's back button, Spotify-style: close whatever sheet or menu is open, otherwise go back a
// screen, and on Home send the app to the background (music keeps playing) instead of closing it.
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isMobileApp } from "@/lib/api";

const closers = []; // open overlays, newest last

// Registers `onClose` while `open` is true, so back closes this overlay before leaving the screen
export function useCloseOnBack(open, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const entry = () => onCloseRef.current?.();
    closers.push(entry);
    return () => {
      const index = closers.lastIndexOf(entry);
      if (index !== -1) closers.splice(index, 1);
    };
  }, [open]);
}

export function useAndroidBackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (!isMobileApp) return;
    let handle = null;
    let cancelled = false;

    import("@capacitor/app")
      .then(({ App }) => App.addListener("backButton", ({ canGoBack }) => {
        const closeTop = closers[closers.length - 1];
        if (closeTop) {
          closeTop();
        } else if (pathRef.current !== "/") {
          if (canGoBack) window.history.back();
          else router.replace("/");
        } else {
          App.minimizeApp();
        }
      }))
      .then((listener) => {
        handle = listener;
        if (cancelled) listener?.remove();
      })
      .catch((err) => console.warn("AuraSynq: back button unavailable", err));

    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, []);
}
