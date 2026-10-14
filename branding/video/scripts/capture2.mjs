// Clean recapture for the promo. Every scene is prepared first (page loaded, every cover image
// downloaded, song fully buffered and playing), then recorded, then checked; scenes that show a
// loader, a spinner or a blank cover are recorded again.
// Usage: node scripts/capture2.mjs [scene ...]
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const SERIAL = "ZD222W9GN6";
const adb = (...args) => execFileSync("adb", ["-s", SERIAL, ...args], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ─── DevTools ───
let ws;
let msgId = 0;
async function connect() {
  const pid = adb("shell", "pidof", "com.aurasynq.app");
  execFileSync("adb", ["-s", SERIAL, "forward", "--remove-all"]);
  execFileSync("adb", ["-s", SERIAL, "forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`]);
  const pages = await (await fetch("http://localhost:9222/json")).json();
  ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
}
function evaluate(expression, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const id = ++msgId;
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    const onMsg = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMsg);
      resolve(msg.result?.result?.value);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}
const js = (fn, ...args) => evaluate(`(${fn})(...${JSON.stringify(args)})`);
const click = (selector) => js((sel) => { const el = document.querySelector(sel); el?.click(); return !!el; }, selector);
const clickText = (selector, text) => js((sel, t) => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(t) || e.title?.startsWith(t));
  el?.click();
  return !!el;
}, selector, text);
const path = () => evaluate("location.pathname");
const tap = (x, y) => adb("shell", "input", "tap", String(x), String(y));
const swipe = (x1, y1, x2, y2, ms) => adb("shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(ms));
const typeText = (text) => adb("shell", "input", "text", text.replace(/ /g, "%s"));

// Masks the signed-in person's name, email and photo (screen only, while recording)
const MASK = `(() => {
  if (window.__brandMask) return 'already';
  const mask = () => {
    document.querySelectorAll('img').forEach((img) => {
      if (/googleusercontent\\.com\\/a\\//.test(img.src)) img.src = '/icon-192x192.png';
    });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (/@gmail\\.com|@skct/i.test(text)) node.nodeValue = 'you@aurasynq.app';
      else if (/^(ABI|LOVELY KING)$/i.test(text.trim())) node.nodeValue = node.parentElement?.closest('[class*=topBar], header') ? 'Aura' : 'Aura Listener';
    }
  };
  mask();
  window.__brandMask = new MutationObserver(mask);
  window.__brandMask.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src'] });
  return 'masked';
})()`;

// ─── Readiness: every image on screen downloaded, no loaders ───
const LOADER_TEXT = /Loading|Syncing Live|Syncing what|Streaming\.\.\.|Connecting to your account/;
async function imagesReady(timeoutMs = 30000) {
  return js(async (limit) => {
    const urls = new Set();
    document.querySelectorAll("img").forEach((i) => i.src && urls.add(i.src));
    document.querySelectorAll("[style*='background-image']").forEach((e) => {
      const m = e.style.backgroundImage.match(/url\("?(.*?)"?\)/);
      if (m) urls.add(m[1]);
    });
    const load = (u) => new Promise((r) => { const im = new Image(); im.onload = () => r(true); im.onerror = () => r(false); im.src = u; setTimeout(() => r(false), limit); });
    const results = await Promise.all([...urls].map(load));
    return { total: urls.size, failed: results.filter((x) => !x).length };
  }, timeoutMs);
}
async function screenClean() {
  return js((pattern) => {
    const text = document.body.innerText;
    const loader = new RegExp(pattern).test(text);
    const skeleton = !!document.querySelector("[class*=skeleton]");
    const spinner = [...document.querySelectorAll("[class*=spinner], [class*=loaderOverlay]")].some((e) => e.offsetParent);
    return { loader, skeleton, spinner, ok: !loader && !skeleton && !spinner };
  }, LOADER_TEXT.source);
}
async function waitReady(label, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const img = await imagesReady();
    const clean = await screenClean();
    if (img && clean?.ok && img.failed === 0) return true;
    log(`  waiting for ${label}:`, JSON.stringify({ img, clean }));
    await sleep(2500);
  }
  return false;
}
const audioState = () => js(() => {
  const a = document.querySelector("audio");
  return a ? { paused: a.paused, t: a.currentTime, rs: a.readyState, src: a.src.slice(0, 16), title: document.querySelector("[class*=miniPlayer] [class*=title], [class*=info] h1")?.textContent } : null;
});
async function waitPlaying(label, minTime = 2) {
  for (let i = 0; i < 40; i++) {
    const s = await audioState();
    if (s && !s.paused && s.rs >= 3 && s.t >= minTime) return s;
    await sleep(1500);
  }
  log(`  ${label}: song never settled`);
  return null;
}

