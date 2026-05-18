import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import { fmtNum, fmtRs, formatDate, LOGO_BASE64 } from './pdfHelpers'

;(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || pdfFonts

type Content = any
type TableCell = any

const GREEN = '#C6E0B4'

export interface StatementLine {
  date: string
  type: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'DEBIT_NOTE'
  number: string
  particulars: string
  debit: number
  credit: number
  balance: number
}

export interface StatementData {
  customer: {
    name: string
    email?: string
    phone?: string
    billingAddress?: string
    taxId?: string
  }
  company?: {
    name?: string
    address?: string
    phone?: string
    email?: string
    taxId?: string
    logoBase64?: string
  }
  fromDate: string
  toDate: string
  openingBalance: number
  lines: StatementLine[]
  totalDebit: number
  totalCredit: number
  closingBalance: number
}

const sanitizeFilePart = (s: string) => s.replace(/[^a-z0-9]/gi, '_')

export function buildStatementFilename(data: StatementData) {
  const partyPart = sanitizeFilePart(data.customer.name)
  const fromPart = data.fromDate.slice(0, 10).replace(/-/g, '')
  const toPart = data.toDate.slice(0, 10).replace(/-/g, '')
  return `statement_${partyPart}_${fromPart}_${toPart}.pdf`
}

export function downloadStatementPDF(data: StatementData) {
  pdfMake.createPdf(buildDocDefinition(data)).download(buildStatementFilename(data))
}

export function getStatementPDFBytes(data: StatementData): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(buildDocDefinition(data)).getBuffer((buffer: any) => {
        resolve(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
      })
    } catch (err) {
      reject(err)
    }
  })
}

function buildDocDefinition(data: StatementData): any {
  const logo = data.company?.logoBase64 || LOGO_BASE64
  return {
    pageSize: 'A4',
    pageMargins: [20, 16, 20, 16],
    content: [
      buildTitle(),
      buildHeader(data, logo),
      buildPartyAndPeriod(data),
      buildOpeningRow(data.openingBalance),
      buildTable(data),
      buildSummary(data),
    ],
    defaultStyle: { fontSize: 9 },
  }
}

function buildTitle(): Content {
  return {
    text: 'CUSTOMER STATEMENT',
    bold: true,
    fontSize: 14,
    alignment: 'center',
    margin: [0, 0, 0, 6],
  }
}

function buildHeader(data: StatementData, logo: string): Content {
  const company = data.company
  const companyStack: Content[] = [
    {
      text: (company?.name || 'Company').toUpperCase(),
      bold: true,
      fontSize: 14,
      color: '#2E7D32',
      margin: [0, 0, 0, 2],
    },
  ]
  if (company?.address) companyStack.push({ text: company.address, fontSize: 9 })
  if (company?.taxId)
    companyStack.push({
      text: [{ text: 'GSTIN: ', bold: true }, company.taxId],
      fontSize: 9,
    })
  if (company?.phone)
    companyStack.push({ text: [{ text: 'Phone: ', bold: true }, company.phone], fontSize: 9 })
  if (company?.email)
    companyStack.push({ text: [{ text: 'Email: ', bold: true }, company.email], fontSize: 9 })

  return {
    columns: [
      { image: logo, width: 50, height: 50, margin: [0, 0, 8, 0] },
      { stack: companyStack, width: '*' },
    ],
    margin: [0, 0, 0, 8],
  }
}

