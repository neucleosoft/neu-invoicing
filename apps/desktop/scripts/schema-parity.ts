// Schema-parity guard: proves the two hand-mirrored schemas — Prisma
// (apps/desktop/prisma/schema.prisma, via the generated client's DMMF) and
// Drizzle (packages/shared/src/schema.ts, used by mobile) — still describe the
// SAME tables, columns, and nullability. Any drift between them becomes a sync
// bug (a column one app writes and the other's executor rejects), which is why
// this runs in CI on every push.
//
//   pnpm verify:parity     (bundled+run via esbuild, see package.json)
//
// Types are compared as coarse SQLite storage classes (text/int/real/blob) —
// the drift class that has actually bitten this repo is missing columns, not
// storage classes, and Prisma/Drizzle spell types too differently for exact
// matching to be signal instead of noise.

import { Prisma } from '@prisma/client'
import { getTableColumns, getTableName } from 'drizzle-orm'
import * as shared from '../../../packages/shared/src/schema'

// Known-intentional divergences. Keep this SHORT and explained.
const IGNORE_TABLES = new Set([
  // Prisma-only, desktop-legacy; not synced, not on mobile.
  'GstCache',
  'SyncMetadata',
  'Expense',
])

type Col = { notNull: boolean; storage: string }
type Tables = Map<string, Map<string, Col>>

// ── Prisma side (DMMF from the generated client) ─────────────────────────────

const PRISMA_STORAGE: Record<string, string> = {
  String: 'text',
  Int: 'int',
  BigInt: 'int',
  Float: 'real',
  Decimal: 'real',
  Boolean: 'int',
  DateTime: 'int', // stored as epoch-ms integers in this repo's SQLite dialect
  Bytes: 'blob',
  Json: 'text',
}

function prismaTables(): Tables {
  const out: Tables = new Map()
  for (const model of Prisma.dmmf.datamodel.models) {
    const tableName = model.dbName ?? model.name
    if (IGNORE_TABLES.has(tableName)) continue
    const cols = new Map<string, Col>()
    for (const f of model.fields) {
      if (f.kind !== 'scalar' && f.kind !== 'enum') continue // relations aren't columns
      if (f.isList) continue
      cols.set(f.dbName ?? f.name, {
        notNull: f.isRequired,
        storage: PRISMA_STORAGE[f.type] ?? f.type,
      })
    }
    out.set(tableName, cols)
  }
  return out
}

// ── Drizzle side (the shared schema module) ──────────────────────────────────

const DRIZZLE_STORAGE: Record<string, string> = {
  SQLiteText: 'text',
  SQLiteTextJson: 'text',
  SQLiteInteger: 'int',
  SQLiteTimestamp: 'int',
  SQLiteBoolean: 'int',
  SQLiteReal: 'real',
  SQLiteBlobBuffer: 'blob',
  SQLiteBigInt: 'int',
  // The schema's one custom type is prismaDate() — epoch-ms integers matching
  // Prisma's SQLite DateTime dialect.
  SQLiteCustomColumn: 'int',
}

function drizzleTables(): Tables {
  const out: Tables = new Map()
  for (const value of Object.values(shared)) {
    let tableName: string
    try {
      tableName = getTableName(value as any)
    } catch {
      continue // not a table export
    }
    if (!tableName || IGNORE_TABLES.has(tableName)) continue
    const cols = new Map<string, Col>()
    for (const col of Object.values(getTableColumns(value as any))) {
      const c = col as any
      cols.set(c.name, {
        notNull: !!c.notNull,
        storage: DRIZZLE_STORAGE[c.columnType] ?? c.columnType,
      })
    }
    out.set(tableName, cols)
  }
  return out
}

// ── Compare ──────────────────────────────────────────────────────────────────

function main() {
  const prisma = prismaTables()
  const drizzle = drizzleTables()
  const problems: string[] = []

  for (const [table, pCols] of prisma) {
    const dCols = drizzle.get(table)
    if (!dCols) {
      problems.push(`table "${table}" exists in Prisma but not in the shared Drizzle schema`)
      continue
    }
    for (const [name, p] of pCols) {
      const d = dCols.get(name)
      if (!d) {
        problems.push(`${table}.${name} exists in Prisma but not in Drizzle`)
        continue
      }
      if (p.notNull !== d.notNull) {
        problems.push(`${table}.${name} nullability differs — Prisma notNull=${p.notNull}, Drizzle notNull=${d.notNull}`)
      }
      if (p.storage !== d.storage) {
        problems.push(`${table}.${name} storage differs — Prisma=${p.storage}, Drizzle=${d.storage}`)
      }
    }
    for (const name of dCols.keys()) {
      if (!pCols.has(name)) problems.push(`${table}.${name} exists in Drizzle but not in Prisma`)
    }
  }
  for (const table of drizzle.keys()) {
    if (!prisma.has(table)) problems.push(`table "${table}" exists in Drizzle but not in Prisma`)
  }

  console.log(`Compared ${prisma.size} Prisma tables against ${drizzle.size} Drizzle tables.`)
  if (problems.length === 0) {
    console.log('✓ Schemas are in parity.')
    return
  }
  console.error(`\n✗ ${problems.length} parity problem(s):`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

main()
