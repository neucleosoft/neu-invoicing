// GST Number (GSTIN) Validation Utility for India
// GSTIN Format: 2 digits state code + 10 char PAN + 1 entity code + Z + 1 checksum

export const INDIAN_STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
}

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export interface GstValidationResult {
  valid: boolean
  error?: string
  stateCode?: string
  stateName?: string
  panNumber?: string
}

export function validateGSTIN(gstin: string): GstValidationResult {
  if (!gstin || gstin.trim() === '') {
    return { valid: false, error: 'GSTIN is required' }
  }

  const normalizedGstin = gstin.toUpperCase().replace(/\s/g, '')

  if (normalizedGstin.length !== 15) {
    return {
      valid: false,
      error: `GSTIN must be exactly 15 characters (got ${normalizedGstin.length})`,
    }
  }

  if (!GSTIN_REGEX.test(normalizedGstin)) {
    return {
      valid: false,
      error: 'Invalid GSTIN format. Expected: 2 digits + 10 char PAN + Z + 1 checksum',
    }
  }

  const stateCode = normalizedGstin.substring(0, 2)
  const stateName = INDIAN_STATE_CODES[stateCode]

  if (!stateName) {
    return {
      valid: false,
      error: `Invalid state code: ${stateCode}. Must be between 01-37.`,
    }
  }

  const panNumber = normalizedGstin.substring(2, 12)

  if (!validateGstinChecksum(normalizedGstin)) {
    return {
      valid: false,
      error: 'Invalid GSTIN checksum. Please verify the number.',
    }
  }

  return {
    valid: true,
    stateCode,
    stateName,
    panNumber,
  }
}

function validateGstinChecksum(gstin: string): boolean {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0

  for (let i = 0; i < 14; i++) {
    const char = gstin[i]
    const index = chars.indexOf(char)

    if (index === -1) return false

    const product = index * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }

  const checksum = (36 - (sum % 36)) % 36
  const expectedCheckChar = chars[checksum]

  return gstin[14] === expectedCheckChar
}

export function looksLikeGSTIN(value: string): boolean {
  if (!value) return false
  const normalized = value.toUpperCase().replace(/\s/g, '')
  return normalized.length === 15 && /^[0-9]{2}[A-Z0-9]{13}$/.test(normalized)
}
