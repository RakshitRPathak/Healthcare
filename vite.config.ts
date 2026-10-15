/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const api = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000';
export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5173, proxy: { '/api': { target: api, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } } },
  preview: { port: 5173, proxy: { '/api': { target: api, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'], css: false },
});
