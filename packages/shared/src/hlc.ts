// Hybrid Logical Clock (HLC) — the clock-skew-proof ordering for sync (P1,
// docs/sync-design.md §11). Newest-edit-wins on updatedAt trusts every
// device's wall clock; a phone with a backdated date silently loses every
// conflict, and one set ahead becomes unbeatable. The HLC fix is one idea:
// never stamp below anything you've already SEEN. Each stamp is
// max(wall clock, biggest stamp seen anywhere) advanced by one tick, so once
// a device syncs, its next edits always order after the other device's —
// no matter what its wall clock says.
//
// A stamp is a SINGLE SORTABLE STRING, so plain string comparison — in JS
// or in SQL (`hlc > ?` under SQLite's default BINARY collation) — IS the
// causal order:
//
//     <physical ms, base36, 9 chars>-<counter, base36, 4 chars>-<deviceId>
//
// Fixed-width base36 (0-9a-z) makes lexicographic = numeric for the first
// two fields; the deviceId suffix breaks exact ties deterministically, so
// two devices can never disagree about a winner. updatedAt stays an honest
// wall-clock value for the UI — hlc rides beside it and only sync reads it.
//
// The 9-char physical field covers epoch-ms values until the year ~5000;
// the 4-char counter allows 1.6M writes inside one millisecond before
// borrowing the next.

export const HLC_PT_CHARS = 9
export const HLC_CTR_CHARS = 4
const CTR_LIMIT = Math.pow(36, HLC_CTR_CHARS)
const HLC_RE = /^[0-9a-z]{9}-[0-9a-z]{4}-/

export function encodeHlc(physicalMs: number, counter: number, device: string): string {
  const pt = Math.max(0, Math.floor(physicalMs)).toString(36).padStart(HLC_PT_CHARS, '0')
  const ctr = Math.max(0, Math.floor(counter)).toString(36).padStart(HLC_CTR_CHARS, '0')
  return `${pt}-${ctr}-${device}`
}

export interface DecodedHlc {
  physicalMs: number
  counter: number
  device: string
}

/** null for anything that isn't a well-formed stamp (defensive: a diary is
 *  peer input — never let a malformed string poison the ratchet). */
export function decodeHlc(hlc: unknown): DecodedHlc | null {
  if (typeof hlc !== 'string' || !HLC_RE.test(hlc)) return null
  return {
    physicalMs: parseInt(hlc.slice(0, HLC_PT_CHARS), 36),
    counter: parseInt(hlc.slice(HLC_PT_CHARS + 1, HLC_PT_CHARS + 1 + HLC_CTR_CHARS), 36),
    device: hlc.slice(HLC_PT_CHARS + HLC_CTR_CHARS + 2),
  }
}

/** Total order over stamps: <0, 0, >0 like a comparator. Plain code-unit
 *  string comparison IS the causal order (fixed-width base36 prefix). */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Smallest possible stamp at a given wall-clock instant — the cutoff value
 *  for "changed inside the window" SQL/ORM filters (`hlc > lowerBound`). */
export function hlcLowerBound(physicalMs: number): string {
  return encodeHlc(physicalMs, 0, '')
}

/** The stamp's physical component, for clock-skew tripwires ("that device's
 *  clock looks N hours off"). null when malformed. */
export function hlcPhysicalMs(hlc: unknown): number | null {
  return decodeHlc(hlc)?.physicalMs ?? null
}

export interface HlcClock {
  /** Issue a fresh stamp, strictly greater than every stamp this clock has
   *  issued or observed — even if the wall clock went backwards. */
  next(): string
  /** Feed a peer's stamp into the ratchet (call for every incoming packet).
   *  Malformed/empty input is ignored. */
  observe(remote: unknown): void
  /** The high-water mark (biggest stamp issued-or-observed), or null. */
  last(): string | null
}

export interface HlcClockOptions {
  /** Injectable wall clock for tests / skew simulation. Default Date.now. */
  now?: () => number
  /** Seed the ratchet — pass MAX(hlc) from the local DB at startup, so a
   *  restart can never re-issue below an already-stored stamp. */
  init?: unknown
}

/**
 * Create the device's ratchet. Both apps hold ONE instance (seeded from the
 * DB's MAX(hlc) at startup) and route every stamp through it. State is
 * in-memory only on purpose: every stamp this device issues or applies is
 * stored in a row, so MAX(hlc) at next startup is always ≥ everything seen.
 */
export function createHlcClock(device: string, opts: HlcClockOptions = {}): HlcClock {
  const now = opts.now ?? Date.now
  let lastPt = -1
  let lastCtr = -1

  const bump = (pt: number, ctr: number) => {
    if (pt > lastPt || (pt === lastPt && ctr > lastCtr)) {
      lastPt = pt
      lastCtr = ctr
    }
  }

  const clock: HlcClock = {
    next() {
      const wall = Math.max(0, Math.floor(now()))
      let pt: number
      let ctr: number
      if (wall > lastPt) {
        pt = wall
        ctr = 0
      } else {
        pt = lastPt
        ctr = lastCtr + 1
        if (ctr >= CTR_LIMIT) {
          pt += 1
          ctr = 0
        }
      }
      lastPt = pt
      lastCtr = ctr
      return encodeHlc(pt, ctr, device)
    },
    observe(remote: unknown) {
      const d = decodeHlc(remote)
      if (d) bump(d.physicalMs, d.counter)
    },
    last() {
      return lastPt < 0 ? null : encodeHlc(lastPt, lastCtr, device)
    },
  }

  clock.observe(opts.init)
  return clock
}

// ── Global stamper hook ──────────────────────────────────────────────────────
// The shared Drizzle schema stamps hlc via $defaultFn/$onUpdate, but the
// schema module can't know the device id or hold the clock — the APP does.
// Mobile calls setGlobalHlcStamper(clock.next) right after seeding its clock
// at DB init; until then stampHlc() returns null (the legacy "no stamp yet"
// state the comparator already falls back from). Desktop writes via Prisma,
// so it never sets this — its stamping lives in the client extension.

let globalStamper: (() => string) | null = null

export function setGlobalHlcStamper(fn: (() => string) | null): void {
  globalStamper = fn
}

export function stampHlc(): string | null {
  return globalStamper ? globalStamper() : null
}
