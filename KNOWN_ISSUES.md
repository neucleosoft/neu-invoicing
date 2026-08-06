# Known Issues

Deliberately-deferred issues, documented so they can be picked up cold.

---

## UTC "today" in mobile document forms (deferred 2026-07-28)

**What:** Every mobile document form pre-fills its date field using
`new Date().toISOString().slice(0, 10)` (or the same pattern on an existing
date when editing). `toISOString()` answers in **UTC**, not device-local time.

**Why it's a bug:** India is UTC+5:30. Between **00:00 and 05:30 IST** the UTC
calendar is still on the previous day, so a document created in that window
pre-fills **yesterday's date**. If the user doesn't hand-correct it:

- the sale/payment lands in the wrong day (daily totals off),
- on the 1st of a month, in the wrong month,
- on the night of April 1st, in the **wrong financial year** (GST filing
  mismatch — the worst case).

**Softening factors:** the date field is editable; the bug only fires in the
5.5-hour night window; it only matters when unnoticed. Severity: real but
conditional.

**Already fixed elsewhere (same root cause):**
- `apps/mobile/app/reports/statement.tsx` — defaults were showing "March 31"
  as FY start (fixed, commit d3d242e).
- Report screens use `toIsoLocal` from `apps/mobile/utils/dateRanges.ts` — the
  timezone-correct helper that is the cure everywhere.

**Affected files (16, mobile):**

- `app/challan/edit/[id].tsx`, `app/challan/newChallan.tsx`
- `app/creditNote/edit/[id].tsx`, `app/creditNote/newCreditNote.tsx`
- `app/invoice/edit/[id].tsx`, `app/invoice/newInvoice.tsx`
- `app/payment/index.tsx`
- `app/previousInvoice/newPreviousInvoice.tsx`
- `app/proforma/edit/[id].tsx`, `app/proforma/newProforma.tsx`
- `app/purchase/edit/[id].tsx`, `app/purchase/newPurchase.tsx`
- `app/purchaseOrder/edit/[id].tsx`, `app/purchaseOrder/newPurchaseOrder.tsx`
- `app/quotation/edit/[id].tsx`, `app/quotation/newQuotation.tsx`

**Desktop:** only the harmless cousin exists — 8 pages stamp the UTC date into
Excel **export filenames** (`Invoices_all_<date>.xlsx`). No document data is
affected. Optional cleanup only.

**The fix, when picked up:** in each file, replace
`X.toISOString().slice(0, 10)` with `toIsoLocal(X)` and add
`import { toIsoLocal } from '@/utils/dateRanges'`. Two-to-three lines per
file, no behavior change outside the night window.

**Status:** deferred by explicit decision (2026-07-28). A prepared sweep was
reverted the same day pending a fresh go-ahead; nothing of it remains in the
tree.

---

## Collision renumbering burns invoice numbers across multi-round merges (2026-07-28)

**What:** When two devices mint the same invoice numbers while disconnected,
sync renumbers the later-created document to the next free number (by design,
D4). But when the pileup resolves over SEVERAL sync rounds (both devices
renumbering alternately as more colliding rows keep arriving), a document can
be renumbered more than once — and every intermediate number it briefly held
is abandoned, never reused (`nextInSeries` = max + 1).

**Observed:** 2026-07-28 in the test environment — a week-long fork produced a
12-renumber cascade (receipts in the sync activity log); two invoices ended at
/52 and /53 and numbers **46–51 were burned**, leaving a permanent gap in the
series.

**Impact:** cosmetic/compliance — GST prefers consecutive series; gaps look
like deleted invoices. No data loss, no duplicates (verified: every document
intact and unique).

**Fix direction (not built):** a renumbered document should CLAIM its target
number durably (first renumber is final for that doc), and/or the renumber
pass should resolve the full collision set in one round against the merged
number space instead of ping-ponging per sync tick. The sandbox only tested
single-round collisions — add a multi-round two-device case.

**Mitigation until fixed:** keep devices synced (collisions then resolve
within a minute, one round, no cascade). Week-long forks are the trigger.
