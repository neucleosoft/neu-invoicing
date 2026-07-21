// In-app database reload — the production-safe replacement for
// DevSettings.reload() (which is a NO-OP in release builds; restore used to
// finish silently and leave the app holding a dead SQLite handle).
//
// The root layout registers a trigger that bumps the SQLiteProvider epoch:
// a fresh onInit identity defeats expo-sqlite's global provider cache, forcing
// a true close-and-reopen of the database file, and the key bump remounts the
// whole tree under it (auth, screens) — a soft reboot that works identically
// in dev and production.

let trigger: (() => void) | null = null

export function registerDbReload(fn: () => void) {
  trigger = fn
}

/** Soft-reboot the app onto the current database file. */
export function reloadDb() {
  trigger?.()
}
