// Stand-in for src/lib/dbSync.js: the real cloud logic (cloudBlob.js) over an in-memory Firestore.
import * as blob from "@project/lib/cloudBlob.js";

export const CLOUD = globalThis.__CLOUD__ || (globalThis.__CLOUD__ = { docs: new Map(), online: true });
const key = (p) => p.join("/");

const store = {
  available: () => true,
  async runTransaction(fn) {
    if (!CLOUD.online) throw new Error("offline");
    for (let attempt = 0; attempt < 8; attempt++) {
      const reads = new Map();
      const writes = [];
      const tx = {
        get: async (p) => { const d = CLOUD.docs.get(key(p)); reads.set(key(p), d?.version || 0); return d ? structuredClone(d.data) : null; },
        set: (p, data) => writes.push(["set", key(p), structuredClone(data)]),
        delete: (p) => writes.push(["delete", key(p)]),
      };
      const result = await fn(tx);
      if ([...reads].some(([k, v]) => (CLOUD.docs.get(k)?.version || 0) !== v)) continue;
      for (const [op, k, data] of writes) {
        if (op === "set") CLOUD.docs.set(k, { data, version: (CLOUD.docs.get(k)?.version || 0) + 1 });
        else CLOUD.docs.delete(k);
      }
      return result;
    }
    throw new Error("contention");
  },
  get: async (p) => { if (!CLOUD.online) throw new Error("offline"); const d = CLOUD.docs.get(key(p)); return d ? structuredClone(d.data) : null; },
  list: async (p) => [...CLOUD.docs.keys()].filter((k) => k.startsWith(key(p) + "/")).map((k) => k.slice(key(p).length + 1)),
  deleteMany: async (paths) => paths.forEach((p) => CLOUD.docs.delete(key(p))),
};

export const syncBlob = (userId, name, local, merge) => blob.syncBlob(store, userId, name, local, merge);
export const readCloud = (userId, name) => blob.readCloud(store, userId, name);
export const deleteCloudLibrary = (userId) => blob.deleteCloudLibrary(store, userId);
export const writeMarker = async (userId, name, data) => {
  if (!CLOUD.online) return false;
  CLOUD.docs.set(key(blob.libPath(userId, name)), { data: { ...data, at: Date.now() }, version: 1 });
  return true;
};
export const loadLegacyLibrary = async (userId) => {
  if (!CLOUD.online) return null;
  const d = CLOUD.docs.get(`users/${userId}`);
  if (!d) return {};
  const data = d.data;
  return {
    likedTracks: data.likedTracks || [], customPlaylists: data.customPlaylists || [],
    playHistory: data.playHistory || [], listenStats: data.listenStats || null,
  };
};
export const syncProfileToCloud = async () => true;
