// The four non-classic invoice templates (modern / minimal / elegant / bold),
// RE-AUTHORED as pdfmake document definitions from desktop's jsPDF
// pixel-coordinate originals (src/utils/generateInvoicePDF.ts). Same visual
// identity — colors, header treatment, table styling, totals box — but
// flow-based, so long invoices paginate correctly instead of overflowing a
// hand-measured page. Both apps render these through their own pdfmake
// instance, so a "modern" invoice from the phone matches the desktop's.
//
// Quotations and proformas ALWAYS use the classic layout regardless of the
// selected template — mirrors desktop's download/getBytes routing.

import { fmtAmt, formatDate } from './helpers'
import { buildInvoiceDocDefinition } from './invoice'
import type { Content, DocDefinition, InvoiceData } from './types'

export type InvoiceTemplate = 'classic' | 'modern' | 'minimal' | 'elegant' | 'bold'

// Verbatim from desktop pdfHelpers.TEMPLATE_INFO so both pickers read the same.
export const INVOICE_TEMPLATE_INFO: Record<
  InvoiceTemplate,
  { name: string; description: string; preview: string }
> = {
  classic: { name: 'GST Tax Invoice', description: 'Standard Indian GST tax invoice format', preview: '🔵' },
  modern: { name: 'Modern Gradient', description: 'Stylish gradient design', preview: '🟣' },
  minimal: { name: 'Minimal Clean', description: 'Simple and elegant with lots of whitespace', preview: '⚪' },
  elegant: { name: 'Elegant Gold', description: 'Sophisticated design with gold accents', preview: '🟡' },
  bold: { name: 'Bold & Modern', description: 'Dark theme with bold typography', preview: '⚫' },
}

export function buildInvoiceDocDefinitionForTemplate(
  inv: InvoiceData,
  template?: string,
): DocDefinition {
  const t = (template ?? inv.template ?? 'classic') as InvoiceTemplate
  if (inv.type === 'QUOTATION' || inv.type === 'PROFORMA_INVOICE') {
    return buildInvoiceDocDefinition(inv)
  }
  switch (t) {
    case 'modern':
      return buildModernInvoice(inv)
    case 'minimal':
      return buildMinimalInvoice(inv)
    case 'elegant':
      return buildElegantInvoice(inv)
    case 'bold':
      return buildBoldInvoice(inv)
    default:
      return buildInvoiceDocDefinition(inv)
  }
}

// Same user-facing labels as desktop's formatInvoiceStatus.
const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Unpaid',
  PAID: 'Paid',
  PARTIAL: 'Partial',
  OVERDUE: 'Overdue',
  REVERSED: 'Reversed',
}
const statusLabel = (s?: string | null) => (s ? STATUS_LABELS[s] || s : '')

const NO_BORDERS = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
}

// Simple 5-column items body shared by the non-classic templates (they all
// show # / description / qty / rate / amount — the GST split lives on classic).
function simpleItemRows(inv: InvoiceData, cur: string | undefined, textColor: string) {
  return inv.items.map((it, i) => [
    { text: String(i + 1), alignment: 'center', color: textColor },
    { text: it.item.name, color: textColor },
    { text: String(it.quantity), alignment: 'center', color: textColor },
    { text: fmtAmt(it.rate, cur), alignment: 'right', color: textColor },
    { text: fmtAmt(it.total, cur), alignment: 'right', color: textColor },
  ])
}

// ─── Modern (purple header band, card sections, purple totals box) ───────────

