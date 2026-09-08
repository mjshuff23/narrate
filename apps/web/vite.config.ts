import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: Vite serves the client and proxies /api to the Node server, so the
// browser sees one origin and no CORS is needed. Prod: the server serves dist/.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3210' },
  },
});
