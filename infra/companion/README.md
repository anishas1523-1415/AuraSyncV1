# AuraSynq audio backend (invidious-companion)

YouTube now serves only the first ~1 MB of a song (about a minute) to clients without a PO token, so
AuraSynq's built-in extractor can't play full songs. [invidious-companion](https://github.com/iv-org/invidious-companion)
mints PO tokens and proxies the audio, which gets past that limit.

How AuraSynq uses it: `/api/stream?id=…` signs a short "check ID" with a shared secret and redirects the
player to the companion, which streams the song directly to the listener. Vercel only issues the
redirect, so audio bandwidth never goes through your Vercel plan.

```
phone ──/api/stream──▶ AuraSynq (Vercel) ──302 + signed check──▶ companion ──▶ YouTube
  ▲                                                                   │
  └──────────────────────── audio/mp4 (seekable) ◀────────────────────┘
```

## Measured (2026-10-06, residential connection)

| | Result |
|---|---|
| Unsigned / wrong-secret request | `400` (not an open proxy) |
| Full song (4.4 MB) | complete `audio/mp4`, past the 1 MB cap |
| First audio byte | 1.9–3.1 s cold; 9–24 ms once warmed (AuraSynq warms the next track) |
| Throughput, 1 MB fetch chunks | ~14–19 Mbps (default 5 MB chunks: ~0.25 Mbps) |
| Seek to 3 MB | `206` in ~0.9 s |

## Where to host it

YouTube trusts residential IPs far more than datacenter IPs.

- **Home PC / Raspberry Pi + Cloudflare Tunnel (recommended to start):** free, residential IP, no
  open ports. The machine must stay on.
- **Small VPS:** always on, but YouTube may flag datacenter IPs. If it does, set `PROXY` in
  `docker-compose.yml` or use the companion's IPv6 rotation.

Either way it needs Docker, about 1 GB RAM, and a public **HTTPS** URL (an `http://` URL is blocked
as mixed content on the deployed site).

## Setup

1. Generate a secret (exactly 16 letters/digits):
   ```bash
   node -e "console.log(require('crypto').randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(0,16))"
   ```
2. On the host machine, in this folder:
   ```bash
   cp .env.example .env    # set SERVER_SECRET_KEY (and CLOUDFLARE_TUNNEL_TOKEN if using the tunnel)
   docker compose up -d                    # behind your own reverse proxy (e.g. Caddy) on :8282
   docker compose --profile tunnel up -d   # or: Cloudflare Tunnel → http://companion:8282
   ```
3. Wait for `Successfully generated PO token` in `docker compose logs -f companion` (about a minute),
   then check `curl https://<your-host>/healthz` returns `OK`.
4. Add to AuraSynq's environment (Vercel → Project → Settings → Environment Variables, and
   `.env.local` for local dev), then redeploy:
   ```
   AURASYNQ_COMPANION_URL=https://<your-host>/companion
   AURASYNQ_COMPANION_SECRET=<same value as SERVER_SECRET_KEY>
   ```
   Leaving `AURASYNQ_COMPANION_URL` unset keeps the built-in extractor.

## Notes

- PO tokens refresh automatically every 5 minutes; no cron or restarts are needed for that.
- If cold starts get slow or fail, check the host's DNS resolution of `www.youtube.com` (the
  development PC used for testing intermittently failed these lookups).
- Captions, DASH manifests and video streams are also served, but AuraSynq only requests
  audio itag 140 (AAC 128 kbps).
