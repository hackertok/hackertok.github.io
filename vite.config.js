/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  resolve: {
    // Mirrors tsconfig.json paths and components.json aliases so `@/...`
    // imports resolve at build time, dev time, AND test time. This is the
    // unified Vite + Vitest config (see the `test:` block below) — the alias
    // automatically applies to test runs without a separate vitest.config.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'src/test/'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase';
          }
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react-router') || id.includes('node_modules/react/')) {
            return 'react';
          }
        },
      },
    },
  },
})
