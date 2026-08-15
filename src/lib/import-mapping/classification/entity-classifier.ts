import { 
  EntityType, 
  PlatformType, 
  SheetAnalysis, 
  ColumnCluster,
  RawRow 
} from '../types'
import { entityFieldAliases } from '../aliases'
import { normalized } from '../utils/normalized'

/**
 * Score a single entity type against headers and sample data
 */
function scoreEntity(
  entityType: EntityType,
  normHeaders: string[],
  nameLower: string,
  allText: string,
  sampleRows: RawRow[],
  headers: string[]
): number {
  const aliases = entityFieldAliases[entityType]
  if (!aliases || Object.keys(aliases).length === 0) return 0

  let fieldHits = 0
  let totalFields = 0
  for (const [field, fieldAliases] of Object.entries(aliases)) {
    totalFields++
    const hasMatch = normHeaders.some(h => 
      fieldAliases.some(alias => h.includes(normalized(alias)) || normalized(alias).includes(h))
    )
    if (hasMatch) fieldHits++
  }

  // Base score from field matches
  let score = totalFields > 0 ? Math.round((fieldHits / totalFields) * 70) : 0

  // Sheet name bonuses
  const nameKeywords: Record<EntityType, string[]> = {
    orders: ['order', 'sale', 'sales', 'transaction', 'transactions', 'invoice', 'invoices', 'ledger', 'register', 'book', 'data', 'raw'],
    returns: ['return', 'rto', 'refund', 'reversal', 'cancel', 'cancelled', 'returned'],
    settlement: ['settlement', 'payout', 'disbursement', 'payment', 'reconciliation', 'net amount', 'fee', 'commission'],
    skus: ['sku', 'product', 'catalog', 'master', 'item', 'listing', 'inventory'],
    materials: ['material', 'raw', 'rm ', 'packaging', 'consumable'],
    borrowings: ['borrow', 'lend', 'loan', 'borrowed', 'lent', 'counterparty', 'party'],
    purchases: ['purchase', 'procurement', 'buy', 'invoice', 'po', 'purchase order', 'supplier invoice'],
    expenses: ['expense', 'expenditure', 'cost', 'spending', 'opex', 'operating'],
    suppliers: ['supplier', 'vendor', 'party master', 'supplier list', 'vendor list'],
    sku_materials: ['bom', 'bill of material', 'recipe', 'sku material', 'material mapping', 'consumption'],
    material_transactions: ['material transaction', 'stock movement', 'material ledger', 'rm transaction', 'material txn'],
    unknown: [],
  }

  const keywords = nameKeywords[entityType] || []
  for (const kw of keywords) {
    if (nameLower.includes(kw)) score += 15
  }

  // Data pattern bonuses
  if (sampleRows.length > 0) {
    const sampleValues = sampleRows.slice(0, 5).flatMap((r) => Object.values(r).map((v) => String(v ?? '')))
    const hasDateLike = sampleValues.some((v) => /\d{4}[\/-]\d{2}[\/-]\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4}/.test(v))
    const hasPriceLike = sampleValues.some((v) => /^[₹$€£]?\s?\d+([.,]\d+)?$/.test(v.trim()))
    const hasIdLike = sampleValues.some((v) => /^[A-Z0-9]{3,}[\-_]/.test(v) || /^\d{6,}$/.test(v) || /^#?\d{4,}$/.test(v))
    const hasQtyLike = sampleValues.some((v) => /^\d+(\.\d+)?$/.test(v.trim()) && Number(v) < 10000)

    if (entityType === 'orders' || entityType === 'returns' || entityType === 'settlement') {
      if (hasDateLike) score += 5
      if (hasPriceLike) score += 5
      if (hasIdLike) score += 5
    }
    if (entityType === 'skus' || entityType === 'materials') {
      if (hasIdLike) score += 10
      if (hasQtyLike) score += 5
    }
    if (entityType === 'borrowings') {
      if (hasDateLike) score += 5
      if (hasIdLike) score += 5
    }
    if (entityType === 'purchases') {
      if (hasDateLike) score += 5
      if (hasPriceLike) score += 5
      if (hasIdLike) score += 5
    }
    if (entityType === 'expenses') {
      if (hasDateLike) score += 5
      if (hasPriceLike) score += 5
    }
    if (entityType === 'suppliers') {
      if (hasIdLike) score += 5
    }
    if (entityType === 'sku_materials') {
      if (hasQtyLike) score += 5
    }
    if (entityType === 'material_transactions') {
      if (hasDateLike) score += 5
      if (hasQtyLike) score += 5
    }
  }

  // Column count penalty/bonus
  if (headers.length < 3) score = Math.max(score - 20, 0)
  if (headers.length >= 5 && headers.length <= 20) score += 5

  return Math.min(score, 100)
}

/**
 * Detect if sheet has mixed entity types by clustering columns
 */
