import { PlatformType, RawRow } from '../types'
import { normalized } from '../utils/normalized'

// Platform-specific ID patterns for content-based detection
const PLATFORM_ID_PATTERNS: Record<PlatformType, RegExp[]> = {
  Amazon: [
    /^\d{3}-\d{7}-\d{7}$/,           // Amazon Order ID: 123-1234567-1234567
    /^[A-Z0-9]{10}$/,                 // ASIN
    /^[A-Z]{2,}\d{6,}$/,              // Seller SKU patterns
  ],
  Meesho: [
    /^MSO\d+$/,                       // Meesho order ID
    /^SUB\d+$/,                       // Sub order
    /^MEE\d+$/i,                      // Meesho prefix
  ],
  Flipkart: [
    /^FSN\d+$/i,                      // FSN
    /^OD\d+$/i,                       // Order ID
    /^FK[A-Z0-9]+$/i,                 // Flipkart prefixes
  ],
  Shopify: [
    /^#?\d{4,}$/,                     // Shopify order numbers
    /^[A-Z0-9]{8,}-[A-Z0-9]{4,}$/i,   // Shopify line item IDs
  ],
  Offline: [],
}

const PLATFORM_HEADER_SIGNATURES: Record<PlatformType, string[][]> = {
  Amazon: [
    ['amazon order id'], ['asin'], ['seller sku'], ['easy ship'], ['fba'],
    ['principal amount'], ['item status'], ['ship city'],
  ],
  Meesho: [
    ['sub order no'], ['sub_order_no'], ['meesho price'], ['supplier discounted price'],
    ['return reason'], ['dispatch date'], ['customer state'],
  ],
  Flipkart: [
    ['order item id'], ['fsn'], ['flipkart status'], ['listing id'],
    ['final invoice amount'], ['service profile'], ['tier'],
  ],
  Shopify: [
    ['lineitem name'], ['lineitem sku'], ['financial status'], ['fulfillment status'],
    ['lineitem price'], ['lineitem quantity'], ['discount amount'],
  ],
  Offline: [
    ['gstin'], ['place of supply'], ['taxable value'], ['integrated tax'],
  ],
}

/**
 * Detect platform from header signatures (existing logic)
 */
function detectFromHeaders(headers: string[]): { platform: PlatformType; score: number } {
  const normHeaders = headers.map(normalized)
  let amazonScore = 0, meeshoScore = 0, flipkartScore = 0, shopifyScore = 0, gstScore = 0

  for (const [platform, signatures] of Object.entries(PLATFORM_HEADER_SIGNATURES)) {
    const p = platform as PlatformType
    for (const sig of signatures) {
      if (normHeaders.some(h => h.includes(normalized(sig[0])))) {
        if (p === 'Amazon') amazonScore += 10
        else if (p === 'Meesho') meeshoScore += 10
        else if (p === 'Flipkart') flipkartScore += 10
        else if (p === 'Shopify') shopifyScore += 10
        else gstScore += 10
      }
    }
  }

  const scores = [
    { platform: 'Amazon' as PlatformType, score: amazonScore },
    { platform: 'Meesho' as PlatformType, score: meeshoScore },
    { platform: 'Flipkart' as PlatformType, score: flipkartScore },
    { platform: 'Shopify' as PlatformType, score: shopifyScore },
    { platform: 'Offline' as PlatformType, score: gstScore },
  ]
  scores.sort((a, b) => b.score - a.score)
  return { platform: scores[0].platform, score: scores[0].score }
}

/**
 * Detect platform from column VALUES (content-based)
 * Checks if data in ID columns matches platform-specific patterns
 */
