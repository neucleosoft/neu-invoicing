import { ipcMain } from 'electron'
import { getPrisma } from '../database'

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

// Cache TTL: 24 hours in milliseconds
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Sandbox.co.in API Configuration
const SANDBOX_AUTH_URL = 'https://api.sandbox.co.in/authenticate'
const SANDBOX_GST_URL = 'https://api.sandbox.co.in/gst/compliance/public/gstin/search'
const SANDBOX_API_KEY = process.env.SANDBOX_API_KEY || ''
const SANDBOX_API_SECRET = process.env.SANDBOX_API_SECRET || ''

// Token cache (valid for 24 hours, we refresh at 23 hours to be safe)
let cachedAccessToken: string | null = null
let tokenExpiryTime: number = 0

interface GstValidationResult {
  valid: boolean
  error?: string
  stateCode?: string
  stateName?: string
}

interface GstLookupData {
  gstin: string
  tradeName?: string
  legalName?: string
  gstStatus?: string
  registrationDate?: string
  businessType?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  district?: string
  state?: string
  stateCode?: string
  pincode?: string
  additionalAddresses?: any[]
}

interface GstLookupResult {
  success: boolean
  data?: GstLookupData
  error?: string
  errorCode?: 'INVALID_FORMAT' | 'NOT_FOUND' | 'API_ERROR' | 'CANCELLED' | 'RATE_LIMITED'
  warning?: string
  fromCache?: boolean
}

/**
 * Validates GSTIN format
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
 * Validates GSTIN checksum
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

/**
 * Check if cache is expired
 */
function isCacheExpired(fetchedAt: Date): boolean {
  return Date.now() - fetchedAt.getTime() > CACHE_TTL_MS
}

/**
 * Get access token from Sandbox.co.in (with caching)
 */
async function getAccessToken(): Promise<string | null> {
  // Return cached token if still valid (refresh 1 hour before expiry)
  if (cachedAccessToken && Date.now() < tokenExpiryTime - 3600000) {
    console.log('Using cached access token')
    return cachedAccessToken
  }

  console.log('Fetching new access token from Sandbox.co.in')

  try {
    const response = await fetch(SANDBOX_AUTH_URL, {
      method: 'POST',
      headers: {
        'x-api-key': SANDBOX_API_KEY,
        'x-api-secret': SANDBOX_API_SECRET,
        'x-api-version': '1.0',
        'Content-Type': 'application/json'
      }
    })

    console.log(`Auth Response Status: ${response.status}`)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Auth failed:', errorData)
      return null
    }

    const data = await response.json()
    console.log('Auth Response:', JSON.stringify(data, null, 2))

    if (data.data?.access_token) {
      cachedAccessToken = data.data.access_token
      // Token valid for 24 hours
      tokenExpiryTime = Date.now() + (24 * 60 * 60 * 1000)
      return cachedAccessToken
    }

    return null
  } catch (error) {
    console.error('Auth Error:', error)
    return null
  }
}

/**
 * Fetch GST details from Sandbox.co.in API
 */
async function fetchFromSandboxApi(gstin: string): Promise<GstLookupResult> {
  console.log(`Fetching GST details for: ${gstin}`)

  try {
    // Step 1: Get access token
    const accessToken = await getAccessToken()
    if (!accessToken) {
      return {
        success: false,
        error: 'Failed to authenticate with GST API. Please check credentials.',
        errorCode: 'API_ERROR'
      }
    }

    // Step 2: Fetch GST details using the token
    const response = await fetch(SANDBOX_GST_URL, {
      method: 'POST',
      headers: {
        'Authorization': accessToken,
        'x-api-key': SANDBOX_API_KEY,
        'x-api-version': '1.0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        gstin: gstin
      })
    })

    console.log(`API Response Status: ${response.status}`)

    if (response.status === 404) {
      return {
        success: false,
        error: 'GSTIN not found in GST portal',
        errorCode: 'NOT_FOUND'
      }
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'API rate limit exceeded. Please try again later.',
        errorCode: 'RATE_LIMITED'
      }
    }

    if (response.status === 401 || response.status === 403) {
      console.error('API Authentication failed')
      return {
        success: false,
        error: 'API authentication failed. Please check credentials.',
        errorCode: 'API_ERROR'
      }
    }

    const responseData = await response.json()
    console.log('API Response:', JSON.stringify(responseData, null, 2))

    if (!response.ok) {
      return {
        success: false,
        error: responseData.message || responseData.error || `API returned ${response.status}`,
        errorCode: 'API_ERROR'
      }
    }

    // Check if API returned an error in the body
    if (responseData.code && responseData.code !== 200) {
      return {
        success: false,
        error: responseData.message || 'Failed to fetch GST details',
        errorCode: responseData.code === 404 ? 'NOT_FOUND' : 'API_ERROR'
      }
    }

    // Map Sandbox API response to our format
    // Handle double-nested data structure: { data: { data: {...} } }
    const actualData = responseData.data?.data || responseData.data || responseData
    const data = mapSandboxResponse(actualData)

    return { success: true, data }

  } catch (error) {
    console.error('GST API Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to fetch GST details. Please try again.',
      errorCode: 'API_ERROR'
    }
  }
}

