// Records the promo's app footage from the phone over USB: drives AuraSynq through DevTools
// (and adb taps), records each scene with `adb shell screenrecord`, and pulls the clips into
// public/clips. Personal details on screen are masked before anything is recorded.
// Usage: node scripts/capture.mjs [sceneName ...]
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const SERIAL = "ZD222W9GN6";
const adb = (...args) => execFileSync("adb", ["-s", SERIAL, ...args], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── DevTools connection to the app's WebView ───
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
function evaluate(expression) {
  return new Promise((resolve) => {
    const id = ++msgId;
    const onMsg = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMsg);
      resolve(msg.result?.result?.value);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return !!el; })()`);
const clickDial = (index) => evaluate(`(() => { const b = [...document.querySelectorAll('button[title]')].filter(b => b.title.includes(' — ')); b[${index}]?.click(); return b[${index}]?.title || null; })()`);
const path = () => evaluate("location.pathname");
const tap = (x, y) => adb("shell", "input", "tap", String(x), String(y));
const swipe = (x1, y1, x2, y2, ms) => adb("shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(ms));

// Masks the signed-in person's name, email and photo while recording (screen only)
const MASK = `(() => {
  if (window.__brandMask) return 'already';
  const swaps = [];
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

// ─── Recording ───
const SIZE = "864x1920";
async function record(name, seconds, actions) {
  const remote = `/sdcard/aura_${name}.mp4`;
  const rec = spawn("adb", ["-s", SERIAL, "shell", "screenrecord", "--size", SIZE, "--bit-rate", "16000000",
    "--time-limit", String(seconds), remote]);
  await sleep(600); // let the encoder start
  const started = Date.now();
  await actions();
  await new Promise((resolve) => rec.on("exit", resolve));
  execFileSync("adb", ["-s", SERIAL, "pull", remote, `public/clips/${name}.mp4`]);
  adb("shell", "rm", remote);
  console.log(`recorded ${name} (${Math.round((Date.now() - started) / 1000)}s of actions)`);
}

// Home → a page by clicking its link (client-side navigation keeps the app state)
async function goHome() {
  if ((await path()) === "/") return;
  await click('a[href="/"]');
  await sleep(1500);
  if ((await path()) !== "/") {
    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await sleep(1500);
  }
}

const SCENES = {
  async home() {
    await goHome();
    await sleep(1500);
    await record("home", 9, async () => {
      await sleep(5500);
      tap(1083, 2505); // open the Aura dial menu
      await sleep(2500);
      tap(1083, 2505);
    });
  },
  async trending() {
    await goHome();
    await record("trending", 10, async () => {
      await sleep(1200);
      await click('a[href="/trending"]');
      await sleep(4000);
      swipe(610, 1900, 610, 1200, 900);
    });
  },
  async tamil() {
    await goHome();
    await record("tamil", 9, async () => {
      await sleep(1200);
      await click('a[href="/trends"]');
    });
  },
  async player() {
    await goHome();
    await click('a[href="/trending"]');
    await sleep(3500);
    await clickDial(1);
    await sleep(3500);
    await record("player", 12, async () => {
      await sleep(800);
      await click("[class*=miniPlayer]");
      await sleep(4500);
      swipe(900, 1300, 150, 1300, 220); // swipe to the next song
      await sleep(3500);
      tap(855, 2181); // next button
    });
  },
  async queue() {
    if ((await path()) !== "/player") {
      await click("[class*=miniPlayer]");
      await sleep(2000);
    }
    await record("queue", 8, async () => {
      await sleep(1000);
      await click('button[title="View Queue"]');
      await sleep(2500);
      await click('button[title="Sync fresh songs"]');
      await sleep(3000);
    });
    await click('button[title="View Queue"]');
  },
  async discover() {
    // Open the feed first and let it load, then record scrolling through it
    await goHome();
    await click('a[href="/discover"]');
    await sleep(9000);
    await record("discover", 10, async () => {
      await sleep(2500);
      swipe(610, 2000, 610, 500, 450);
      await sleep(3500);
      swipe(610, 2000, 610, 500, 450);
    });
  },
  async category() {
    await goHome();
    await record("category", 9, async () => {
      await sleep(800);
      await click('a[href="/category/chill"]');
      await sleep(4000);
      swipe(610, 2100, 610, 1300, 1200);
    });
  },
  async profile() {
    await goHome();
    await record("profile", 10, async () => {
      await sleep(800);
      await click('a[href="/profile"]');
      await sleep(3500);
      swipe(610, 2100, 610, 1100, 1800);
      await sleep(1500);
    });
  },
};

mkdirSync("public/clips", { recursive: true });
adb("shell", "am", "start", "-n", "com.aurasynq.app/.MainActivity");
await sleep(4000);
await connect();
console.log("mask:", await evaluate(MASK));
// Warm the lists once so scenes don't open on a loading spinner
for (const href of ["/trending", "/trends", "/discover", "/category/chill"]) {
  await goHome();
  await click(`a[href="${href}"]`);
  await sleep(href === "/discover" ? 5000 : 3500);
}
const wanted = process.argv.slice(2);
for (const [name, run] of Object.entries(SCENES)) {
  if (wanted.length && !wanted.includes(name)) continue;
  await run();
}
ws.close();
console.log("done");
process.exit(0);
