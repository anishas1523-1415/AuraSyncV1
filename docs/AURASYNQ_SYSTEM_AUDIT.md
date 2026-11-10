# AuraSynq System Audit (Phase 1)

Date: 2026-11-10. Scope: backend, search, language, taste profiling and recommendation logic.
The UI is frozen and out of scope: no screen, component, style or interaction flow is assessed for change.

Every statement below is marked:

- **[verified]**: read in the code or measured by running it.
- **[hypothesis]**: inferred, not yet measured.

No code was changed during this audit.

---

## 1. Architecture map

```
                         ┌──────────────────────────── UI (FROZEN) ────────────────────────────┐
                         │ app/*/page.js, components/*, *.module.css                            │
                         └───────────────┬─────────────────────────────────────┬────────────────┘
                                         │                                     │
                     contexts/AudioContext.js (playback + feedback hooks)   catalog.js (list sourcing,
                         │ recordFeedback(play/complete/skip/like/playlist)   client cache, mixes)
                         ▼                                                     │
                 ir/profile.js ── ir/context.js            ┌───────────────────┴──────────────────┐
                 (taste vector,   (session vector,         │ Android app                Website   │
                  localStorage,    time of day)            ▼                              ▼        │
                  synced to                    ondevice/music.js            GET /api/search      │
                  Firestore)                   (youtubei-web on phone)      (Next route, server) │
                         │                                 └──────────────┬──────────────┘        │
                         └── profile + trending ──► ir/search.js ◄────────┘  (server: NO profile) │
                                                       │                                           │
                         ir/query.js  ir/text.js  ir/rank.js  ir/classify.js  ir/language.js       │
                         ir/signals.js  ir/charts.js  ir/recommend.js  musicTracks.js              │
                                                       │                                           │
                                         YouTube Music (InnerTube via youtubei.js)                 │
                                         fallbacks: youtube-search-api, Invidious                  │
```

**Stack [verified]:**

- Framework: Next.js 14.2.4 (App Router), React 18.3, plain JavaScript.
- Clients: PWA via `@ducanh2912/next-pwa`, and an Android app built with Capacitor 8.
- Auth: Firebase Authentication (`middleware.js` is a no-op). The Clerk dependency remains but `proxy.js` bypasses it.
- Data:
  - Firestore holds each user's library (`dbSync.js`, transactional merge).
  - Firebase RTDB and Supabase handle Blend sync (`syncEngine.js`).
  - Supabase `song_cache` stores track metadata.
  - Upstash Redis provides the query cache and rate limits, with in-memory fallback.
- Music data: YouTube Music through `youtubei.js` on the server and `youtubei-web` on the phone.
- Lyrics: LRCLIB, cached in Supabase.
- No ML models, embeddings or vector store. All intelligence is hand-built IR: BM25, rank fusion, Naive Bayes, Rocchio, HITS, MMR.

## 2. Intelligence module inventory → capability owner

| Capability | Module(s) | Runs on | Technique |
|---|---|---|---|
| Query understanding | `ir/query.js` | both | Rules + thesaurus: language words, 37 mood words → expansions, album/artist patterns |
| Text processing | `ir/text.js` | both | Normalise, tokenise, fuzzy `termMatch`, `parseTitle` (song/film/variants), `songKey` |
| Retrieval | `ir/search.js` | both | Parallel meta-search: songs, film album, artist top songs, mood expansions; suggestion-based respelling |
| Ranking | `ir/rank.js` | both | Field-weighted BM25 (title 3, artist 2, album 0.5), RRF (k=30), quality priors, duplicate collapse, cosine, MMR |
| Language ID | `ir/language.js`, `ir/classify.js` | both | Word NB + char-trigram NB + artist priors; neighbour vote; YouTube tag check for charts |
| Mood | `ir/classify.js` | both | Multinomial NB over seed lexicons (8 moods) |
| Mood / genre (2nd, separate) | `activity.js` | device | Regex on title/artist. **Duplicate, disagrees with `classify.js`** |
| Taste profile | `ir/profile.js` | device | Rocchio vector over artist/lang/mood/film features, 21-day half-life, 400 songs max |
| Session context | `ir/context.js` | device | Last 14 events, 0.78 order decay, 3 h session; time-of-day mood prior |
| Shared signals | `ir/signals.js` | both | Regional language score, trend score, mood/language continuity |
| Recommendation | `ir/recommend.js` | device | Radio re-rank, For You (HITS over taste-cluster seeds), mixes, live queue re-rank, moment picks |
| Charts | `ir/charts.js` | both | YouTube Music charts merged with RRF; language checked from video tags |
| Track mapping | `musicTracks.js` | both | YouTube Music nodes → AuraSynq track objects |
| List sourcing / cache | `catalog.js` | device | Device-first lookup, server fallback, 6 h client cache (key `aurasynq_catalog_cache_v3`) |
| Feedback capture | `contexts/AudioContext.js` lines 482–491, 991, 1001 | device | complete ≥ 70% heard; play ≥ 30 s; skip < min(30 s, 40%) |
| Lyrics | `app/api/lyrics/route.js` | server | LRCLIB search with title cleanup |
| Streaming | `app/api/stream/route.js`, `ondevice/stream.js` | server / device | Playback infrastructure: out of intelligence scope |

