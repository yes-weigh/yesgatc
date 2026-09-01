import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { registerSW } from 'virtual:pwa-register'
import { bindPwaInstallListeners } from './lib/pwaInstall'
import './index.css'
import App from './App.tsx'

bindPwaInstallListeners()

if (!Capacitor.isNativePlatform()) {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      window.location.reload()
    },
    onRegisterError(error) {
      console.error('PWA service worker registration failed:', error)
    },
  })
} else {
  void StatusBar.setStyle({ style: Style.Dark })
  void StatusBar.setBackgroundColor({ color: '#1a7f37' })
  void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack || window.history.length > 1) {
      window.history.back()
      return
    }
    void CapacitorApp.exitApp()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