export function buildModernInvoice(inv: InvoiceData): DocDefinition {
  if (!inv.items) inv.items = []
  const PURPLE = '#7C3AED'
  const PURPLE_LIGHT = '#8B5CF6'
  const DARK = '#1E1E2E'
  const CARD = '#F8F9FC'
  const cur = inv.company?.currency

  const headerLeft: Content = {
    stack: [
      { text: inv.company?.name || 'Company', fontSize: 20, bold: true, color: 'white', margin: [0, 0, 0, 4] },
      ...(inv.company?.address ? [{ text: inv.company.address, fontSize: 8, color: 'white' }] : []),
      ...(inv.company?.phone ? [{ text: inv.company.phone, fontSize: 8, color: 'white' }] : []),
      ...(inv.company?.email ? [{ text: inv.company.email, fontSize: 8, color: 'white' }] : []),
      ...(inv.company?.taxId ? [{ text: 'GSTIN: ' + inv.company.taxId, fontSize: 8, color: 'white' }] : []),
    ],
  }
  const headerRight: Content = {
    table: {
      widths: [110],
      body: [
        [
          {
            stack: [
              { text: 'INVOICE', fontSize: 11, bold: true, color: PURPLE, alignment: 'center' },
              { text: inv.invoiceNumber, fontSize: 8, color: PURPLE, alignment: 'center', margin: [0, 4, 0, 0] },
              { text: formatDate(inv.invoiceDate), fontSize: 7, color: PURPLE, alignment: 'center', margin: [0, 2, 0, 0] },
            ],
            fillColor: 'white',
            margin: [4, 8, 4, 8],
          },
        ],
      ],
    },
    layout: NO_BORDERS,
  }

  const card = (title: string, lines: Content[]): Content => ({
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [{ text: title, fontSize: 7, bold: true, color: PURPLE, margin: [0, 0, 0, 5] }, ...lines],
            fillColor: CARD,
            margin: [8, 8, 8, 8],
          },
        ],
      ],
    },
    layout: NO_BORDERS,
  })

  const totalsRows: any[] = [
    [
      { text: 'Subtotal:', color: '#DCDCFF', fontSize: 8 },
      { text: fmtAmt(inv.subtotal ?? 0, cur), color: 'white', alignment: 'right', fontSize: 8 },
    ],
  ]
  if (inv.discount > 0) {
    totalsRows.push([
      { text: 'Discount:', color: '#DCDCFF', fontSize: 8 },
      { text: '- ' + fmtAmt(inv.discount, cur), color: 'white', alignment: 'right', fontSize: 8 },
    ])
  }
  totalsRows.push([
    { text: 'Tax:', color: '#DCDCFF', fontSize: 8 },
    { text: fmtAmt(inv.taxAmount ?? 0, cur), color: 'white', alignment: 'right', fontSize: 8 },
  ])
  totalsRows.push([
    { text: 'TOTAL:', color: 'white', bold: true, fontSize: 11, margin: [0, 4, 0, 0] },
    { text: fmtAmt(inv.totalAmount, cur), color: 'white', bold: true, fontSize: 11, alignment: 'right', margin: [0, 4, 0, 0] },
  ])
  if (inv.amountPaid > 0) {
    totalsRows.push([
      { text: 'Paid:', color: '#DCDCFF', fontSize: 8 },
      { text: '- ' + fmtAmt(inv.amountPaid, cur), color: 'white', alignment: 'right', fontSize: 8 },
    ])
  }

  return {
    pageSize: 'A4',
    pageMargins: [15, 15, 15, 30],
    content: [
      {
        table: { widths: ['*', 'auto'], body: [[headerLeft, headerRight]] },
        layout: { ...NO_BORDERS, fillColor: () => PURPLE, paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 12, paddingBottom: () => 12 },
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          card('INVOICE DETAILS', [
            { text: 'Date: ' + formatDate(inv.invoiceDate), fontSize: 8, color: DARK },
            { text: 'Status: ' + statusLabel(inv.status), fontSize: 8, color: DARK },
            ...(inv.company?.taxId ? [{ text: 'GSTIN: ' + inv.company.taxId, fontSize: 8, color: DARK }] : []),
          ]),
          card('BILL TO', [
            { text: inv.customer.name, fontSize: 9, bold: true, color: DARK },
            ...(inv.customer.phone ? [{ text: inv.customer.phone, fontSize: 8, color: DARK }] : []),
            ...(inv.customer.email ? [{ text: inv.customer.email, fontSize: 8, color: DARK }] : []),
          ]),
        ],
        columnGap: 10,
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: [20, '*', 35, 70, 80],
          body: [
            ['#', 'Description', 'Qty', 'Rate', 'Amount'].map((h, i) => ({
              text: h,
              bold: true,
              color: 'white',
              fontSize: 8,
              alignment: i === 0 || i === 2 ? 'center' : i >= 3 ? 'right' : 'left',
            })),
            ...simpleItemRows(inv, cur, DARK),
          ],
        },
        layout: {
          ...NO_BORDERS,
          fillColor: (rowIndex: number) => (rowIndex === 0 ? PURPLE : rowIndex % 2 === 0 ? CARD : null),
          paddingTop: () => 5,
          paddingBottom: () => 5,
          paddingLeft: () => 6,
          paddingRight: () => 6,
        },
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          { text: '', width: '*' },
          {
            width: 220,
            table: { widths: ['*', 'auto'], body: totalsRows },
            layout: {
              ...NO_BORDERS,
              fillColor: () => PURPLE,
              paddingLeft: () => 10,
              paddingRight: () => 10,
              paddingTop: () => 4,
              paddingBottom: () => 4,
            },
          },
        ],
      },
    ],
    footer: {
      text: 'Thank you for your business!',
      alignment: 'center',
      bold: true,
      fontSize: 9,
      color: PURPLE_LIGHT,
      margin: [0, 6, 0, 0],
    },
    defaultStyle: { fontSize: 8 },
  }
}

