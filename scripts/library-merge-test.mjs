// Tests for the library merge rules (run: node scripts/library-merge-test.mjs).
// Scenarios are the real ways data used to be lost, plus the properties that make merging safe:
// order of merging never matters and merging twice changes nothing.
import assert from "node:assert/strict";
import {
  mergeLiked, mergePlaylists, mergeHistory, mergeActivity, activityTotals, mergeSlot, emptySlot, stable,
} from "../src/lib/library.js";

const T = Date.now() - 60 * 1000; // a minute ago; tests add small offsets
let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};
const ids = (list) => list.map((x) => x.id).join(",");
const song = (id, likedAt = 0) => ({ id, title: id, likedAt: likedAt ? T + likedAt : 0 });

console.log("liked songs");
test("two devices each like a different song offline: both survive", () => {
  const phone = { items: [song("a", 10)], removed: {} };
  const web = { items: [song("b", 20)], removed: {} };
  assert.equal(ids(mergeLiked(phone, web).items), "a,b");
});
test("unlike on one device sticks on the other", () => {
  const phone = { items: [], removed: { a: T + 30 } };
  const web = { items: [song("a", 10), song("b", 12)], removed: {} };
  assert.equal(ids(mergeLiked(phone, web).items), "b");
});
test("liked again after an unlike comes back", () => {
  const web = { items: [song("a", 50)], removed: {} };
  const phone = { items: [], removed: { a: T + 30 } };
  assert.equal(ids(mergeLiked(phone, web).items), "a");
});
test("songs saved before timestamps existed lose to a real unlike, and survive otherwise", () => {
  assert.equal(ids(mergeLiked({ items: [song("old")], removed: {} }, { items: [], removed: { old: T + 5 } }).items), "");
  assert.equal(ids(mergeLiked({ items: [song("old")], removed: {} }, { items: [song("new", 9)], removed: {} }).items), "old,new");
});
test("empty cloud never wipes the device, empty device never wipes the cloud", () => {
  const full = { items: [song("a", 1), song("b", 2)], removed: {} };
  assert.equal(ids(mergeLiked(full, { items: [], removed: {} }).items), "a,b");
  assert.equal(ids(mergeLiked({ items: [], removed: {} }, full).items), "a,b");
  assert.equal(ids(mergeLiked(full, null).items), "a,b");
});

console.log("playlists");
const track = (id, addedAt = 0) => ({ id, title: id, addedAt: addedAt ? T + addedAt : 0 });
const playlist = (id, name, tracks = [], extra = {}) => ({ id, name, nameAt: T + 1, tracks, removed: {}, createdAt: T + 1, updatedAt: T + 1, ...extra });
test("songs added to the same playlist on two devices: both kept", () => {
  const phone = { items: [playlist("p1", "Gym", [track("a", 10), track("b", 11)], { updatedAt: T + 11 })], deleted: {} };
  const web = { items: [playlist("p1", "Gym", [track("a", 10), track("c", 12)], { updatedAt: T + 12 })], deleted: {} };
  assert.equal(ids(mergePlaylists(phone, web).items[0].tracks), "a,b,c");
});
test("a song removed on one device stays removed", () => {
  const phone = { items: [playlist("p1", "Gym", [track("a", 10)], { removed: { b: T + 20 }, updatedAt: T + 20 })], deleted: {} };
  const web = { items: [playlist("p1", "Gym", [track("a", 10), track("b", 11)], { updatedAt: T + 11 })], deleted: {} };
  assert.equal(ids(mergePlaylists(phone, web).items[0].tracks), "a");
});
test("renaming: the latest name wins on both sides", () => {
  const phone = { items: [playlist("p1", "Old", [], { nameAt: T + 5 })], deleted: {} };
  const web = { items: [playlist("p1", "New", [], { nameAt: T + 9 })], deleted: {} };
  assert.equal(mergePlaylists(phone, web).items[0].name, "New");
  assert.equal(mergePlaylists(web, phone).items[0].name, "New");
});
test("a playlist created on one device appears on the other", () => {
  const merged = mergePlaylists({ items: [playlist("p1", "A")], deleted: {} }, { items: [playlist("p2", "B")], deleted: {} });
  assert.equal(ids(merged.items), "p1,p2");
});
test("a deleted playlist stays deleted, but one edited after the deletion survives", () => {
  const deleted = { items: [], deleted: { p1: T + 50 } };
  const stale = { items: [playlist("p1", "A", [track("a", 10)], { updatedAt: T + 10 })], deleted: {} };
  assert.equal(mergePlaylists(deleted, stale).items.length, 0);
  const edited = { items: [playlist("p1", "A", [track("a", 10), track("z", 60)], { updatedAt: T + 60 })], deleted: {} };
  assert.equal(mergePlaylists(deleted, edited).items.length, 1);
});
test("playlists saved before timestamps existed merge without losing songs", () => {
  const legacyA = { items: [{ id: "playlist_1700000000000_1", name: "Old", tracks: [{ id: "a" }] }], deleted: {} };
  const legacyB = { items: [{ id: "playlist_1700000000000_1", name: "Old", tracks: [{ id: "a" }, { id: "b" }] }], deleted: {} };
  assert.equal(ids(mergePlaylists(legacyA, legacyB).items[0].tracks), "a,b");
});

