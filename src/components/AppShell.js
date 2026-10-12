"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { toast } from "@/lib/toast";
import MiniPlayer from "./MiniPlayer";
import NetworkBanner from "./NetworkBanner";
import AuraDial from "./AuraDial";
import { useAndroidBackButton } from "@/lib/backButton";
import { isMobileApp } from "@/lib/api";

export default function AppShell() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTrack, sharedTrackInfo, openSharedTrack, playSharedTrack, clearSharedTrack } = useAudio();
  useAndroidBackButton();

  const isAuthPage =
    pathname?.startsWith("/sign-in") || pathname?.startsWith("/sign-up");
  const isPlayerPage = pathname === "/player";

  // Shared links (?track=<id>&t=<title>&a=<artist>) show a banner; tapping it plays the song
  useEffect(() => {
    const trackId = searchParams?.get("track");
    const playlistId = searchParams?.get("playlist");

    if (trackId) {
      openSharedTrack({
        id: trackId,
        title: searchParams.get("t") || undefined,
        artist: searchParams.get("a") || undefined
      });
      router.replace(pathname, { scroll: false });
    }

    if (playlistId) {
      toast("You have successfully joined the collaborative playlist!", { variant: "success" });
      // Since it's local state, we just redirect to library
      router.push('/library');
    }
    // openSharedTrack is recreated each render; reacting to URL changes is what matters here
  }, [searchParams, pathname, router]);

  // Light clock and status icons on every screen (the app is always dark)
  useEffect(() => {
    if (!isMobileApp) return;
    import("@capacitor/core")
      .then(({ SystemBars, SystemBarsStyle }) => SystemBars.setStyle({ style: SystemBarsStyle.Dark }))
      .catch(() => {});
  }, []);

  // Share links (https://aurasynq.web.app/s/<id>?t=&a=, /o?p=<path>) and aurasynq:// links that
  // opened the Android app, both when it was closed and when it was already running
  useEffect(() => {
    if (!isMobileApp) return;
    const handleLink = (raw) => {
      if (!raw) return;
      let url;
      try { url = new URL(raw); } catch (e) { return; }
      // aurasynq://s/<id> puts "s" in the host; https links have it in the path
      const parts = (url.protocol === "aurasynq:" ? `/${url.host}${url.pathname}` : url.pathname).split("/").filter(Boolean);
      if (parts[0] === "s" && parts[1]) {
        openSharedTrack({
          id: decodeURIComponent(parts[1]),
          title: url.searchParams.get("t") || undefined,
          artist: url.searchParams.get("a") || undefined,
        }); // shows the "shared song · tap to play" banner
      } else if (parts[0] === "o") {
        const target = url.searchParams.get("p");
        if (target?.startsWith("/")) router.push(target);
      }
    };
    let listener = null;
    let cancelled = false;
    import("@capacitor/app").then(async ({ App }) => {
      const launch = await App.getLaunchUrl().catch(() => null);
      if (!cancelled) handleLink(launch?.url);
      listener = await App.addListener("appUrlOpen", (event) => handleLink(event.url));
      if (cancelled) listener.remove();
    }).catch(() => {});
    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, []);

  // Capture PWA install prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      window.deferredPrompt = e;
      window.dispatchEvent(new Event("pwa-install-prompt-ready"));
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  // Handle service worker lifecycle (update/unregister in dev)
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      // Force clear all caches EXCEPT offline audio to get rid of stale code
      if ("caches" in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => {
            if (key !== "aurasynq_offline_audio") {
              caches.delete(key).catch(() => {});
            }
          });
        });
      }

      // Unconditionally unregister the service worker to prevent it from serving broken/missing caches
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().then((success) => {
            if (success) {
              console.log("AuraSynq Debug: Unregistered stale service worker.");
            }
          });
        }
      });
    }
  }, []);

  if (isAuthPage) return null;

  // On the player page the banner is only needed while nothing is playing (e.g. opening a shared link)
  const showSharedBanner = sharedTrackInfo && !(isPlayerPage && currentTrack);

  return (
    <>
      <MiniPlayer />
      <AuraDial />
      <NetworkBanner />

      {showSharedBanner && (
        <div
          className="shared-song-banner"
          onClick={() => {
            playSharedTrack();
            if (!isPlayerPage) router.push("/player");
          }}
        >
          <div className="banner-content">
            <img src={sharedTrackInfo.cover} alt="" className="banner-cover" />
            <div className="banner-info">
              <span className="banner-tag">🎵 SHARED SONG · TAP TO PLAY</span>
              <h4>{sharedTrackInfo.title?.split("|")[0].split("(")[0].trim()}</h4>
              <p>{sharedTrackInfo.artist}</p>
            </div>
          </div>
          <div className="banner-actions">
            <button
              className="banner-close"
              onClick={(e) => {
                e.stopPropagation();
                clearSharedTrack();
              }}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