// ─── Minimal (black on white, generous whitespace, hairlines only) ───────────

export function buildMinimalInvoice(inv: InvoiceData): DocDefinition {
  if (!inv.items) inv.items = []
  const GRAY = '#828282'
  const LINE = '#DCDCDC'
  const cur = inv.company?.currency

  const hairline = (marginTop: number, marginBottom: number): Content => ({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: LINE }],
    margin: [0, marginTop, 0, marginBottom],
  })

  const totalsRows: any[] = [
    [
      { text: 'Subtotal', color: GRAY, fontSize: 9 },
      { text: fmtAmt(inv.subtotal ?? 0, cur), alignment: 'right', fontSize: 9 },
    ],
  ]
  if (inv.discount > 0) {
    totalsRows.push([
      { text: 'Discount', color: GRAY, fontSize: 9 },
      { text: '- ' + fmtAmt(inv.discount, cur), alignment: 'right', fontSize: 9 },
    ])
  }
  totalsRows.push([
    { text: 'Tax', color: GRAY, fontSize: 9 },
    { text: fmtAmt(inv.taxAmount ?? 0, cur), alignment: 'right', fontSize: 9 },
  ])

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    content: [
      {
        columns: [
          { text: 'Invoice', fontSize: 26, bold: true, width: '*' },
          {
            width: 'auto',
            stack: [
              { text: inv.invoiceNumber, fontSize: 9, color: GRAY, alignment: 'right' },
              { text: formatDate(inv.invoiceDate), fontSize: 9, color: GRAY, alignment: 'right', margin: [0, 3, 0, 0] },
            ],
          },
        ],
      },
      hairline(16, 16),
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'FROM', fontSize: 7, bold: true, color: GRAY, margin: [0, 0, 0, 5] },
              { text: inv.company?.name || 'Company', fontSize: 10, bold: true, margin: [0, 0, 0, 3] },
              ...(inv.company?.address ? [{ text: inv.company.address, fontSize: 8 }] : []),
              ...(inv.company?.phone ? [{ text: inv.company.phone, fontSize: 8 }] : []),
              ...(inv.company?.email ? [{ text: inv.company.email, fontSize: 8 }] : []),
            ],
          },
          {
            width: '*',
            stack: [
              { text: 'TO', fontSize: 7, bold: true, color: GRAY, margin: [0, 0, 0, 5] },
              { text: inv.customer.name, fontSize: 10, bold: true, margin: [0, 0, 0, 3] },
              ...(inv.customer.billingAddress ? [{ text: inv.customer.billingAddress, fontSize: 8 }] : []),
              ...(inv.customer.phone ? [{ text: inv.customer.phone, fontSize: 8 }] : []),
              ...(inv.customer.email ? [{ text: inv.customer.email, fontSize: 8 }] : []),
            ],
          },
        ],
        columnGap: 20,
        margin: [0, 0, 0, 20],
      },
      {
        table: {
          headerRows: 1,
          widths: [20, '*', 35, 70, 80],
          body: [
            ['#', 'Description', 'Qty', 'Rate', 'Amount'].map((h, i) => ({
              text: h,
              bold: true,
              color: GRAY,
              fontSize: 7,
              alignment: i === 0 || i === 2 ? 'center' : i >= 3 ? 'right' : 'left',
            })),
            ...simpleItemRows(inv, cur, 'black'),
          ],
        },
        layout: {
          hLineWidth: (i: number) => (i === 1 ? 0.5 : 0),
          vLineWidth: () => 0,
          hLineColor: () => LINE,
          paddingTop: () => 6,
          paddingBottom: () => 6,
          paddingLeft: () => 4,
          paddingRight: () => 4,
        },
        margin: [0, 0, 0, 18],
      },
      {
        columns: [
          { text: '', width: '*' },
          {
            width: 180,
            stack: [
              { table: { widths: ['*', 'auto'], body: totalsRows }, layout: NO_BORDERS },
              {
                canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.5, lineColor: LINE }],
                margin: [0, 6, 0, 6],
              },
              {
                columns: [
                  { text: 'Total', fontSize: 12, bold: true, width: '*' },
                  { text: fmtAmt(inv.totalAmount, cur), fontSize: 12, bold: true, alignment: 'right', width: 'auto' },
                ],
              },
            ],
          },
        ],
      },
    ],
    defaultStyle: { fontSize: 9 },
  }
}

