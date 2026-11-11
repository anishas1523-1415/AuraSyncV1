# Hum Search, Music Recognition and Voice Search: Architecture

Status: **plan for owner approval** (2026-11-11). Voice search (Module C) is implemented. Hum search (A) and music recognition (B) are designed here and not yet built.

Each statement is marked **[verified]** (checked in code, docs or by running it) or **[estimate]** (not yet measured). No accuracy number in this document is a measurement unless marked verified.

---

## 0. Constraints this design works within

| Constraint | Source | Effect on the design |
|---|---|---|
| **No paid recognition API** | Owner: "I can't spend money" | ACRCloud, AudD and similar paid services are out. |
| **No reverse engineering of ACRCloud, Shazam or Google** to copy their algorithms, model weights, keys or private endpoints | Their licence terms. The owner's brief also says "Do not extract proprietary algorithms, protected model weights, private databases, credentials or internal APIs". | REA is not used on third-party recognition apps. What we use instead: the published science behind them (Wang 2003 "An Industrial-Strength Audio Search Algorithm"; query-by-humming literature) and open-source implementations. |
| **UI frozen**, except one mic button in the search bar | Owner, 2026-11-11 | All three modes start from that one button (see §5). |
| **Only authorised audio** for reference data | Owner's brief, Module F | This is the hard part. See §3. |

## 1. The real bottleneck: reference audio

Recognition engines are well understood and open source. What makes Shazam, ACRCloud or Google work is their **reference catalogue**: tens of millions of licensed recordings, already fingerprinted and melody-indexed.

**AuraSynq has no reference audio of its own [verified].** It streams from YouTube Music on demand. Building a server-side index by downloading YouTube audio would breach YouTube's Terms of Service and the brief's "authorised recordings only" rule. This is not an engineering problem, and no amount of reverse engineering solves it.

**Proposed answer: an on-device index of songs the listener's phone already plays.** The Android app already downloads every song it plays to the phone [verified: `ondevice/stream.js`, `aurasynq_auto_cached_ids`, downloaded songs in Library].

Fingerprints and melody contours computed **on that phone, from that audio, for that listener**:
- never leave the device
- never redistribute audio
- add no new access to YouTube beyond what playback already does

**What that buys:**
- **Recognition (B):** identifies a song playing nearby if this phone has played or downloaded it. This covers "what's this song on the TV that I know", not "a song I've never heard".
- **Hum search (A):** finds a song you hum if this phone has played it. This is the most common case for humming ("that song I keep humming").
- **Coverage grows with listening.** It starts small.

**What it cannot do (stated plainly):** identify a song the phone has never played. That needs a licensed catalogue, which is outside a zero-budget plan.

**Optional extension, needs your decision:** pre-index the current Tamil, Hindi, Telugu and English charts by playing their audio through the same on-device pipeline in the background on Wi-Fi. This stays within the app's existing behaviour, but uses data and battery.

## 2. Module B: music recognition (playing nearby)

**Algorithm:** spectral landmark fingerprinting, the published Wang (2003) method. Implemented from the paper and from Dan Ellis's `audfprint`, which is MIT-licensed [verified in the repo].

1. Mono audio at 11 025 Hz, STFT (512-sample window, 256-sample hop).
2. Spectral peaks: local maxima above a decaying threshold, about 20–30 per second.
3. Landmarks: each peak paired with up to 3 later peaks in a target zone. The hash is `(f1, f2 − f1, Δt)`, 20 bits.
4. Index: `hash → [(songId, t1)]`, stored in IndexedDB on the phone.
5. Query: 5–10 s from the mic. Hashes are looked up; votes are counted per `(songId, t1_ref − t1_query)`. The top offset bin with ≥ N votes is the match, otherwise "no match". This voting is what makes it tolerant to noise and partial clips.

**Chromaprint** (LGPL-2.1) was evaluated and not chosen as the engine. It fingerprints whole tracks for duplicate detection; it's weak on short, noisy, partial mic clips. The AcoustID web service is also not free for commercial use, as the brief notes.

**Estimates [estimate]:** about 2–4 KB of fingerprint per song, so 1,000 songs ≈ 3 MB. Matching takes milliseconds.

## 3. Module A: hum search (query by humming)

**Reference melodies:** the vocal pitch contour of each indexed song, extracted on the phone from the audio it already has.
- **Pitch tracker:** Spotify's **Basic Pitch** (Apache-2.0, TensorFlow.js; about 17 K parameters, under 1 MB) [to verify before use]. It's built for polyphonic audio, where plain YIN fails on full mixes.
- **Fallback:** pYIN-style YIN on a vocal-band-filtered signal.

**Query:** YIN or pYIN pitch tracking on the hum, which is monophonic and cheap.

**Invariance:**
- **Key and octave:** compare intervals (semitone differences) rather than absolute pitch, or median-centre the contour.
- **Tempo:** dynamic time warping with slope constraints, plus a 0.8–1.25× time-scale search.
- **Off-key singing:** quantise to semitones with ±0.5 tolerance; DTW cost uses a capped distance.
- **Whistling:** same tracker; whistles are an octave or two higher, which interval matching removes.
- **Short or incomplete melodies:** subsequence DTW (the query can match anywhere in the reference).
- **Noise:** voicing-confidence gating drops frames the tracker isn't sure about.

**Retrieval at scale:**
1. A coarse filter on interval n-grams (an inverted index) keeps the top ~50 candidates.
2. Subsequence DTW re-ranks them.
3. A learned melody embedding (a small Siamese CNN on contours) is a later step, only if DTW accuracy isn't enough.

**Reviewed open-source references:** `emi-mem/Hum-To-Search` and `ShreyanshGoyal/query_by_humming`. Their licences and code must be checked before any reuse; the design above needs neither.

