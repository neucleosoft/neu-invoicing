// Fix for the pnpm dual-Prisma-client quirk (see MIGRATIONS.md): `prisma
// generate` writes the fresh client to this app's custom output
// (apps/desktop/node_modules/.prisma/client), but tsc and the dev runtime
// resolve @prisma/client through the pnpm store, whose .prisma/client is a
// SEPARATE copy that goes stale after every schema change ("Unknown argument"
// errors on new columns). This script locates the store copy via module
// resolution and overwrites it with the fresh one. Chained into the
// prisma:generate script so the quirk can't bite again.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const freshClient = path.join(here, '..', 'node_modules', '.prisma', 'client')

const require = createRequire(import.meta.url)
// Resolves through the @prisma/client symlink into the real pnpm store dir.
// storeIndex = <store>/node_modules/@prisma/client/default.js; the runtime
// client it re-exports lives at <store>/node_modules/.prisma/client — TWO
// levels up from the file's dir, then down into .prisma/client. (An earlier
// version went one level short and copied into @prisma/.prisma/client, a
// path nothing resolves — caught by the parity guard flagging a stale DMMF.)
const storeIndex = require.resolve('@prisma/client')
const storeClient = path.join(path.dirname(storeIndex), '..', '..', '.prisma', 'client')

if (!existsSync(freshClient)) {
  console.error('Fresh client not found — run `prisma generate` first:', freshClient)
  process.exit(1)
}
if (path.resolve(freshClient) === path.resolve(storeClient)) {
  console.log('Store client IS the fresh client — nothing to sync.')
  process.exit(0)
}
// The query-engine .dll.node is held open by any RUNNING app/dev instance and
// Windows then refuses the overwrite — but the engine binary never changes for
// a given Prisma version, only the generated JS/dts/schema do. So copy
// file-by-file and tolerate a locked engine; fail loudly on anything else.
const copyTree = (from, to) => {
  mkdirSync(to, { recursive: true })
  const skipped = []
  for (const entry of readdirSync(from)) {
    const src = path.join(from, entry)
    const dest = path.join(to, entry)
    if (statSync(src).isDirectory()) {
      skipped.push(...copyTree(src, dest))
      continue
    }
    try {
      copyFileSync(src, dest)
    } catch (err) {
      if (/query_engine|\.node$/.test(entry)) {
        skipped.push(entry)
      } else {
        throw err
      }
    }
  }
  return skipped
}

const skipped = copyTree(freshClient, storeClient)
console.log(
  'Synced fresh Prisma client into the pnpm store copy.' +
    (skipped.length ? ` (engine binary in use, left as-is: ${skipped.join(', ')})` : ''),
)
