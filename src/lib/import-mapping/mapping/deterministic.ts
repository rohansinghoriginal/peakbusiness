import { 
  RawRow, 
  ImportMapping, 
  EntityType, 
  PlatformType 
} from '../types'
import { entityFieldAliases, fieldAliases } from '../aliases'
import { normalized } from '../utils/normalized'

/**
 * Entity-aware deterministic mapping using entity-specific field aliases.
 * Much faster than AI - uses local alias matching with entity context.
 */
export function deterministicMappingForEntity(
  headers: string[],
  entityType: EntityType = 'orders'
): ImportMapping {
  const aliases = entityFieldAliases[entityType] || fieldAliases
  const normalizedHeaders = headers.map((header) => ({ original: header, normalized: normalized(header) }))
  const mapping: ImportMapping = {}
  const used = new Set<string>()

  for (const [field, fieldAliasesList] of Object.entries(aliases)) {
    const exact = normalizedHeaders.find(
      (header) => !used.has(header.original) && fieldAliasesList.some((alias) => header.normalized === normalized(alias)),
    )
    const fuzzy =
      exact ||
      normalizedHeaders.find(
        (header) =>
          !used.has(header.original) && fieldAliasesList.some((alias) => header.normalized.includes(normalized(alias))),
      )
    if (fuzzy) {
      mapping[field] = fuzzy.original
      used.add(fuzzy.original)
    }
  }

  return mapping
}

/**
 * Legacy deterministic mapping for backward compatibility (orders only)
 */
export function deterministicMapping(headers: string[]): ImportMapping {
  return deterministicMappingForEntity(headers, 'orders')
}

/**
 * Score a sheet's headers + sample data on a 0-100 scale for how likely it
 * contains order / sales data.  Used to pick the best sheet in a multi-sheet
 * workbook.
 */
export function scoreSheetForOrderData(headers: string[], sampleRows: RawRow[], sheetName = ''): number {
  if (!headers.length) return 0

  const normHeaders = headers.map(normalized)

  // Penalty: sheets named like metadata / summary
  const skipPatterns = [
    'summary', 'config', 'notes', 'metadata', 'instructions', 'readme', 'help', 'settings', 'template',
    'cover', 'index', 'toc', 'legend', 'key', 'about', 'info', 'dashboard', 'report', 'pivot',
    'chart', 'graph', 'analysis', 'kpi', 'metrics', 'overview', 'master', 'settings', 'template'
  ]
  const nameNorm = normalized(sheetName)
  if (skipPatterns.some((p) => nameNorm === p || nameNorm.includes(p))) return 0

  // Count how many of our known field alias groups get a match
  const mapping = deterministicMapping(headers)
  let fieldHits = 0
  const criticalFields = ['orderId', 'lineKey', 'skuCode', 'productName', 'salePrice', 'orderDate', 'qtyOrdered', 'status']
  for (const field of criticalFields) {
    if (mapping[field]) fieldHits++
  }

  // At least orderId/lineKey AND (skuCode OR productName) to be useful
  const hasIdentifier = Boolean(mapping.orderId || mapping.lineKey)
  const hasProduct = Boolean(mapping.skuCode || mapping.productName)

  let score = fieldHits * 12 // up to ~96 for all 8 fields

  // Bonus for critical pair
  if (hasIdentifier && hasProduct) score += 10
  else if (!hasIdentifier && !hasProduct) score = Math.min(score, 15)

  // Bonus for reasonable row count
  if (sampleRows.length >= 2) score += 5
  if (sampleRows.length >= 5) score += 5
  if (sampleRows.length >= 20) score += 5

  // Penalty for very few columns (likely not a data sheet)
  if (headers.length < 3) score = Math.max(score - 30, 0)
  if (headers.length < 2) return 0

  // Bonus: sample data has values that look like order IDs, dates, prices
  if (sampleRows.length > 0) {
    const sampleValues = sampleRows.slice(0, 5).flatMap((r) => Object.values(r).map((v) => String(v ?? '')))
    const hasDateLike = sampleValues.some((v) => /\d{4}[\/-]\d{2}[\/-]\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4}/.test(v))
    const hasPriceLike = sampleValues.some((v) => /^[₹$€£]?\s?\d+([.,]\d+)?$/.test(v.trim()))
    const hasIdLike = sampleValues.some((v) => /^[A-Z0-9]{3,}[\-_]/.test(v) || /^\d{6,}$/.test(v) || /^#?\d{4,}$/.test(v))
    if (hasDateLike) score += 5
    if (hasPriceLike) score += 5
    if (hasIdLike) score += 5
  }

  // Sheet name bonuses for common order sheet names
  const nameLower = sheetName.toLowerCase()
  const orderSheetNames = ['order', 'sale', 'sales', 'transaction', 'transactions', 'invoice', 'invoices', 'data', 'raw', 'ledger', 'register', 'book']
  const returnSheetNames = ['return', 'rto', 'refund', 'reversal', 'cancel', 'cancelled']
  const settlementSheetNames = ['settlement', 'payout', 'disbursement', 'payment', 'reconciliation']
  
  if (orderSheetNames.some(n => nameLower.includes(n))) score += 15
  if (returnSheetNames.some(n => nameLower.includes(n))) score += 10
  if (settlementSheetNames.some(n => nameLower.includes(n))) score += 8

  return Math.min(score, 100)
}