## 3. Data flows

**Search on the Android app [verified]:**

1. `search/page.js` calls `catalog.searchSongs(q)`.
2. `catalog.searchSongs` calls `ondevice/music.searchSongs(q, {profile, trending})`.
3. That runs `ir/search.search`:
   - `analyzeQuery`
   - Parallel retrieval: songs, film album, artist top songs, up to 2 mood expansions
   - RRF (album weight 1.6, artist 1.2, expansions 0.7)
   - BM25, quality prior, taste and region scores
   - Duplicate collapse
   - If the best coverage is < 0.6, a YouTube Music spelling suggestion and a rerun
4. The result is cached on the client for 6 h.

**Search on the website [verified]:**

1. `catalog.searchSongs` calls `GET /api/search?q=`.
2. The route checks the cache, then the rate limit (30/min per IP).
3. It runs `searchEngine.search(query)` **with no profile or trending list** (`api/search/route.js:229`).
4. If fewer than `MIN_SONG_RESULTS` results come back, it falls back to YouTube video search.
5. Results are written to Supabase `song_cache` and to the Redis/memory cache for 24 h, keyed by query text only.

**Radio and up-next [verified]:**

1. YouTube Music radio for the current song is the candidate list.
2. A second list comes from radio for the listener's favourite song most similar to the current one (the "anchor").
3. `rankRadio` scores each candidate:
   `0.3·base rank + 0.35·cos(current, track) + continuity + 0.45·cos(intent, track) + 0.5·regional + trend`
4. MMR diversity is applied (λ 0.7).
5. After a skip or like, `rerankUpcoming` reorders the queue. The next song stays put because it may be preloading.

**For You [verified]:**

1. Taste clusters (3) provide up to 6 seeds.
2. The radio of each seed is fetched.
3. Authority score = Σ (hub weight / (5 + rank)).
4. Final score = 0.6·authority + 0.4·cos(profile, track).
5. MMR diversity is applied (λ 0.72).

**Feedback and profile [verified]:**

- `AudioContext.judgeListen` calls `recordFeedback`, which updates the per-song pos/neg weights with decay.
- Event weights: like 3, playlist 2, complete 1, play 0.4, skip −1, unlike −2.
- Changes are written to localStorage, and a subscriber syncs them to Firestore within seconds.
- A song is "rejected" only when skips ≥ 2, completes = 0 and neg > pos, so one skip is never treated as a permanent dislike.

## 4. Measured baseline

### 4.1 Language identification [verified, `node scripts/lang-eval.mjs`, `lang-eval-graph.mjs`]

| Set | Accuracy | Coverage | n |
|---|---|---|---|
| Known (used to build word lists) | 0.97 | 1.00 | 60 |
| Held-out (honest score) | **0.81** | 0.92 | 36 |
| Held-out with neighbour vote | **0.92** | — | 36 |

Held-out per-language F1:

| Language | F1 |
|---|---|
| Tamil | 0.89 |
| Hindi | 0.78 |
| Telugu | 0.91 |
| Malayalam | 1.00 |
| Kannada | 0.67 |
| Punjabi | 0.80 |
| English | 0.75 |

Held-out mistakes, and the pattern behind each:

