import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflareHeadersFile } from './server/headers';

// Relative base so the build works from any sub-path (GitHub Pages, static hosts).
// To try the app against a local Daybook server while developing, run the server
// (npm run server) and start Vite with DAYBOOK_SERVER=http://localhost:8080.
const server = process.env.DAYBOOK_SERVER;

export default defineConfig({
  base: './',
  plugins: [
    react(),
    // dist/_headers: the security and caching headers Cloudflare adds to the app's files
    // (the Node server sends the same ones itself).
    {
      name: 'cloudflare-headers',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: '_headers', source: cloudflareHeadersFile() });
      },
    },
  ],
  server: server ? { proxy: { '/api': server } } : undefined,
});
