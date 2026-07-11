// Row-level sync ("Sync now") — desktop plumbing around the shared sync brain.
//
// The intelligence lives in @neu/shared (syncPackets = diary format,
// syncApply = merge rules, recompute = totals rebuild); this file is only the
// Prisma fetches, the Drive diary IO, and the mechanical plan execution.
// Mobile has the exact twin in apps/mobile/sync/rowSync.ts.
//
// The diary model is STATELESS and idempotent: every push rewrites this
// device's whole diary with everything that changed in the last 30 days
// (D11's trim, for free); every pull reads the peers' diaries in full and
// lets planApply skip what's older-or-equal. No baselines to corrupt, and
// re-running Sync now is always harmless.
//
// Flow: PULL peers' diaries → planApply → execute plan in ONE transaction →
// recomputeAll({apply}) → PUSH own diary (so renumbered/merged state
// propagates immediately).

import { ipcMain } from 'electron'
import { google } from 'googleapis'
import Store from 'electron-store'
import {
  buildDiary,
  parseDiary,
  planApply,
  reviveRowDates,
  toEpochMs,
  SYNC_DOCUMENT_TABLES,
  SYNC_SINGLE_TABLES,
  type ApplyPlan,
  type DocumentBundle,
  type LocalIndex,
  type SyncPacket,
} from '@neu/shared'
import { getOAuth2Client, isAuthError } from './auth'
import { getPrisma } from './database'
import { recomputeAll } from './recompute'

const store = new Store()

// Push everything changed in this window; peers dedupe/skip what they have.
const DIARY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const diaryFileName = (deviceId: string) => `changes-${deviceId}.json`

const getDeviceId = (): string => store.get('device_id') as string

export interface RowSyncResult {
  success: boolean
  error?: string
  pushedPackets?: number
  applied?: number
  skipped?: number
  localRenumbers?: number
  removalsApplied?: number
  recomputeChanges?: number
  log?: { kind: string; table: string; rowId: string; detail: string }[]
}

// Rows changed inside the window. The `updatedAt: null` branch only matters
// for legacy payment rows minted before the updatedAt column existed.
const changedSince = (cutoff: Date) => ({
  OR: [{ updatedAt: { gt: cutoff } }, { updatedAt: null, createdAt: { gt: cutoff } }],
})

// ── Collect (push side) ──────────────────────────────────────────────────────

async function collectDiary(prisma: any, deviceId: string, now: number) {
  const cutoff = new Date(now - DIARY_WINDOW_MS)

  const singles: Record<string, Record<string, unknown>[]> = {}
  for (const table of SYNC_SINGLE_TABLES) {
    singles[table] = await prisma[table].findMany({ where: changedSince(cutoff) })
  }

  const documents: Record<string, DocumentBundle[]> = {}
  for (const spec of SYNC_DOCUMENT_TABLES) {
    const headers = await prisma[spec.table].findMany({ where: changedSince(cutoff) })
    if (headers.length === 0) continue
    const ids = headers.map((h: any) => h.id)
    const children = await prisma[spec.childTable].findMany({ where: { [spec.childFk]: { in: ids } } })
    const movements = spec.movementRef
      ? await prisma.stockMovement.findMany({ where: { referenceType: spec.movementRef, referenceId: { in: ids } } })
      : []
    documents[spec.table] = headers.map((h: any) => ({
      header: h,
      children: children.filter((c: any) => c[spec.childFk] === h.id),
      ...(spec.movementRef
        ? { movements: movements.filter((m: any) => m.referenceId === h.id) }
        : {}),
    }))
  }

  return buildDiary({ device: deviceId, now, singles: singles as any, documents })
}

// ── Local index (pull side input) ────────────────────────────────────────────

async function buildLocalIndex(prisma: any): Promise<LocalIndex> {
  const headers: LocalIndex['headers'] = {}
  const numbers: NonNullable<LocalIndex['numbers']> = {}

  const indexTable = async (table: string, numberColumn?: string) => {
    const rows = await prisma[table].findMany()
    headers[table] = {}
    if (numberColumn) numbers[table] = {}
    for (const r of rows) {
      headers[table][r.id] = {
        updatedAt: toEpochMs(r.updatedAt),
        createdAt: toEpochMs(r.createdAt),
        deletedAt: toEpochMs(r.deletedAt),
        cancelledAt: toEpochMs(r.cancelledAt),
        status: r.status ?? null,
      }
      const num = numberColumn ? r[numberColumn] : null
      if (numberColumn && num != null) {
        numbers[table][String(num)] = { rowId: r.id, createdAt: toEpochMs(r.createdAt) }
      }
    }
  }

  for (const table of SYNC_SINGLE_TABLES) await indexTable(table)
  for (const spec of SYNC_DOCUMENT_TABLES) await indexTable(spec.table, spec.numberColumn)

  return { headers, numbers }
}

// ── Execute (pull side output) ───────────────────────────────────────────────

