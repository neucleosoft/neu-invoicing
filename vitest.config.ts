import { defineConfig } from 'vitest/config'
import path from 'path'

// Dedicated Vitest config so the Electron/Vite build plugins in vite.config.ts
// are NOT loaded during tests. Runs in a plain Node environment; the Electron
// main/renderer boundaries are mocked in the tests themselves.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['electron/main/handlers/salesLogic.ts', 'src/utils/gstValidation.ts']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './electron/main'),
      '@renderer': path.resolve(__dirname, './src')
    }
  }
})
