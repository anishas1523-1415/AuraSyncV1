import path from "node:path";
import { fileURLToPath } from "node:url";
import withPWAInit from "@ducanh2912/next-pwa";

const projectDir = path.dirname(fileURLToPath(import.meta.url));

// `npm run build:mobile` sets this to bundle the UI into the Android app (static export).
// The API routes keep running on Vercel and the app calls them over HTTPS.
const isMobileBuild = process.env.NEXT_PUBLIC_APP_TARGET === "mobile";

const withPWA = withPWAInit({
  dest: "public",
  disable: isMobileBuild || process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    exclude: [
      /^\/sign-in/,
      /^\/sign-up/,
      /^\/api\//
    ],
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/www\.youtube\.com\/.*/,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: /\/api\/stream.*/,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: /^https:\/\/lrclib\.net\/api\/.*/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'aurasynq-lyrics-cache',
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
          },
        },
      },
      {
        urlPattern: /\/api\/.*/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'aurasynq-api-cache',
        },
      }
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = isMobileBuild
  ? {
      reactStrictMode: true,
      output: "export",
      // With a custom distDir, Next writes the export there; "out" is what Capacitor bundles.
      // It also keeps a running `next dev` (.next) intact.
      distDir: "out",
      images: { unoptimized: true },
      webpack(config) {
        // The app uses its local profile; keep Clerk (and its server actions) out of the bundle
        const clerkStub = path.join(projectDir, "src/lib/clerkMobileStub.js");
        config.resolve.alias = {
          ...config.resolve.alias,
          "@clerk/nextjs$": clerkStub,
          "@clerk/themes$": clerkStub,
        };
        return config;
      },
    }
  : {
      reactStrictMode: true,
      // The Android app runs from https://localhost and calls these endpoints cross-origin.
      // They are public, read-only GETs (search, lyrics, stream), so any origin may read them.
      async headers() {
        return [
          {
            source: "/api/:path*",
            headers: [
              { key: "Access-Control-Allow-Origin", value: "*" },
              { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
              { key: "Access-Control-Allow-Headers", value: "Range" },
              { key: "Access-Control-Expose-Headers", value: "Content-Length, Content-Range" },
            ],
          },
        ];
      },
    };

export default withPWA(nextConfig);