export function detectPlatformFromContent(
  headers: string[],
  sampleRows: RawRow[],
  idFieldNames = ['orderId', 'lineKey', 'skuCode']
): { platform: PlatformType; confidence: number } {
  // Find which columns are likely ID columns
  const normHeaders = headers.map(normalized)
  const idColumnIndices: number[] = []

  for (const idField of idFieldNames) {
    const idx = normHeaders.findIndex(h => {
      const aliases = ['order id', 'order_id', 'order number', 'order no', 'line item', 'sku', 'sku code', 'seller sku', 'asin', 'fsn', 'item id']
      return aliases.some(a => h.includes(normalized(a)))
    })
    if (idx >= 0) idColumnIndices.push(idx)
  }

  // If no ID columns found, check first few columns that look like IDs
  if (idColumnIndices.length === 0) {
    for (let i = 0; i < Math.min(5, headers.length); i++) {
      const sampleValues = sampleRows.slice(0, 10).map(r => String(Object.values(r)[i] ?? ''))
      const looksLikeId = sampleValues.some(v => 
        /^[A-Z0-9]{3,}[\-_]/.test(v) || /^\d{6,}$/.test(v) || /^#?\d{4,}$/.test(v)
      )
      if (looksLikeId) idColumnIndices.push(i)
    }
  }

  // Score platforms based on ID column values
  const platformScores: Record<PlatformType, number> = {
    Amazon: 0, Meesho: 0, Flipkart: 0, Shopify: 0, Offline: 0,
  }

  for (const colIdx of idColumnIndices) {
    const values = sampleRows.slice(0, 20).map(r => String(Object.values(r)[colIdx] ?? ''))
    
    for (const platform of Object.keys(platformScores) as PlatformType[]) {
      for (const pattern of PLATFORM_ID_PATTERNS[platform]) {
        const matches = values.filter(v => pattern.test(v)).length
        if (matches > 0) {
          platformScores[platform] += matches * 2
        }
      }
    }
  }

  const sorted = Object.entries(platformScores).sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  
  if (top[1] >= 3) {
    return { platform: top[0] as PlatformType, confidence: Math.min(top[1] * 5, 95) }
  }
  
  return { platform: 'Offline', confidence: 0 }
}

/**
 * Detect if there's a platform column in the headers and extract unique platform values
 */
export function detectPlatformColumn(
  headers: string[],
  sampleRows: RawRow[]
): { platformColumn: string | null; platformValues: string[] } {
  const normHeaders = headers.map(normalized)
  
  // Look for platform column by header name
  const platformAliases = ['platform', 'marketplace', 'channel', 'source', 'sales channel', 'platform name']
  let platformColumnIdx = -1
  
  for (let i = 0; i < normHeaders.length; i++) {
    const header = normHeaders[i]
    if (platformAliases.some(alias => header.includes(normalized(alias)))) {
      platformColumnIdx = i
      break
    }
  }
  
  if (platformColumnIdx === -1) {
    return { platformColumn: null, platformValues: [] }
  }
  
  const platformColumn = headers[platformColumnIdx]
  
  // Extract unique platform values from sample rows
  const platformValuesSet = new Set<string>()
  for (const row of sampleRows) {
    const value = String(Object.values(row)[platformColumnIdx] ?? '').trim()
    if (value) {
      // Normalize platform value to standard format
      const normalizedValue = normalizePlatformValue(value)
      platformValuesSet.add(normalizedValue)
    }
  }
  
  return { 
    platformColumn, 
    platformValues: Array.from(platformValuesSet) 
  }
}

/**
 * Normalize platform value to standard PlatformType
 */
export function normalizePlatformValue(value: string): PlatformType {
  const lower = value.toLowerCase().trim()
  
  // Direct matches
  if (lower === 'amazon' || lower === 'amzn' || lower === 'fba' || lower === 'easy ship') return 'Amazon'
  if (lower === 'meesho' || lower === 'fashnear') return 'Meesho'
  if (lower === 'flipkart' || lower === 'fk' || lower === 'ekart') return 'Flipkart'
  if (lower === 'shopify' || lower === 'myshopify') return 'Shopify'
  if (lower === 'offline' || lower === 'retail' || lower === 'store' || lower === 'wholesale' || lower === 'b2b') return 'Offline'
  if (lower === 'export') return 'Offline'
  
  // Default: title case
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() as PlatformType
}

