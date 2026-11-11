// Copies the phone's hum search index (melody contours + song names, no audio) to
// bench/hum/index.json for the offline benchmark. Needs the app open on a phone connected over USB
// with debugging on (run: node scripts/hum-export-index.mjs).
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const pid = execSync("adb shell pidof com.aurasynq.app").toString().trim();
if (!pid) throw new Error("AuraSynq isn't running on the phone");
execSync(`adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
try {
  const pages = await (await fetch("http://127.0.0.1:9222/json")).json();
  const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const expression = `(async () => {
    const refs = await window.__auraMelody.references();
    return refs.map((r) => ({ id: r.id, track: r.track, contour: Array.from(r.contour, (v) => (Number.isNaN(v) ? null : v)) }));
  })()`;
  const result = await new Promise((resolve) => {
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) resolve(m.result?.result?.value); };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  if (!Array.isArray(result)) throw new Error("Couldn't read the index (is the app open?)");
  mkdirSync("bench/hum", { recursive: true });
  writeFileSync("bench/hum/index.json", JSON.stringify({ exportedAt: new Date().toISOString(), songs: result }));
  console.log(`exported ${result.length} songs to bench/hum/index.json`);
  for (const s of result) console.log(`  ${s.id}  ${s.track?.title} — ${s.track?.artist}`);
} finally {
  execSync("adb forward --remove tcp:9222");
}
process.exit(0);
