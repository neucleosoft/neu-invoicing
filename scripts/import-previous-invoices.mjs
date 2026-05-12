#!/usr/bin/env node
// Bulk import of new_style/ PDFs into the PreviousInvoice table.
// Reads from "invoices database/new_style/", extracts metadata via pdf-parse,
// inserts rows into the live SQLite DB at userData/neuinvoicing.db.
//
// Idempotent: skips files already imported (matched by fileName).
// Usage:
//   node scripts/import-previous-invoices.mjs            # commit
//   node scripts/import-previous-invoices.mjs --dry-run  # parse + report only

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')
const { PrismaClient } = require('@prisma/client')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const DIR_ARG = (process.argv.find(a => a.startsWith('--dir=')) || '').slice('--dir='.length)
const PDF_DIR = DIR_ARG
  ? (path.isAbsolute(DIR_ARG) ? DIR_ARG : path.resolve(REPO_ROOT, 'invoices database', DIR_ARG))
  : path.resolve(REPO_ROOT, 'invoices database', 'new_style')
const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'neu-invoicing', 'neuinvoicing.db')

const DRY_RUN = process.argv.includes('--dry-run')

process.env.DATABASE_URL = `file:${DB_PATH.replace(/\\/g, '/')}`

async function extractText(filePath) {
  const buf = fs.readFileSync(filePath)
  const parser = new PDFParse(new Uint8Array(buf))
  await parser.load()
  const r = await parser.getText()
  return r.pages.map(p => p.text).join('\n')
}

function parseDateDMY(s) {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`)
}

function parseInvoice(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  let invoiceNumber = ''
  let invoiceDate = null
  let partyName = ''
  let totalAmount = 0

  // Invoice No. is followed by NS/SL/25-26/N on the next line; Invoice Date by DD/MM/YYYY
  for (let i = 0; i < lines.length; i++) {
    if (/^Invoice No\.?$/i.test(lines[i]) && lines[i + 1]) {
      invoiceNumber = lines[i + 1].trim()
    }
    if (/^Invoice Date$/i.test(lines[i]) && lines[i + 1]) {
      const dm = lines[i + 1].match(/(\d{2}\/\d{2}\/\d{4})/)
      if (dm) invoiceDate = parseDateDMY(dm[1])
    }
    // Fallback: combined "Invoice No. NS/SL/25-26/N" on one line
    if (!invoiceNumber) {
      const m = lines[i].match(/Invoice No\.?\s+(NS\/SL\/[\d-]+\/\d+)/i)
      if (m) invoiceNumber = m[1]
    }
    if (!invoiceDate) {
      const m = lines[i].match(/Invoice Date\s+(\d{2}\/\d{2}\/\d{4})/i)
      if (m) invoiceDate = parseDateDMY(m[1])
    }
  }

  // Party name = line right after "BILL TO"
  const billIdx = lines.findIndex(l => /^BILL TO$/i.test(l))
  if (billIdx >= 0 && lines[billIdx + 1]) partyName = lines[billIdx + 1].trim()

  // Total: line starting with "TOTAL" followed by qty and ₹ amount.
  // Common form across pages: "TOTAL 10 ₹ 17,850" or split across lines.
  // Walk lines and grab the last ₹ amount on the TOTAL row.
  for (let i = 0; i < lines.length; i++) {
    if (!/^TOTAL\b/i.test(lines[i])) continue
    const candidate = (lines[i] + ' ' + (lines[i + 1] || '') + ' ' + (lines[i + 2] || ''))
    const m = candidate.match(/₹\s*([\d,]+(?:\.\d+)?)/g)
    if (m && m.length) {
      const last = m[m.length - 1].replace(/[₹\s,]/g, '')
      const n = parseFloat(last)
      if (!Number.isNaN(n)) { totalAmount = n; break }
    }
  }

  return { invoiceNumber, invoiceDate, partyName, totalAmount }
}

async function main() {
  if (!fs.existsSync(PDF_DIR)) {
    console.error(`PDF dir not found: ${PDF_DIR}`)
    process.exit(1)
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`DB not found: ${DB_PATH}`)
    process.exit(1)
  }

  const files = fs.readdirSync(PDF_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort()
  console.log(`Found ${files.length} PDFs in ${PDF_DIR}`)
  console.log(`DB:      ${DB_PATH}`)
  console.log(`Mode:    ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMIT'}`)
  console.log('')

  const prisma = new PrismaClient()
  const existing = new Set(
    (await prisma.previousInvoice.findMany({ select: { fileName: true } })).map(r => r.fileName)
  )
  console.log(`Already in DB: ${existing.size}`)
  console.log('')

  const skipped = []
  const failed = []
  let inserted = 0

  for (const file of files) {
    if (existing.has(file)) {
      skipped.push({ file, reason: 'already in DB' })
      continue
    }
    const full = path.join(PDF_DIR, file)
    try {
      const text = await extractText(full)
      const parsed = parseInvoice(text)
      if (!parsed.invoiceNumber || !parsed.invoiceDate || !parsed.partyName) {
        failed.push({
          file,
          reason: `missing: ${[
            !parsed.invoiceNumber && 'invoiceNumber',
            !parsed.invoiceDate && 'invoiceDate',
            !parsed.partyName && 'partyName',
          ].filter(Boolean).join(', ')}`,
        })
        continue
      }
      if (DRY_RUN) {
        console.log(`  [DRY] ${parsed.invoiceNumber.padEnd(16)} ${parsed.invoiceDate.toISOString().slice(0, 10)}  ${parsed.partyName.padEnd(40)} ₹${parsed.totalAmount}  ← ${file}`)
        inserted++
        continue
      }
      const bytes = fs.readFileSync(full)
      await prisma.previousInvoice.create({
        data: {
          invoiceNumber: parsed.invoiceNumber,
          invoiceDate: parsed.invoiceDate,
          partyName: parsed.partyName,
          totalAmount: parsed.totalAmount,
          notes: null,
          fileData: bytes,
          fileMimeType: 'application/pdf',
          fileName: file,
        },
      })
      console.log(`  [OK]  ${parsed.invoiceNumber.padEnd(16)} ${parsed.invoiceDate.toISOString().slice(0, 10)}  ${parsed.partyName.padEnd(40)} ₹${parsed.totalAmount}`)
      inserted++
    } catch (err) {
      failed.push({ file, reason: err?.message ?? String(err) })
    }
  }

  console.log('')
  console.log('─'.repeat(60))
  console.log(`Inserted: ${inserted}${DRY_RUN ? ' (dry run — not committed)' : ''}`)
  console.log(`Skipped:  ${skipped.length}`)
  console.log(`Failed:   ${failed.length}`)
  if (failed.length) {
    console.log('')
    console.log('Failures:')
    for (const f of failed) console.log(`  - ${f.file} — ${f.reason}`)
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  process.exit(1)
})