/**
 * Detect sheet type (orders, returns, settlement)
 */
export function detectSheetType(headers: string[], sampleRows: RawRow[], sheetName = ''): { isOrders: boolean; isReturns: boolean; isSettlement: boolean } {
  const normHeaders = headers.map(normalized)
  const allText = [
    sheetName.toLowerCase(),
    headers.join(' ').toLowerCase(),
    sampleRows.map((r) => Object.values(r).join(' ')).join(' ').toLowerCase(),
  ].join(' ')

  const isReturns = normHeaders.some(h => 
    h.includes('return') || h.includes('rto') || h.includes('refund') || h.includes('reversal') || h.includes('cancel')
  ) || allText.includes('return') || allText.includes('rto') || allText.includes('refund')
  
  const isSettlement = normHeaders.some(h => 
    h.includes('settlement') || h.includes('payout') || h.includes('disbursement') || h.includes('reconciliation') || 
    h.includes('net amount') || h.includes('total amount') || h.includes('fee') || h.includes('commission')
  ) || allText.includes('settlement') || allText.includes('payout') || allText.includes('disbursement')
  
  const isOrders = !isReturns && !isSettlement && (
    normHeaders.some(h => h.includes('order') || h.includes('sale') || h.includes('invoice') || h.includes('transaction')) ||
    normHeaders.some(h => h.includes('sku') || h.includes('product') || h.includes('item'))
  )

  return { isOrders, isReturns, isSettlement }
}

/**
 * Scan the first N rows of raw 2D sheet data to find the actual header row.
 * Handles title rows, blank rows, and logos/images at the top.
 * v2: Now detects and skips title/metadata rows
 */
export function detectHeaderRow(
  sheetArray: unknown[][],
  maxScanRows = 15,
): { headerRowIndex: number; headers: string[]; confidence: number } {
  let bestIndex = 0
  let bestScore = -1
  let bestHeaders: string[] = []
  let bestConfidence = 0

  const rowsToScan = Math.min(sheetArray.length, maxScanRows)
  
  // Patterns that indicate a title/metadata row (not a header)
  const titleRowPatterns = [
    /^(report|statement|summary|export|generated|created|date|page)\s*:/i,
    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/,  // standalone date
    /^page\s+\d+/i,
    /^(amazon|meesho|flipkart|shopify)\s+(sales|order|settlement|report)/i,
  ]

  for (let i = 0; i < rowsToScan; i++) {
    const row = sheetArray[i]
    if (!row || !Array.isArray(row)) continue

    const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean)
    if (cells.length < 2) continue // skip sparse rows (titles, logos, blank)

    // Skip obvious title/metadata rows
    const rowText = cells.join(' ').toLowerCase()
    const isTitleRow = titleRowPatterns.some(p => p.test(rowText))
    if (isTitleRow) continue

    // Score this row as a potential header:
    // - more non-empty text cells is better
    // - cells that are short text (< 50 chars) are more header-like
    // - cells that are purely numeric are data, not headers
    let rowScore = 0
    let textCells = 0
    for (const cell of cells) {
      const isNumeric = /^[\d.,₹$€£%\-+]+$/.test(cell)
      const isShortText = cell.length <= 50 && !isNumeric
      if (isShortText) {
        textCells++
        rowScore += 2
      } else if (isNumeric) {
        rowScore -= 1 // numeric cells penalize – likely data row
      } else {
        rowScore += 0.5 // longer text, mild bonus
      }
    }

    // Must have at least 2 text-like cells to be a header candidate
    if (textCells < 2) continue

    // Bonus for matching known field aliases
    const mapping = deterministicMapping(cells)
    const aliasHits = Object.values(mapping).filter(Boolean).length
    rowScore += aliasHits * 5

    // Slight preference for earlier rows (all else equal)
    rowScore -= i * 0.1

    // Confidence based on alias hits
    const confidence = Math.min(aliasHits * 15, 100)

    if (rowScore > bestScore) {
      bestScore = rowScore
      bestIndex = i
      bestHeaders = cells
      bestConfidence = confidence
    }
  }

  return { headerRowIndex: bestIndex, headers: bestHeaders, confidence: bestConfidence }
}