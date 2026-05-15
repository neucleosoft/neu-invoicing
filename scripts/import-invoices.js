/**
 * Import PDF invoices from old NEUCLEO SOFT billing into Neu Invoicing database.
 *
 * Usage:
 *   node scripts/import-invoices.js              # Full import
 *   node scripts/import-invoices.js --test FILE  # Test-parse one PDF (dump text + parsed data)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PrismaClient } = require('@prisma/client');

// ── Configuration ─────────────────────────────────────────────────────────

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const DB_PATH = path.join(APPDATA, 'neu-invoicing', 'neuinvoicing.db');
const INVOICES_DIR = path.join(__dirname, '..', 'invoices database');
const COMPANY_STATE_CODE = '07'; // Delhi — NEUCLEO SOFT

// ── Indian State Codes ────────────────────────────────────────────────────

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
  '97': 'Other Territory',
};

const STATE_NAME_TO_CODE = {};
for (const [code, name] of Object.entries(STATE_CODES)) {
  STATE_NAME_TO_CODE[name.toUpperCase()] = code;
}

// ── Utility Helpers ───────────────────────────────────────────────────────

function parseNum(s) {
  if (!s) return 0;
  return parseFloat(String(s).replace(/[₹,\s]/g, '')) || 0;
}

function parseDateDMY(s) {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function stateCodeFromGstin(gstin) {
  return gstin && gstin.length >= 2 ? gstin.substring(0, 2) : '';
}

function stateNameFromCode(code) { return STATE_CODES[code] || ''; }

function stateCodeFromName(name) {
  if (!name) return '';
  return STATE_NAME_TO_CODE[name.toUpperCase().trim()] || '';
}

/** Remove serial-number references (NEU/YYYY/MM/...) from item descriptions */
function normalizeItemName(name) {
  return name
    .replace(/\d+(?:\.\d+)?\s*\([^)]*NEU[^)]*\)/gi, '')
    .replace(/\bNEU\/\d{4}\/\d{2}\/[\dA-Z/]+(?:\s*[-–]\s*NEU\/\d{4}\/\d{2}\/[\dA-Z/]+)*/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[-–,\s]+$/, '')
    .trim() || name.trim();
}

function makeItemKey(name, hsn) { return `${name.toUpperCase()}|${hsn || ''}`; }
function round2(n) { return Math.round(n * 100) / 100; }

// ── Extract text from PDF using pdf-parse v2 class API ────────────────────

async function extractPdfText(pdfParseCls, filePath) {
  const buf = fs.readFileSync(filePath);
  const parser = new pdfParseCls(new Uint8Array(buf));
  await parser.load();
  const result = await parser.getText();
  return result.pages.map(p => p.text).join('\n');
}

// ── PDF Text → Structured Invoice Data ────────────────────────────────────

