import { defineConfig } from 'vite';

// GitHub Pages project site: https://huming0618.github.io/airportview/
export default defineConfig({
  base: process.env.VITE_BASE || '/airportview/',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
