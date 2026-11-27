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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: 'studio-effects', test: /node_modules\/(n8ao|postprocessing)\//, includeDependenciesRecursively: false },
          ],
        },
      },
    },
  },
  // Whole-house builds take seconds when several agents share the CPU: allow them, keep real hangs visible.
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 30_000 },
})
