import { cpSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type ViteUserConfig } from 'vitest/config'

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'public') {
    return {
      ...studioConfig,
      define: { 'import.meta.env.PUBLIC_BUILD': 'true' },
      build: { ...studioConfig.build, outDir: 'dist-public', copyPublicDir: false },
      plugins: [
        ...studioConfig.plugins,
        {
          name: 'public-build-assets',
          writeBundle({ dir }) {
            if (!dir) throw new Error('The public build needs an output directory')
            const source = resolve('public')
            const modelDirs = new Set(['models', 'models-lo'].map(folder => join('assets', folder)))
            cpSync(source, dir, {
              recursive: true,
              dereference: true,
              filter: file => !modelDirs.has(relative(source, file)),
            })
          },
        },
      ],
    }
  }
  return studioConfig
})

const studioConfig = {
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
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} satisfies ViteUserConfig
