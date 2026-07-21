// Hand-off note across the post-restore soft reboot. Module state survives a
// React-tree remount (only components unmount, the JS module stays), so the
// restore handler sets a note, reloadDb() remounts everything, and AutoSync —
// freshly mounted with the NEW database handle — consumes it: shows the
// "Restore complete" confirmation and kicks an immediate sync instead of
// waiting out the usual first-run delay.

let pending: string | null = null

/** Called by a restore flow right before reloadDb(). Label = backup date. */
export function setRestoreNotice(label: string) {
  pending = label
}

/** Returns the pending label once, then clears it. */
export function consumeRestoreNotice(): string | null {
  const p = pending
  pending = null
  return p
}