console.log("history");
const played = (id, playedAt) => ({ id, playedAt: playedAt ? T + playedAt : 0 });
test("history from two devices interleaves, newest first, capped", () => {
  const merged = mergeHistory({ items: [played("a", 10), played("c", 30)], clearedAt: 0 }, { items: [played("b", 20)], clearedAt: 0 }, 2);
  assert.equal(ids(merged.items), "c,b");
});
test("history saved before timestamps existed is NOT dropped by a merge (it used to be)", () => {
  const legacy = { items: [{ id: "old1" }, { id: "old2" }], clearedAt: 0 };
  assert.equal(ids(mergeHistory(legacy, { items: [], clearedAt: 0 }).items), "old1,old2");
  assert.equal(ids(mergeHistory(legacy, null).items), "old1,old2");
});
test("clearing history on one device is not undone by the other", () => {
  const cleared = { items: [], clearedAt: T + 100 };
  const old = { items: [played("a", 10), played("legacy", 0)], clearedAt: 0 };
  assert.equal(mergeHistory(cleared, old).items.length, 0);
  assert.equal(ids(mergeHistory(cleared, { items: [played("n", 150)], clearedAt: 0 }).items), "n");
});

console.log("listening activity");
const slot = (seconds, plays, artists = {}) => ({ ...emptySlot(), seconds, plays, artists, at: T + 1 });
test("listening on two devices adds up (it used to take the larger one)", () => {
  const merged = mergeActivity({ devices: { phone: slot(600, 10, { Anirudh: 6 }) } }, { devices: { web: slot(300, 5, { Anirudh: 2, Sid: 3 }) } });
  const total = activityTotals(merged);
  assert.equal(total.seconds, 900);
  assert.equal(total.plays, 15);
  assert.deepEqual(total.artists, { Anirudh: 8, Sid: 3 });
});
test("one device's slot never goes backwards when merged with an older copy of itself", () => {
  const newer = { devices: { phone: slot(600, 10, { A: 6 }) } };
  const older = { devices: { phone: slot(400, 7, { A: 4 }) } };
  assert.equal(activityTotals(mergeActivity(newer, older)).seconds, 600);
  assert.equal(activityTotals(mergeActivity(older, newer)).seconds, 600);
});
test("a signed-out device's totals come back when it signs in again", () => {
  const cloud = { devices: { phone: slot(900, 12, { A: 12 }) } };
  const freshLocal = { devices: { phone: emptySlot() } };
  assert.equal(activityTotals(mergeActivity(freshLocal, cloud)).plays, 12);
});

console.log("merge properties (random data)");
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let tick = 0;
const uniq = () => T + (++tick) * 7 + 1000; // never ties
const randomLiked = () => ({
  items: Array.from({ length: rnd(6) }, () => song(`s${rnd(8)}`, uniq() - T)),
  removed: Object.fromEntries(Array.from({ length: rnd(3) }, () => [`s${rnd(8)}`, uniq()])),
});
const randomPlaylists = () => ({
  items: Array.from({ length: rnd(3) }, () => playlist(`p${rnd(3)}`, `n${rnd(5)}`, Array.from({ length: rnd(4) }, () => track(`t${rnd(5)}`, uniq() - T)), { nameAt: uniq(), updatedAt: uniq(), removed: rnd(2) ? { [`t${rnd(5)}`]: uniq() } : {} })),
  deleted: rnd(3) ? { [`p${rnd(3)}`]: uniq() } : {},
});
const randomActivity = () => ({ devices: Object.fromEntries(Array.from({ length: rnd(3) + 1 }, () => [`d${rnd(3)}`, slot(rnd(1000), rnd(50), { [`a${rnd(4)}`]: rnd(20) })])) });
const algebra = (name, gen, merge) => test(`${name}: commutative, associative, idempotent (200 random cases)`, () => {
  for (let i = 0; i < 200; i++) {
    const a = gen(); const b = gen(); const c = gen();
    assert.equal(stable(merge(a, b)), stable(merge(b, a)), "commutative");
    assert.equal(stable(merge(merge(a, b), c)), stable(merge(a, merge(b, c))), "associative");
    const ab = merge(a, b);
    assert.equal(stable(merge(ab, ab)), stable(ab), "idempotent");
    assert.equal(stable(merge(ab, a)), stable(ab), "absorbs its inputs");
  }
});
algebra("liked", randomLiked, mergeLiked);
algebra("playlists", randomPlaylists, mergePlaylists);
algebra("activity", randomActivity, mergeActivity);

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