// ─── Navigation (client-side, keeps the app's state) ───
// Never the Android back key here: on Home it sends the app to the background
async function goHome() {
  for (let i = 0; i < 3 && (await path()) !== "/"; i++) {
    if (!(await click('a[href="/"]'))) await evaluate("history.back()");
    await sleep(1500);
  }
}
async function go(href) {
  await click(`a[href="${href}"]`);
  await sleep(1200);
}

// ─── Recording with automatic re-takes ───
const SIZE = "864x1920";
async function record(name, seconds, prepare, actions, { retries = 3 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await prepare();
    const remote = `/sdcard/aura_${name}.mp4`;
    const problems = [];
    const rec = spawn("adb", ["-s", SERIAL, "shell", "screenrecord", "--size", SIZE, "--bit-rate", "16000000", "--time-limit", String(seconds), remote]);
    await sleep(700);
    // Watch the screen while the scene plays
    let watching = true;
    const watcher = (async () => {
      await sleep(2200); // allow the opening transition
      while (watching) {
        const c = await screenClean();
        if (c && !c.ok) problems.push(c);
        await sleep(700);
      }
    })();
    await actions();
    await new Promise((resolve) => rec.on("exit", resolve));
    watching = false;
    await watcher;
    execFileSync("adb", ["-s", SERIAL, "pull", remote, `public/clips/${name}.mp4`], { stdio: "ignore" });
    adb("shell", "rm", remote);
    if (!problems.length) {
      log(`✓ ${name} (take ${attempt})`);
      return true;
    }
    log(`✗ ${name} take ${attempt}: ${JSON.stringify(problems[0])}`);
  }
  log(`! ${name}: kept the last take`);
  return false;
}

// ─── Scenes ───
let songReady = false;
async function ensureSong() {
  // Believer: a strong cover, synced lyrics, well known
  const s = await audioState();
  if (songReady && s && !s.paused) return;
  await goHome();
  await go("/search");
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(800);
    tap(609, 457); // the search box
    await sleep(700);
    typeText("believer imagine dragons");
    await sleep(7000);
    await clickText("[class*=resultItem]", "Believer");
    if (await waitPlaying("believer", 4)) break;
    await click("[class*=clearBtn]");
  }
  await sleep(15000); // let the next song pre-download too
  songReady = true;
}