/**
 * Map Sandbox.co.in API response to our format
 * Sandbox response fields: gstin, lgnm (legal name), tradeNam, sts (status),
 * rgdt (registration date), ctb (constitution), pradr (principal address)
 */
function mapSandboxResponse(apiData: any): GstLookupData {
  // Handle principal address - Sandbox uses 'pradr' with nested 'addr' object
  const pradr = apiData.pradr || {}
  const addr = pradr.addr || pradr || {}

  // Build address line 1 from building details
  const addressLine1Parts = [
    addr.bno,      // Building number
    addr.bnm,      // Building name
    addr.flno,     // Floor number
  ].filter(Boolean)

  // Build address line 2 from street/locality
  const addressLine2Parts = [
    addr.st,       // Street
    addr.loc,      // Locality
    addr.city,     // City (sometimes in addr)
  ].filter(Boolean)

  // Get state name from code or use the one in response
  const stateCode = apiData.gstin?.substring(0, 2) || addr.stcd
  const stateName = addr.state || INDIAN_STATE_CODES[stateCode] || addr.stcd

  // Determine GST status - check multiple possible field names
  // If dealer type (dty) exists, the registration is likely active
  let gstStatus = apiData.sts || apiData.status || apiData.gstStatus
  if (!gstStatus && apiData.dty) {
    gstStatus = 'Active'  // If dealer type exists, assume active
  }
  if (!gstStatus && apiData.lgnm) {
    gstStatus = 'Active'  // If legal name exists in response, assume active
  }

  return {
    gstin: apiData.gstin,
    tradeName: apiData.tradeNam || apiData.tradeName,
    legalName: apiData.lgnm || apiData.legalName,
    gstStatus: gstStatus || 'Unknown',
    registrationDate: apiData.rgdt || apiData.registrationDate,
    businessType: apiData.ctb || apiData.dty || apiData.constitution || apiData.businessType,
    addressLine1: addressLine1Parts.join(', ') || undefined,
    addressLine2: addressLine2Parts.join(', ') || undefined,
    city: addr.dst || addr.city || addr.loc,  // dst = district, often used as city
    district: addr.dst,
    state: stateName,
    stateCode: stateCode,
    pincode: addr.pncd || addr.pincode,
    additionalAddresses: apiData.adadr || []
  }
}

