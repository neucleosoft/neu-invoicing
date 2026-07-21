/**
 * Run the in-app recompute pass against the real desktop database.
 *
 *   pnpm run recompute            # DRY RUN — rebuilds every number, prints what would change
 *   pnpm run recompute -- --apply # writes the rebuilt numbers back (only after a clean dry run)
 *
 * Calls the SAME shared recomputeAllDb the app uses (through drizzle/libsql
 * since the Prisma→Drizzle migration), so a green run here proves the real
 * engine — not a parallel copy of it — against your data.
 *
 * It's a .ts file because it imports the TS engine; the `recompute` npm script bundles it with
 * esbuild (already a dependency) before running, since the repo has no standalone TS runner.
 */

import path from 'path'
import os from 'os'
import fs from 'fs'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { formatRecomputeReport, recomputeAllDb } from '../../../packages/shared/src/index'

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const DB_PATH = path.join(APPDATA, 'neu-invoicing', 'neuinvoicing.db')
const apply = process.argv.includes('--apply')

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found: ${DB_PATH}`)
    process.exit(1)
  }
  const client = createClient({ url: `file:${DB_PATH}` })
  console.log(`\nDB: ${DB_PATH}`)
  if (apply) {
    console.log(`\n⚠️  APPLY MODE — this WILL overwrite stored numbers with the rebuilt ones.`)
    console.log(`   Only do this after a dry run you've eyeballed. Dirty documents become wrong balances.\n`)
  }
  const report = await recomputeAllDb(drizzle(client), { apply })
  console.log(formatRecomputeReport(report))
  console.log('')
  client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
