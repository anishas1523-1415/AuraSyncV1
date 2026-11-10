// Tests for the cloud save logic (run: node scripts/cloud-sync-test.mjs).
// Uses an in-memory store that behaves like Firestore: documents are versioned and a transaction
// whose documents changed underneath it is retried, so these tests exercise the real concurrency
// story (two devices saving at once), the chunking of big data, offline failure and corruption.
import assert from "node:assert/strict";
import { syncBlob, deleteCloudLibrary, libPath } from "../src/lib/cloudBlob.js";
import { mergeLiked, mergeActivity, activityTotals, stable } from "../src/lib/library.js";

function fakeStore({ online = () => true, beforeCommit = null } = {}) {
  const docs = new Map(); // key -> { data, version }
  const key = (p) => p.join("/");
  return {
    docs,
    available: () => true,
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (!online()) throw new Error("offline");
        const reads = new Map();
        const writes = [];
        const tx = {
          get: async (p) => { const d = docs.get(key(p)); reads.set(key(p), d?.version || 0); await Promise.resolve(); return d ? structuredClone(d.data) : null; },
          set: (p, data) => writes.push(["set", key(p), structuredClone(data)]),
          delete: (p) => writes.push(["delete", key(p)]),
        };
        const result = await fn(tx);
        if (beforeCommit) await beforeCommit(attempt); // another device may write now
        const changed = [...reads].some(([k, v]) => (docs.get(k)?.version || 0) !== v);
        if (changed) continue; // contention: retry, as Firestore does
        for (const [op, k, data] of writes) {
          if (op === "set") docs.set(k, { data, version: (docs.get(k)?.version || 0) + 1 });
          else docs.delete(k);
        }
        return result;
      }
      throw new Error("too much contention");
    },
    get: async (p) => { const d = docs.get(key(p)); return d ? structuredClone(d.data) : null; },
    list: async (p) => [...docs.keys()].filter((k) => k.startsWith(key(p) + "/")).map((k) => k.slice(key(p).length + 1)),
    deleteMany: async (paths) => paths.forEach((p) => docs.delete(key(p))),
  };
}

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};
const T = Date.now() - 60000;
const song = (id, n) => ({ id, title: id, likedAt: T + n });
const liked = (...songs) => ({ items: songs, removed: {} });
const ids = (x) => x.items.map((s) => s.id).join(",");

await test("first sign-in on a new device restores the cloud library", async () => {
  const store = fakeStore();
  await syncBlob(store, "u1", "liked", liked(song("a", 1), song("b", 2)), mergeLiked);
  const newDevice = await syncBlob(store, "u1", "liked", liked(), mergeLiked); // empty local
  assert.equal(ids(newDevice.merged), "a,b");
});

await test("a different account never sees this one's data", async () => {
  const store = fakeStore();
  await syncBlob(store, "u1", "liked", liked(song("a", 1)), mergeLiked);
  const other = await syncBlob(store, "u2", "liked", liked(), mergeLiked);
  assert.equal(ids(other.merged), "");
});

await test("two devices saving at the same instant both keep their songs (transaction retry)", async () => {
  let injected = false;
  const store = fakeStore({
    beforeCommit: async () => {
      if (injected) return;
      injected = true;
      // the web app saves its own like in the middle of the phone's save
      store.docs.set("users/u1/lib/liked", { data: { json: JSON.stringify(liked(song("web", 5))), parts: 1 }, version: 99 });
    },
  });
  const phone = await syncBlob(store, "u1", "liked", liked(song("phone", 4)), mergeLiked);
  assert.equal(phone.ok, true);
  assert.equal(ids(phone.merged), "phone,web");
  const cloud = JSON.parse(store.docs.get("users/u1/lib/liked").data.json);
  assert.equal(ids(cloud), "phone,web");
});