| Song | Predicted | Truth | Cause |
|---|---|---|---|
| Rathamaarey (Vishal Mishra, Anirudh) | hindi | tamil | Hindi singer on a Tamil song |
| Salaam Rocky Bhai (Vijay Prakash, Ravi Basrur) | hindi | kannada | Pan-India film, Hindi-looking title |
| With You (AP Dhillon) | english | punjabi | English title, Punjabi artist prior too weak |
| Kesariya Rangu (Arijit Singh, Sid Sriram) | hindi | telugu | Dubbed version shares the original's title |
| Dhinka Chika, Flowers, Mazhaiyae Mazhaiyae | unknown | — | Coverage gaps |

The weak spots are dubbed versions, pan-India films, artists whose prior is too weak against an English title, and very short titles.

### 4.2 Search relevance [verified, `node scripts/ir-eval.mjs`]

The `baseline` column is YouTube Music's own song search; the `new` column is `ir/search.js`. Run on 2026-11-10 against live YouTube Music.

| Kind | n | Baseline Hit@1 / P@10 | New Hit@1 / P@10 |
|---|---|---|---|
| exact title | 15 | 1.00 | 1.00 |
| misspelt | 3 | 1.00 | 1.00 |
| noisy, partial | 2 | 1.00 | 1.00 |
| movie ("leo songs") | 4 | 1.00 / **P@10 0.47** | 1.00 / **P@10 1.00** |
| artist | 4 | P@10 0.85 | P@10 0.97 |
| mood | 3 | P@10 1.00 | P@10 1.00 |

What this shows:

1. **The benchmark is saturated.** Every song-finding query scores 1.00 for both engines. It cannot tell a better engine from a worse one, except on movie and artist precision. It has no natural-language, Tanglish, era, artist + mood, or code-mixed queries.
2. **Real gains are on film and artist lists.** Movie P@10 went from 0.47 to 1.00 and artist P@10 from 0.85 to 0.97.
3. **Latency cost: about 3×.** The new engine takes ~0.7–3.0 s per query (median ≈1.7 s); baseline takes ~0.45–0.7 s. Fan-out to 3–5 upstream calls is the cause.
4. **Residual noise.** "ar rahman" puts a Quran recitation ("Surah Ar Rahman") in the top 3. "rowdy baby" includes an unrelated Hindi song at rank 3.

**Natural-language queries from the product brief [verified, `analyzeQuery` output]:**

| Query | Parsed as | Problem |
|---|---|---|
| Enaku melody songs venum | intent `song`, topic `[enaku, venum]`, no language | Tanglish filler words become the search topic; Tamil not inferred; mood expansions are unused (they only fire for intent `mood`) |
| Ilayaraja old love songs | `album_or_artist` "ilayaraja", moods retro + romantic | Artist found, but mood and era are dropped as filters |
| Play sad Tamil songs | `mood`, tamil, sad | Correct |
| 90s Hindi romantic songs | `album_or_artist` entity **"90s"** | Era is treated as a film/artist name |
| Vijay songs for gym | intent `song`, topic `[vijay, for]` | "for" isn't a stopword; artist + activity combination unsupported; actor vs singer "Vijay" ambiguity not handled |

So 4 of the brief's 5 example requests are misparsed. This is the largest measured gap in search.

### 4.3 Recommendation [verified, `ir-eval-radio/session/queue.mjs`]

**Radio re-rank (`ir-eval-radio.mjs`), simulated Tamil listener, 4 seeds:**

- Tamil share of the top 10 rose from 0.42 (raw YouTube radio) to **0.50** (re-ranked).
- For non-Tamil seeds (Kesariya, Shape of You) it stays at 0.0. The re-ranker can only reorder YouTube's candidates, so no Tamil songs exist to promote (D3).

**Session steering (`ir-eval-session.mjs`):**

- A session primed with "calm melodies" yields **1 calm-ish song in 10**.
- A session primed with "mass / energetic" yields **0 loud songs in 10**.
- Mood steering barely works. The cause is that most candidates have no mood label, so the session vector has nothing to match (D4, now measured).

**Live queue after 2 skips of one artist (`ir-eval-queue.mjs`):**

| Seed | Mean queue position of skipped artist (of 18) |
|---|---|
| Vaathi Coming | 11.0 → 14.3 |
| Kesariya | 7.0 → 9.0 |
| Kolaveri | 11.0 → **10.7** (no effect) |

- Next-song stability holds 3/3.
- Skip adaptation works in 2 of 3 seeds.

### 4.4 Provider health [verified]

