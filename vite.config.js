import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Tuckii 書籤',
        short_name: 'Tuckii',
        description: '單頁式網頁書籤管理：貼上網址，一鍵收藏分類。',
        lang: 'zh-Hant',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: '#F7F4EE',
        theme_color: '#1F6FEB',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
