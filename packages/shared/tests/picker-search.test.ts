// Picker-search checks (packages/shared/src/pickerSearch.ts): matching,
// multi-word narrowing, separator normalization, ranking bands, stable order.

import { filterPickerOptions, normalizeSearchText } from '../src/pickerSearch'

let failures = 0
let passes = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passes++; console.log(`  ok  ${name}`) }
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

const opts = [
  { name: 'Rajshree Cement 50kg', extra: ['2523'] },
  { name: 'Raj Traders', extra: ['9876543210'] },
  { name: 'Ambuja Cement', extra: ['2523'] },
  { name: 'A-4 Paper Ream', extra: ['4802'] },
  { name: 'Steel Rod 12mm', extra: [null, 'TMT-12'] },
]

check('normalize folds separators', normalizeSearchText('A-4/Paper.Ream') === 'a 4 paper ream')

const cement = filterPickerOptions(opts, 'cem')
check('substring match finds both cements', cement.length === 2 && cement.every((o) => o.name.includes('Cement')))

const rajCem = filterPickerOptions(opts, 'raj cem')
check('multi-word narrows (every word must match)', rajCem.length === 1 && rajCem[0].name === 'Rajshree Cement 50kg')

const phone = filterPickerOptions(opts, '98765')
check('extra fields (phone) are searchable', phone.length === 1 && phone[0].name === 'Raj Traders')

const a4 = filterPickerOptions(opts, 'a4')
check('separator-blind: "a4" finds "A-4"', a4.length === 1 && a4[0].name === 'A-4 Paper Ream')

const ranked = filterPickerOptions(opts, 'raj')
check('name-prefix match ranks above substring', ranked[0].name === 'Rajshree Cement 50kg' && ranked[1].name === 'Raj Traders')

const empty = filterPickerOptions(opts, '   ')
check('blank query keeps caller order untouched', empty.length === opts.length && empty[0].name === opts[0].name)

const none = filterPickerOptions(opts, 'zzz')
check('no match → empty list', none.length === 0)

const hsn = filterPickerOptions(opts, 'tmt 12')
check('null extras are skipped, code still matches', hsn.length === 1 && hsn[0].name === 'Steel Rod 12mm')

console.log(`\n=== ${passes} passed, ${failures} failed ===`)
process.exit(failures > 0 ? 1 : 0)
