import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
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
const nextConfig = {
  reactStrictMode: true,
};

export default withPWA(nextConfig);