function buildPartyAndPeriod(data: StatementData): Content {
  const partyStack: Content[] = [
    { text: 'STATEMENT TO', bold: true, fontSize: 9, margin: [0, 0, 0, 2] },
    { text: data.customer.name, bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (data.customer.billingAddress)
    partyStack.push({ text: data.customer.billingAddress, fontSize: 9, margin: [0, 0, 0, 1] })
  if (data.customer.taxId)
    partyStack.push({
      text: [{ text: 'GSTIN: ', bold: true }, data.customer.taxId],
      fontSize: 9,
      margin: [0, 0, 0, 1],
    })
  if (data.customer.phone)
    partyStack.push({
      text: [{ text: 'Mobile: ', bold: true }, data.customer.phone],
      fontSize: 9,
    })

  const periodStack: Content[] = [
    { text: 'STATEMENT PERIOD', bold: true, fontSize: 9, margin: [0, 0, 0, 2] },
    {
      text: `${formatDate(data.fromDate)}  to  ${formatDate(data.toDate)}`,
      bold: true,
      fontSize: 11,
    },
  ]

  return {
    table: {
      widths: ['60%', '40%'],
      body: [
        [
          { stack: partyStack, margin: [0, 0, 5, 0] },
          { stack: periodStack, alignment: 'right' },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 0, 0, 8],
  }
}

function buildOpeningRow(openingBalance: number): Content {
  return {
    table: {
      widths: ['*', 60],
      body: [
        [
          {
            text: 'Opening Balance (carried forward)',
            bold: true,
            fontSize: 9,
            fillColor: GREEN,
          },
          {
            text: fmtRs(openingBalance),
            bold: true,
            fontSize: 9,
            alignment: 'right',
            fillColor: GREEN,
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 0],
  }
}

function buildTable(data: StatementData): Content {
  const widths = [55, 55, '*', 70, 70, 70]
  const headers = ['DATE', 'NUMBER', 'PARTICULARS', 'CHARGES', 'RECEIPTS', 'BALANCE']

  const headerRow: TableCell[] = headers.map((h) => ({
    text: h,
    bold: true,
    fontSize: 9,
    alignment: 'center',
    fillColor: GREEN,
    margin: [0, 2, 0, 2],
  }))

  const lineRows: TableCell[][] = data.lines.map((line) => [
    { text: formatDate(line.date), fontSize: 9 },
    { text: line.number, fontSize: 9 },
    { text: line.particulars, fontSize: 9 },
    { text: line.debit ? fmtNum(line.debit) : '-', alignment: 'right', fontSize: 9 },
    { text: line.credit ? fmtNum(line.credit) : '-', alignment: 'right', fontSize: 9 },
    { text: fmtNum(line.balance), alignment: 'right', fontSize: 9 },
  ])

  // Totals row
  const totalsRow: TableCell[] = [
    { text: '', fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: 'Period Totals', bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
    {
      text: fmtNum(data.totalDebit),
      bold: true,
      fontSize: 9,
      alignment: 'right',
      fillColor: GREEN,
    },
    {
      text: fmtNum(data.totalCredit),
      bold: true,
      fontSize: 9,
      alignment: 'right',
      fillColor: GREEN,
    },
    { text: '', fillColor: GREEN },
  ]

  const body: TableCell[][] =
    lineRows.length > 0
      ? [headerRow, ...lineRows, totalsRow]
      : [headerRow, [
          {
            text: 'No transactions in this period.',
            colSpan: 6,
            alignment: 'center',
            italics: true,
            color: '#666',
            fontSize: 9,
            margin: [0, 6, 0, 6],
          },
          {},
          {},
          {},
          {},
          {},
        ]]

  return {
    table: { headerRows: 1, widths, body },
    layout: {
      hLineWidth: (i: number, node: any) =>
        i === 0 || i === 1 || i === node.table.body.length || i === node.table.body.length - 1
          ? 0.5
          : 0,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 8],
  }
}

function buildSummary(data: StatementData): Content {
  return {
    table: {
      widths: ['*', 110],
      body: [
        [
          {
            text: 'CLOSING BALANCE',
            bold: true,
            fontSize: 11,
            alignment: 'right',
            fillColor: GREEN,
            margin: [0, 4, 4, 4],
          },
          {
            text: fmtRs(data.closingBalance),
            bold: true,
            fontSize: 11,
            alignment: 'right',
            fillColor: GREEN,
            margin: [0, 4, 4, 4],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
    },
  }
}
