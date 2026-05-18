// GST Number (GSTIN) Validation Utility for India
// GSTIN Format: 2 digits state code + 10 char PAN + 1 entity code + Z + 1 checksum

// Valid Indian state codes (01-37 + special territories)
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
  '97': 'Other Territory'
}

// GSTIN Regex Pattern
// Format: 2 digits (state) + 5 uppercase letters + 4 digits + 1 letter + 1 alphanumeric + Z + 1 alphanumeric
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export interface GstValidationResult {
  valid: boolean
  error?: string
  stateCode?: string
  stateName?: string
  panNumber?: string
}

/**
 * Validates an Indian GSTIN (GST Number)
 * @param gstin - The GSTIN string to validate
 * @returns Validation result with details
 */
export function validateGSTIN(gstin: string): GstValidationResult {
  // Check if empty
  if (!gstin || gstin.trim() === '') {
    return { valid: false, error: 'GSTIN is required' }
  }

  // Normalize to uppercase and remove spaces
  const normalizedGstin = gstin.toUpperCase().replace(/\s/g, '')

  // Check length
  if (normalizedGstin.length !== 15) {
    return {
      valid: false,
      error: `GSTIN must be exactly 15 characters (got ${normalizedGstin.length})`
    }
  }

  // Check format with regex
  if (!GSTIN_REGEX.test(normalizedGstin)) {
    return {
      valid: false,
      error: 'Invalid GSTIN format. Expected: 2 digits + 10 char PAN + Z + 1 checksum'
    }
  }

  // Extract and validate state code
  const stateCode = normalizedGstin.substring(0, 2)
  const stateName = INDIAN_STATE_CODES[stateCode]

  if (!stateName) {
    return {
      valid: false,
      error: `Invalid state code: ${stateCode}. Must be between 01-37.`
    }
  }

  // Extract PAN number (characters 3-12)
  const panNumber = normalizedGstin.substring(2, 12)

  // Validate checksum using Luhn-like algorithm for GSTIN
  if (!validateGstinChecksum(normalizedGstin)) {
    return {
      valid: false,
      error: 'Invalid GSTIN checksum. Please verify the number.'
    }
  }

  return {
    valid: true,
    stateCode,
    stateName,
    panNumber
  }
}

/**
 * Validates GSTIN checksum using the official algorithm
 */
function validateGstinChecksum(gstin: string): boolean {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0

  for (let i = 0; i < 14; i++) {
    const char = gstin[i]
    const index = chars.indexOf(char)

    if (index === -1) return false

    let product = index * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }

  const checksum = (36 - (sum % 36)) % 36
  const expectedCheckChar = chars[checksum]

  return gstin[14] === expectedCheckChar
}

/**
 * Formats a GSTIN for display (adds spaces for readability)
 * @param gstin - The GSTIN to format
 * @returns Formatted GSTIN string
 */
export function formatGSTIN(gstin: string): string {
  const normalized = gstin.toUpperCase().replace(/\s/g, '')
  if (normalized.length !== 15) return gstin

  // Format: 27 AABCU 9603 R 1 Z M
  return `${normalized.slice(0, 2)} ${normalized.slice(2, 7)} ${normalized.slice(7, 11)} ${normalized.slice(11, 12)} ${normalized.slice(12, 13)} ${normalized.slice(13, 14)} ${normalized.slice(14, 15)}`
}

/**
 * Extracts state information from GSTIN
 */
export function getStateFromGSTIN(gstin: string): { code: string; name: string } | null {
  const validation = validateGSTIN(gstin)
  if (!validation.valid || !validation.stateCode || !validation.stateName) {
    return null
  }
  return { code: validation.stateCode, name: validation.stateName }
}

/**
 * Quick check if a string looks like a GSTIN (less strict)
 */
export function looksLikeGSTIN(value: string): boolean {
  if (!value) return false
  const normalized = value.toUpperCase().replace(/\s/g, '')
  return normalized.length === 15 && /^[0-9]{2}[A-Z0-9]{13}$/.test(normalized)
}
