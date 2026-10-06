"use client";
import { useAuth } from "@/lib/clerk";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { toast } from "@/lib/toast";
import MiniPlayer from "./MiniPlayer";
import AuraDial from "./AuraDial";

export default function AppShell() {
  const { isSignedIn } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTrack, stopAudio, sharedTrackInfo, openSharedTrack, playSharedTrack, clearSharedTrack } = useAudio();
  const wasSignedInRef = useRef(isSignedIn);

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

  // Stop music only on the transition to signed-out. stopAudio is a new function every render,
  // so depending on it re-ran this on every render and looped while signed out.
  useEffect(() => {
    if (wasSignedInRef.current && isSignedIn === false) {
      stopAudio();
    }
    wasSignedInRef.current = isSignedIn;
  }, [isSignedIn]);

  if (isAuthPage) return null;

  // On the player page the banner is only needed while nothing is playing (e.g. opening a shared link)
  const showSharedBanner = sharedTrackInfo && !(isPlayerPage && currentTrack);

  return (
    <>
      <MiniPlayer />
      <AuraDial />

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
