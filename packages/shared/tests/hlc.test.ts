// HLC checks (packages/shared/src/hlc.ts): encoding order, the ratchet
// (never stamp below anything seen — the whole clock-skew fix), counter
// overflow, seeding, and the SQL lower-bound cutoff.

import {
  compareHlc,
  createHlcClock,
  decodeHlc,
  encodeHlc,
  hlcLowerBound,
  hlcPhysicalMs,
  setGlobalHlcStamper,
  stampHlc,
} from '../src/hlc'

let failures = 0
let passes = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passes++; console.log(`  ok  ${name}`) }
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── encode / decode / compare ────────────────────────────────────────────────
{
  const a = encodeHlc(1_700_000_000_000, 0, 'dev-a')
  const d = decodeHlc(a)
  check('decode inverts encode', d?.physicalMs === 1_700_000_000_000 && d?.counter === 0 && d?.device === 'dev-a')
  check('malformed stamps decode to null', decodeHlc('not-a-stamp') === null && decodeHlc(null) === null && decodeHlc(12345) === null)

  // Lexicographic string order must equal numeric (pt, counter) order — that's
  // what lets SQLite compare hlc columns with plain `>`.
  const t = 1_700_000_000_000
  const ordered = [
    encodeHlc(t, 0, 'zzz'),        // earlier pt beats any counter/device
    encodeHlc(t, 1, 'aaa'),
    encodeHlc(t, 35, 'dev'),       // counter 'z' still one ms below…
    encodeHlc(t, 36, 'dev'),       // …counter '10'
    encodeHlc(t + 1, 0, 'aaa'),
    encodeHlc(t + 9_000_000, 0, 'a'),
  ]
  const sorted = [...ordered].sort() // plain string sort
  check('string sort == causal order', JSON.stringify(sorted) === JSON.stringify(ordered))
  check('compareHlc agrees', compareHlc(ordered[0], ordered[1]) < 0 && compareHlc(ordered[3], ordered[2]) > 0 && compareHlc(ordered[4], ordered[4]) === 0)

  // Exact (pt, counter) tie breaks on device — deterministically, both ways.
  const tieA = encodeHlc(t, 5, 'device-aaa')
  const tieB = encodeHlc(t, 5, 'device-bbb')
  check('device suffix breaks exact ties', compareHlc(tieA, tieB) < 0 && compareHlc(tieB, tieA) > 0)

  check('hlcPhysicalMs reads pt back', hlcPhysicalMs(encodeHlc(t, 3, 'x')) === t && hlcPhysicalMs('garbage') === null)
  check('lowerBound sorts below any real stamp at same ms', hlcLowerBound(t) < encodeHlc(t, 0, 'a') && hlcLowerBound(t) > encodeHlc(t - 1, 35, 'zzz'))
}

// ── the ratchet: clock-skew survival ─────────────────────────────────────────
{
  // Device B's wall clock is a MONTH behind. After it observes device A's
  // stamp (pull), everything B issues must still order AFTER A's — this is
  // the exact backdated-clock bug HLC exists to kill.
  const AHEAD = 1_700_000_000_000
  const BEHIND = AHEAD - 30 * 24 * 60 * 60 * 1000
  const b = createHlcClock('dev-b', { now: () => BEHIND })
  const fromA = encodeHlc(AHEAD, 0, 'dev-a')
  b.observe(fromA)
  const stamped = b.next()
  check('backdated clock still stamps above what it saw', compareHlc(stamped, fromA) > 0, `${stamped} !> ${fromA}`)
  check('and keeps counting up, not repeating', compareHlc(b.next(), stamped) > 0)

  // Wall clock jumping FORWARD past the ratchet resumes real time.
  const b2 = createHlcClock('dev-b', { now: () => AHEAD + 5000 })
  b2.observe(fromA)
  const resumed = b2.next()
  check('healthy clock ahead of ratchet uses wall time', decodeHlc(resumed)?.physicalMs === AHEAD + 5000)

  // Monotonic within one frozen millisecond, and strictly increasing.
  const frozen = createHlcClock('dev-c', { now: () => 1000 })
  const s1 = frozen.next(); const s2 = frozen.next(); const s3 = frozen.next()
  check('frozen wall clock still strictly increases', s1 < s2 && s2 < s3)
  check('frozen clock counts in the counter field', decodeHlc(s3)?.counter === 2 && decodeHlc(s3)?.physicalMs === 1000)

  // Counter overflow borrows one physical ms instead of wrapping backwards.
  const near = createHlcClock('dev-d', { now: () => 1000 })
  near.observe(encodeHlc(1000, Math.pow(36, 4) - 1, 'peer'))
  const over = near.next()
  check('counter overflow borrows the next ms', decodeHlc(over)?.physicalMs === 1001 && decodeHlc(over)?.counter === 0)

  // Seeding from DB max at startup: a restart can never re-issue lower.
  const seeded = createHlcClock('dev-e', { now: () => 500, init: encodeHlc(9999, 7, 'dev-e') })
  check('init seeds the ratchet', compareHlc(seeded.next(), encodeHlc(9999, 7, 'dev-e')) > 0)
  check('malformed init is ignored', createHlcClock('dev-f', { now: () => 500, init: 'junk' }).next().startsWith(encodeHlc(500, 0, '').slice(0, 9)))

  // observe() never lets a LOWER stamp pull the ratchet back.
  const hw = createHlcClock('dev-g', { now: () => 2000 })
  const top = hw.next()
  hw.observe(encodeHlc(50, 0, 'old-peer'))
  check('observe of an older stamp cannot lower the ratchet', compareHlc(hw.next(), top) > 0)
}

// ── global stamper hook (drizzle schema path) ────────────────────────────────
{
  setGlobalHlcStamper(null)
  check('stampHlc is null before init (legacy fallback state)', stampHlc() === null)
  const c = createHlcClock('dev-h', { now: () => 3000 })
  setGlobalHlcStamper(c.next)
  const s = stampHlc()
  check('stampHlc routes through the app clock', typeof s === 'string' && decodeHlc(s)?.device === 'dev-h')
  setGlobalHlcStamper(null)
}

console.log(`\n=== ${passes} passed, ${failures} failed ===`)
process.exit(failures > 0 ? 1 : 0)
