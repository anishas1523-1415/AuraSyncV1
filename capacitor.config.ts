import type { CapacitorConfig } from '@capacitor/cli';

// The UI ships inside the app (`npm run build:mobile` exports it to ./out), so it opens
// instantly like a native app; only search, lyrics and audio go over the network.
// For live development against a running dev server instead:
//   CAP_SERVER_URL=http://192.168.0.11:3000 npx cap sync android
const devServerUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.aurasynq.app',
  appName: 'AuraSynq',
  webDir: 'out',
  ...(devServerUrl
    ? { server: { url: devServerUrl, cleartext: devServerUrl.startsWith('http://') } }
    : {}),
  android: {
    allowMixedContent: false
  }
};

export default config;
