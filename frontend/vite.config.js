import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    strictPort: true,
    headers: {
      // Dev CSP is intentionally permissive (HMR + live preview iframes).
      // `frame-ancestors` must be delivered via response header (meta is ignored).
      'Content-Security-Policy':
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: http: https:; " +
        "style-src 'self' 'unsafe-inline' http: https:; " +
        "img-src 'self' data: blob: http: https:; " +
        "font-src 'self' data: http: https:; " +
        "connect-src 'self' ws: wss: http: https:; " +
        "worker-src 'self' blob: data:; " +
        "frame-src 'self' blob: data: http: https:;",
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
