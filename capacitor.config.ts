import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aurasynq.app',
  appName: 'AuraSynq',
  webDir: 'out',
  server: {
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
