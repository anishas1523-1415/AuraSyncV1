"use client";
import { useAuth } from "@/lib/clerk";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useAudio } from "@/contexts/AudioContext";
import MiniPlayer from "./MiniPlayer";
import AuraDial from "./AuraDial";

export default function AppShell() {
  const { isSignedIn } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { stopAudio, sharedTrackInfo, setSharedTrackInfo, clearSharedTrack } = useAudio();

  const isAuthPage =
    pathname?.startsWith("/sign-in") || pathname?.startsWith("/sign-up");
  const isPlayerPage = pathname === "/player";

  // Check for shared track links and create a banner
  useEffect(() => {
    const trackId = searchParams?.get("track");
    const playlistId = searchParams?.get("playlist");
    
    if (trackId && typeof window !== "undefined") {
      setSharedTrackInfo({
        id: trackId,
        title: "Shared Song",
        artist: "Someone shared a vibe with you",
        cover: "/icon-512x512.png"
      });
      router.replace(pathname, { scroll: false });
    }
    
    if (playlistId && typeof window !== "undefined") {
      alert(`You have successfully joined the collaborative playlist!`);
      // Since it's local state, we just redirect to library
      router.push('/library');
    }
  }, [searchParams, pathname, router, setSharedTrackInfo]);

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

  // Stop music when user signs out
  useEffect(() => {
    if (isSignedIn === false) {
      stopAudio();
    }
  }, [isSignedIn, stopAudio]);

  if (isAuthPage) return null;

  return (
    <>
      <MiniPlayer />
      <AuraDial />
      
      {sharedTrackInfo && !isPlayerPage && (
        <div className="shared-song-banner" onClick={() => { router.push("/player"); }}>
          <div className="banner-content">
            <img src={sharedTrackInfo.cover} alt="" className="banner-cover" />
            <div className="banner-info">
              <span className="banner-tag">🎵 SHARED SONG</span>
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
