// Nightly hum search tuning on the shared Hum Lab dataset (run: node scripts/hum-train.mjs).
//
// 1. Reads every shared take (its pitch outline and label) and the outline of every labelled song
//    from the dataset (Supabase; needs SUPABASE_SERVICE_KEY), or from HUM_TRAIN_FILE (a JSON file
//    { takes: [...], songs: [...] }) for local runs.
// 2. Drops junk: takes with too little tune, and contributors whose takes never come near the song
//    they claim (wrong labels or noise).
// 3. Splits the takes by contributor: settings are tuned on one part (train) and judged on people
//    they never saw (held out), so they can't just memorise the dataset.
// 4. Tries combinations of the matcher's settings on train; the best one is compared with the
//    current public/hum-params.json on the held-out takes. The file is rewritten ONLY when the new
//    settings score better there, on enough takes. A bad night can never make hum search worse.
// 5. Removes audio files whose take was withdrawn by its contributor.
//
// Score per take: confident and right +1, confident and wrong -1 (worse than no answer), right song
// among the "best guesses" +0.4, nothing 0. A take of a song with no outline must get no confident
// answer (a confident one is a false positive: -1).
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { contourFromBase64, unpackContour, voicedShare, CONTOUR_FPS } from "../src/lib/melody/contour.js";
import { searchMelody } from "../src/lib/melody/match.js";

// Matching is the slow part (~0.3 s per hum), so it runs on every CPU core
if (!isMainThread) {
  const refs = workerData.refs.map((r) => ({ id: r.id, contour: Float32Array.from(r.contour) }));
  const out = workerData.queries.map((q) => {
    const res = searchMelody(Float32Array.from(q), refs, { top: 5, maxCost: Infinity, minZ: -Infinity, ...workerData.opts });
    return { scored: (res.matches || []).map((m) => ({ id: m.id, cost: m.cost, z: m.z })), reason: res.reason };
  });
  parentPort.postMessage(out);
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL || "https://aldykcamdcizwkqvbubz.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PARAMS_FILE = process.env.HUM_PARAMS_FILE || "public/hum-params.json";
const MIN_HELD_OUT = Number(process.env.HUM_MIN_HELD_OUT || 30); // fewer held-out takes: too noisy to judge
const MARGIN = 0.01;           // the new settings must beat the current ones by at least this much
const MAX_TAKES = 3000;        // newest first; keeps a nightly run well under an hour
const GUESSES = 3;

const log = (...a) => console.log(...a);
const summary = [];
const note = (line) => { log(line); summary.push(line); };

// ─── Data ───
async function rest(path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function loadData() {
  if (process.env.HUM_TRAIN_FILE) return JSON.parse(readFileSync(process.env.HUM_TRAIN_FILE, "utf8"));
  if (!SERVICE_KEY) {
    log("SUPABASE_SERVICE_KEY is not set: nothing to train on.");
    process.exit(0);
  }
  const takes = await rest(`hum_takes?select=take_id,contributor,song_id,kind,segment_start,contour,audio_path,created_at&order=created_at.desc&limit=${MAX_TAKES}`);
  const songs = await rest("song_outlines?select=song_id,title,contour");
  return { takes, songs };
}

const decode = (b64) => unpackContour(contourFromBase64(b64));
const bucket = (text) => parseInt(createHash("sha1").update(String(text)).digest("hex").slice(0, 8), 16) / 0xffffffff;

// ─── Evaluation ───
// One matching pass per (coarseKeep, perSong): thresholds are applied afterwards to the costs and
// z-scores, exactly as the matcher's decide() does, so trying thresholds is nearly free.
const CORES = Math.max(1, availableParallelism());
let plainRefs = null;
async function matchAll(takes, refs, { coarseKeep, perSong }) {
  if (!takes.length) return [];
  plainRefs = plainRefs || refs.map((r) => ({ id: r.id, contour: Array.from(r.contour) }));
  const size = Math.ceil(takes.length / CORES);
  const chunks = [];
  for (let i = 0; i < takes.length; i += size) chunks.push(takes.slice(i, i + size));
  const results = await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), {
      workerData: { refs: plainRefs, queries: chunk.map((t) => Array.from(t.query)), opts: { coarseKeep, perSong } },
    });
    w.once("message", resolve);
    w.once("error", reject);
  })));
  return results.flat().map((r, i) => ({ take: takes[i], ...r }));
}
// Matching results for one (coarseKeep, perSong), kept per take so no hum is matched twice
const passCache = new Map();
async function matchCached(takes, refs, opts) {
  const key = `${opts.coarseKeep}/${opts.perSong}`;
  const cache = passCache.get(key) || new Map();
  passCache.set(key, cache);
  const missing = takes.filter((t) => !cache.has(t.take_id));
  (await matchAll(missing, refs, opts)).forEach((m) => cache.set(m.take.take_id, m));
  return takes.map((t) => cache.get(t.take_id));
}

