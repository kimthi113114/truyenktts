import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3002',
      '/covers': 'http://localhost:3002',

      // '/api': 'https://truyenkttsv2.onrender.com',
      // '/covers': 'https://truyenkttsv2.onrender.com',
    }
  }
})