export function detectColumnClusters(
  headers: string[],
  sampleRows: RawRow[],
  sheetName: string
): ColumnCluster[] {
  const normHeaders = headers.map(normalized)
  const nameLower = sheetName.toLowerCase()
  const allText = [
    nameLower,
    headers.join(' ').toLowerCase(),
    sampleRows.map((r) => Object.values(r).join(' ')).join(' ').toLowerCase(),
  ].join(' ')

  // Score each entity type
  const scores: Record<EntityType, number> = {
    orders: 0, returns: 0, settlement: 0, skus: 0, materials: 0,
    borrowings: 0, purchases: 0, expenses: 0, suppliers: 0,
    sku_materials: 0, material_transactions: 0, unknown: 0,
  }

  for (const entityType of Object.keys(scores) as EntityType[]) {
    scores[entityType] = scoreEntity(entityType, normHeaders, nameLower, allText, sampleRows, headers)
  }

  // Find top scoring entity types (above threshold)
  const threshold = 30
  const topEntities = Object.entries(scores)
    .filter(([, score]) => score >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([entityType]) => entityType as EntityType)

  if (topEntities.length <= 1) {
    // Single dominant entity type
    return [{
      entityType: topEntities[0] || 'unknown',
      confidence: scores[topEntities[0] || 'unknown'],
      columnIndices: headers.map((_, i) => i),
      headers: [...headers],
    }]
  }

  // Multiple entity types detected - cluster columns by which entity they match best
  const clusters: ColumnCluster[] = []
  const usedIndices = new Set<number>()

  for (const entityType of topEntities) {
    const aliases = entityFieldAliases[entityType]
    const matchingIndices: number[] = []
    const matchingHeaders: string[] = []

    for (let i = 0; i < headers.length; i++) {
      if (usedIndices.has(i)) continue
      const header = normHeaders[i]
      const hasMatch = Object.values(aliases).some(fieldAliases =>
        fieldAliases.some(alias => header.includes(normalized(alias)) || normalized(alias).includes(header))
      )
      if (hasMatch) {
        matchingIndices.push(i)
        matchingHeaders.push(headers[i])
      }
    }

    if (matchingIndices.length > 0) {
      clusters.push({
        entityType,
        confidence: scores[entityType],
        columnIndices: matchingIndices,
        headers: matchingHeaders,
      })
      matchingIndices.forEach(i => usedIndices.add(i))
    }
  }

  // Remaining unmatched columns go to top entity
  const remainingIndices = headers.map((_, i) => i).filter(i => !usedIndices.has(i))
  if (remainingIndices.length > 0 && clusters.length > 0) {
    clusters[0].columnIndices.push(...remainingIndices)
    clusters[0].headers.push(...remainingIndices.map(i => headers[i]))
  }

  return clusters
}

/**
 * Classify a sheet into an entity type with confidence score.
 * Now supports multi-entity sheets via column clustering.
 */
export function classifySheetEntity(
  headers: string[],
  sampleRows: RawRow[],
  sheetName = ''
): { entityType: EntityType; entityConfidence: number; scores: Record<EntityType, number>; clusters: ColumnCluster[] } {
  const normHeaders = headers.map(normalized)
  const nameLower = sheetName.toLowerCase()
  const allText = [
    nameLower,
    headers.join(' ').toLowerCase(),
    sampleRows.map((r) => Object.values(r).join(' ')).join(' ').toLowerCase(),
  ].join(' ')

  const scores: Record<EntityType, number> = {
    orders: 0, returns: 0, settlement: 0, skus: 0, materials: 0,
    borrowings: 0, purchases: 0, expenses: 0, suppliers: 0,
    sku_materials: 0, material_transactions: 0, unknown: 0,
  }

  for (const entityType of Object.keys(scores) as EntityType[]) {
    scores[entityType] = scoreEntity(entityType, normHeaders, nameLower, allText, sampleRows, headers)
  }

  // Detect column clusters for mixed sheets
  const clusters = detectColumnClusters(headers, sampleRows, sheetName)

  // Special handling: check for returns/settlement first (more specific)
  if (scores.returns > scores.orders && scores.returns >= 40) {
    scores.orders = Math.max(scores.orders - 10, 0)
  }
  if (scores.settlement > scores.orders && scores.settlement >= 40) {
    scores.orders = Math.max(scores.orders - 10, 0)
  }

  // Find top entity type
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  
  let entityType: EntityType = 'unknown'
  let confidence = 0
  
  if (top[1] >= 35) {
    entityType = top[0] as EntityType
    confidence = top[1]
  } else if (scores.orders >= 25) {
    entityType = 'orders'
    confidence = scores.orders
  } else if (scores.skus >= 25) {
    entityType = 'skus'
    confidence = scores.skus
  } else if (scores.materials >= 25) {
    entityType = 'materials'
    confidence = scores.materials
  }

  return { entityType, entityConfidence: confidence, scores, clusters }
}