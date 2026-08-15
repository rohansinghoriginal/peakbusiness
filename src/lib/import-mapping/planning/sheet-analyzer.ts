import { 
  SheetAnalysis, 
  EntityType, 
  PlatformType, 
  DocumentType, 
  RawRow, 
  ImportMapping,
  ColumnCluster
} from '../types'
import * as XLSX from 'xlsx'
import { 
  classifySheetEntity, 
  detectColumnClusters 
} from '../classification'
import { 
  detectPlatformFromSheet,
  detectPlatformColumn,
  extractPerRowPlatforms
} from '../classification/platform-detector'
import { detectDocumentAndPlatform } from '../classification/doc-type-detector'
import { 
  deterministicMappingForEntity, 
  detectSheetType, 
  detectHeaderRow,
  scoreSheetForOrderData 
} from '../mapping'
import { normalizeRow } from '../normalization'
import { getTargetTable } from './import-planner'

/**
 * Extract sheet data from workbook
 */
export function extractSheetData(
  workbook: XLSX.WorkBook,
  sheetName: string,
): { headerRowIndex: number; headers: string[]; rows: RawRow[] } {
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) return { headerRowIndex: 0, headers: [], rows: [] }

  const raw2D = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  })

  if (!raw2D.length) return { headerRowIndex: 0, headers: [], rows: [] }

  const { headerRowIndex, headers, confidence } = detectHeaderRow(raw2D as unknown[][])

  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1')
  range.s.r = headerRowIndex
  const adjustedRef = XLSX.utils.encode_range(range)

  const tempSheet = { ...worksheet, '!ref': adjustedRef }
  const rawRows = XLSX.utils.sheet_to_json<RawRow>(tempSheet, {
    defval: '',
    raw: false,
  })

  const rows = serializeImportRows(rawRows)
  const actualHeaders = rows.length > 0 ? Object.keys(rows[0]) : headers

  return { headerRowIndex, headers: actualHeaders, rows }
}

/**
 * Analyze a single sheet comprehensively
 */
export function analyzeSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
): SheetAnalysis {
  const { headerRowIndex, headers, rows } = extractSheetData(workbook, sheetName)
  
  if (!headers.length || !rows.length) {
    return {
      name: sheetName,
      score: 0,
      headerRowIndex,
      headers,
      rows: [],
      platform: null,
      docType: null,
      docTypeName: 'Empty or unreadable sheet',
      isValidOrderDoc: false,
      validationSummary: 'No headers or data rows found',
      mapping: {},
      rowCount: 0,
      confidence: 0,
      entityType: 'unknown',
      entityConfidence: 0,
      isOrdersSheet: false,
      isReturnsSheet: false,
      isSettlementSheet: false,
      relatedSheetNames: [],
      columnClusters: [],
    }
  }

  const sampleRows = rows.slice(0, 10)
  const score = scoreSheetForOrderData(headers, sampleRows, sheetName)
  const { platform, confidence } = detectPlatformFromSheet(headers, sampleRows, sheetName)
  const { isOrders, isReturns, isSettlement } = detectSheetType(headers, sampleRows, sheetName)
  const { entityType, entityConfidence, scores, clusters } = classifySheetEntity(headers, sampleRows, sheetName)
  const mapping = deterministicMappingForEntity(headers, entityType)
  const detection = detectDocumentAndPlatform(headers, sampleRows, sheetName, '')
  
  // NEW: Detect platform column and extract per-row platforms
  const { platformColumn: detectedPlatformColumn, platformValues } = detectPlatformColumn(headers, sampleRows)
  const platformColumn = detectedPlatformColumn ?? undefined
  const usePerRowPlatform = platformColumn !== undefined && platformValues.length > 0
  const perRowPlatforms = usePerRowPlatform ? extractPerRowPlatforms(rows, platformColumn, platform) : undefined

  return {
    name: sheetName,
    score,
    headerRowIndex,
    headers,
    rows,
    platform,
    docType: detection.docType,
    docTypeName: detection.docTypeName,
    isValidOrderDoc: detection.isValidOrderDoc,
    validationSummary: detection.validationSummary,
    mapping,
    rowCount: rows.length,
    confidence,
    entityType,
    entityConfidence,
    isOrdersSheet: isOrders,
    isReturnsSheet: isReturns,
    isSettlementSheet: isSettlement,
    relatedSheetNames: [],
    columnClusters: clusters,
    platformColumn,
    platformValues,
  }
}

/**
 * Serialize import rows (convert dates to strings, etc.)
 */
export function serializeImportRows(rows: RawRow[]): RawRow[] {
  function pad(value: number) {
    return String(value).padStart(2, '0')
  }
  
  function fromExcelSerial(serial: number) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000)
    const date = new Date(utc)
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  }

  function importDate(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 20000 && value < 80000) return fromExcelSerial(value)
      const asDate = new Date(value)
      if (!Number.isNaN(asDate.getTime()) && value > 1e11) {
        return `${asDate.getFullYear()}-${pad(asDate.getMonth() + 1)}-${pad(asDate.getDate())}`
      }
    }
    const source = String(value ?? '').trim()
    if (!source) return new Date().toISOString().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}/.test(source)) return source.slice(0, 10)
    const indian = source.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s|$)/)
    if (indian) {
      return `${indian[3]}-${pad(Number(indian[2]))}-${pad(Number(indian[1]))}`
    }
    const parsed = new Date(source)
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
    }
    const asNumberDate = Number(source)
    if (Number.isFinite(asNumberDate) && asNumberDate > 20000 && asNumberDate < 80000) {
      return fromExcelSerial(asNumberDate)
    }
    return new Date().toISOString().slice(0, 10)
  }

  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        if (value instanceof Date) {
          return [key, `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`]
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null) {
          return [key, value]
        }
        return [key, String(value)]
      }),
    ),
  )
}