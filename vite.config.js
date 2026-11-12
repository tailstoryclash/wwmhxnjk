import { defineConfig } from 'vite';

// Hosted previews proxy the dev server under their own hostname, which Vite's
// host check would otherwise reject. Opt in explicitly instead of always.
const allowedHosts = process.env.VITE_ALLOW_ALL_HOSTS === '1' ? true : undefined;

export default defineConfig({
  base: './',
  server: { host: true, port: 5173, strictPort: true, allowedHosts },
  preview: { host: true, port: 4173, allowedHosts },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
});
