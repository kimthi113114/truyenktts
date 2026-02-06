import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        // Enable streaming for TTS endpoints
        ws: true,
        timeout: 120000, // 2 minutes timeout for TTS generation
      },
      '/covers': 'http://localhost:3002',

      // '/api': 'https://truyenkttsv2.onrender.com',
      // '/covers': 'https://truyenkttsv2.onrender.com',
    }
  }
})
