# AuraSynq: Google Play release plan

Status as of 2026-10-12: **not ready for Google Play.** The app itself is close to release
quality. The blocker is where the music comes from, not the code.

## 1. The blocker: how songs are played

AuraSynq plays music by pulling audio straight from YouTube on the phone. It passes YouTube's
bot check (BotGuard / PO tokens) by serving its own UI under the `www.youtube.com` origin, and it
downloads the audio files for background play and offline caching.

That conflicts with:

- **YouTube's Terms of Service**, which forbid downloading content or accessing it any way other
  than through YouTube's own player or API. Background play and offline downloads are YouTube
  Premium features.
- **Google Play's Developer Program Policies**: Intellectual Property (apps that enable
  unauthorized access to copyrighted content) and Deceptive Behavior (the app presents itself to
  Google's servers as youtube.com).

Expected outcome if submitted as-is: rejection in review, or removal after a takedown report.
Repeated policy violations can suspend the whole Play developer account, and new accounts can be
linked to the developer's other Google accounts.

### Ways forward (pick one)

| Option | What changes | Trade-off |
|---|---|---|
| **A. Licensed or free catalogue** (recommended for Play) | Play songs from services whose terms allow it: **Audius** (free API, streaming allowed), **Jamendo** (free API for Creative Commons music), or your own uploaded/licensed tracks. Keep YouTube Music *search* only for discovery, linking out to YouTube to play. | Fewer mainstream hits; everything else in the app (floating UI, accounts, blends, sharing) stays. |
| **B. YouTube's official player** | Play through the YouTube IFrame Player API inside the app, visibly, with YouTube branding. | Allowed, but no background play, no lock-screen playback, no offline. Feels like a YouTube wrapper. |
| **C. Partner with a licensed provider** | Spotify (App Remote SDK; listeners need the Spotify app and Premium for full control) or a paid music-licensing API. | Business agreements and cost; Spotify rules restrict how its content is shown. |
| **D. Don't use Google Play** | Share the APK directly (your own site, Telegram, etc.). | No Play review, but the YouTube Terms issue remains and anyone can report it. Updates must be installed by hand. |

## 2. Release checklist (once the catalogue question is settled)

### Accounts and money
- [ ] Google Play developer account (one-time US$25, identity verification).
- [ ] **New personal accounts must run a closed test with at least 12 testers for 14 days**
      before they can publish to production. Line up the testers early.

### Signing and build
- [ ] Create an upload keystore and keep it, and its passwords, backed up outside the repo.
- [ ] Enrol in Play App Signing (Play holds the app signing key).
- [ ] Add the **Play app-signing SHA-1 and SHA-256** to Firebase (Android app `com.aurasynq.app`),
      or Google sign-in fails for Play installs. Today only this PC's debug key is registered.
- [ ] Add the Play SHA-256 to `hosting/public/.well-known/assetlinks.json` and redeploy, so share
      links keep opening the app.
- [ ] Release build: `versionCode` / `versionName` (now 1 / 1.0), enable R8 minify with keep rules
      for the Capacitor plugins, build the bundle with `./gradlew bundleRelease` (AAB, not APK).
- [ ] Remove the USB diagnostics hook (`window.__auraOnDevice`) from release builds.

### Policy forms in Play Console
- [ ] **Privacy policy URL** (required: the app collects name, email and listening history).
      Host it on aurasynq.web.app/privacy.
- [ ] **Account deletion**: in-app deletion exists (Profile → Privacy → Delete my account). Play
      also needs a **web page** for deletion requests, e.g. aurasynq.web.app/delete-account.
- [ ] **Data safety**: collected = name, email, user ID, app activity (history, likes,
      playlists); stored in Firebase (Firestore, Mumbai); encrypted in transit; deletable by the
      user; not sold; no ads.
- [ ] **Foreground service declaration**: the app uses a `mediaPlayback` foreground service.
      Play asks for a short video showing background playback.
- [ ] Content rating questionnaire, target audience (13+ is simplest with sign-in), ads = none,
      news app = no, government app = no.

### Store listing
- [ ] App name, short description (80 characters), full description (4000 characters).
- [ ] 512×512 icon (from the Aurora logo), 1024×500 feature graphic, 2–8 phone screenshots
      (Home bubbles, Trending, Tamil drift, player, Profile, share card).
- [ ] Category: Music & Audio. Contact email. Website: https://aurasynq.web.app

### Quality before submitting
- [ ] Crash reporting (Firebase Crashlytics) so tester crashes are visible.
- [ ] Test on a small phone, a tablet, Android 10 and Android 15/16, and on weak mobile data.
- [ ] The website (Vercel) still runs older code. Deploy it or retire it so links never show it.
- [ ] Optional: a custom domain (for example aurasynq.app) so nothing shows Firebase or Vercel
      addresses.

## 3. Rough timeline

| Step | Time |
|---|---|
| Decide the catalogue (section 1) and rebuild playback | 1–3 weeks, depending on the option |
| Privacy policy, deletion page, Data safety, listing assets | 2–3 days |
| Signing, release build, Firebase/App Links fingerprints | 1 day |
| Closed test (12+ testers, 14 days) | 2 weeks (required for new accounts) |
| Production review | a few days to about a week |
