import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any sub-path (GitHub Pages, static hosts).
// To try the app against a local Daybook server while developing, run the server
// (npm run server) and start Vite with DAYBOOK_SERVER=http://localhost:8080.
const server = process.env.DAYBOOK_SERVER;

export default defineConfig({
  base: './',
  plugins: [react()],
  server: server ? { proxy: { '/api': server } } : undefined,
});