function scoreOne({ take, scored, reason }, { maxCost, minZ, guessMaxCost }) {
  const best = scored[0];
  if (!best || reason === "too-short" || reason === "no-melody") return 0;
  const confident = best.cost <= maxCost && best.z >= minZ;
  if (!take.inIndex) return confident ? -1 : 0;
  if (confident) return best.id === take.song_id ? 1 : -1;
  if (best.cost > maxCost) return 0; // "no match": the app shows nothing
  const guesses = scored.filter((m) => m.cost <= guessMaxCost).slice(0, GUESSES);
  return guesses.some((m) => m.id === take.song_id) ? 0.4 : 0;
}

const meanScore = (matched, th) => (matched.length ? matched.reduce((n, m) => n + scoreOne(m, th), 0) / matched.length : 0);

function breakdown(matched, th) {
  const known = matched.filter((m) => m.take.inIndex);
  const confident = (m) => m.scored[0] && m.scored[0].cost <= th.maxCost && m.scored[0].z >= th.minZ;
  const right = known.filter((m) => confident(m) && m.scored[0].id === m.take.song_id).length;
  const wrong = known.filter((m) => confident(m) && m.scored[0].id !== m.take.song_id).length;
  const fp = matched.filter((m) => !m.take.inIndex && confident(m)).length;
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
  return `right ${pct(right, known.length)}, wrong ${pct(wrong, known.length)}, false positives ${pct(fp, matched.length - known.length)}`;
}

const range = (from, to, step) => {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(+v.toFixed(3));
  return out;
};

// ─── Audio of withdrawn takes ───
async function removeOrphanAudio(liveTakes) {
  if (!SERVICE_KEY) return;
  const keep = new Set(liveTakes.map((t) => t.audio_path).filter(Boolean));
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
  const list = async (prefix) => {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/hum-audio`, {
        method: "POST", headers, body: JSON.stringify({ prefix, limit: 1000, offset }),
      });
      if (!res.ok) throw new Error(`list ${prefix}: ${res.status}`);
      const items = await res.json();
      out.push(...items);
      if (items.length < 1000) return out;
    }
  };
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000; // a take's audio goes up just before its row
  const orphans = [];
  for (const folder of await list("takes/")) {
    if (folder.id) continue; // folders have no id
    for (const file of await list(`takes/${folder.name}/`)) {
      const path = `takes/${folder.name}/${file.name}`;
      if (file.id && !keep.has(path) && Date.parse(file.created_at) < dayAgo) orphans.push(path);
    }
  }
  for (let i = 0; i < orphans.length; i += 100) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/hum-audio`, {
      method: "DELETE", headers, body: JSON.stringify({ prefixes: orphans.slice(i, i + 100) }),
    });
  }
  if (orphans.length) note(`Removed ${orphans.length} audio file(s) of withdrawn takes.`);
}

// ─── Main ───
const { takes: rawTakes, songs } = await loadData();
note(`Dataset: ${rawTakes.length} takes, ${songs.length} song outlines.`);

