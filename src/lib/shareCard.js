"use client";
// Spotify-style share card: a 1080x1920 story image with the song's cover on a backdrop tinted
// from the cover itself, the title and artist, and the AuraSynq mark. Returns a PNG Blob.
import { isMobileApp } from "@/lib/api";

const WIDTH = 1080;
const HEIGHT = 1920;
const COVER = 760;

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

// Covers live on Google's image servers. In the app they're fetched natively (no CORS), so the
// canvas can still be exported; on the web the image servers allow cross-origin reads.
async function loadCover(url) {
  if (!url) return null;
  try {
    if (isMobileApp) {
      const { nativeFetchBytes } = await import("@/lib/ondevice/nativeHttp");
      const res = await nativeFetchBytes(url);
      if (res.status !== 200 || !res.bytes) throw new Error(`HTTP ${res.status}`);
      const objectUrl = URL.createObjectURL(new Blob([res.bytes]));
      try { return await loadImage(objectUrl); } finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 0); }
    }
    return await loadImage(url);
  } catch (e) {
    return null;
  }
}

// Average colour of the cover, darkened, for the backdrop
function dominantColor(img) {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, 24, 24);
    const { data } = ctx.getImageData(0, 0, 24, 24);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    const n = data.length / 4;
    return [r / n, g / n, b / n].map((v) => Math.round(v * 0.55));
  } catch (e) {
    return [88, 40, 140];
  }
}

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// Up to `maxLines` lines, the last one ending in "…" if the text doesn't fit
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

export async function renderShareCard({ title, artist, cover }) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");

  const [coverImg, logo] = await Promise.all([loadCover(cover), loadImage("/logo-emblem.png").catch(() => null)]);
  const [r, g, b] = coverImg ? dominantColor(coverImg) : [88, 40, 140];

  // Backdrop: the cover's own colour fading into the app's night sky, with the aura glows
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, `rgb(${r}, ${g}, ${b})`);
  bg.addColorStop(0.62, "#0d1424");
  bg.addColorStop(1, "#090d18");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const [x, y, radius, color] of [[180, 1500, 520, "rgba(138, 43, 226, 0.35)"], [920, 1750, 460, "rgba(236, 72, 153, 0.28)"]]) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, color);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Cover with a soft shadow and rounded corners
  const coverX = (WIDTH - COVER) / 2;
  const coverY = 300;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 80;
  ctx.shadowOffsetY = 30;
  roundRect(ctx, coverX, coverY, COVER, COVER, 44);
  ctx.fillStyle = "#1a1a2e";
  ctx.fill();
  ctx.restore();
  if (coverImg) {
    ctx.save();
    roundRect(ctx, coverX, coverY, COVER, COVER, 44);
    ctx.clip();
    // Fill the square from the image's centre (video thumbnails are 16:9)
    const side = Math.min(coverImg.width, coverImg.height);
    ctx.drawImage(coverImg, (coverImg.width - side) / 2, (coverImg.height - side) / 2, side, side, coverX, coverY, COVER, COVER);
    ctx.restore();
  }

  // Title and artist
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 68px Inter, system-ui, sans-serif";
  const titleLines = wrapText(ctx, title || "Unknown song", WIDTH - 160, 2);
  let y = coverY + COVER + 130;
  for (const line of titleLines) {
    ctx.fillText(line, WIDTH / 2, y);
    y += 82;
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.font = "500 42px Inter, system-ui, sans-serif";
  ctx.fillText(wrapText(ctx, artist || "", WIDTH - 200, 1)[0] || "", WIDTH / 2, y + 6);

  // AuraSynq mark
  const markY = HEIGHT - 230;
  if (logo) ctx.drawImage(logo, WIDTH / 2 - 210, markY - 70, 112, 91);
  const word = ctx.createLinearGradient(WIDTH / 2 - 80, 0, WIDTH / 2 + 220, 0);
  word.addColorStop(0, "#a855f7");
  word.addColorStop(1, "#ec4899");
  ctx.textAlign = "left";
  ctx.fillStyle = word;
  ctx.font = "800 64px Inter, system-ui, sans-serif";
  ctx.fillText("AuraSynq", WIDTH / 2 - 80, markY);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.font = "500 34px Inter, system-ui, sans-serif";
  ctx.fillText("Listen on AuraSynq", WIDTH / 2, markY + 80);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't draw the card"))), "image/png"));
}