/**
 * Get per-row platform values for all rows
 */
export function extractPerRowPlatforms(
  rows: RawRow[],
  platformColumn: string,
  defaultPlatform: PlatformType = 'Offline'
): PlatformType[] {
  const normHeaders = Object.keys(rows[0] || {}).map(normalized)
  const platformColIdx = Object.keys(rows[0] || {}).findIndex(h => normalized(h) === normalized(platformColumn))
  
  if (platformColIdx === -1) {
    return rows.map(() => defaultPlatform)
  }
  
  return rows.map(row => {
    const value = String(Object.values(row)[platformColIdx] ?? '').trim()
    if (!value) return defaultPlatform
    return normalizePlatformValue(value)
  })
}

/**
 * Combined platform detection: headers + content + text context
 */
export function detectPlatformFromSheet(
  headers: string[],
  sampleRows: RawRow[],
  sheetName = '',
  fileName = '',
  rawTextSnippet = ''
): { platform: PlatformType; confidence: number } {
  const allText = [
    sheetName.toLowerCase(),
    fileName.toLowerCase(),
    rawTextSnippet.toLowerCase(),
    headers.join(' ').toLowerCase(),
    sampleRows.map((r) => Object.values(r).join(' ')).join(' ').toLowerCase(),
  ].join(' ')

  // Text-based scoring (brand mentions)
  let amazonScore = 0, meeshoScore = 0, flipkartScore = 0, shopifyScore = 0
  if (allText.includes('amazon') || allText.includes('amzn') || allText.includes('fba') || allText.includes('easy ship') || allText.includes('merchant tax report') || allText.includes('mtr')) amazonScore += 30
  if (allText.includes('meesho') || allText.includes('fashnear') || allText.includes('supplier settlement') || allText.includes('sub order')) meeshoScore += 30
  if (allText.includes('flipkart') || allText.includes('fk') || allText.includes('ekart') || allText.includes('marketplace seller')) flipkartScore += 30
  if (allText.includes('shopify') || allText.includes('shopify_orders') || allText.includes('myshopify')) shopifyScore += 30

  // Header-based detection
  const headerResult = detectFromHeaders(headers)
  if (headerResult.platform === 'Amazon') amazonScore += headerResult.score
  else if (headerResult.platform === 'Meesho') meeshoScore += headerResult.score
  else if (headerResult.platform === 'Flipkart') flipkartScore += headerResult.score
  else if (headerResult.platform === 'Shopify') shopifyScore += headerResult.score
  else amazonScore += headerResult.score // GST adds to offline

  // Content-based detection (NEW)
  const contentResult = detectPlatformFromContent(headers, sampleRows)
  if (contentResult.confidence > 0) {
    if (contentResult.platform === 'Amazon') amazonScore += contentResult.confidence
    else if (contentResult.platform === 'Meesho') meeshoScore += contentResult.confidence
    else if (contentResult.platform === 'Flipkart') flipkartScore += contentResult.confidence
    else if (contentResult.platform === 'Shopify') shopifyScore += contentResult.confidence
  }

  const scores = [
    { platform: 'Amazon' as PlatformType, score: amazonScore },
    { platform: 'Meesho' as PlatformType, score: meeshoScore },
    { platform: 'Flipkart' as PlatformType, score: flipkartScore },
    { platform: 'Shopify' as PlatformType, score: shopifyScore },
  ]
  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  
  if (top.score >= 40) {
    return { platform: top.platform, confidence: Math.min(top.score + 10, 99) }
  }
  
  // If content-based detection found something but header/text didn't
  if (contentResult.confidence > 0) {
    return { platform: contentResult.platform, confidence: Math.min(contentResult.confidence + 20, 80) }
  }
  
  return { platform: 'Offline', confidence: 50 }
}