// ─── Elegant (gold rules, navy text, centered framed header) ─────────────────

export function buildElegantInvoice(inv: InvoiceData): DocDefinition {
  if (!inv.items) inv.items = []
  const GOLD = '#B49132'
  const GOLD_DIM = '#8B7324'
  const NAVY = '#1A2A3A'
  const cur = inv.company?.currency

  const contactLine = [inv.company?.address, inv.company?.phone, inv.company?.email]
    .filter(Boolean)
    .join('  ·  ')

  return {
    pageSize: 'A4',
    pageMargins: [15, 15, 15, 34],
    content: [
      // Double gold frame: an outer 1.5pt bordered table nesting an inner
      // 0.5pt bordered table — the pdfmake translation of the two rects.
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                table: {
                  widths: ['*'],
                  body: [
                    [
                      {
                        stack: [
                          { text: inv.company?.name || 'Company', fontSize: 18, bold: true, color: NAVY, alignment: 'center' },
                          ...(contactLine
                            ? [{ text: contactLine, fontSize: 8, color: NAVY, alignment: 'center', margin: [0, 4, 0, 0] }]
                            : []),
                          ...(inv.company?.taxId
                            ? [{ text: 'GSTIN: ' + inv.company.taxId, fontSize: 8, color: NAVY, alignment: 'center', margin: [0, 2, 0, 0] }]
                            : []),
                        ],
                        margin: [8, 10, 8, 10],
                      },
                    ],
                  ],
                },
                layout: {
                  hLineWidth: () => 0.5,
                  vLineWidth: () => 0.5,
                  hLineColor: () => GOLD,
                  vLineColor: () => GOLD,
                },
                margin: [3, 3, 3, 3],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 1.5,
          vLineWidth: () => 1.5,
          hLineColor: () => GOLD,
          vLineColor: () => GOLD,
        },
      },
      {
        columns: [
          { text: '', width: '*' },
          {
            width: 'auto',
            table: { body: [[{ text: 'TAX INVOICE', color: 'white', bold: true, fontSize: 9, margin: [10, 3, 10, 3] }]] },
            layout: { ...NO_BORDERS, fillColor: () => GOLD },
          },
          { text: '', width: '*' },
        ],
        margin: [0, 0, 0, 16],
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              {
                columns: [
                  { text: 'Invoice No:', bold: true, color: NAVY, fontSize: 9, width: 60 },
                  { text: inv.invoiceNumber, color: NAVY, fontSize: 9, width: '*' },
                ],
              },
              {
                columns: [
                  { text: 'Date:', bold: true, color: NAVY, fontSize: 9, width: 60 },
                  { text: formatDate(inv.invoiceDate), color: NAVY, fontSize: 9, width: '*' },
                ],
                margin: [0, 4, 0, 0],
              },
            ],
          },
          {
            width: '*',
            stack: [
              { text: 'BILL TO', bold: true, color: NAVY, fontSize: 8 },
              { text: inv.customer.name, bold: true, color: NAVY, fontSize: 10, margin: [0, 3, 0, 0] },
              ...(inv.customer.phone ? [{ text: inv.customer.phone, color: NAVY, fontSize: 8, margin: [0, 3, 0, 0] }] : []),
            ],
          },
        ],
        margin: [0, 0, 0, 16],
      },
      {
        table: {
          headerRows: 1,
          widths: [20, '*', 45, 70, 80],
          body: [
            ['#', 'Description', 'Quantity', 'Rate', 'Amount'].map((h, i) => ({
              text: h,
              bold: true,
              color: 'white',
              fontSize: 8,
              fillColor: NAVY,
              alignment: i === 0 || i === 2 ? 'center' : i >= 3 ? 'right' : 'left',
            })),
            ...simpleItemRows(inv, cur, NAVY),
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#B7B7B7',
          vLineColor: () => '#B7B7B7',
          paddingTop: () => 5,
          paddingBottom: () => 5,
          paddingLeft: () => 5,
          paddingRight: () => 5,
        },
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          { text: '', width: '*' },
          {
            width: 220,
            table: {
              widths: ['*', 'auto'],
              body: [
                [
                  { text: 'Subtotal:', color: NAVY, fontSize: 9 },
                  { text: fmtAmt(inv.subtotal ?? 0, cur), color: NAVY, fontSize: 9, alignment: 'right' },
                ],
                [
                  { text: 'Tax:', color: NAVY, fontSize: 9 },
                  { text: fmtAmt(inv.taxAmount ?? 0, cur), color: NAVY, fontSize: 9, alignment: 'right' },
                ],
                [
                  { text: 'TOTAL:', color: 'white', bold: true, fontSize: 11, fillColor: GOLD },
                  { text: fmtAmt(inv.totalAmount, cur), color: 'white', bold: true, fontSize: 11, alignment: 'right', fillColor: GOLD },
                ],
              ],
            },
            layout: {
              hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 1 : 0),
              vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 1 : 0),
              hLineColor: () => GOLD,
              vLineColor: () => GOLD,
              paddingLeft: () => 8,
              paddingRight: () => 8,
              paddingTop: () => 5,
              paddingBottom: () => 5,
            },
          },
        ],
      },
    ],
    footer: {
      stack: [
        { canvas: [{ type: 'line', x1: 15, y1: 0, x2: 580, y2: 0, lineWidth: 0.5, lineColor: GOLD }] },
        { text: 'Thank you for your valued business', alignment: 'center', italics: true, fontSize: 9, color: GOLD_DIM, margin: [0, 6, 0, 0] },
      ],
    },
    defaultStyle: { fontSize: 9 },
  }
}