**Honest expectation [estimate]:** published QBH systems using audio-extracted melodies reach roughly 40–70 % top-10 on small catalogues. Matching a hum against a full song mix is hard. The benchmark in §6 will measure the real figure; nothing is promised until then.

## 4. Module C: voice search (implemented)

- **Speech to text** [verified in code]:
  - Android: the phone's own speech recognition via `@capacitor-community/speech-recognition` 7.0.1 (MIT), with the system "Speak now" prompt.
  - Website: the browser Web Speech API.
  - Both use language `en-IN`, which writes Tanglish and Hinglish in Latin letters.
  - AuraSynq records and stores nothing.
- **Transcript to action:** `src/lib/ir/voice.js` turns a transcript into `play` / `search` / `similar` / `playlist` plus search words. Those go through the existing request understanding (`query.js`): languages, moods, eras, artists, and Tamil or Hindi asking words. The typing language is kept separate from the requested music language.
- **Tests:** `scripts/voice-intent-test.mjs`, 19/19 passing [verified]. Covers every command in the brief, plus title-preservation cases ("This Is Me", "Why This Kolaveri Di").
- **Limitations:**
  - The Tamil or Hindi recognisers would return native script, which the parser can't read yet. `en-IN` is used instead.
  - Spoken requests in pure Tamil script aren't transliterated yet.
  - "Playlist" shows matching songs to add; it doesn't create the playlist automatically, because that would change UI flows.

## 5. Unified entry point (Module D)

A single mic button in the search bar (the only UI change, approved):
- **Tap:** voice search (implemented).
- **Proposed, needs owner choice:** the same button offers "Hum", "What's playing" and "Speak" through the system's standard action sheet, so no custom UI is needed. Alternatively, a long press could mean "listen for music".

The three pipelines stay separate:
- `ir/voice.js`: speech
- `fingerprint/`: landmark fingerprinting (proposed)
- `melody/`: query by humming (proposed)

Each returns `{ candidates: [{ track, score, confidence }], latencyMs }`. Results go through the existing ranking and taste profile, and a "no match" answer is always allowed.

## 6. Benchmark plan (`HUM_SEARCH_BENCHMARK.md`, to be filled with measurements only)

**Sets:**
- Tamil, Hindi, Malayalam, Telugu, English
- old recordings
- regional and folk
- off-key humming
- whistling
- short clips (3–5 s)
- background noise (TV, traffic, café)

**Metrics:** Top-1, Top-3 and Top-5 accuracy, no-match rate, false-positive rate (queries for songs *not* in the index that still return a match), and latency.

**Data needed from the owner:** real recordings. I can't produce genuine human humming, whistling or room recordings; synthetic tones would overstate accuracy. Proposed: you and a few volunteers record 3–5 hums and 3–5 phone clips per category, about 60–100 clips. They stay local and are never committed to git.

Recognition clips can be generated honestly: play songs from a laptop speaker and record on the phone at different distances.

## 7. Decisions needed before building A and B

1. Approve the **on-device index** approach (§1), and whether to pre-index charts on Wi-Fi.
2. How the one mic button offers **hum / identify / speak** (§5).
3. Provide or record the **benchmark clips** (§6).
4. App size: Basic Pitch adds ~1 MB; the fingerprint and melody code adds under 200 KB [estimate].

---

## 8. Measured on real hums (2026-11-11)

Five real attempts on the owner's phone, three of them labelled: Alaakaa Loova, Arabic Kuthu,
Neeyum Naanum. The index held 25–27 songs the phone had played.

**Findings [verified]:**

- **Pitch tracking of hums and whistles works.** 84–95 % of each recording was voiced, with a clean
  melody line.
- **Song melodies were the weak half.** The original extractor locked onto bass and drones for up to
  12 s at a time. Sustained-sound suppression fixed that (longest stuck note 12.2 s → 1.7 s;
  synthetic extraction agreement 83 % → 92 %).
- **Real hums separate songs poorly.** The best song scores only 0.06–0.10 below the median song,
  3–4× less than in synthetic tests. So answers are shown as "best guesses" when nothing is
  confident.
- **Stretching the hum's intervals didn't help.** People compress intervals when humming, so the
  matcher was tried with the hum's intervals stretched. It never helped and was removed.
- **Spotify Basic Pitch didn't help either.** It was tested as the song melody extractor, on the
  phone's GPU, with TensorFlow.js 4.22 (3.x shaders fail on this GPU).

  | Song melodies | Alaakaa | Arabic Kuthu | Neeyum Naanum | per song |
  |---|---|---|---|---|
  | current extractor | 13 | 1 | 1 | ~5 s |
  | Basic Pitch, best setting | 10 | 1 | 1 | 70–110 s |

  It is no better on these hums, and 15–20× slower. Not shipped.

**Conclusion.** What limits accuracy now is how much real humming varies, not the song melodies.
Further tuning on three hums would be noise. The next step is a labelled hum dataset (§9).

## 9. Next: a labelled hum dataset (owner's proposal)

- **Recordings:** many people humming and whistling songs, especially Tamil songs across decades;
  male and female voices; varied keys, octaves, speeds; imperfect melodies.
- **Labels:** the song id, plus the start and end of the part of the song that was hummed.
- **Song metadata:** film, year, composer, singers, language.
- **Uses:**
  1. An honest benchmark (`scripts/hum-benchmark.mjs` already reads labelled WAVs).
  2. Tuning.
  3. At a few thousand clips, training a small hum-to-song embedding model on AuraSynq's own data.
     That is how commercial hum search works, without using anyone else's model.
- **Ruled out:** reverse engineering Google's (or ACRCloud's, Shazam's) models or datasets. They
  are proprietary, and extracting them violates their terms.
