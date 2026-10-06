"use client";

// Lightweight glass toast, replacing blocking alert() popups.
// DOM-based so it can be called from anywhere (contexts, event handlers) without a provider.

const CONTAINER_ID = "aura-toast-stack";

const VARIANTS = {
  info: { border: "rgba(168, 85, 247, 0.45)", glow: "rgba(168, 85, 247, 0.35)", bg: "rgba(24, 16, 40, 0.82)" },
  success: { border: "rgba(236, 72, 153, 0.45)", glow: "rgba(236, 72, 153, 0.3)", bg: "rgba(36, 14, 32, 0.82)" },
  error: { border: "rgba(244, 63, 94, 0.6)", glow: "rgba(244, 63, 94, 0.35)", bg: "rgba(60, 10, 20, 0.85)" },
};

function getContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    container.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:calc(100px + env(safe-area-inset-bottom, 0px))",
      "transform:translateX(-50%)",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "gap:8px",
      "z-index:99999",
      "pointer-events:none",
      "width:max-content",
      "max-width:calc(100vw - 32px)",
    ].join(";");
    document.body.appendChild(container);
  }
  return container;
}

export function toast(message, { variant = "info", duration = 2800 } = {}) {
  if (typeof document === "undefined" || !message) return;
  const colors = VARIANTS[variant] || VARIANTS.info;
  const container = getContainer();

  // Collapse duplicates (e.g. repeated stream failures) instead of stacking them
  for (const existing of container.children) {
    if (existing.textContent === message) return;
  }

  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText = [
    `background:${colors.bg}`,
    `border:1px solid ${colors.border}`,
    `box-shadow:0 10px 30px rgba(0,0,0,0.45), 0 0 18px ${colors.glow}`,
    "backdrop-filter:blur(16px)",
    "-webkit-backdrop-filter:blur(16px)",
    "color:#fff",
    "padding:10px 18px",
    "border-radius:999px",
    "font-size:0.85rem",
    "font-weight:600",
    "letter-spacing:0.2px",
    "text-align:center",
    "line-height:1.35",
    "opacity:0",
    "transform:translateY(12px) scale(0.96)",
    "transition:opacity 0.25s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
  ].join(";");
  container.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0) scale(1)";
  });

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px) scale(0.98)";
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// Copies text, falling back to a native prompt where the Clipboard API is unavailable (http, old WebViews)
export async function copyText(text, successMessage = "Link copied to clipboard!") {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast(successMessage, { variant: "success" });
      return true;
    }
  } catch (e) {}
  window.prompt("Copy this link:", text);
  return false;
}

// Native share sheet when available, clipboard otherwise
export async function shareOrCopy({ title, text, url }, successMessage) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if (e?.name === "AbortError") return; // user closed the share sheet
    }
  }
  await copyText(url, successMessage);
}