// ─── Bold (black header, cyan accent strip, dark totals) ─────────────────────

export function buildBoldInvoice(inv: InvoiceData): DocDefinition {
  if (!inv.items) inv.items = []
  const BLACK = '#111111'
  const ACCENT = '#00B8D4'
  const OFFW = '#F5F5F7'
  const cur = inv.company?.currency

  const totalsRows: any[] = [
    [
      { text: 'Subtotal', color: '#B4B4B4', fontSize: 8 },
      { text: fmtAmt(inv.subtotal ?? 0, cur), color: 'white', fontSize: 8, alignment: 'right' },
    ],
  ]
  if (inv.discount > 0) {
    totalsRows.push([
      { text: 'Discount', color: '#B4B4B4', fontSize: 8 },
      { text: '- ' + fmtAmt(inv.discount, cur), color: 'white', fontSize: 8, alignment: 'right' },
    ])
  }
  totalsRows.push([
    { text: 'Tax', color: '#B4B4B4', fontSize: 8 },
    { text: fmtAmt(inv.taxAmount ?? 0, cur), color: 'white', fontSize: 8, alignment: 'right' },
  ])

  return {
    pageSize: 'A4',
    pageMargins: [15, 15, 15, 30],
    content: [
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            [
              {
                stack: [
                  { text: 'INVOICE', fontSize: 26, bold: true, color: 'white' },
                  { text: '# ' + inv.invoiceNumber, fontSize: 10, color: 'white', margin: [0, 4, 0, 0] },
                  { text: formatDate(inv.invoiceDate), fontSize: 10, color: 'white', margin: [0, 3, 0, 0] },
                ],
              },
              {
                stack: [
                  { text: inv.company?.name || 'Company', fontSize: 12, bold: true, color: 'white', alignment: 'right' },
                  ...(inv.company?.address
                    ? [{ text: inv.company.address, fontSize: 8, color: 'white', alignment: 'right', margin: [0, 3, 0, 0] }]
                    : []),
                  ...(inv.company?.phone
                    ? [{ text: inv.company.phone, fontSize: 8, color: 'white', alignment: 'right', margin: [0, 2, 0, 0] }]
                    : []),
                  ...(inv.company?.email
                    ? [{ text: inv.company.email, fontSize: 8, color: 'white', alignment: 'right', margin: [0, 2, 0, 0] }]
                    : []),
                ],
              },
            ],
          ],
        },
        layout: {
          ...NO_BORDERS,
          fillColor: () => BLACK,
          paddingLeft: () => 12,
          paddingRight: () => 12,
          paddingTop: () => 14,
          paddingBottom: () => 14,
        },
      },
      // The 4pt cyan strip under the header band.
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 565, h: 4, color: ACCENT }], margin: [0, 0, 0, 14] },
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  { text: 'BILL TO', fontSize: 7, bold: true, color: ACCENT, margin: [0, 0, 0, 4] },
                  { text: inv.customer.name, fontSize: 11, bold: true, color: BLACK },
                  ...(inv.customer.phone ? [{ text: inv.customer.phone, fontSize: 8, color: BLACK, margin: [0, 3, 0, 0] }] : []),
                ],
                fillColor: OFFW,
                margin: [8, 8, 8, 8],
              },
            ],
          ],
        },
        layout: NO_BORDERS,
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: [20, '*', 35, 70, 80],
          body: [
            ['#', 'ITEM', 'QTY', 'RATE', 'TOTAL'].map((h, i) => ({
              text: h,
              bold: true,
              color: 'white',
              fontSize: 8,
              alignment: i === 0 || i === 2 ? 'center' : i >= 3 ? 'right' : 'left',
            })),
            ...simpleItemRows(inv, cur, BLACK),
          ],
        },
        layout: {
          ...NO_BORDERS,
          fillColor: (rowIndex: number) => (rowIndex === 0 ? BLACK : rowIndex % 2 === 0 ? OFFW : null),
          paddingTop: () => 5,
          paddingBottom: () => 5,
          paddingLeft: () => 6,
          paddingRight: () => 6,
        },
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          { text: '', width: '*' },
          {
            width: 220,
            stack: [
              {
                table: { widths: ['*', 'auto'], body: totalsRows },
                layout: {
                  ...NO_BORDERS,
                  fillColor: () => BLACK,
                  paddingLeft: () => 10,
                  paddingRight: () => 10,
                  paddingTop: () => 4,
                  paddingBottom: () => 4,
                },
              },
              {
                table: {
                  widths: ['*', 'auto'],
                  body: [
                    [
                      { text: 'TOTAL', color: BLACK, bold: true, fontSize: 12 },
                      { text: fmtAmt(inv.totalAmount, cur), color: BLACK, bold: true, fontSize: 12, alignment: 'right' },
                    ],
                  ],
                },
                layout: {
                  ...NO_BORDERS,
                  fillColor: () => ACCENT,
                  paddingLeft: () => 10,
                  paddingRight: () => 10,
                  paddingTop: () => 5,
                  paddingBottom: () => 5,
                },
              },
            ],
          },
        ],
      },
    ],
    defaultStyle: { fontSize: 8 },
  }
}