await test("offline: the save fails cleanly and nothing in the cloud changes", async () => {
  let online = true;
  const store = fakeStore({ online: () => online });
  await syncBlob(store, "u1", "liked", liked(song("a", 1)), mergeLiked);
  online = false;
  const result = await syncBlob(store, "u1", "liked", liked(song("a", 1), song("offline", 9)), mergeLiked);
  assert.equal(result.ok, false);
  assert.equal(ids(JSON.parse(store.docs.get("users/u1/lib/liked").data.json)), "a");
  online = true;
  const retry = await syncBlob(store, "u1", "liked", liked(song("a", 1), song("offline", 9)), mergeLiked);
  assert.equal(ids(retry.merged), "a,offline");
});

await test("a huge library is split across documents and read back whole", async () => {
  const store = fakeStore();
  const big = liked(...Array.from({ length: 4000 }, (_, i) => ({ ...song(`s${i}`, i), title: "x".repeat(150), cover: "https://example.com/" + "c".repeat(120) })));
  const saved = await syncBlob(store, "u1", "liked", big, mergeLiked);
  assert.equal(saved.ok, true);
  const parts = [...store.docs.keys()].filter((k) => k.startsWith("users/u1/lib/liked"));
  assert.ok(parts.length > 1, `expected several documents, got ${parts.length}`);
  for (const k of parts) assert.ok(store.docs.get(k).data.json.length <= 240000, "each document stays under the size limit");
  const again = await syncBlob(store, "u1", "liked", liked(), mergeLiked);
  assert.equal(again.merged.items.length, 4000);
});

await test("shrinking a big library removes the leftover documents", async () => {
  const store = fakeStore();
  const big = liked(...Array.from({ length: 3000 }, (_, i) => ({ ...song(`s${i}`, i), title: "y".repeat(200) })));
  await syncBlob(store, "u1", "liked", big, mergeLiked);
  const before = [...store.docs.keys()].filter((k) => k.includes("liked~")).length;
  const everyoneUnliked = { items: [], removed: Object.fromEntries(big.items.map((s) => [s.id, T + 999999])) };
  await syncBlob(store, "u1", "liked", everyoneUnliked, mergeLiked);
  const after = [...store.docs.keys()].filter((k) => k.includes("liked~")).length;
  assert.ok(before > 0 && after < before, `${before} -> ${after}`);
});

await test("a corrupt cloud copy is backed up, then replaced by this device's data", async () => {
  const store = fakeStore();
  store.docs.set("users/u1/lib/liked", { data: { json: "{not json", parts: 1 }, version: 1 });
  const result = await syncBlob(store, "u1", "liked", liked(song("a", 1)), mergeLiked);
  assert.equal(result.ok, true);
  assert.ok([...store.docs.keys()].some((k) => k.includes("liked.corrupt-")), "backup kept");
});

await test("unchanged data is not written again", async () => {
  const store = fakeStore();
  await syncBlob(store, "u1", "liked", liked(song("a", 1)), mergeLiked);
  const version = store.docs.get("users/u1/lib/liked").version;
  await syncBlob(store, "u1", "liked", liked(song("a", 1)), mergeLiked);
  assert.equal(store.docs.get("users/u1/lib/liked").version, version);
});

await test("listening totals from two devices add up through the cloud", async () => {
  const store = fakeStore();
  const slot = (seconds, plays) => ({ seconds, plays, artists: { A: plays }, genres: {}, moods: {}, at: T });
  await syncBlob(store, "u1", "activity", { devices: { phone: slot(600, 10) } }, mergeActivity);
  const web = await syncBlob(store, "u1", "activity", { devices: { web: slot(300, 5) } }, mergeActivity);
  const total = activityTotals(web.merged);
  assert.equal(total.seconds, 900);
  assert.equal(total.plays, 15);
});

await test("deleting the account removes every library document", async () => {
  const store = fakeStore();
  await syncBlob(store, "u1", "liked", liked(song("a", 1)), mergeLiked);
  await syncBlob(store, "u1", "playlists", { items: [], deleted: {} }, (a) => a);
  assert.equal(await deleteCloudLibrary(store, "u1"), true);
  assert.equal([...store.docs.keys()].filter((k) => k.startsWith("users/u1")).length, 0);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
process.exit(process.exitCode || 0);
