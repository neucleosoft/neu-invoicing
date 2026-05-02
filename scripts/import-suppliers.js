/**
 * Import suppliers from an Excel sheet into the Party table (type=SUPPLIER).
 *
 * Default source: C:\Users\yoges\Downloads\SUPPLY SHEET (2).xlsx
 * Override with:  node scripts/import-suppliers.js "<path-to-xlsx>"
 *
 * Excel columns expected: S.NO | DISPLAY NAME | ADDRESS | TELEPHONE NO. | STATE | GSTIN
 */

const path = require('path');
const os = require('os');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const DB_PATH = path.join(APPDATA, 'neu-invoicing', 'neuinvoicing.db');

const STATE_CODES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

const STATE_NAME_TO_CODE = {};
for (const [code, name] of Object.entries(STATE_CODES)) {
  STATE_NAME_TO_CODE[name.toUpperCase()] = code;
}
// Aliases that appear in the sheet but aren't proper state names
STATE_NAME_TO_CODE['NEW DELHI'] = '07';
STATE_NAME_TO_CODE['BENGALURU'] = '29';

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.text) return String(v.text);
  if (typeof v === 'object' && v.result !== undefined) return String(v.result);
  return String(v);
}

function clean(v) {
  const s = cell(v).trim();
  if (!s || s.toUpperCase() === 'NA') return null;
  return s;
}

function deriveStateFromGstin(gstin) {
  if (!gstin) return { code: null, name: null };
  // Some entries have a letter O instead of digit 0 — coerce
  const head = gstin.slice(0, 2).replace(/O/gi, '0');
  if (STATE_CODES[head]) return { code: head, name: STATE_CODES[head] };
  return { code: null, name: null };
}

async function main() {
  const xlsxPath = process.argv[2] ||
    'C:\\Users\\yoges\\Downloads\\SUPPLY SHEET (2).xlsx';

  console.log('Source XLSX:', xlsxPath);
  console.log('Target DB :', DB_PATH);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const sheet = wb.worksheets[0];

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return; // header
    const name = clean(row.getCell(2).value);
    if (!name) return; // skip blank S.No-only rows
    const address = clean(row.getCell(3).value);
    const phone = clean(row.getCell(4).value);
    const stateRaw = clean(row.getCell(5).value);
    const gstin = clean(row.getCell(6).value);

    let stateCode = null;
    let stateName = null;
    if (gstin) {
      const fromGst = deriveStateFromGstin(gstin);
      stateCode = fromGst.code;
      stateName = fromGst.name;
    }
    if (!stateCode && stateRaw) {
      stateCode = STATE_NAME_TO_CODE[stateRaw.toUpperCase()] || null;
      stateName = STATE_CODES[stateCode] || stateRaw;
    }
    if (!stateName && stateRaw) stateName = stateRaw;

    rows.push({ name, address, phone, stateRaw, stateCode, stateName, gstin });
  });

  console.log(`Parsed ${rows.length} supplier rows.\n`);

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${DB_PATH}` } },
  });

  let created = 0;
  let skippedDup = 0;
  const warnings = [];

  for (const r of rows) {
    // Dedupe by name (case-insensitive) within SUPPLIER scope
    const existing = await prisma.party.findFirst({
      where: { type: 'SUPPLIER', name: { equals: r.name } },
    });
    if (existing) {
      skippedDup++;
      console.log(`SKIP (already exists): ${r.name}`);
      continue;
    }

    if (r.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/i.test(r.gstin.replace(/\s/g, ''))) {
      warnings.push(`${r.name}: GSTIN "${r.gstin}" is malformed — saved as-is`);
    }

    await prisma.party.create({
      data: {
        name: r.name,
        type: 'SUPPLIER',
        phone: r.phone,
        billingAddress: r.address,
        shippingAddress: r.address,
        taxId: r.gstin,
        stateCode: r.stateCode,
        stateName: r.stateName,
        gstType: r.gstin ? 'REGULAR' : 'UNREGISTERED',
        openingBalance: 0,
        currentBalance: 0,
      },
    });
    created++;
    console.log(`ADDED: ${r.name}  [${r.stateCode || '--'} ${r.stateName || ''}]`);
  }

  await prisma.$disconnect();

  console.log('\n──── Summary ─────────────────────────');
  console.log(`Created : ${created}`);
  console.log(`Skipped : ${skippedDup} (duplicates)`);
  if (warnings.length) {
    console.log(`Warnings:\n  - ${warnings.join('\n  - ')}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
