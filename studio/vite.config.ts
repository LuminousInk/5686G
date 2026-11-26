import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 2500,
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
