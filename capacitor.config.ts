import type { CapacitorConfig } from '@capacitor/cli';

// The app is a native shell around the deployed web app (it needs the Next.js API routes,
// so there is no static export). Point a dev build at a local server with e.g.
//   CAP_SERVER_URL=http://192.168.0.11:3000 npx cap sync android
const serverUrl = process.env.CAP_SERVER_URL || 'https://aura-sync-v1.vercel.app';
const isPlainHttp = serverUrl.startsWith('http://');

const config: CapacitorConfig = {
  appId: 'com.aurasynq.app',
  appName: 'AuraSynq',
  webDir: 'public',
  server: {
    url: serverUrl,
    cleartext: isPlainHttp,
    allowNavigation: [
      'daring-grackle-57.clerk.accounts.dev',
      '*.clerk.accounts.dev',
      '*.clerk.com'
    ]
  },
  android: {
    allowMixedContent: isPlainHttp
  }
};

export default config;
