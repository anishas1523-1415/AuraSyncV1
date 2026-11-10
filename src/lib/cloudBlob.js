// Pure cloud-storage logic (no Firebase import, so it can be tested with an in-memory store).
// See dbSync.js for how it is wired to Firestore and for the data layout.

const PART_CHARS = 240000;
const TIMEOUT_MS = 20000;

export const libPath = (userId, name) => ["users", userId, "lib", name];

const withTimeout = (promise, ms = TIMEOUT_MS) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
]);

const toParts = (json) => {
  const parts = [];
  for (let i = 0; i < json.length; i += PART_CHARS) parts.push(json.slice(i, i + PART_CHARS));
  return parts.length ? parts : [""];
};

// Reads one kind of data inside a transaction (all reads before any write)
async function readBlob(tx, userId, name) {
  const head = await tx.get(libPath(userId, name));
  if (!head) return { value: null, parts: 0, json: null };
  const count = Math.max(1, Number(head.parts) || 1);
  let json = String(head.json || "");
  for (let i = 1; i < count; i++) {
    const part = await tx.get(libPath(userId, `${name}~${i}`));
    json += String(part?.json || "");
  }
  try {
    return { value: JSON.parse(json), parts: count, json };
  } catch (e) {
    return { value: null, parts: count, json, corrupt: true };
  }
}

// Merge this device's `local` data with the cloud copy and save the result. Resolves to
// { ok: true, merged } or { ok: false } (offline, rules, timeout): the data is never lost, the
// caller just tries again later.
export async function syncBlob(store, userId, name, local, merge) {
  if (!userId || !store.available()) return { ok: false };
  try {
    const merged = await withTimeout(store.runTransaction(async (tx) => {
      const cloud = await readBlob(tx, userId, name);
      // A corrupt cloud copy is never silently replaced without a trace: keep it as a backup first
      if (cloud.corrupt) tx.set(libPath(userId, `${name}.corrupt-${Date.now()}`), { json: String(cloud.json).slice(0, PART_CHARS), at: Date.now() });
      const result = merge(local, cloud.value);
      const json = JSON.stringify(result);
      if (json !== cloud.json) {
        const parts = toParts(json);
        parts.forEach((part, i) => tx.set(libPath(userId, i === 0 ? name : `${name}~${i}`), i === 0 ? { json: part, parts: parts.length, at: Date.now() } : { json: part }));
        for (let i = parts.length; i < cloud.parts; i++) tx.delete(libPath(userId, `${name}~${i}`)); // old extra parts
      }
      return result;
    }));
    return { ok: true, merged };
  } catch (err) {
    console.warn(`AuraSynq: couldn't sync ${name}`, err?.message || err);
    return { ok: false };
  }
}


export async function readCloud(store, userId, name) {
  if (!userId || !store.available()) return { ok: false };
  try {
    const head = await withTimeout(store.get(libPath(userId, name)));
    return { ok: true, exists: !!head, data: head };
  } catch (err) {
    return { ok: false };
  }
}

export async function deleteCloudLibrary(store, userId) {
  if (!userId || !store.available()) return false;
  try {
    const names = await withTimeout(store.list(["users", userId, "lib"]));
    await withTimeout(store.deleteMany([...names.map((n) => libPath(userId, n)), ["users", userId]]));
    return true;
  } catch (err) {
    console.warn("AuraSynq: couldn't delete the cloud library", err);
    return false;
  }
}
