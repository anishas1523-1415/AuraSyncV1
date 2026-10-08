// Builds the Android app's bundled UI: a static export of the Next.js app into ./out,
// then syncs it into the Capacitor project.
//
//   npm run build:mobile                       # uses the production site for API calls
//   AURASYNQ_SITE_URL=https://... npm run build:mobile
//
// API routes, the auth middleware and the Clerk sign-in pages can't be statically exported
// (they keep running on Vercel), so they are moved aside for the build and always restored.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const SITE = (process.env.AURASYNQ_SITE_URL || "https://aura-sync-v1.vercel.app").replace(/\/+$/, "");
const ASIDE_ROOT = ".mobile-build-aside";
const SERVER_ONLY = ["src/app/api", "src/middleware.js", "src/app/sign-in", "src/app/sign-up"];

function move(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  // Windows can briefly lock files (editors, watchers); retry before falling back to copy
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (attempt === 4) {
        cpSync(from, to, { recursive: true });
        rmSync(from, { recursive: true, force: true });
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
    }
  }
}

function restoreAll() {
  for (const path of SERVER_ONLY) {
    const parked = join(ASIDE_ROOT, path);
    if (existsSync(parked)) {
      if (existsSync(path)) throw new Error(`Both ${path} and ${parked} exist; resolve manually.`);
      move(parked, path);
    }
  }
  rmSync(ASIDE_ROOT, { recursive: true, force: true });
}

function run(command, env = {}) {
  const result = spawnSync(command, { stdio: "inherit", shell: true, env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`"${command}" failed with exit code ${result.status}`);
}

// A previous run that crashed mid-build may have left files parked
if (existsSync(ASIDE_ROOT)) {
  console.log("Restoring files parked by an interrupted build...");
  restoreAll();
}

try {
  for (const path of SERVER_ONLY) {
    if (existsSync(path)) move(path, join(ASIDE_ROOT, path));
  }
  rmSync("out", { recursive: true, force: true });

  console.log(`Building the mobile UI (API: ${SITE})...`);
  run("npx next build", {
    NEXT_PUBLIC_APP_TARGET: "mobile",
    NEXT_PUBLIC_API_BASE: SITE,
    NEXT_PUBLIC_SITE_URL: SITE,
  });
} finally {
  restoreAll();
}

if (!process.argv.includes("--no-sync")) {
  run("npx cap sync android");
}
console.log("Mobile UI ready in ./out and synced to android/. Build the APK with Gradle or Android Studio.");