export const setupGstHandlers = () => {
  const prisma = getPrisma()

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

  // Lookup GST details
  ipcMain.handle('gst:lookup', async (_, gstin: string, forceRefresh: boolean = false) => {
    try {
      // Step 1: Validate format first (saves API costs)
      const validation = validateGSTIN(gstin)
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          errorCode: 'INVALID_FORMAT'
        }
      }

      const normalizedGstin = gstin.toUpperCase().replace(/\s/g, '')

      // Step 2: Check cache if not forcing refresh
      if (!forceRefresh) {
        const cached = await prisma.gstCache.findUnique({
          where: { gstin: normalizedGstin }
        })

        if (cached && !isCacheExpired(cached.fetchedAt)) {
          const data: GstLookupData = {
            gstin: cached.gstin,
            tradeName: cached.tradeName || undefined,
            legalName: cached.legalName || undefined,
            gstStatus: cached.gstStatus || undefined,
            registrationDate: cached.registrationDate || undefined,
            businessType: cached.businessType || undefined,
            addressLine1: cached.addressLine1 || undefined,
            addressLine2: cached.addressLine2 || undefined,
            city: cached.city || undefined,
            district: cached.district || undefined,
            state: cached.state || undefined,
            stateCode: cached.stateCode || undefined,
            pincode: cached.pincode || undefined,
            additionalAddresses: cached.additionalAddresses
              ? (() => { try { return JSON.parse(cached.additionalAddresses) } catch { return undefined } })()
              : undefined
          }

          const result: GstLookupResult = {
            success: true,
            data,
            fromCache: true
          }

          // Add warning if GST is cancelled
          if (data.gstStatus === 'Cancelled' || data.gstStatus === 'Inactive') {
            result.warning = 'This GSTIN has been cancelled'
            result.errorCode = 'CANCELLED'
          }

          return result
        }
      }

      // Step 3: Fetch from Sandbox API
      const apiResult = await fetchFromSandboxApi(normalizedGstin)

      if (!apiResult.success) {
        return apiResult
      }

      // Step 4: Cache the result
      if (apiResult.data) {
        await prisma.gstCache.upsert({
          where: { gstin: normalizedGstin },
          update: {
            tradeName: apiResult.data.tradeName,
            legalName: apiResult.data.legalName,
            gstStatus: apiResult.data.gstStatus,
            registrationDate: apiResult.data.registrationDate,
            businessType: apiResult.data.businessType,
            addressLine1: apiResult.data.addressLine1,
            addressLine2: apiResult.data.addressLine2,
            city: apiResult.data.city,
            district: apiResult.data.district,
            state: apiResult.data.state,
            stateCode: apiResult.data.stateCode,
            pincode: apiResult.data.pincode,
            additionalAddresses: apiResult.data.additionalAddresses
              ? JSON.stringify(apiResult.data.additionalAddresses)
              : null,
            fetchedAt: new Date()
          },
          create: {
            gstin: normalizedGstin,
            tradeName: apiResult.data.tradeName,
            legalName: apiResult.data.legalName,
            gstStatus: apiResult.data.gstStatus,
            registrationDate: apiResult.data.registrationDate,
            businessType: apiResult.data.businessType,
            addressLine1: apiResult.data.addressLine1,
            addressLine2: apiResult.data.addressLine2,
            city: apiResult.data.city,
            district: apiResult.data.district,
            state: apiResult.data.state,
            stateCode: apiResult.data.stateCode,
            pincode: apiResult.data.pincode,
            additionalAddresses: apiResult.data.additionalAddresses
              ? JSON.stringify(apiResult.data.additionalAddresses)
              : null,
            fetchedAt: new Date()
          }
        })
      }

      // Step 5: Return result with warning if cancelled
      if (apiResult.data?.gstStatus === 'Cancelled' || apiResult.data?.gstStatus === 'Inactive') {
        return {
          ...apiResult,
          warning: 'This GSTIN has been cancelled',
          errorCode: 'CANCELLED' as const
        }
      }

      return apiResult

    } catch (error) {
      console.error('GST Lookup Error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to lookup GST details',
        errorCode: 'API_ERROR' as const
      }
    }
  })

  // Get cached GST data
  ipcMain.handle('gst:getCached', async (_, gstin: string) => {
    try {
      const normalizedGstin = gstin.toUpperCase().replace(/\s/g, '')
      const cached = await prisma.gstCache.findUnique({
        where: { gstin: normalizedGstin }
      })

      if (!cached) {
        return { success: false, error: 'Not found in cache' }
      }

      return { success: true, data: cached }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get cached data'
      }
    }
  })

  // Clear expired cache entries
  ipcMain.handle('gst:clearExpiredCache', async () => {
    try {
      const expiryDate = new Date(Date.now() - CACHE_TTL_MS)
      const result = await prisma.gstCache.deleteMany({
        where: {
          fetchedAt: { lt: expiryDate }
        }
      })

      return { success: true, data: { deleted: result.count } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear cache'
      }
    }
  })

  // Get state list
  ipcMain.handle('gst:getStateList', async () => {
    return { success: true, data: INDIAN_STATE_CODES }
  })
}
