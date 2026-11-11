import { defineConfig } from 'vite';

// Bundles the server (and the calendar code it shares with the app) into one
// file, so the production image needs Node and nothing else.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'server/main.ts',
    outDir: 'dist-server',
    target: 'node22',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: 'server.mjs' } },
  },
  ssr: { noExternal: true },
});
