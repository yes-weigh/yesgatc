import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { bindPwaInstallListeners } from './lib/pwaInstall'
import './index.css'
import App from './App.tsx'

bindPwaInstallListeners()

registerSW({
  immediate: true,
  onRegisterError(error) {
    console.error('PWA service worker registration failed:', error)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