const SCENES = {
  async home() {
    await record("home", 9, async () => { await goHome(); await waitReady("home"); }, async () => {
      await sleep(5500);
      tap(1083, 2505);
      await sleep(2600);
      tap(1083, 2505);
    });
  },
  async trending() {
    // Each visit mixes new songs, so film the visit whose covers were loaded (no re-navigation)
    await record("trending", 10, async () => {
      await goHome(); await go("/trending"); await sleep(3000); await waitReady("trending", 20);
    }, async () => {
      await sleep(4500);
      swipe(610, 1900, 610, 1200, 1400);
      await sleep(2500);
    });
  },
  async tamil() {
    await goHome(); await go("/trends"); await waitReady("tamil"); await sleep(3000);
    await record("tamil", 9, async () => { await goHome(); await sleep(800); }, async () => {
      await sleep(1000);
      await go("/trends");
    });
  },
  async search() {
    await record("search", 10, async () => { await goHome(); await go("/search"); await waitReady("search"); }, async () => {
      await sleep(900);
      tap(609, 457); // the search box
      await sleep(600);
      typeText("anirudh");
      await sleep(4500);
      await js(() => document.activeElement?.blur());
    });
  },
  async player() {
    await ensureSong();
    await record("player", 12, async () => {
      if ((await path()) !== "/player") { await click("[class*=miniPlayer]"); await sleep(2500); }
      await waitReady("player");
    }, async () => {
      await sleep(3000);
      tap(609, 2043); // pause
      await sleep(1600);
      tap(609, 2043); // play
      await sleep(2600);
      swipe(900, 1300, 150, 1300, 220); // next song (pre-downloaded)
    });
  },
  async lyrics() {
    await ensureSong();
    await record("lyrics", 8, async () => {
      if ((await path()) !== "/player") { await click("[class*=miniPlayer]"); await sleep(2500); }
      await waitReady("player");
    }, async () => {
      await sleep(900);
      // double tap the card for lyrics
      tap(609, 1650); await sleep(120); tap(609, 1650);
      await sleep(5500);
    });
    // back to the card
    tap(609, 1300); await sleep(120); tap(609, 1300);
    await sleep(1000);
  },
  async queue() {
    await ensureSong();
    await record("queue", 8, async () => {
      if ((await path()) !== "/player") { await click("[class*=miniPlayer]"); await sleep(2500); }
      await waitReady("player");
    }, async () => {
      await sleep(900);
      await click('button[title="View Queue"]');
      await sleep(2800);
      await click('button[title="Sync fresh songs"]');
      await sleep(3500);
    });
    await click('button[title="View Queue"]');
  },
  async discover() {
    await goHome(); await go("/discover"); await sleep(4000); await waitReady("discover");
    await record("discover", 10, async () => { await waitReady("discover"); }, async () => {
      await sleep(2600);
      swipe(610, 2000, 610, 500, 450);
      await sleep(3200);
      swipe(610, 2000, 610, 500, 450);
    });
  },
  async category() {
    await goHome(); await go("/category/workout"); await waitReady("workout");
    await record("category", 9, async () => { await goHome(); await sleep(800); }, async () => {
      await sleep(900);
      await go("/category/workout");
      await sleep(3800);
      swipe(610, 2100, 610, 1300, 1400);
    });
  },
  async library() {
    await record("library", 9, async () => { await goHome(); await go("/library"); await waitReady("library"); }, async () => {
      await sleep(2200);
      await clickText("[class*=listItem]", "Liked");
      await sleep(3500);
      swipe(610, 2000, 610, 1300, 1400);
    });
  },
  async blend() {
    await record("blend", 10, async () => { await goHome(); await go("/blend"); await waitReady("blend"); }, async () => {
      await sleep(1500);
      await js(() => document.querySelector("[class*=friendCard]")?.click());
      await sleep(1200);
      await js(() => [...document.querySelectorAll("button")].find((b) => /blend/i.test(b.textContent) && !b.disabled)?.click());
      await sleep(5500);
    }, { retries: 1 });
  },
  async society() {
    await record("society", 8, async () => { await goHome(); await go("/society"); await waitReady("society"); }, async () => {
      await sleep(6000);
    }, { retries: 1 });
  },
  async profile() {
    await record("profile", 11, async () => { await goHome(); await go("/profile"); await waitReady("profile"); }, async () => {
      await sleep(2200);
      swipe(610, 2100, 610, 900, 1800);
      await sleep(1500);
      await clickText("h4", "Preferences");
      await sleep(1600);
      swipe(610, 2000, 610, 1400, 900);
      await sleep(1500);
    });
  },
};

mkdirSync("public/clips", { recursive: true });
adb("shell", "am", "start", "-n", "com.aurasynq.app/.MainActivity");
await sleep(5000);
await connect();
log("mask:", await evaluate(MASK));
const wanted = process.argv.slice(2);
for (const [name, run] of Object.entries(SCENES)) {
  if (wanted.length && !wanted.includes(name)) continue;
  log(`scene ${name}`);
  try { await run(); } catch (e) { log(`! ${name} failed:`, e.message); }
}
ws.close();
log("done");
process.exit(0);