YouTube Music radio returns 49 songs from both the server client (`youtubei.js`) and the phone client (`youtubei-web` 18.1.0). The `ParsingError: Type mismatch, got Message` lines printed during evals come from a tab that YouTube no longer fills. They are logged by the library and are not fatal.

## 5. Technical debt

1. **No test runner.** `package.json` has no `test` script. Evals and merge tests are standalone `scripts/*.mjs` that must be run by hand. Search and radio evals depend on live YouTube results, so they are not reproducible over time.
2. **Duplicated knowledge.** Language vocabularies and aliases appear in `query.js` (`LANGUAGE_WORDS`), `language.js` (`LANGUAGES`, `VOCAB`), `classify.js` (`LANGUAGE_SEEDS`), `signals.js` (`LOCALE_LANGUAGES`), `charts.js` (`LANGUAGE_PATTERNS`) and `recommend.js` (`SEED_LANGUAGES`).
3. **Two mood classifiers.** `activity.js` (regex: "Energetic / Peaceful / Melancholic", genres "Tamil Hits", "Pop"…) and `ir/classify.js` (NB: 8 moods) label the same song differently. `activity.js` feeds the lifetime "Sound Aura" totals.
4. **Placeholder metadata.** `musicTracks.makeTrack` sets `mood: "energetic"` and a random `hue` on every track. Nothing outside `ir/` reads `track.mood` today, but it is misleading data.
5. **Hand-tuned weights.** Every ranking blend (`rankRadio`, `forYou`, `personalize`, `rerankUpcoming`, `regionalScore` ±0.15/−0.12, `continuityScore`) is a fixed constant. Nothing is learned from feedback, though the feedback is logged.
6. **No feature embeddings.** Similarity is cosine over sparse artist/lang/mood/film features. Two songs with no shared artist or film and an unknown mood have similarity 0.
7. **Server cache keyed by text only.** It cannot hold personalised results, and the in-memory fallback is per instance on serverless.
8. **No observability.** There are no metrics for search latency, zero-result rate, fallback rate, skip rate or radio precision outside the device. `profile.radio.{played,skipped}` exists on device only.
9. **Repo hygiene.** Untracked root scratch files: `find-proxy.js`, `test-clients.js`, `test-proxy.js`, `test-stream.js`. Two of them route YouTube player requests through a third-party CORS proxy (corsproxy.io); keep them out of any build. There are also screenshots and `build-output*.txt` files.
10. **Unused dependencies.** `@clerk/nextjs` and `@clerk/themes` are installed but bypassed.

## 6. Prioritised defect list

