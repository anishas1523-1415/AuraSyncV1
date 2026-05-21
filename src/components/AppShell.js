"use client";
import { useAuth } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAudio } from "@/contexts/AudioContext";
import MiniPlayer from "./MiniPlayer";
import AuraDial from "./AuraDial";

export default function AppShell() {
  const { isSignedIn } = useAuth();
  const pathname = usePathname();
  const { stopAudio } = useAudio();

  const isAuthPage =
    pathname?.startsWith("/sign-in") || pathname?.startsWith("/sign-up");

  // Stop music when user signs out
  useEffect(() => {
    if (isSignedIn === false) {
      stopAudio();
    }
  }, [isSignedIn]);

  if (isAuthPage) return null;

  return (
    <>
      <MiniPlayer />
      <AuraDial />
    </>
  );
}
