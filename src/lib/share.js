"use client";
// Sharing. Links go to AuraSynq's own share pages (aurasynq.web.app), which open the song straight
// in the app when it's installed, and songs are shared as a Spotify-style card image.
import { isMobileApp } from "@/lib/api";
import { shareOrCopy } from "@/lib/toast";
import { renderShareCard } from "@/lib/shareCard";

export const SHARE_ORIGIN = "https://aurasynq.web.app";

const cleanTitle = (title = "") => title.split("|")[0].split("(")[0].trim();

// https://aurasynq.web.app/s/<id>?t=<title>&a=<artist>: title and artist ride along so the
// receiver sees the song instantly
export const songLink = (track) => {
  const params = new URLSearchParams({ t: cleanTitle(track.title), a: track.artist || "" });
  return `${SHARE_ORIGIN}/s/${encodeURIComponent(track.id)}?${params}`;
};

// Anything else (blend invites, collaborative playlists) opens that screen in the app
export const appLink = (path) => `${SHARE_ORIGIN}/o?p=${encodeURIComponent(path)}`;

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1]);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

export async function shareSong(track) {
  if (!track?.id) return;
  const title = cleanTitle(track.title);
  const link = songLink(track);
  const text = `🎵 ${title} — ${track.artist || "AuraSynq"}\nListen on AuraSynq`;
  let card = null;
  try {
    card = await renderShareCard({ title, artist: track.artist, cover: track.cover });
  } catch (e) {
    console.warn("AuraSynq: couldn't draw the share card", e);
  }

  if (isMobileApp) {
    try {
      const [{ Share }, { Filesystem, Directory }] = await Promise.all([
        import("@capacitor/share"),
        import("@capacitor/filesystem"),
      ]);
      let files;
      if (card) {
        const { uri } = await Filesystem.writeFile({
          path: `aurasynq-${track.id}.png`,
          data: await blobToBase64(card),
          directory: Directory.Cache,
        });
        files = [uri];
      }
      await Share.share({ title, text: `${text}\n${link}`, files, dialogTitle: "Share this song" });
      return;
    } catch (err) {
      if (/cancel/i.test(err?.message || "")) return;
      console.warn("AuraSynq: native share failed", err);
    }
  }

  // Browsers that can share files get the card too
  if (card && typeof navigator !== "undefined" && navigator.canShare) {
    const file = new File([card], `aurasynq-${track.id}.png`, { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title, text, url: link, files: [file] });
        return;
      } catch (e) {
        if (e?.name === "AbortError") return;
      }
    }
  }
  await shareOrCopy({ title, text, url: link }, "Song link copied to clipboard!");
}

export async function shareInvite({ title, text, path }, successMessage) {
  await shareOrCopy({ title, text, url: appLink(path) }, successMessage);
}

