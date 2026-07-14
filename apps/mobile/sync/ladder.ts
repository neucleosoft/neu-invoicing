// Backup ladder (S4, D7) — mobile side. Same three Drive slots as desktop
// (backup-daily/weekly/monthly.db); whichever device is active refreshes them,
// and due-ness is judged from the DRIVE file's own age so the two devices
// can't thrash each other's cadence. Copies are BLOB-STRIPPED + VACUUMed
// (photos/archive files live once as img-* Drive objects, refetchable), so a
// rung is ~10 MB instead of ~300 MB.

import * as LegacyFS from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import * as SQLite from 'expo-sqlite'

import { snapshotDbTo } from './dbFileLock'

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

const TMP_DB_NAME = 'ladder-tmp.db'

const LADDER_SLOTS = [
  { name: 'backup-daily.db', minAgeMs: 24 * 60 * 60 * 1000 },
  { name: 'backup-weekly.db', minAgeMs: 7 * 24 * 60 * 60 * 1000 },
  { name: 'backup-monthly.db', minAgeMs: 30 * 24 * 60 * 60 * 1000 },
]

// Don't hit Drive with 3 list calls on every 60s auto-sync tick — the ladder
// only needs a look every few hours.
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000
const LAST_CHECK_KEY = 'neu.sync.lastLadderCheckAt'

async function findSlot(
  accessToken: string,
  name: string,
): Promise<{ id: string; modifiedTime?: string; size: number } | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${name}' and trashed=false`,
    fields: 'files(id,modifiedTime,size)',
    pageSize: '1',
  })
  const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`)
  const files =
    ((await res.json()) as { files?: { id: string; modifiedTime?: string; size?: string }[] }).files ?? []
  const f = files[0]
  return f ? { id: f.id, modifiedTime: f.modifiedTime, size: Number(f.size ?? 0) } : null
}

// Build the stripped, vacuumed temp copy inside the SQLite directory (the only
// place expo-sqlite can open a database by name). Returns the temp FILE path.
async function buildStrippedCopy(liveDb: SQLite.SQLiteDatabase): Promise<string> {
  // Consistent snapshot under the shared DB-file lock — a raw copy could
  // capture a half-merged ledger from a concurrent auto-sync apply.
  const tmpPath = await snapshotDbTo(liveDb, TMP_DB_NAME)

  const tmp = await SQLite.openDatabaseAsync(TMP_DB_NAME)
  try {
    await tmp.execAsync(`
      UPDATE PurchaseBill SET attachmentData = NULL;
      UPDATE PreviousInvoice SET fileData = X'';
      VACUUM;
    `)
  } finally {
    await tmp.closeAsync()
  }
  return tmpPath
}

async function uploadSlot(
  accessToken: string,
  slot: { id?: string; name: string },
  tmpPath: string,
): Promise<void> {
  let fileId = slot.id
  if (!fileId) {
    const createRes = await fetch(DRIVE_FILES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: slot.name, parents: ['appDataFolder'] }),
    })
    if (!createRes.ok) throw new Error(`Drive create failed (${createRes.status})`)
    fileId = ((await createRes.json()) as { id: string }).id
  }
  const uploadRes = await LegacyFS.uploadAsync(
    `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`,
    tmpPath,
    {
      httpMethod: 'PATCH',
      uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-sqlite3' },
    },
  )
  if (uploadRes.status < 200 || uploadRes.status >= 300) {
    throw new Error(`Ladder upload failed (${uploadRes.status})`)
  }
}

/**
 * Refresh whichever ladder rungs are due. Throttled locally (one Drive check
 * per ~6h); silent on failure — the ladder is insurance, never a gate.
 */
export async function runLadderIfDue(
  liveDb: SQLite.SQLiteDatabase,
  accessToken: string,
): Promise<void> {
  try {
    const last = await SecureStore.getItemAsync(LAST_CHECK_KEY)
    const now = Date.now()
    if (last && now - Number(last) < CHECK_THROTTLE_MS) return
    await SecureStore.setItemAsync(LAST_CHECK_KEY, String(now))

    // A 0-byte slot (failed two-step upload) counts as missing.
    const due: { name: string; id?: string }[] = []
    for (const slot of LADDER_SLOTS) {
      const f = await findSlot(accessToken, slot.name)
      const age = f?.modifiedTime && f.size > 0 ? now - new Date(f.modifiedTime).getTime() : Infinity
      if (age >= slot.minAgeMs) due.push({ name: slot.name, id: f?.id })
    }
    if (due.length === 0) return

    const tmpPath = await buildStrippedCopy(liveDb)
    try {
      for (const slot of due) {
        await uploadSlot(accessToken, slot, tmpPath)
      }
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        await LegacyFS.deleteAsync(`${tmpPath}${suffix}`, { idempotent: true })
      }
    }
  } catch {
    // insurance only — never surface, next throttled check retries
  }
}
