import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.yesgatc.app',
  appName: 'YES LAB',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#1a7f37',
  },
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    allowNavigation: [
      '*.yesgatc.in',
      '*.web.app',
      '*.firebaseapp.com',
      '*.googleapis.com',
      '*.google.com',
      '*.gstatic.com',
      '*.cloudfunctions.net',
      '*.run.app',
      '*.razorpay.com',
    ],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#1a7f37',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a7f37',
    },
  },
};

export default config;