| # | Severity | Defect | Status |
|---|---|---|---|
| D0 | High | Natural-language / Tanglish / era / artist + mood queries are misparsed (4 of the brief's 5 examples): filler words become topic, "90s" becomes an entity, mood expansions unused outside pure-mood intent | **fixed 2026-11-10** (see §9) |
| D1 | High | Website search is never personalised: the server calls `search(query)` without profile/trending | verified |
| D1b | High | Search benchmark is saturated (all 1.00); it cannot measure improvement and lacks the query types users ask | verified |
| D1c | Medium | Search latency ≈3× baseline (median ≈1.7 s vs ≈0.55 s) from upstream fan-out | verified |
| D2 | High | Language ID held-out accuracy 0.81 (0.92 with neighbours). Dubbed and pan-India titles and English-titled regional songs fail; Kannada F1 0.67 | verified |
| D3 | High | Candidates come only from YouTube Music radio/search, so popularity and YouTube's own CF dominate. No content-based or own-catalogue candidates | verified (design); impact hypothesis |
| D4 | High | Mood is inferred from title words only (seed lexicon NB), so most songs get no mood. Measured: session mood steering gives 1/10 calm and 0/10 loud | **improved 2026-11-10** (see §9): steering now 6/10 and 10/10 where candidates allow; mood coverage still 38% of labelled songs |
| D5 | Medium | Duplicate and inconsistent mood/genre classifier in `activity.js` | verified |
| D6 | Medium | Mid-song exits (between the skip cutoff and 70%) count as "play" (+0.4), never negative, so a disliked song heard for 40 s is learned as a weak positive | verified (logic) |
| D7 | Medium | Fixed ranking weights; no learning from logged skips/completes | verified |
| D8 | Low | Placeholder `mood: "energetic"` on all tracks | verified |
| D9 | Low | Third-party proxy test scripts in repo root | verified |

## 7. Why recommendations underperform

The first item is now measured; the rest are hypotheses to test in Phase 8.

0. **[verified] Mood coverage is the bottleneck.** Session steering barely moves results (1/10, 0/10), because candidates mostly lack a mood label.
1. **Thin feature space.** Similarity only sees artist, language, mood and film. Unknown mood plus a different artist makes a good match look like a stranger (D4, debt 6).
2. **Language errors leak into ranking.** `regionalScore` (−0.12) and `continuityScore` (−0.15) punish a language mismatch. Every misclassified song (≈8–19% held-out) is wrongly demoted (D2).
3. **Candidate pool is borrowed.** If YouTube Music's radio drifts, for example to Latin pop after a crossover hit, re-ranking can only reorder what it was given (D3).
4. **Website listeners get no personalisation in search** (D1).

## 9. Change log

### 2026-11-10: query understanding (D0)

**Scope.** Only `src/lib/ir/query.js` and `src/lib/ir/search.js` changed. There are no UI or API contract changes. `analyzeQuery` keeps every field it returned before and adds:

- `queryLanguage`
- `era`
- `isRequest`
- `searchText`
- `bases`
- `allTokens`

**Query reader (`query.js`):**

- **Requests vs titles.** Text that names a mood, activity, language, era or "songs" is a request. Only requests have their asking words removed. The asking words are:
  - Tamil: enaku, venum, podu…
  - Hindi: mujhe, sunao, chahiye…
  - English: i, want, for, some…

  Titles such as "I Want It That Way" and "Mujhe Kuch Kehna Hai" are untouched.
- **Typing language** (`queryLanguage`) comes from native asking words. It is kept separate from the requested song language (`languages`), and used only as a fallback when neither the request nor the listener's taste names a language.
- **Eras** ("90s", "2000s") are recognised as a facet, not a film or artist name. Era and language are carried into the mood expansions ("hindi 90s romantic songs").
- **Name plus mood** ("sid sriram melody", "vijay songs for gym") becomes `album_or_artist` with the name as entity.
- **New activity and genre words:** driving, study, focus, running, wedding, gaana.

**Search (`search.js`):**

- Requests are searched without their asking words.
- Name-plus-mood requests also search "<name> <mood> songs". Those lists are used only when the name resolves to an artist or film.
- If the top song is titled like the query ("arabic kuthu"), the request falls back to plain song handling.
- A soundtrack overrides a same-named artist only when the album is named exactly that. "vijay" is the singer, not the dub album "Vijay the Master".
- Mood requests typed with native asking words keep their language ("hindi sad songs").
- Songs whose classified mood matches the request get +0.1.

**Measured results (live YouTube Music, 2026-11-10):**

| Check | Before | After |
|---|---|---|
| `scripts/query-parse-test.mjs` (26 offline cases) | 9/26 | **26/26** |
| `scripts/ir-eval-requests.mjs`, mean P@10 (10 requests) | 0.80 | **0.99** |
| — "90s Hindi romantic songs" | 0.1 | 1.0 |
| — "Vijay songs for gym" | 0.2 | 1.0 |
| — "kuthu songs podu" | 0.8 | 1.0 |
| — median latency | 1961 ms | 2192 ms |
| `scripts/ir-eval.mjs` title benchmark | all 1.00, movie P@10 1.00 | unchanged |

Of the 31 existing benchmark queries, only two parse differently:
- "ilaiyaraaja melody" is now artist plus mood, which is intended.
- "arabic kuthu" now parses as name plus mood, but search falls back to song handling when the top song is titled like the query. Its result stays rank 1.

**Not addressed:**

- "Vijay" in a request is assumed to mean the singer; there's no explicit check between the actor and other people named Vijay.
- Era is used only to widen retrieval, not as a filter, because tracks carry no release year.
- `npm run lint` is broken independently of this change: `eslint.config.mjs` imports `eslint/config`, which ESLint 8 doesn't export.

### 2026-11-10: song moods (D4)

**Scope.** Search, classification and ranking logic only. No UI or API contract changes.

**What changed:**

1. **Mood index (new `src/lib/ir/moods.js`).** Songs are labelled from YouTube Music's own editorial mood playlists: "Kollywood Romance Essentials", "Bollywood Melancholy", "Tollywood Dance Hitlist", "Workout"…
   - **Sources:** the "Moods & moments" categories plus the listener's language pages.
   - **Which playlists count:** only official playlists (ids starting `RDCL`). A playlist's mood comes from its title. Only the narrow categories (Romance, Sad, Party, Workout, Devotional) lend their mood to playlists whose title names none, because "Iconic Kollywood Hits" sits under Feel good but isn't "happy".
   - **Budget:** 96 playlists, spread round-robin over (language, mood) pairs, with 20 kept for global playlists for English listeners.
   - **Votes:** a song on several playlists takes the majority mood. Specific moods (romantic, sad, party, energetic, devotional) outweigh broad ones (happy, chill, calm) 1 : 0.6.
   - **Lookup:** by video id, or by title + artist so other uploads match. Remix, lo-fi and other edited versions are matched by id only, so a remix in a workout list doesn't make the original "energetic".
   - **Caching:** on the device for 3 days, about 4,500 songs. It's built about 8 s after app start-up and takes ~10 s in the background. The server builds its own copy after its first request; searches never wait for it.
2. **Learned moods.** Songs returned for an unambiguous mood request ("sad tamil songs"), or for a mood-seeded mix on the phone, are remembered as weak evidence for that mood.
3. **Evidence order in `classifyTrack`:** index > title words > version (lofi/slowed) > learned. `moodSource` records which one decided.
4. **Title words.** "dil", "heart" and "baby" were removed from the romantic list. They gave "Rowdy Baby", "Badtameez Dil" and "Channa Mereya" (film "Ae **Dil** Hai Mushkil") the wrong mood.
5. **Mood steering in ranking.** A new `moodAffinity` term (weight 0.3) in radio ranking (`rankRadio`) and the live queue (`rerankUpcoming`) uses this session's mood directly. Before, mood was one entry in a cosine over artists, language and film, where five different session artists drowned it.

**Measured results (live YouTube Music, 2026-11-10):**

| Check | Before | After |
|---|---|---|
| `scripts/mood-eval.mjs`, labelled songs (n=50): coverage | 0.16 | **0.38** |
| — precision (share of given moods that are right) | 0.50 | **0.74** |
| — accuracy | 0.08 | **0.28** |
| — radio candidates with a mood (6 seeds, n=294) | 0.09 | **0.30** |
| `ir-eval-session.mjs`, Kanmani Anbodu radio, calm session | 1/10 calm | **6/10** (10 available) |
| — same radio, energetic session | 0/10 loud | **2/10** (2 available) |
| — Vaathi Coming radio, energetic session | — | **10/10** (25 available) |
| `ir-eval-queue.mjs`: skipped artist pushed down | 2 of 3 seeds | 2 of 3 seeds (Arijit 11 → 15) |
| `ir-eval-requests.mjs` mean P@10 | 0.99 | 0.98 (live variance) |
| `ir-eval.mjs` title benchmark | all 1.00 | all 1.00 |

**Limits:**

- **Coverage of older songs is low.** Many Tamil and Telugu classics ("Munbe Vaa", "Samajavaragamana") are on no editorial mood playlist; 62% of labelled songs still get no mood.
- **Remaining errors are borderline.** Most mix up neighbouring moods: romantic vs happy, party vs energetic.
- **Benchmark labels are unreviewed.** `scripts/mood-benchmark.json` was hand-labelled from general knowledge and should be checked by the owner.
- **Website gets nothing yet.** Website listeners rank radio in the browser, which has no YouTube client, so they don't get the index. Serving it would need a new API endpoint, which requires approval.
- **Storage use.** The index takes about 250 KB of the device's local storage.

## 8. Constraints for later phases

- **UI freeze.** Changes are allowed only in `src/lib/ir/*`, `catalog.js`, `musicTracks.js`, `activity.js` and `app/api/*`. Changes in `AudioContext.js` are limited to the feedback lines.
- **API contracts.**
  - `/api/search` today takes `q | related | chart (+country, langs) | suggest` and returns `{tracks}` / `{suggestions}`.
  - Fixing D1 needs a new optional parameter (e.g. `langs`, `artists`) and a cache-key change. **This needs owner approval before implementation.**
- **Data rules.** No Spotify content, credentials or private APIs. Spotify is a reference for publicly observable behaviour and published research only.
