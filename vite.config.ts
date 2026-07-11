import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(() => {
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: null,
        includeAssets: [
          'icons/favicon-16.png',
          'icons/favicon-32.png',
          'icons/apple-touch-icon.png',
          'brand/logo-dark.png',
        ],
        manifest: {
          id: '/',
          name: 'YES LAB',
          short_name: 'YES LAB',
          description: 'GATC calibration and workflow management',
          start_url: '/login',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait-primary',
          background_color: '#ffffff',
          theme_color: '#1a7f37',
          prefer_related_applications: false,
          categories: ['business', 'productivity'],
          icons: [
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          globPatterns: ['**/*.{js,css,html,ico,png,webp,svg,woff2,webmanifest}'],
          // Main bundle can exceed default 2 MiB precache limit after feature growth.
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.origin.includes('googleapis.com')
                || url.origin.includes('firebasestorage.googleapis.com')
                || url.origin.includes('google.com')
                || url.origin.includes('cloudfunctions.net')
                || url.origin.includes('.run.app')
                || url.origin.includes('gstatic.com'),
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
    ],
    server: {
      proxy: {
        '/api/pincode': {
          target: 'https://api.postalpincode.in',
          changeOrigin: true,
          secure: false,
          rewrite: path => path.replace(/^\/api\/pincode/, '/pincode'),
        },
      },
    },
  }
})
