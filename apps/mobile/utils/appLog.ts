// Field visibility, mobile twin of desktop's electron/main/logger.ts: every
// console.error/warn — how this codebase already reports failures — plus fatal
// JS errors are appended to a capped log file the user can share from
// Settings. Without it, a failure on a phone in the shop is invisible.
//
// The legacy FS API has no append, so the log lives in memory (loaded once)
// and is flushed to disk debounced; the tail is trimmed to MAX_CHARS so the
// file can never grow unbounded.

import * as FileSystem from 'expo-file-system/legacy'

const LOG_URI = (FileSystem.documentDirectory ?? '') + 'app-log.txt'
const MAX_CHARS = 200_000
const FLUSH_MS = 1500

let content = ''
let loaded = false
let flushTimer: ReturnType<typeof setTimeout> | null = null
let initialized = false

async function loadOnce() {
  if (loaded) return
  loaded = true
  try {
    const info = await FileSystem.getInfoAsync(LOG_URI)
    if (info.exists) content = await FileSystem.readAsStringAsync(LOG_URI)
  } catch {
    /* start fresh */
  }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, FLUSH_MS)
}

export async function flush(): Promise<void> {
  try {
    await loadOnce()
    if (content.length > MAX_CHARS) content = content.slice(content.length - MAX_CHARS)
    await FileSystem.writeAsStringAsync(LOG_URI, content)
  } catch {
    // logging must never take the app down
  }
}

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

export function appLog(level: string, args: unknown[]) {
  void loadOnce()
  content += `[${new Date().toISOString()}] ${level} ${args.map(fmt).join(' ')}\n`
  scheduleFlush()
}

export function initAppLog() {
  if (initialized) return
  initialized = true

  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...a: unknown[]) => {
    origError(...a)
    appLog('ERROR', a)
  }
  console.warn = (...a: unknown[]) => {
    origWarn(...a)
    appLog('WARN', a)
  }

  // Fatal JS errors (the red screen in dev, a crash in production).
  const ErrorUtils = (globalThis as any).ErrorUtils
  if (ErrorUtils?.setGlobalHandler) {
    const prev = ErrorUtils.getGlobalHandler?.()
    ErrorUtils.setGlobalHandler((e: unknown, isFatal?: boolean) => {
      appLog(isFatal ? 'FATAL' : 'UNCAUGHT', [e])
      void flush()
      prev?.(e, isFatal)
    })
  }

  appLog('INFO', ['--- app start ---'])
}

// For the Settings "Share logs" button: flush pending lines, return the file
// URI (or null when nothing has ever been logged).
export async function getLogFileUri(): Promise<string | null> {
  await flush()
  const info = await FileSystem.getInfoAsync(LOG_URI)
  return info.exists ? LOG_URI : null
}
