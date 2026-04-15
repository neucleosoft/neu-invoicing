import { ipcMain } from 'electron'

// Valid Indian state codes
const INDIAN_STATE_CODES: Record<string, string> = {
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
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

interface GstValidationResult {
  valid: boolean
  error?: string
  stateCode?: string
  stateName?: string
}

/**
 * Validates GSTIN format, state code, and checksum (all offline, no API needed)
 */
function validateGSTIN(gstin: string): GstValidationResult {
  if (!gstin || gstin.trim() === '') {
    return { valid: false, error: 'GSTIN is required' }
  }

  const normalized = gstin.toUpperCase().replace(/\s/g, '')

  if (normalized.length !== 15) {
    return { valid: false, error: `GSTIN must be exactly 15 characters` }
  }

  if (!GSTIN_REGEX.test(normalized)) {
    return { valid: false, error: 'Invalid GSTIN format' }
  }

  const stateCode = normalized.substring(0, 2)
  const stateName = INDIAN_STATE_CODES[stateCode]

  if (!stateName) {
    return { valid: false, error: `Invalid state code: ${stateCode}` }
  }

  // Validate checksum
  if (!validateGstinChecksum(normalized)) {
    return { valid: false, error: 'Invalid GSTIN checksum' }
  }

  return { valid: true, stateCode, stateName }
}

/**
 * Validates GSTIN checksum (15th character)
 *
 * How it works:
 * - Each of the first 14 characters is converted to a number (0-9 stay as-is, A=10, B=11, ..., Z=35)
 * - Characters at even positions (0, 2, 4...) are multiplied by 1
 * - Characters at odd positions (1, 3, 5...) are multiplied by 2
 * - Each product is split into quotient and remainder when divided by 36, then summed
 * - The checksum is (36 - (total sum % 36)) % 36
 * - That checksum must match the 15th character
 *
 * This catches single-digit typos and most transposition errors.
 */
function validateGstinChecksum(gstin: string): boolean {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0

  for (let i = 0; i < 14; i++) {
    const index = chars.indexOf(gstin[i])
    if (index === -1) return false
    let product = index * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }

  const checksum = (36 - (sum % 36)) % 36
  return gstin[14] === chars[checksum]
}

export const setupGstHandlers = () => {
  // Validate GSTIN format
  ipcMain.handle('gst:validate', async (_, gstin: string) => {
    try {
      const result = validateGSTIN(gstin)
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed'
      }
    }
  })

  // Lookup — validates and returns state info (no external API)
  ipcMain.handle('gst:lookup', async (_, gstin: string) => {
    try {
      const validation = validateGSTIN(gstin)
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          errorCode: 'INVALID_FORMAT'
        }
      }

      return {
        success: true,
        data: {
          gstin: gstin.toUpperCase().replace(/\s/g, ''),
          stateCode: validation.stateCode,
          state: validation.stateName
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Lookup failed'
      }
    }
  })

  // Get cached GST data — no-op (no external API to cache)
  ipcMain.handle('gst:getCached', async () => {
    return { success: false, error: 'GST cache not available' }
  })

  // Clear expired cache — no-op
  ipcMain.handle('gst:clearExpiredCache', async () => {
    return { success: true, data: { deleted: 0 } }
  })

  // Get state list
  ipcMain.handle('gst:getStateList', async () => {
    return { success: true, data: INDIAN_STATE_CODES }
  })
}
