#!/usr/bin/env node
// One-off: delete the PreviousInvoice rows that came from new_style_from_old/.
// Matches by the current files on disk in that folder, so the original 106
// new_style/ rows are not touched.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { PrismaClient } = require('@prisma/client')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const FROM_OLD = path.resolve(REPO_ROOT, 'invoices database', 'new_style_from_old')
const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'neu-invoicing', 'neuinvoicing.db')
process.env.DATABASE_URL = `file:${DB_PATH.replace(/\\/g, '/')}`

const DRY_RUN = process.argv.includes('--dry-run')

const files = fs.readdirSync(FROM_OLD).filter(f => f.toLowerCase().endsWith('.pdf')).sort()
const prisma = new PrismaClient()

const rows = await prisma.previousInvoice.findMany({
  where: { fileName: { in: files } },
  select: { id: true, fileName: true, invoiceNumber: true },
})

console.log(`Files on disk:          ${files.length}`)
console.log(`Matching DB rows:       ${rows.length}`)
console.log(`Mode:                   ${DRY_RUN ? 'DRY RUN' : 'DELETE'}`)

if (!DRY_RUN && rows.length) {
  const r = await prisma.previousInvoice.deleteMany({ where: { id: { in: rows.map(x => x.id) } } })
  console.log(`Deleted:                ${r.count}`)
}

await prisma.$disconnect()
