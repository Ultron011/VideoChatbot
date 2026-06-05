import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin dev: proxy API calls to the local token server, mirroring
    // how nginx fronts it in production. Keeps CORS a prod-only concern.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
