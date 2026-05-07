import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'

// Read .env file at build time so Vite can bake the values into compiled code
const envPath = path.resolve(__dirname, '.env')
const envVars: Record<string, string> = {}
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex !== -1) {
        envVars[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim()
      }
    }
  }
}

export default defineConfig({
  base: './', // Important for Electron - use relative paths
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main/index.ts',
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['prisma', '@prisma/client', 'electron-store', 'googleapis']
            }
          },
          define: {
            'process.env.GOOGLE_CLIENT_ID': JSON.stringify(envVars.GOOGLE_CLIENT_ID || ''),
            'process.env.GOOGLE_CLIENT_SECRET': JSON.stringify(envVars.GOOGLE_CLIENT_SECRET || ''),
            'process.env.REDIRECT_URI': JSON.stringify(envVars.REDIRECT_URI || 'http://localhost'),
            'process.env.GEMINI_API_KEY': JSON.stringify(envVars.GEMINI_API_KEY || ''),
            'process.env.GEMINI_MODEL': JSON.stringify(envVars.GEMINI_MODEL || '')
          }
        }
      },
      {
        entry: 'electron/preload/index.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload'
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './electron/main'),
      '@renderer': path.resolve(__dirname, './src'),
      'jspdf': path.resolve(__dirname, 'node_modules/jspdf/dist/jspdf.umd.js')
    }
  },
  server: {
    port: 5173
  }
})
