// Merge rules for a listener's library (liked songs, playlists, history, listening activity).
// Every merge is commutative, associative and idempotent (a "CRDT"): merging the same data twice,
// or in any order, from any number of devices gives the same result, so no device can overwrite
// another's changes. Nothing here touches the network or the UI, which keeps it testable.
//
// How deletions work: removing something leaves a timestamped marker ("tombstone"). A copy of the
// item that is NEWER than the marker survives (it was added again, or edited, after the removal).
// Items saved before timestamps existed count as time 0, so any real removal beats them.

const TOMBSTONE_TTL_MS = 120 * 24 * 60 * 60 * 1000;

export const ts = (value) => Number(value) || 0;

const unionMax = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [key, time] of Object.entries(b)) out[key] = Math.max(ts(out[key]), ts(time));
  return out;
};

const pruneTombstones = (map, now = Date.now()) => {
  const out = {};
  for (const [key, time] of Object.entries(map || {})) if (now - ts(time) < TOMBSTONE_TTL_MS) out[key] = ts(time);
  return out;
};

// Keeps the first occurrence of each id, preferring the entry with the larger timestamp field
const pickNewest = (lists, field) => {
  const byId = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      if (!item?.id) continue;
      const seen = byId.get(item.id);
      if (!seen || ts(item[field]) > ts(seen[field])) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
};

// Stable ascending sort by a timestamp field (ties keep their original relative order)
const sortByTime = (items, field) => items
  .map((item, index) => ({ item, index }))
  .sort((x, y) => ts(x.item[field]) - ts(y.item[field]) || x.index - y.index)
  .map(({ item }) => item);

// ─── Liked songs: { items: [{ id, ..., likedAt }], removed: { id: time } } ───

export function mergeLiked(a, b) {
  const removed = pruneTombstones(unionMax(a?.removed, b?.removed));
  const items = pickNewest([a?.items, b?.items], "likedAt")
    .filter((song) => !(removed[song.id] && removed[song.id] >= ts(song.likedAt)));
  return { items: sortByTime(items, "likedAt"), removed };
}

// ─── Playlists ───
// playlist: { id, name, nameAt, tracks: [{ id, ..., addedAt }], removed: { trackId: time },
//             createdAt, updatedAt, isCollaborative, collaborators }
// state:    { items: [playlist], deleted: { playlistId: time } }

const createdFromId = (playlist) => ts(playlist.createdAt) || ts(String(playlist.id).match(/^playlist_(\d{10,})_/)?.[1]);

function mergePlaylist(p, q) {
  const removed = unionMax(p.removed, q.removed);
  const tracks = pickNewest([p.tracks, q.tracks], "addedAt")
    .filter((track) => !(removed[track.id] && removed[track.id] >= ts(track.addedAt)));
  const newer = ts(q.updatedAt) > ts(p.updatedAt) ? q : p; // for the remaining plain fields
  const nameFrom = ts(q.nameAt) > ts(p.nameAt) ? q : p;
  return {
    ...p,
    ...newer,
    id: p.id,
    name: nameFrom.name,
    nameAt: Math.max(ts(p.nameAt), ts(q.nameAt)),
    tracks: sortByTime(tracks, "addedAt"),
    removed,
    createdAt: Math.min(...[createdFromId(p), createdFromId(q)].filter(Boolean)) || 0,
    updatedAt: Math.max(ts(p.updatedAt), ts(q.updatedAt)),
  };
}

export function mergePlaylists(a, b) {
  const deleted = pruneTombstones(unionMax(a?.deleted, b?.deleted));
  const byId = new Map();
  for (const list of [a?.items, b?.items]) {
    for (const playlist of list || []) {
      if (!playlist?.id) continue;
      byId.set(playlist.id, byId.has(playlist.id) ? mergePlaylist(byId.get(playlist.id), playlist) : { ...playlist, tracks: playlist.tracks || [] });
    }
  }
  const items = [...byId.values()]
    // A playlist edited after someone deleted it survives (their edit isn't thrown away)
    .filter((playlist) => !(deleted[playlist.id] && deleted[playlist.id] >= Math.max(ts(playlist.updatedAt), ts(playlist.nameAt), ...(playlist.tracks || []).map((t) => ts(t.addedAt)))));
  const ordered = items
    .map((playlist, index) => ({ playlist, index }))
    // Creation time, then id: the same order whichever device merges first
    .sort((x, y) => createdFromId(x.playlist) - createdFromId(y.playlist) || String(x.playlist.id).localeCompare(String(y.playlist.id)))
    .map(({ playlist }) => playlist);
  return { items: ordered, deleted };
}

// ─── Play history (recent songs): { items: [{ id, ..., playedAt }], clearedAt } ───

export function mergeHistory(a, b, limit = 50) {
  const clearedAt = Math.max(ts(a?.clearedAt), ts(b?.clearedAt));
  const items = pickNewest([a?.items, b?.items], "playedAt").filter((song) => ts(song.playedAt) > clearedAt);
  const newestFirst = items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => ts(y.item.playedAt) - ts(x.item.playedAt) || x.index - y.index)
    .map(({ item }) => item);
  return { items: newestFirst.slice(0, limit), clearedAt };
}

// ─── Listening activity (lifetime totals): { devices: { deviceId: slot } } ───
// slot: { seconds, plays, artists: {name: n}, genres: {}, moods: {}, at }
// Each device only ever writes its own slot, and its counters only grow, so merging slots takes
// the larger value per counter. The lifetime total is the sum over all devices: listening on two
// devices adds up instead of one overwriting the other.

const maxMaps = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [key, n] of Object.entries(b)) out[key] = Math.max(Number(out[key]) || 0, Number(n) || 0);
  return out;
};

export const emptySlot = () => ({ seconds: 0, plays: 0, artists: {}, genres: {}, moods: {}, at: 0 });

export function mergeSlot(a = emptySlot(), b = emptySlot()) {
  return {
    seconds: Math.max(Number(a.seconds) || 0, Number(b.seconds) || 0),
    plays: Math.max(Number(a.plays) || 0, Number(b.plays) || 0),
    artists: maxMaps(a.artists, b.artists),
    genres: maxMaps(a.genres, b.genres),
    moods: maxMaps(a.moods, b.moods),
    at: Math.max(ts(a.at), ts(b.at)),
  };
}

export function mergeActivity(a, b) {
  const devices = {};
  for (const source of [a?.devices, b?.devices]) {
    for (const [id, slot] of Object.entries(source || {})) devices[id] = devices[id] ? mergeSlot(devices[id], slot) : mergeSlot(emptySlot(), slot);
  }
  return { devices };
}

// Totals across every device: { seconds, plays, artists: {name: n}, genres, moods }
export function activityTotals(activity) {
  const total = { seconds: 0, plays: 0, artists: {}, genres: {}, moods: {} };
  for (const slot of Object.values(activity?.devices || {})) {
    total.seconds += Number(slot.seconds) || 0;
    total.plays += Number(slot.plays) || 0;
    for (const field of ["artists", "genres", "moods"]) {
      for (const [key, n] of Object.entries(slot[field] || {})) total[field][key] = (total[field][key] || 0) + (Number(n) || 0);
    }
  }
  return total;
}

// ─── Settings (last write wins as a whole): { values, at } ───
export const mergeSettings = (a, b) => (ts(b?.at) > ts(a?.at) ? b : a || b || null);

// A stable string for "has this changed?" checks (keys sorted so order never matters)
export function stable(value) {
  return JSON.stringify(value, (key, v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));
}
