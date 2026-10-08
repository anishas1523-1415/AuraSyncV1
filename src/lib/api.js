// Where server endpoints and public links live.
// Website: same origin (empty base). Bundled mobile app: the UI runs from files on the phone
// (origin https://localhost), so build-time env vars point it at the deployed site instead.

const trimSlash = (value) => (value || "").replace(/\/+$/, "");

const API_BASE = trimSlash(process.env.NEXT_PUBLIC_API_BASE);
const SITE_URL = trimSlash(process.env.NEXT_PUBLIC_SITE_URL);

export const isMobileApp = process.env.NEXT_PUBLIC_APP_TARGET === "mobile";

export const apiUrl = (path) => `${API_BASE}${path}`;

// Links meant for other people (share / invite) must open the public site, not the app's origin
export const siteUrl = (path = "") =>
  `${SITE_URL || (typeof window !== "undefined" ? window.location.origin : "")}${path}`;
