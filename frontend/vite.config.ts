import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend (Spring/Jetty side) listens on 8484 on this laptop.
const backend = 'http://localhost:8484';
const proxy = {
  '/api': { target: backend, changeOrigin: true },
  '/ws': { target: backend, ws: true, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
});