function parseInvoiceText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const inv = {
    invoiceNumber: '', invoiceDate: null,
    partyName: '', address: '', gstin: '',
    placeOfSupply: '', placeOfSupplyCode: '',
    pan: '', mobile: '',
    items: [], hsnTaxRates: {}, totalAmount: 0,
  };

  // ─── Invoice Number & Date ───
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('Invoice No')) continue;

    let numVal = lines[i].replace(/.*Invoice No\.?\s*/, '').replace(/Invoice Date.*/, '').trim();
    if (!numVal && i + 1 < lines.length) {
      const next = lines[i + 1];
      const dm = next.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (dm) {
        numVal = next.substring(0, dm.index).trim();
        inv.invoiceDate = parseDateDMY(dm[1]);
      } else if (!next.includes('Invoice Date')) {
        numVal = next;
      }
    }
    inv.invoiceNumber = numVal;

    if (!inv.invoiceDate) {
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const dm = lines[j].match(/(\d{2}\/\d{2}\/\d{4})/);
        if (dm) { inv.invoiceDate = parseDateDMY(dm[1]); break; }
      }
    }
    break;
  }

  // ─── BILL TO section ───
  const billToIdx = lines.findIndex(l => /^BILL TO:?$/i.test(l));
  const shipToIdx = lines.findIndex((l, i) => i > billToIdx && /^SHIP TO:?$/i.test(l));
  const tableIdx  = lines.findIndex(l => /^S\.?NO\.?\s/i.test(l));
  const billToEnd = shipToIdx > billToIdx ? shipToIdx
                  : tableIdx  > billToIdx ? tableIdx
                  : billToIdx + 15;

  if (billToIdx >= 0 && billToIdx + 1 < lines.length) {
    inv.partyName = lines[billToIdx + 1];

    for (let i = billToIdx + 2; i < billToEnd; i++) {
      if (/^Address:/i.test(lines[i])) {
        const parts = [lines[i].replace(/^Address:\s*/i, '')];
        for (let j = i + 1; j < billToEnd; j++) {
          if (/^(GSTIN|PAN|Mobile|SHIP TO|S\.?NO)/i.test(lines[j])) break;
          parts.push(lines[j]);
        }
        inv.address = parts.join(', ').replace(/,\s*,/g, ',').trim();
        break;
      }
    }

    for (let i = billToIdx + 1; i < billToEnd; i++) {
      const l = lines[i];
      if (!inv.gstin) {
        const m = l.match(/GSTIN:\s*(\S+)/i);
        if (m) inv.gstin = m[1].toUpperCase();
      }
      if (!inv.placeOfSupply) {
        const m = l.match(/Place of Supply:\s*(.+?)$/i);
        if (m) inv.placeOfSupply = m[1].replace(/\s*(PAN|Mobile).*$/i, '').trim();
      }
      if (!inv.pan) {
        const m = l.match(/PAN\s*(?:Number)?:\s*(\S+)/i);
        if (m) inv.pan = m[1].toUpperCase();
      }
      if (!inv.mobile) {
        const m = l.match(/Mobile:\s*(\d+)/);
        if (m) inv.mobile = m[1];
      }
    }
  }

  inv.placeOfSupplyCode = inv.gstin ? stateCodeFromGstin(inv.gstin)
    : inv.placeOfSupply ? stateCodeFromName(inv.placeOfSupply) : '';

  // ─── Line Items (tab-separated columns) ───
  const hasHsnCol = tableIdx >= 0 && /HSN/i.test(lines[tableIdx]);
  const hasFreightCol = tableIdx >= 0 && /FREIGHT/i.test(lines[tableIdx]);

  if (tableIdx >= 0) {
    let itemsEnd = lines.length;
    for (let i = tableIdx + 1; i < lines.length; i++) {
      if (/^(IGST|CGST|SGST)\s*@/i.test(lines[i]) || /^TOTAL[\s\t]/i.test(lines[i])) {
        itemsEnd = i;
        break;
      }
    }

    let curSno = 0, curName = '';

    for (let i = tableIdx + 1; i < itemsEnd; i++) {
      const line = lines[i];
      const cols = line.split('\t').map(c => c.trim()).filter(Boolean);

      // 1a. Complete item with HSN via clean tab separation (6+ columns)
      //     Also handles 7-col FREIGHT variant: S.NO, NAME, HSN, FREIGHT, QTY, RATE, AMOUNT
      if (cols.length >= 6 && /^\d+$/.test(cols[0])) {
        // Try standard 6-col first (QTY in cols[3])
        let qtyColIdx = 3;
        let qtyM = cols[qtyColIdx].match(/^(\d+)\s*([A-Za-z]+)?$/);
        // If that fails and there's a FREIGHT column, try cols[4]
        if (!qtyM && hasFreightCol && cols.length >= 7) {
          qtyColIdx = 4;
          qtyM = cols[qtyColIdx].match(/^(\d+)\s*([A-Za-z]+)?$/);
        }
        if (qtyM) {
          curSno = 0; curName = '';
          inv.items.push({
            sno: +cols[0], rawName: cols[1], name: normalizeItemName(cols[1]),
            hsnCode: cols[2], quantity: +qtyM[1], unit: qtyM[2] || 'PCS',
            rate: parseNum(cols[qtyColIdx + 1]), amount: parseNum(cols[qtyColIdx + 2]), taxRate: 0,
          });
          continue;
        }
      }

      // 1b. Complete item WITHOUT HSN via tab separation (5 columns)
      if (cols.length >= 5 && /^\d+$/.test(cols[0]) && !hasHsnCol) {
        const qtyM = cols[2].match(/^(\d+)\s*([A-Za-z]+)?$/);
        if (qtyM) {
          curSno = 0; curName = '';
          inv.items.push({
            sno: +cols[0], rawName: cols[1], name: normalizeItemName(cols[1]),
            hsnCode: '', quantity: +qtyM[1], unit: qtyM[2] || 'PCS',
            rate: parseNum(cols[3]), amount: parseNum(cols[4]), taxRate: 0,
          });
          continue;
        }
      }

      // 2a. Complete item via space regex WITH HSN (handles merged tab columns)
      {
        const norm = line.replace(/\t/g, '  ');
        const m = norm.match(
          /^(\d+)\s+(.+)\s+(\d{4,8})\s+(\d+)\s+([A-Za-z]+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/
        );
        if (m) {
          curSno = 0; curName = '';
          inv.items.push({
            sno: +m[1], rawName: m[2].trim(), name: normalizeItemName(m[2].trim()),
            hsnCode: m[3], quantity: +m[4], unit: m[5],
            rate: parseNum(m[6]), amount: parseNum(m[7]), taxRate: 0,
          });
          continue;
        }
      }

      // 3a. Data-only row for multi-line items: HSN, QTY UNIT, RATE, AMOUNT
      // (checked before 2b to prevent HSN codes being misread as item serial numbers)
      if (cols.length >= 4 && /^\d{4,8}$/.test(cols[0]) && curSno > 0) {
        const qtyM = cols[1].match(/^(\d+)\s*([A-Za-z]+)?$/);
        if (qtyM) {
          inv.items.push({
            sno: curSno, rawName: curName, name: normalizeItemName(curName),
            hsnCode: cols[0], quantity: +qtyM[1], unit: qtyM[2] || 'PCS',
            rate: parseNum(cols[2]), amount: parseNum(cols[3]), taxRate: 0,
          });
          curSno = 0; curName = '';
          continue;
        }
      }

      // 3b. Data-only row with merged HSN+QTY (space regex): "85369090 1 PCS \t260 \t260"
      if (curSno > 0 && cols.length >= 2) {
        const norm = line.replace(/\t/g, '  ');
        const dm = norm.match(
          /^(\d{4,8})\s+(\d+)\s+([A-Za-z]+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/
        );
        if (dm) {
          inv.items.push({
            sno: curSno, rawName: curName, name: normalizeItemName(curName),
            hsnCode: dm[1], quantity: +dm[2], unit: dm[3],
            rate: parseNum(dm[4]), amount: parseNum(dm[5]), taxRate: 0,
          });
          curSno = 0; curName = '';
          continue;
        }
      }

      // 3c. Data-only row for no-HSN multi-line items: QTY UNIT, RATE, AMOUNT
      if (curSno > 0 && cols.length >= 3) {
        const qtyM = cols[0].match(/^(\d+)\s*([A-Za-z]+)?$/);
        if (qtyM) {
          inv.items.push({
            sno: curSno, rawName: curName, name: normalizeItemName(curName),
            hsnCode: '', quantity: +qtyM[1], unit: qtyM[2] || 'PCS',
            rate: parseNum(cols[1]), amount: parseNum(cols[2]), taxRate: 0,
          });
          curSno = 0; curName = '';
          continue;
        }
      }

      // 2b. Complete item via space regex WITHOUT HSN (also tried as fallback when HSN col exists but item has no HSN)
      {
        const norm = line.replace(/\t/g, '  ');
        const m = norm.match(
          /^(\d+)\s+(.+)\s+(\d+)\s+([A-Za-z]+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/
        );
        if (m) {
          curSno = 0; curName = '';
          inv.items.push({
            sno: +m[1], rawName: m[2].trim(), name: normalizeItemName(m[2].trim()),
            hsnCode: '', quantity: +m[3], unit: m[4],
            rate: parseNum(m[5]), amount: parseNum(m[6]), taxRate: 0,
          });
          continue;
        }
      }

      // 4. S.NO + name start (multi-line item, no HSN/QTY yet)
      if (cols.length >= 2 && /^\d+$/.test(cols[0]) && +cols[0] >= 1) {
        curSno = +cols[0];
        curName = cols.slice(1).join(' ');
        continue;
      }

      // 5. Continuation line (serial reference, etc.)
      if (curSno > 0 && cols.length > 0) {
        curName += ' ' + cols.join(' ');
      }
    }
  }

  // ─── HSN/SAC Summary Table (authoritative tax rates per HSN) ───
  // Also collects entries with "-" HSN for rate-by-amount matching
  const noHsnSummary = []; // { taxableValue, taxRate } for "-" HSN entries
  const hsnIdx = lines.findIndex(l => /^HSN\/SAC[\s\t]/i.test(l));
  if (hsnIdx >= 0) {
    const isIGST = /IGST/i.test(lines[hsnIdx]);

    for (let i = hsnIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^Total[\s\t]/i.test(l) && /^\D/.test(l)) break;
      if (/^Total Amount/i.test(l)) break;

      const rateM = l.match(/(\d+(?:\.\d+)?)%/);
      if (!rateM) continue;
      const rate = parseFloat(rateM[1]);
      const totalRate = isIGST ? rate : rate * 2;

      // Lines starting with HSN code (4-8 digits)
      const hsnM = l.match(/^(\d{4,8})[\s\t]/);
      if (hsnM) {
        inv.hsnTaxRates[hsnM[1]] = totalRate;
        continue;
      }

      // Lines starting with "-" (no HSN code)
      if (/^-[\s\t]/.test(l)) {
        const valM = l.match(/^-[\s\t]+([\d,]+(?:\.\d+)?)/);
        if (valM) {
          noHsnSummary.push({ taxableValue: parseNum(valM[1]), taxRate: totalRate });
        }
      }
    }
  }

  // Map tax rates onto items
  for (const item of inv.items) {
    if (item.hsnCode) {
      item.taxRate = inv.hsnTaxRates[item.hsnCode] || 0;
    }
  }

  // For items without HSN, assign tax rates from noHsnSummary
  const unratedItems = inv.items.filter(it => !it.hsnCode && !it.taxRate);
  if (unratedItems.length > 0 && noHsnSummary.length > 0) {
    if (noHsnSummary.length === 1) {
      // Single rate — assign to all unrated items
      for (const it of unratedItems) it.taxRate = noHsnSummary[0].taxRate;
    } else {
      // Multiple rates — match by taxable amount
      const usedSummary = new Set();
      // First pass: exact match for single items
      for (const it of unratedItems) {
        const idx = noHsnSummary.findIndex((s, i) => !usedSummary.has(i) && Math.abs(s.taxableValue - it.amount) < 1);
        if (idx >= 0) {
          it.taxRate = noHsnSummary[idx].taxRate;
          usedSummary.add(idx);
        }
      }
      // Second pass: assign remaining items the remaining rate
      const stillUnrated = unratedItems.filter(it => !it.taxRate);
      if (stillUnrated.length > 0) {
        const remainingRates = noHsnSummary.filter((_, i) => !usedSummary.has(i));
        if (remainingRates.length > 0) {
          for (const it of stillUnrated) it.taxRate = remainingRates[0].taxRate;
        }
      }
    }
  }

  // Final fallback: extract rate from IGST/CGST tax lines
  if (inv.items.some(it => !it.taxRate)) {
    for (const line of lines) {
      const igstM = line.match(/^IGST\s*@\s*(\d+(?:\.\d+)?)%/i);
      if (igstM) {
        const rate = parseFloat(igstM[1]);
        for (const it of inv.items) { if (!it.taxRate) it.taxRate = rate; }
        break;
      }
      const cgstM = line.match(/^CGST\s*@\s*(\d+(?:\.\d+)?)%/i);
      if (cgstM) {
        const rate = parseFloat(cgstM[1]) * 2;
        for (const it of inv.items) { if (!it.taxRate) it.taxRate = rate; }
        break;
      }
    }
  }

  // ─── Total Amount (from TOTAL row in items table — uppercase only) ───
  const searchStart = tableIdx >= 0 ? tableIdx + 1 : 0;
  for (let i = searchStart; i < lines.length; i++) {
    if (/^TOTAL[\s\t]/.test(lines[i])) {
      // Last number on the line is the total amount
      const m = lines[i].match(/([\d,]+(?:\.\d+)?)\s*$/);
      if (m) { inv.totalAmount = parseNum(m[1]); break; }
    }
  }

  // Fallback: compute from items + tax
  if (!inv.totalAmount && inv.items.length > 0) {
    const sub = inv.items.reduce((s, it) => s + it.amount, 0);
    const tax = inv.items.reduce((s, it) => s + it.amount * (it.taxRate || 0) / 100, 0);
    inv.totalAmount = round2(sub + tax);
  }

  return inv;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const { PDFParse } = require('pdf-parse');

  // Check database
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found: ${DB_PATH}`);
    console.error('Run the app at least once to create the database.');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${DB_PATH}` } },
  });
  await prisma.$connect();

  // ── Test mode ──
  if (args[0] === '--test') {
    const file = args[1];
    if (!file) { console.error('Usage: --test <filename>'); process.exit(1); }
    const text = await extractPdfText(PDFParse, path.join(INVOICES_DIR, file));
    console.log('=== RAW TEXT ===');
    console.log(text);
    console.log('\n=== PARSED ===');
    console.log(JSON.stringify(parseInvoiceText(text), null, 2));
    await prisma.$disconnect();
    return;
  }

  console.log(`DB:  ${DB_PATH}`);
  console.log(`Dir: ${INVOICES_DIR}\n`);

  const company = await prisma.company.findFirst();
  const companyStateCode = company?.stateCode || COMPANY_STATE_CODE;

  // ── Load existing records for deduplication ──
  const existingInvNums = new Set(
    (await prisma.salesInvoice.findMany({ select: { invoiceNumber: true } }))
      .map(r => r.invoiceNumber)
  );

  const partyByGstin = new Map();
  const partyByName  = new Map();
  for (const p of await prisma.party.findMany()) {
    if (p.taxId) partyByGstin.set(p.taxId.toUpperCase(), p);
    partyByName.set(p.name.toUpperCase(), p);
  }

  const itemMap = new Map();
  for (const it of await prisma.item.findMany()) {
    itemMap.set(makeItemKey(it.name, it.hsnCode || ''), it);
  }

  // ── Process PDFs ──
  const files = fs.readdirSync(INVOICES_DIR).filter(f => /\.pdf$/i.test(f)).sort();
  console.log(`Found ${files.length} PDFs\n`);

  let imported = 0, skipped = 0, errors = 0;
  let partiesCreated = 0, itemsCreated = 0;

  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx];
    const tag = `[${String(idx + 1).padStart(3)}/${files.length}]`;

    try {
      const text = await extractPdfText(PDFParse, path.join(INVOICES_DIR, file));
      const inv = parseInvoiceText(text);

      if (!inv.invoiceNumber) throw new Error('No invoice number parsed');
      if (!inv.invoiceDate)   throw new Error('No invoice date parsed');
      if (inv.items.length === 0) throw new Error('No line items parsed');

      if (existingInvNums.has(inv.invoiceNumber)) {
        console.log(`${tag} SKIP #${inv.invoiceNumber}`);
        skipped++;
        continue;
      }

      // ── Get or Create Party ──
      let party = inv.gstin ? partyByGstin.get(inv.gstin) : null;
      if (!party) party = partyByName.get(inv.partyName.toUpperCase());

      if (!party) {
        const sc = inv.placeOfSupplyCode || stateCodeFromGstin(inv.gstin || '');
        const sn = inv.placeOfSupply || stateNameFromCode(sc);
        party = await prisma.party.create({
          data: {
            name: inv.partyName,
            type: 'CUSTOMER',
            billingAddress: inv.address || null,
            taxId: inv.gstin || null,
            stateCode: sc || null,
            stateName: sn || null,
            gstType: inv.gstin ? 'REGULAR' : 'UNREGISTERED',
            phone: inv.mobile || null,
          },
        });
        if (inv.gstin) partyByGstin.set(inv.gstin, party);
        partyByName.set(inv.partyName.toUpperCase(), party);
        partiesCreated++;
      }

      // ── Inter-state determination ──
      const partyStateCode = party.stateCode || inv.placeOfSupplyCode || '';
      const isInterState = partyStateCode !== '' && partyStateCode !== companyStateCode;

      // ── Get or Create Items & compute GST per line item ──
      let subtotal = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;
      const invoiceItems = [];

      for (const pdfItem of inv.items) {
        const key = makeItemKey(pdfItem.name, pdfItem.hsnCode);
        let dbItem = itemMap.get(key);

        if (!dbItem) {
          dbItem = await prisma.item.create({
            data: {
              name: pdfItem.name,
              hsnCode: pdfItem.hsnCode || null,
              type: pdfItem.hsnCode && pdfItem.hsnCode.startsWith('99') ? 'SERVICE' : 'PRODUCT',
              unit: (pdfItem.unit || 'PCS').toLowerCase(),
              salePrice: pdfItem.rate,
              taxRate: pdfItem.taxRate || 0,
              gstType: 'GST',
              trackStock: false,
            },
          });
          itemMap.set(key, dbItem);
          itemsCreated++;
        }

        const taxable = pdfItem.amount;
        subtotal += taxable;
        const taxRate = pdfItem.taxRate || 0;
        const half = taxRate / 2;
        let cgR = 0, cgA = 0, sgR = 0, sgA = 0, igR = 0, igA = 0;

        if (isInterState) {
          igR = taxRate; igA = round2(taxable * taxRate / 100);
          totalIgst += igA;
        } else {
          cgR = half; cgA = round2(taxable * half / 100);
          sgR = half; sgA = round2(taxable * half / 100);
          totalCgst += cgA; totalSgst += sgA;
        }

        invoiceItems.push({
          itemId: dbItem.id, quantity: pdfItem.quantity, rate: pdfItem.rate,
          discount: 0, taxRate, total: round2(taxable + cgA + sgA + igA),
          hsnCode: pdfItem.hsnCode || '', taxableAmount: taxable,
          cgstRate: cgR, cgstAmount: cgA, sgstRate: sgR, sgstAmount: sgA,
          igstRate: igR, igstAmount: igA, cessRate: 0, cessAmount: 0,
        });
      }

      const taxAmount = round2(totalCgst + totalSgst + totalIgst);
      const totalAmount = inv.totalAmount || round2(subtotal + taxAmount);
      const supplyType = inv.gstin && inv.gstin.length === 15 ? 'B2B'
        : (isInterState && totalAmount > 250000 ? 'B2C_LARGE' : 'B2C_SMALL');

      await prisma.salesInvoice.create({
        data: {
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          type: 'INVOICE',
          partyId: party.id,
          subtotal: round2(subtotal),
          discount: 0,
          taxAmount,
          totalAmount,
          amountPaid: totalAmount,
          balanceDue: 0,
          status: 'PAID',
          placeOfSupply: inv.placeOfSupplyCode || party.stateCode || null,
          placeOfSupplyName: inv.placeOfSupply || party.stateName || null,
          isInterState,
          reverseCharge: false,
          cgstAmount: round2(totalCgst),
          sgstAmount: round2(totalSgst),
          igstAmount: round2(totalIgst),
          cessAmount: 0,
          supplyType,
          items: { create: invoiceItems },
        },
      });

      existingInvNums.add(inv.invoiceNumber);
      imported++;
      console.log(`${tag} OK   #${inv.invoiceNumber} - ${inv.partyName} - ${totalAmount.toLocaleString('en-IN')}`);

    } catch (err) {
      errors++;
      console.log(`${tag} ERR  ${file} - ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Imported:  ${imported}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Errors:    ${errors}`);
  console.log(`Parties created: ${partiesCreated}`);
  console.log(`Items created:   ${itemsCreated}`);

  await prisma.$disconnect();
}

// Run main() only when invoked directly. When required from another script
// (e.g. rescan-previous-invoices.js) we just expose the parser helpers.
if (require.main === module) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1); });
}

module.exports = {
  extractPdfText,
  parseInvoiceText,
  parseNum,
  parseDateDMY,
  stateCodeFromGstin,
  stateNameFromCode,
  stateCodeFromName,
  normalizeItemName,
  STATE_CODES,
};
