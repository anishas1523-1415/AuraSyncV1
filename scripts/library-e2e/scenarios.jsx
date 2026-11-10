import assert from "node:assert/strict";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useLibrary } from "@/contexts/useLibrary";
import { resetTaste, recordFeedback } from "@/lib/ir/profile";
import { CLOUD } from "@harness/fakeDb.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── A tiny "device" simulator: separate local storage per device, one shared cloud ───
const storages = {};
let current = null;
const saveCurrent = () => {
  if (!current) return;
  storages[current] = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
};
const loadDevice = (name) => {
  saveCurrent();
  localStorage.clear();
  for (const [k, v] of Object.entries(storages[name] || {})) localStorage.setItem(k, v);
  resetTaste(); localStorage.removeItem("aurasynq_taste");
  current = name;
};

function Probe({ user, holder }) {
  const lib = useLibrary(user, { onAccountChange: () => { holder.accountChanges++; } });
  holder.lib = lib;
  return null;
}

async function openDevice(name, user, { waitSynced = true } = {}) {
  loadDevice(name);
  const holder = { lib: null, accountChanges: 0 };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  const device = {
    name, holder, root,
    get lib() { return holder.lib; },
    async setUser(u) { await act(async () => { root.render(<Probe user={u} holder={holder} />); await sleep(30); }); },
    async until(fn, ms = 6000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (fn(holder.lib)) return true; await act(async () => { await sleep(40); }); }
      return false;
    },
    async act(fn) { let out; await act(async () => { out = await fn(holder.lib); await sleep(10); }); return out; },
    async sync() { return this.act((lib) => lib.syncNow()); },
    close: async () => { saveCurrent(); await act(async () => { root.unmount(); await sleep(10); }); el.remove(); },
  };
  await device.setUser(user);
  if (waitSynced && user) assert.ok(await device.until((l) => l.syncState === "synced"), `${name}: first sync finished`);
  return device;
}

const U1 = { id: "u1", fullName: "Test One", email: "one@example.com" };
const U2 = { id: "u2", fullName: "Test Two", email: "two@example.com" };
const song = (id) => ({ id, title: `Song ${id}`, artist: `Artist ${id}, Shared Singer`, cover: "c" });
const ids = (list) => list.map((x) => x.id).join(",");
const cloudJson = (uid, name) => JSON.parse(CLOUD.docs.get(`users/${uid}/lib/${name}`).data.json);

