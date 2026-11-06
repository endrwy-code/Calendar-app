import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any sub-path (GitHub Pages, static hosts).
export default defineConfig({
  base: './',
  plugins: [react()],
});
