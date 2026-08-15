import { EntityType, ImportMapping, RawRow, PlatformType } from '../types'
import { normalizeLocation } from './location'
import { normalizeCategory } from './category'
import { normalizeUnit } from './unit'
import { normalizeStatus } from './status'
import { normalizePlatform } from './platform'
import { cleanText, toTitleCase } from './utils'

/**
 * Fields that should NEVER be normalized (preserve as-is for PK/FK integrity)
 */
const ID_FIELDS = new Set([
  'orderId', 'lineKey', 'skuCode', 'materialCode', 'itemCode',
  'supplierId', 'materialId', 'skuId', 'counterparty', 'itemId',
  'invoiceNo', 'billNo', 'poNumber', 'reference', 'batch', 'fsn', 'asin',
])

/**
 * Explicit allowlist of normalizable fields PER ENTITY TYPE
 * This replaces the heuristic `includes('name')` approach
 */
const NORMALIZABLE_BY_ENTITY: Record<EntityType, Record<string, 'name' | 'location' | 'category' | 'unit' | 'status' | 'platform' | 'text'>> = {
  orders: {
    productName: 'name',
    customerLocation: 'location',
    status: 'status',
    platform: 'platform',
  },
  returns: {
    productName: 'name',
    customerLocation: 'location',
    status: 'status',
    platform: 'platform',
    returnReason: 'text',  // free text - only clean
  },
  settlement: {
    productName: 'name',
    status: 'status',
    platform: 'platform',
  },
  skus: {
    productName: 'name',
    category: 'category',
    platform: 'platform',
    status: 'status',
  },
  materials: {
    materialName: 'name',
    category: 'category',
    unit: 'unit',
    preferredVendor: 'name',
  },
  borrowings: {
    counterparty: 'name',
    itemName: 'name',
    itemType: 'category',
    settlementStatus: 'status',
    direction: 'status',
  },
  purchases: {
    materialId: 'name',  // actually material code - but normalized as name for display
    unit: 'unit',
    supplierId: 'name',
    gstRate: 'text',
  },
  expenses: {
    category: 'category',
    description: 'text',
    platform: 'platform',
  },
  suppliers: {
    supplierName: 'name',
    address: 'location',
    gstin: 'text',
    phone: 'text',
    email: 'text',
  },
  sku_materials: {
    // No normalizable fields - IDs and quantities only
  },
  material_transactions: {
    materialId: 'name',
    txnType: 'status',
    reference: 'text',
    source: 'text',
  },
  unknown: {},
}

/**
 * Normalize a text value based on semantic type
 * PRESERVES IDs exactly as-is
 */
export function normalizeFieldValue(
  canonicalField: string,
  value: unknown,
  entityType: EntityType,
  platform?: PlatformType
): unknown {
  if (value === null || value === undefined || value === '') return value

  // NEVER normalize ID fields - preserve exact values for PK/FK integrity
  if (ID_FIELDS.has(canonicalField)) {
    return String(value).trim()
  }

  const str = String(value).trim()
  if (!str) return value

  // Check explicit allowlist for this entity type
  const entityRules = NORMALIZABLE_BY_ENTITY[entityType] || {}
  const rule = entityRules[canonicalField]

  if (!rule) {
    // Not in allowlist - check if it's a free-text field (long, no ID pattern)
    const isFreeText = str.length > 50 && !/^[A-Z0-9]{3,}[\-_]/.test(str) && !/^\d{6,}$/.test(str)
    if (isFreeText) {
      return cleanText(str)
    }
    return str  // pass through unchanged
  }

  // Apply semantic normalization
  switch (rule) {
    case 'name':
      return toTitleCase(str)
    case 'location':
      return normalizeLocation(str, platform)
    case 'category':
      return normalizeCategory(str)
    case 'unit':
      return normalizeUnit(str)
    case 'status':
      return normalizeStatus(str)
    case 'platform':
      return normalizePlatform(str)
    case 'text':
      return cleanText(str)
    default:
      return cleanText(str)
  }
}

/**
 * Normalize all fields in a row based on entity type
 */
export function normalizeRow(
  row: RawRow,
  mapping: ImportMapping,
  entityType: EntityType,
  platform?: PlatformType
): RawRow {
  const normalizedRow: RawRow = {}
  
  for (const [canonicalField, sourceColumn] of Object.entries(mapping)) {
    if (!sourceColumn) continue
    const value = row[sourceColumn]
    if (value === undefined) continue
    
    // Normalize the value
    normalizedRow[canonicalField] = normalizeFieldValue(canonicalField, value, entityType, platform)
  }
  
  // Also pass through any unmapped fields that might be IDs
  for (const [sourceColumn, value] of Object.entries(row)) {
    const isMapped = Object.values(mapping).includes(sourceColumn)
    const normalizedKey = sourceColumn.toLowerCase().replace(/[^a-z]/g, '')
    if (!isMapped && ID_FIELDS.has(normalizedKey)) {
      normalizedRow[sourceColumn] = String(value).trim()
    }
  }
  
  return normalizedRow
}