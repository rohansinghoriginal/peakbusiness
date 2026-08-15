import { asNumber } from '../business'

export type RawRow = Record<string, unknown>
export type ImportMapping = Record<string, string | undefined>

export type DocumentType =
  | 'AMAZON_SALES_REPORT'
  | 'MEESHO_ORDERS_REPORT'
  | 'FLIPKART_SALES_REPORT'
  | 'SHOPIFY_ORDERS_REPORT'
  | 'GST_TAX_INVOICE'
  | 'GENERIC_ORDER_DATA'
  | 'UNRECOGNIZED'

export interface DocumentAnalysis {
  docType: DocumentType
  docTypeName: string
  detectedPlatform: 'Amazon' | 'Meesho' | 'Flipkart' | 'Shopify' | 'Offline'
  confidence: number
  isValidOrderDoc: boolean
  validationSummary: string
  recommendedMapping: ImportMapping
  selectedSheet?: string
  sheetNames?: string[]
  headerRowIndex?: number
  aiMappingUsed?: boolean
  // NEW: Platform column detection
  platformColumn?: string
  platformValues?: string[]
}

export type PlatformType = 'Amazon' | 'Meesho' | 'Flipkart' | 'Shopify' | 'Offline'

export type EntityType = 
  | 'orders' 
  | 'returns' 
  | 'settlement'
  | 'skus' 
  | 'materials' 
  | 'borrowings' 
  | 'purchases' 
  | 'expenses' 
  | 'suppliers'
  | 'sku_materials'
  | 'material_transactions'
  | 'unknown'

export interface SheetAnalysis {
  name: string
  score: number
  headerRowIndex: number
  headers: string[]
  rows: RawRow[]
  platform: PlatformType | null
  docType: DocumentType | null
  docTypeName: string
  isValidOrderDoc: boolean
  validationSummary: string
  mapping: ImportMapping
  rowCount: number
  confidence: number
  entityType: EntityType
  entityConfidence: number
  isOrdersSheet: boolean
  isReturnsSheet: boolean
  isSettlementSheet: boolean
  relatedSheetNames: string[]
  columnClusters?: ColumnCluster[]
  // NEW: Platform column detection
  platformColumn?: string
  platformValues?: string[]
}

export interface ColumnCluster {
  entityType: EntityType
  confidence: number
  columnIndices: number[]
  headers: string[]
}

export interface ImportPlan {
  sheets: SheetImportPlan[]
  warnings: string[]
}

export interface SheetImportPlan {
  sheetName: string
  platform: PlatformType
  docType: DocumentType
  docTypeName: string
  rows: RawRow[]
  headers: string[]
  mapping: ImportMapping
  rowCount: number
  confidence: number
  isPrimary: boolean
  mergeWith: string[]
  relationship: 'orders' | 'returns' | 'settlement' | 'standalone'
  entityType: EntityType
  entityConfidence: number
  targetTable: string
  normalizedRows?: RawRow[]
  // NEW: Per-row platform support
  platformColumn?: string
  platformValues?: string[]
  usePerRowPlatform?: boolean
}