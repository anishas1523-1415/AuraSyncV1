import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aurasynq.app',
  appName: 'AuraSynq',
  webDir: 'public',
  server: {
    // Use the production Next server for reliable hydration in the Android WebView.
    url: 'http://127.0.0.1:3001',
    cleartext: true,
    allowNavigation: [
      'daring-grackle-57.clerk.accounts.dev',
      '*.clerk.accounts.dev',
      '*.clerk.com'
    ]
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