const refs = songs.map((s) => ({ id: s.song_id, contour: decode(s.contour) }));
const known = new Set(refs.map((r) => r.id));
let takes = rawTakes
  .map((t) => ({ ...t, query: decode(t.contour), inIndex: known.has(t.song_id) }))
  .filter((t) => t.query.length >= 3 * CONTOUR_FPS && voicedShare(t.query) >= 0.3);
note(`Usable takes (enough tune): ${takes.length}.`);

// Contributors whose takes never come near their claimed song (5+ takes, none in the top 5)
const current = JSON.parse(readFileSync(PARAMS_FILE, "utf8"));
const base = { coarseKeep: 60, perSong: 3, ...current.params };
const firstPass = await matchCached(takes, refs, base);
const byContributor = new Map();
for (const m of firstPass.filter((x) => x.take.inIndex)) {
  const c = byContributor.get(m.take.contributor) || { n: 0, near: 0 };
  c.n += 1;
  if (m.scored[0]?.id === m.take.song_id) c.near += 1;
  byContributor.set(m.take.contributor, c);
}
const junk = new Set([...byContributor].filter(([, c]) => c.n >= 5 && c.near === 0).map(([id]) => id));
if (junk.size) note(`Left out ${junk.size} contributor(s) whose takes never matched their labels.`);
takes = takes.filter((t) => !junk.has(t.contributor));

// Split by contributor (by take when there are too few people to split)
const people = new Set(takes.map((t) => t.contributor));
const heldOut = (t) => (people.size >= 4 ? bucket(t.contributor) : bucket(t.take_id)) < 0.3;
const train = takes.filter((t) => !heldOut(t));
const test = takes.filter(heldOut);
note(`Train: ${train.length} takes; held out: ${test.length} takes (${people.size} contributors).`);

if (test.length < MIN_HELD_OUT || !train.length) {
  note(`Not enough held-out takes yet (need ${MIN_HELD_OUT}): settings unchanged.`);
} else {
  let best = null;
  // Matching settings: fast, current, thorough (each one is a full matching pass)
  for (const [coarseKeep, perSong] of [[40, 2], [60, 3], [100, 5]]) {
    {
      const matched = await matchCached(train, refs, { coarseKeep, perSong });
      for (const maxCost of range(0.45, 1, 0.05)) {
        for (const minZ of range(1.5, 5, 0.25)) {
          for (const guessMaxCost of range(0.5, 0.9, 0.05)) {
            const th = { maxCost, minZ, guessMaxCost };
            const s = meanScore(matched, th);
            if (!best || s > best.score) best = { score: s, params: { maxCost, minZ, coarseKeep, perSong, guessMaxCost } };
          }
        }
      }
    }
  }
  const currentParams = { coarseKeep: 60, perSong: 3, guessMaxCost: 0.65, ...current.params };
  const curMatched = await matchCached(test, refs, currentParams);
  const newMatched = await matchCached(test, refs, best.params);
  const curScore = meanScore(curMatched, currentParams);
  const newScore = meanScore(newMatched, best.params);
  note(`Current settings on held-out takes: score ${curScore.toFixed(3)} (${breakdown(curMatched, currentParams)}).`);
  note(`Best new settings on held-out takes: score ${newScore.toFixed(3)} (${breakdown(newMatched, best.params)}).`);
  note(`New settings: ${JSON.stringify(best.params)}`);
  if (newScore > curScore + MARGIN) {
    writeFileSync(PARAMS_FILE, `${JSON.stringify({
      params: best.params,
      tunedAt: new Date().toISOString(),
      heldOut: { takes: test.length, score: +newScore.toFixed(4), previousScore: +curScore.toFixed(4) },
      dataset: { takes: rawTakes.length, usable: takes.length, songs: songs.length, contributors: people.size },
      note: current.note,
    }, null, 2)}\n`);
    note("Published: the new settings beat the current ones.");
  } else {
    note("Kept the current settings: the new ones aren't better on held-out takes.");
  }
}

await removeOrphanAudio(rawTakes).catch((e) => note(`Audio cleanup skipped: ${e.message}`));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Hum search training\n\n${summary.map((l) => `- ${l}`).join("\n")}\n`);
