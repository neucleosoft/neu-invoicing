// Test runner for the shared-brain proof harnesses (tests/*.test.ts).
//
// Each harness is a self-contained executable: it prints ok/FAIL per check and
// exits non-zero on any failure. They were battle-proven as scratchpad scripts
// during the sync build and moved here VERBATIM — no framework port, because
// rewriting assertions is how you silently break the net you're installing.
// This runner just bundles each with esbuild (they're TS) and runs them.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const testsDir = path.join(here, '..', 'tests')
const outDir = mkdtempSync(path.join(tmpdir(), 'neu-shared-tests-'))

const files = readdirSync(testsDir).filter((f) => f.endsWith('.test.ts'))
if (files.length === 0) {
  console.error('No test files found in', testsDir)
  process.exit(1)
}

let failed = 0
for (const f of files) {
  const entry = path.join(testsDir, f)
  const out = path.join(outDir, f.replace(/\.ts$/, '.cjs'))
  console.log(`\n▶ ${f}`)
  try {
    execFileSync(
      'pnpm',
      ['exec', 'esbuild', entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--log-level=warning'],
      { stdio: 'inherit', cwd: path.join(here, '..'), shell: process.platform === 'win32' },
    )
    execFileSync('node', [out], { stdio: 'inherit' })
  } catch {
    failed++
  }
}

rmSync(outDir, { recursive: true, force: true })
console.log(failed === 0 ? '\nAll test files passed.' : `\n${failed} test file(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
