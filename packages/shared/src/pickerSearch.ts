// Picker search — the ONE matching/ranking brain behind every "pick a
// customer / item / supplier" field in both apps. The desktop SearchableSelect
// and mobile SearchablePickerModal are thin platform shells around this, so
// typing "raj cem" finds "Rajshree Cement 50kg" identically everywhere.
//
// Rules (tuned for counter-speed billing, not fuzzy cleverness):
//  - Case-insensitive; -, /, . treated as spaces (mirrors the purchase-side
//    normalizeItemName, so "A-4" matches "a4 paper" the same way dedupe does).
//  - The query splits into words; EVERY word must match somewhere in the
//    option's fields (name, phone, HSN, …) — "raj 50" narrows, never widens.
//  - Ranking: whole-name prefix match first, then any-word prefix match,
//    then substring matches — stable within each band so the caller's
//    ordering (alphabetical, recency) is preserved as the tiebreak.

export interface PickerSearchable {
  /** Primary display text — gets the prefix-match ranking boost. */
  name: string
  /** Extra searchable text: phone, HSN, code… (nulls are fine). */
  extra?: (string | null | undefined)[]
}

export const normalizeSearchText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[-/.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Filter + rank options for a picker. Returns a NEW array; with an empty
 * query it returns the input order untouched (so recency/alphabetical
 * pre-sorting shows through).
 */
export function filterPickerOptions<T extends PickerSearchable>(options: T[], query: string): T[] {
  const q = normalizeSearchText(query)
  if (!q) return options.slice()
  const words = q.split(' ')

  type Scored = { option: T; score: number; index: number }
  const scored: Scored[] = []

  const squash = (s: string) => s.replace(/ /g, '')
  const qSquashed = squash(q)

  options.forEach((option, index) => {
    const name = normalizeSearchText(option.name)
    const fields = [name, ...(option.extra ?? []).map((f) => normalizeSearchText(f ?? ''))].filter(
      (f) => f.length > 0,
    )
    // The squashed variants make "a4" find "A-4" (normalized to "a 4"):
    // separator folding alone would otherwise DEMAND the space in the query.
    const squashed = fields.map(squash)

    // Every query word must appear in at least one field (spaced or squashed).
    const allMatch = words.every((w) => fields.some((f) => f.includes(w)) || squashed.some((f) => f.includes(w)))
    if (!allMatch) return

    let score = 2 // substring band
    if (name.startsWith(q) || squash(name).startsWith(qSquashed)) {
      score = 0 // whole-query prefix of the name
    } else if (words.every((w) => fields.some((f) => f.split(' ').some((part) => part.startsWith(w))))) {
      score = 1 // every word starts some word of some field
    }
    scored.push({ option, score, index })
  })

  scored.sort((a, b) => a.score - b.score || a.index - b.index)
  return scored.map((s) => s.option)
}
