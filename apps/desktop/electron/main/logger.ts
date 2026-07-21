// Field visibility: everything the main process logs via console.error/warn —
// which is how every handler in this codebase already reports failures — is
// ALSO appended to a capped log file in userData/logs, along with uncaught
// exceptions and renderer-side errors (via the log:fromRenderer IPC). Without
// this, a failure on the boss's machine is invisible; with it, debugging is
// "open the log folder from Settings and read".

import { app, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'

const MAX_BYTES = 1_000_000 // rotate at ~1 MB, keep one previous file

let logPath: string | null = null
let logDir: string | null = null

const fmt = (a: unknown): string => {
  if (a instanceof Error) return a.stack ?? a.message
  if (typeof a === 'object' && a !== null) {
    try {
      return JSON.stringify(a)
    } catch {
      return String(a)
    }
  }
  return String(a)
}

function write(level: string, args: unknown[]) {
  if (!logPath) return
  try {
    try {
      const stat = fs.statSync(logPath)
      if (stat.size > MAX_BYTES) {
        fs.renameSync(logPath, path.join(logDir!, 'app.old.log'))
      }
    } catch {
      /* first write */
    }
    const line = `[${new Date().toISOString()}] ${level} ${args.map(fmt).join(' ')}\n`
    fs.appendFileSync(logPath, line)
  } catch {
    // logging must never take the app down
  }
}

export function initLogging() {
  logDir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  logPath = path.join(logDir, 'app.log')

  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...a: unknown[]) => {
    origError(...a)
    write('ERROR', a)
  }
  console.warn = (...a: unknown[]) => {
    origWarn(...a)
    write('WARN', a)
  }
  process.on('uncaughtException', (e) => {
    write('FATAL', [e])
    origError(e)
  })
  process.on('unhandledRejection', (r) => {
    write('REJECTION', [r])
  })
  write('INFO', [`--- app start v${app.getVersion()} ---`])

  ipcMain.handle('log:openFolder', async () => {
    if (logPath && fs.existsSync(logPath)) shell.showItemInFolder(logPath)
    else if (logDir) await shell.openPath(logDir)
    return { success: true }
  })
  // Renderer errors (window.onerror / unhandledrejection) funnel through here.
  ipcMain.handle('log:fromRenderer', async (_, level: string, message: string) => {
    write(`RENDERER-${level}`, [message])
    return { success: true }
  })
}
