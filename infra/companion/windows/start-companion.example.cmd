@echo off
rem AuraSynq audio backend (invidious-companion) for Windows.
rem Copy to C:\AuraSynqCompanion\start-companion.cmd, next to invidious_companion.exe,
rem and replace the secret. Do not commit the real file.

rem Exactly 16 letters/digits. Must equal AURASYNQ_COMPANION_SECRET in Vercel.
set SERVER_SECRET_KEY=REPLACE_WITH_16_CHARS

rem Only answer requests signed by AuraSynq (otherwise this is an open proxy)
set SERVER_VERIFY_REQUESTS=true

rem Local only: Cloudflare Tunnel / Tailscale Funnel on this PC publish it over HTTPS
set HOST=127.0.0.1
set PORT=8282

rem YouTube throttles the default 5 MB chunks to ~0.25 Mbps; 1 MB chunks measured ~14 Mbps
set NETWORKING_VIDEOPLAYBACK_VIDEO_FETCH_CHUNK_SIZE_MB=1

cd /d "%~dp0"
invidious_companion.exe >> companion.log 2>&1