async function executePlan(prisma: any, plan: ApplyPlan): Promise<void> {
  if (plan.upserts.length === 0 && plan.localRenumbers.length === 0) return
  await prisma.$transaction(async (tx: any) => {
    for (const u of plan.upserts) {
      const data = reviveRowDates(u.row)
      await tx[u.table].upsert({ where: { id: u.rowId }, create: data, update: data })
      if (u.children) {
        await tx[u.children.table].deleteMany({ where: { [u.children.fk]: u.rowId } })
        if (u.children.rows.length) {
          await tx[u.children.table].createMany({ data: u.children.rows.map(reviveRowDates) })
        }
      }
      if (u.movements) {
        await tx.stockMovement.deleteMany({
          where: { referenceType: u.movements.referenceType, referenceId: u.movements.referenceId },
        })
        if (u.movements.rows.length) {
          await tx.stockMovement.createMany({ data: u.movements.rows.map(reviveRowDates) })
        }
      }
    }
    // @updatedAt auto-bumps on these updates, so a renumber propagates on the
    // next push — the other device learns the new number.
    for (const r of plan.localRenumbers) {
      await tx[r.table].update({ where: { id: r.rowId }, data: { [r.column]: r.to } })
    }
  })
}

// ── Drive diary IO ───────────────────────────────────────────────────────────

async function uploadOwnDiary(drive: any, deviceId: string, json: string): Promise<void> {
  const name = diaryFileName(deviceId)
  const existing = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name='${name}'`,
    fields: 'files(id)',
    pageSize: 1,
  })
  const media = { mimeType: 'application/json', body: json }
  if (existing.data.files?.length) {
    await drive.files.update({ fileId: existing.data.files[0].id!, media })
  } else {
    await drive.files.create({ requestBody: { name, parents: ['appDataFolder'] }, media })
  }
}

async function downloadPeerDiaries(
  drive: any,
  ownName: string,
): Promise<{ packets: SyncPacket[]; newerVersion: boolean }> {
  const list = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name contains 'changes-'`,
    fields: 'files(id,name)',
    pageSize: 100,
  })
  const packets: SyncPacket[] = []
  let newerVersion = false
  for (const f of list.data.files ?? []) {
    if (!f.name || f.name === ownName || !f.name.startsWith('changes-')) continue
    const res = await drive.files.get({ fileId: f.id!, alt: 'media' }, { responseType: 'text' })
    const parsed = parseDiary(typeof res.data === 'string' ? res.data : JSON.stringify(res.data))
    if (!parsed.ok) {
      if (parsed.error === 'NEWER_VERSION') newerVersion = true
      // MALFORMED: skip — a half-written peer diary must not kill the sync.
      continue
    }
    packets.push(...parsed.diary.packets)
  }
  return { packets, newerVersion }
}

// ── The whole flow ───────────────────────────────────────────────────────────

export const rowSyncNow = async (): Promise<RowSyncResult> => {
  if (store.get('demo_mode')) return { success: true, pushedPackets: 0, applied: 0 }
  if (!store.get('google_tokens')) return { success: false, error: 'OFFLINE' }

  try {
    const prisma = getPrisma()
    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const deviceId = getDeviceId()
    const now = Date.now()

    // PULL first, so renumbers/merges ride the push below.
    const { packets, newerVersion } = await downloadPeerDiaries(drive, diaryFileName(deviceId))
    if (newerVersion) {
      return { success: false, error: 'The other device runs a newer app version — update this one to keep syncing.' }
    }

    let applied = 0
    let skipped = 0
    let localRenumbers = 0
    let removalsApplied = 0
    let log: RowSyncResult['log'] = []
    if (packets.length > 0) {
      const local = await buildLocalIndex(prisma)
      const plan = planApply(packets, local)
      await executePlan(prisma, plan)
      applied = plan.upserts.length
      skipped = plan.skipped.length
      localRenumbers = plan.localRenumbers.length
      removalsApplied = plan.incomingRemovals
      log = plan.log
    }

    // Recompute AFTER apply — the whole reason stored totals can be trusted.
    // (openingStock backfill already ran at startup, before any sync can.)
    const recompute = await recomputeAll(prisma, { apply: true })

    // PUSH: rewrite this device's whole 30-day diary (stateless, idempotent).
    const diary = await collectDiary(prisma, deviceId, now)
    await uploadOwnDiary(drive, deviceId, JSON.stringify(diary))

    return {
      success: true,
      pushedPackets: diary.packets.length,
      applied,
      skipped,
      localRenumbers,
      removalsApplied,
      recomputeChanges: recompute.totalChanges,
      log,
    }
  } catch (error) {
    console.error('rowSyncNow error:', error)
    const friendly = isAuthError(error)
      ? 'Google sign-in expired. Please sign in again.'
      : error instanceof Error ? error.message : 'Sync failed'
    return { success: false, error: friendly }
  }
}

export const setupRowSyncHandlers = () => {
  ipcMain.handle('sync:rowSyncNow', async () => rowSyncNow())
}