let passed = 0;
const scenario = async (name, fn) => {
  // each scenario starts with a blank cloud and blank devices
  CLOUD.docs.clear(); CLOUD.online = true;
  for (const k of Object.keys(storages)) delete storages[k];
  current = null; localStorage.clear();
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message.split("\n").slice(0, 4).join("\n       ")}`); process.exitCode = 1; }
};

export async function run() {
  await scenario("liked songs and playlists made on the phone appear on a brand-new device", async () => {
    const phone = await openDevice("phone", U1);
    await phone.act((l) => { l.toggleLike(song("a")); l.toggleLike(song("b")); const p = l.createPlaylist("Gym"); l.addTrackToPlaylist(p.id, song("c")); l.addTrackToPlaylist(p.id, song("a")); });
    assert.ok(await phone.sync());
    await phone.close();
    const web = await openDevice("web", U1);
    assert.equal(ids(web.lib.likedTracks), "a,b");
    assert.equal(web.lib.customPlaylists.length, 1);
    assert.equal(web.lib.customPlaylists[0].name, "Gym");
    assert.equal(ids(web.lib.customPlaylists[0].tracks), "c,a");
    await web.close();
  });

  await scenario("each device likes a different song while the phone is offline: both are kept", async () => {
    const phone = await openDevice("phone", U1);
    CLOUD.online = false;
    await phone.act((l) => l.toggleLike(song("phone-song")));
    const web = await openDevice("web", U1, { waitSynced: false });
    CLOUD.online = true;
    await web.until((l) => l.syncState === "synced");
    await web.act((l) => l.toggleLike(song("web-song")));
    await web.sync();
    await web.close();
    // the phone reconnects (it was never closed: switch back to its storage)
    loadDevice("phone");
    CLOUD.online = true;
    await phone.sync();
    assert.ok(phone.lib.likedTracks.some((t) => t.id === "phone-song"), "phone keeps its own song");
    assert.ok(phone.lib.likedTracks.some((t) => t.id === "web-song"), "phone receives the web song");
    assert.ok(cloudJson("u1", "liked").items.some((t) => t.id === "phone-song"), "cloud has the phone song");
    await phone.close();
  });

  await scenario("signing out while offline never loses changes: they come back at the next sign-in", async () => {
    const phone = await openDevice("phone", U1);
    await phone.act((l) => l.toggleLike(song("keep")));
    await phone.sync();
    CLOUD.online = false;
    await phone.act((l) => { l.toggleLike(song("offline-like")); l.createPlaylist("Offline list"); });
    const saved = await phone.act((l) => l.prepareSignOut());
    assert.equal(saved.ok, false, "sign-out reports that it could not save");
    await phone.setUser(null); // signed out
    assert.equal(phone.lib.likedTracks.length, 0, "nothing of this account remains for the next person");
    assert.ok(localStorage.getItem("aurasynq_outbox_u1"), "unsynced changes were set aside");
    CLOUD.online = true;
    await phone.setUser(U1);
    assert.ok(await phone.until((l) => l.syncState === "synced"));
    assert.equal(ids(phone.lib.likedTracks), "keep,offline-like");
    assert.equal(phone.lib.customPlaylists.length, 1);
    assert.ok(cloudJson("u1", "liked").items.some((t) => t.id === "offline-like"), "reached the cloud");
    assert.equal(localStorage.getItem("aurasynq_outbox_u1"), null, "outbox cleared once saved");
    await phone.close();
  });

  await scenario("switching accounts: nothing leaks between accounts, and each gets its own data back", async () => {
    const phone = await openDevice("phone", U1);
    await phone.act((l) => { l.toggleLike(song("u1-song")); l.recordPlay(song("u1-play")); l.addListenSeconds(120); });
    await phone.act((l) => l.prepareSignOut());
    await phone.setUser(U2);
    assert.ok(await phone.until((l) => l.syncState === "synced"));
    assert.equal(phone.lib.likedTracks.length, 0, "account 2 starts empty");
    assert.equal(phone.lib.lifetime.plays, 0, "and does not inherit account 1's minutes");
    await phone.act((l) => { l.toggleLike(song("u2-song")); l.recordPlay(song("u2-play")); });
    await phone.act((l) => l.prepareSignOut());
    await phone.setUser(U1);
    assert.ok(await phone.until((l) => l.syncState === "synced"));
    assert.equal(ids(phone.lib.likedTracks), "u1-song");
    assert.equal(phone.lib.lifetime.plays, 1);
    assert.equal(phone.lib.lifetime.seconds, 120, "minutes played came back");
    assert.deepEqual(Object.keys(cloudJson("u2", "liked").items.map((t) => t.id)), ["0"]);
    await phone.close();
  });

  await scenario("lifetime stats from two devices add up, and Profile numbers survive a new install", async () => {
    const phone = await openDevice("phone", U1);
    await phone.act((l) => { for (let i = 0; i < 3; i++) l.recordPlay(song("x" + i)); l.addListenSeconds(600); });
    await phone.sync(); await phone.close();
    const web = await openDevice("web", U1);
    await web.act((l) => { l.recordPlay(song("x0")); l.recordPlay(song("y")); l.addListenSeconds(300); });
    await web.sync();
    assert.equal(web.lib.lifetime.plays, 5);
    assert.equal(web.lib.lifetime.seconds, 900);
    assert.equal(web.lib.lifetime.artists["Shared Singer"], 5, "artist counts add up too");
    assert.ok(Object.keys(web.lib.lifetime.artists).length >= 5, "all artists kept, not only the last 50 plays");
    await web.close();
    // a fresh install (empty storage) of the phone sees the same totals
    const reinstall = await openDevice("phone-reinstalled", U1);
    assert.equal(reinstall.lib.lifetime.plays, 5);
    assert.equal(reinstall.lib.lifetime.seconds, 900);
    await reinstall.close();
  });

  await scenario("lifetime stats are not limited to the last 50 plays", async () => {
    const phone = await openDevice("phone", U1);
    await phone.act((l) => { for (let i = 0; i < 120; i++) l.recordPlay({ ...song("s" + i), artist: "Artist " + (i % 40) }); });
    assert.equal(phone.lib.playHistory.length, 50, "recent history stays at 50");
    assert.equal(phone.lib.lifetime.plays, 120);
    assert.equal(Object.keys(phone.lib.lifetime.artists).length, 40);
    await phone.close();
  });

  await scenario("playlist edits on two devices merge: songs added on both survive", async () => {
    const phone = await openDevice("phone", U1);
    const pl = await phone.act((l) => { const p = l.createPlaylist("Road trip"); l.addTrackToPlaylist(p.id, song("a")); return p; });
    await phone.sync(); await phone.close();
    const web = await openDevice("web", U1);
    await web.act((l) => l.addTrackToPlaylist(pl.id, song("from-web")));
    await web.sync(); await web.close();
    loadDevice("phone");
    const phone2 = await openDevice("phone", U1, { waitSynced: false });
    await phone2.act((l) => l.addTrackToPlaylist(pl.id, song("from-phone")));
    await phone2.sync();
    const tracks = ids(phone2.lib.customPlaylists[0].tracks).split(",").sort().join(",");
    assert.equal(tracks, "a,from-phone,from-web");
    await phone2.close();
  });

  await scenario("deleting a playlist and unliking a song on one device sticks on the others", async () => {
    const phone = await openDevice("phone", U1);
    const pl = await phone.act((l) => { l.toggleLike(song("a")); l.toggleLike(song("b")); return l.createPlaylist("Temp"); });
    await phone.sync(); await phone.close();
    const web = await openDevice("web", U1);
    await web.act((l) => { l.toggleLike(song("a")); l.deletePlaylist(pl.id); });
    await web.sync(); await web.close();
    const phone2 = await openDevice("phone", U1, { waitSynced: false });
    await phone2.sync();
    assert.equal(ids(phone2.lib.likedTracks), "b");
    assert.equal(phone2.lib.customPlaylists.length, 0);
    await phone2.close();
  });

  await scenario("clearing listening history on one device is not undone by another", async () => {
    const phone = await openDevice("phone", U1);
    await phone.act((l) => { l.recordPlay(song("h1")); l.recordPlay(song("h2")); });
    await phone.sync(); await phone.close();
    const web = await openDevice("web", U1);
    assert.equal(web.lib.playHistory.length, 2);
    await web.act((l) => l.clearHistory());
    await web.sync(); await web.close();
    const phone2 = await openDevice("phone", U1, { waitSynced: false });
    await phone2.sync();
    assert.equal(phone2.lib.playHistory.length, 0);
    await phone2.close();
  });

  await scenario("guest listening merges into the account on sign-in instead of being replaced", async () => {
    const guest = await openDevice("phone", null);
    await guest.act((l) => { l.toggleLike(song("guest-like")); l.recordPlay(song("g1")); });
    await guest.setUser(U1);
    assert.ok(await guest.until((l) => l.syncState === "synced"));
    assert.equal(ids(guest.lib.likedTracks), "guest-like");
    assert.equal(guest.lib.lifetime.plays, 1);
    await guest.close();
    const other = await openDevice("web", U1);
    assert.equal(ids(other.lib.likedTracks), "guest-like", "visible on the account everywhere");
    await other.close();
  });

  await scenario("a library saved before this update migrates once, without doubling the minutes", async () => {
    // cloud written by the old app: one document, whole-list fields, max-merged stats
    CLOUD.docs.set("users/u1", { version: 1, data: {
      likedTracks: [song("old1"), song("old2")],
      customPlaylists: [{ id: "playlist_1700000000000_1", name: "Old list", tracks: [song("o1")] }],
      playHistory: [song("oh")],
      listenStats: { totalSeconds: 1800, trackPlays: 40 },
    } });
    // the phone still holds the old local format
    storages.phone = {
      aurasynq_listen_stats: JSON.stringify({ totalSeconds: 1800, trackPlays: 40 }),
      aurasynq_liked_songs_metadata: JSON.stringify([song("old1"), song("old2")]),
      aurasynq_play_history: JSON.stringify([song("oh")]),
    };
    const phone = await openDevice("phone", U1);
    assert.equal(ids(phone.lib.likedTracks), "old1,old2");
    assert.equal(phone.lib.customPlaylists[0].name, "Old list");
    assert.equal(phone.lib.lifetime.seconds, 1800, "minutes preserved exactly, not doubled");
    assert.equal(phone.lib.lifetime.plays, 40);
    assert.equal(ids(phone.lib.playHistory), "oh", "recent history survives the first sync");
    await phone.act((l) => l.toggleLike(song("old1"))); // unlike a migrated song
    await phone.sync(); await phone.close();
    const web = await openDevice("web", U1);
    assert.equal(ids(web.lib.likedTracks), "old2", "the old single document does not bring it back");
    assert.equal(web.lib.lifetime.seconds, 1800, "totals the same on a second device");
    await web.close();
  });

  await scenario("settings follow the account", async () => {
    const phone = await openDevice("phone", U1);
    await phone.act((l) => l.updateSettings({ haptics: false, dataSaver: true }));
    await phone.sync(); await phone.close();
    const web = await openDevice("web", U1);
    assert.equal(web.lib.settings.haptics, false);
    assert.equal(web.lib.settings.dataSaver, true);
    await web.close();
  });

  await scenario("changes sync by themselves shortly after being made (no button needed)", async () => {
    const phone = await openDevice("phone", U1);
    await phone.act((l) => l.toggleLike(song("auto")));
    assert.ok(await phone.until((l) => l.syncState === "synced" && l.pendingCount === 0, 8000), "synced on its own");
    assert.ok(cloudJson("u1", "liked").items.some((t) => t.id === "auto"));
    await phone.close();
  });

  await scenario("what the app learns from listening reaches the account within seconds, and follows it to a new device", async () => {
    const phone = await openDevice("phone", U1);
    await act(async () => { recordFeedback(song("fav"), "like"); await sleep(10); });
    const t0 = Date.now();
    let saved = false;
    while (Date.now() - t0 < 5000 && !saved) { await act(async () => { await sleep(100); }); saved = !!CLOUD.docs.get("users/u1/lib/taste") && JSON.stringify(cloudJson("u1", "taste")).includes("fav"); }
    assert.ok(saved, "taste reached the cloud in under 5 seconds");
    assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
    await phone.close();
    const web = await openDevice("web", U1);
    const { exportTaste } = await import("@/lib/ir/profile");
    assert.ok(Object.keys(exportTaste().tracks).includes("fav"), "new device has the learned taste");
    await web.close();
  });

  await scenario("a connection that drops mid-session is retried automatically", async () => {
    const phone = await openDevice("phone", U1);
    CLOUD.online = false;
    await phone.act((l) => l.toggleLike(song("later")));
    await phone.until((l) => l.pendingCount > 0, 4000);
    assert.ok(phone.lib.pendingCount > 0, "shown as waiting to sync");
    CLOUD.online = true;
    await act(async () => { window.dispatchEvent(new window.Event("online")); await sleep(50); });
    assert.ok(await phone.until((l) => l.pendingCount === 0 && l.syncState === "synced", 8000), "caught up after reconnecting");
    assert.ok(cloudJson("u1", "liked").items.some((t) => t.id === "later"));
    await phone.close();
  });

  console.log(`\n${passed} scenarios passed${process.exitCode ? ", some FAILED" : ""}`);
}
