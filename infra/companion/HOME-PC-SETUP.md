# Home PC setup (Windows, no Docker)

Runs the AuraSynq audio backend on your Windows PC and gives it a permanent public HTTPS
address, so the app on Vercel and on phones can stream full songs. Your home internet IP is the
kind YouTube trusts most. Budget about 30 minutes.

What you end up with:

```
phone / browser ──▶ aura-sync-v1.vercel.app ──redirect──▶ https://<your-pc-address>/companion ──▶ this PC ──▶ YouTube
```

The PC must be on and online whenever someone listens.

---

## 1. Prepare the PC (5 min)

1. **Never sleep while plugged in:** Settings → System → Power → *Screen, sleep & hibernate
   timeouts* → set "Make my device sleep after" (plugged in) to **Never**. The screen may still turn off.
2. **Reliable DNS:** this PC intermittently failed to resolve `www.youtube.com` during testing,
   which made song starts slow or fail. Settings → Network & internet → your adapter →
   *DNS server assignment* → Edit → Manual → IPv4 on → Preferred `1.1.1.1`, Alternate `8.8.8.8`.

## 2. Install the companion (10 min)

1. Create the folder `C:\AuraSynqCompanion`.
2. Download `invidious_companion-x86_64-pc-windows-msvc.zip` from
   <https://github.com/iv-org/invidious-companion/releases/tag/release-master> and extract
   `invidious_companion.exe` into that folder.
3. Copy [`windows/start-companion.example.cmd`](windows/start-companion.example.cmd) to
   `C:\AuraSynqCompanion\start-companion.cmd`.
4. Generate a secret (exactly 16 letters/digits) and paste it into `start-companion.cmd`
   in place of `REPLACE_WITH_16_CHARS`. Keep it handy for step 4.
   ```powershell
   node -e "console.log(require('crypto').randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(0,16))"
   ```
5. Make it start with Windows. In an **administrator** PowerShell, from this repo folder:
   ```powershell
   powershell -ExecutionPolicy Bypass -File infra\companion\windows\install-autostart.ps1
   ```
6. Wait about a minute, then check:
   ```powershell
   curl.exe http://127.0.0.1:8282/healthz
   ```
   It should print `OK`. `C:\AuraSynqCompanion\companion.log` should contain
   `Successfully generated PO token`. These lines in the log are normal and safe to ignore:
   `HTMLCanvasElement.prototype.getContext` and `Failed to open the on-disk KV cache`.

## 3. Give it a public HTTPS address (10 min). Pick one.

### Option A: Tailscale Funnel (free, no domain needed; easiest)

1. Install Tailscale from <https://tailscale.com/download/windows> and sign in.
2. In an administrator PowerShell:
   ```powershell
   tailscale funnel --bg 8282
   ```
   The first time, it prints a link to enable HTTPS and Funnel for your account. Open it, approve,
   then run the command again. It keeps running after reboots.
3. Find your address:
   ```powershell
   tailscale funnel status
   ```
   It looks like `https://<pc-name>.<tailnet-name>.ts.net`. Your companion URL is that
   address + `/companion`.

To stop sharing later: `tailscale funnel reset`.

### Option B: Cloudflare Tunnel (if you own a domain that uses Cloudflare)

1. Cloudflare dashboard → **Networking → Tunnels → Create a tunnel** → name it `aurasynq`
   → choose **Windows**, and run the install command it shows in an administrator PowerShell.
   That installs `cloudflared` as a Windows service.
2. Open the tunnel → **Routes → Add route → Published application**: pick a subdomain such as
   `stream`, choose your domain, and set Service URL to `http://localhost:8282`.
3. Your companion URL is `https://stream.<your-domain>/companion`.

### Check it from outside

From any device (phone on mobile data is a good test), open:

```
https://<your-address>/companion/latest_version?id=yKNxeF4KMsY&itag=140
```

You should see **`No check ID.`** That proves the PC is reachable and only answers requests
signed by AuraSynq.

## 4. Connect AuraSynq (5 min)

1. Vercel → project **aura-sync-v1** → Settings → Environment Variables → add both, for
   **Production** (and Preview if you use it):
   | Name | Value |
   |---|---|
   | `AURASYNQ_COMPANION_URL` | `https://<your-address>/companion` (no trailing slash) |
   | `AURASYNQ_COMPANION_SECRET` | the 16-character secret from step 2 |
2. Deployments → latest production deployment → **⋯ → Redeploy**. Environment changes only apply
   to new deployments.
3. Open the app, play a song, and seek past the 1-minute mark. It should keep playing.

For local development, put the same two lines in `.env.local`.

## Keeping it healthy

- **Updates:** YouTube changes things every few weeks. If songs stop playing, download the latest
  zip from the release page, then in an administrator PowerShell:
  `Stop-ScheduledTask "AuraSynq Companion"`, replace the `.exe`, and run
  `Start-ScheduledTask "AuraSynq Companion"`.
- **Logs:** `C:\AuraSynqCompanion\companion.log` (delete it occasionally; it grows).
- **Turning it off:** set `AURASYNQ_COMPANION_URL` empty in Vercel and redeploy. AuraSynq falls back
  to its built-in extractor (about one minute per song).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `healthz` doesn't answer | Run `C:\AuraSynqCompanion\start-companion.cmd` by hand and read the error |
| Log shows `dns error: No such host is known` | Do step 1.2 (DNS) |
| Public URL fails but `127.0.0.1` works | `tailscale funnel status`, or the tunnel shows *Healthy* in Cloudflare |
| Songs fail and the companion answers `ID incorrect.` | The secrets in Vercel and `start-companion.cmd` differ |
| Songs start slowly the first time | Normal (2–10 s while the companion resolves a song); the next track is pre-resolved |
