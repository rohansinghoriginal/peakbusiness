import { 
  SheetAnalysis, 
  SheetImportPlan, 
  ImportPlan, 
  EntityType, 
  PlatformType, 
  DocumentType,
  RawRow,
  ImportMapping,
  ColumnCluster
} from '../types'
import { normalizeRow } from '../normalization'
import { deterministicMappingForEntity } from '../mapping'

/**
 * Get the target database table for an entity type
 */
export function getTargetTable(entityType: EntityType): string {
  const tableMap: Record<EntityType, string> = {
    orders: 'business_orders',
    returns: 'business_orders',
    settlement: 'sales_import_batches',
    skus: 'skus',
    materials: 'materials',
    borrowings: 'borrowings',
    purchases: 'material_purchases',
    expenses: 'business_expenses',
    suppliers: 'suppliers',
    sku_materials: 'sku_materials',
    material_transactions: 'material_transactions',
    unknown: 'unknown',
  }
  return tableMap[entityType] || 'unknown'
}

/**
 * Compute union mapping for merged sheets
 * Takes headers from all sheets, computes union, runs deterministic mapping on union
 */
export function computeUnionMapping(
  sheets: { headers: string[]; entityType: EntityType }[]
): { unionHeaders: string[]; unionMapping: ImportMapping } {
  // Collect all unique headers across sheets
  const headerSet = new Set<string>()
  for (const sheet of sheets) {
    for (const h of sheet.headers) headerSet.add(h)
  }
  
  // Use the first sheet's entity type for mapping (they should be same for mergeable)
  const entityType = sheets[0]?.entityType || 'orders'
  const unionHeaders = Array.from(headerSet)
  const unionMapping = deterministicMappingForEntity(unionHeaders, entityType)
  
  return { unionHeaders, unionMapping }
}

/**
 * Merge rows from multiple sheets using union mapping
 */
export function mergeSheetsWithUnion(
  sheets: { 
    name: string; 
    rows: RawRow[]; 
    headers: string[]; 
    entityType: EntityType 
  }[],
  unionHeaders: string[],
  unionMapping: ImportMapping,
  platform: string,
): { rows: RawRow[]; normalizedRows: RawRow[] } {
  // Map each sheet's rows to union headers
  const allRows: RawRow[] = []
  
  for (const sheet of sheets) {
    // Create a mapping from sheet's headers to union headers
    const headerMap = new Map<string, string>()
    for (const h of sheet.headers) {
      if (unionHeaders.includes(h)) {
        headerMap.set(h, h)
      }
    }
    
    for (const row of sheet.rows) {
      const unionRow: RawRow = {}
      for (const [canonicalField, sourceCol] of Object.entries(unionMapping)) {
        if (!sourceCol) continue
        // Find the value in the original row
        const value = row[sourceCol]
        if (value !== undefined) {
          unionRow[canonicalField] = value
        }
      }
      // Add source sheet tracking
      unionRow['_sourceSheet'] = sheet.name
      allRows.push(unionRow)
    }
  }
  
  // Normalize all merged rows
  const normalizedRows = allRows.map(row => normalizeRow(row, unionMapping, sheets[0].entityType))
  
  return { rows: allRows, normalizedRows }
}

/**
 * Check if sheets are merge-compatible (same entity, same platform, ≥70% column overlap)
 */
export function areSheetsMergeable(
  primary: SheetAnalysis,
  candidate: SheetAnalysis,
): boolean {
  if (primary.entityType !== candidate.entityType) return false
  if (primary.platform !== candidate.platform) return false
  
  const overlap = primary.headers.filter(h => 
    candidate.headers.some(ch => ch.toLowerCase() === h.toLowerCase())
  ).length
  const similarity = overlap / Math.max(primary.headers.length, candidate.headers.length)
  
  return similarity >= 0.7 && candidate.rowCount > 0
}

/**
 * Detect cross-sheet relationships (Orders + Returns, Orders + Settlement)
 */
export function detectCrossSheetRelationships(analyses: SheetAnalysis[]): SheetAnalysis[] {
  const returnsSheets = analyses.filter(a => a.isReturnsSheet)
  const ordersSheets = analyses.filter(a => a.isOrdersSheet)
  const settlementSheets = analyses.filter(a => a.isSettlementSheet)
  
  // Link returns to orders
  for (const returns of returnsSheets) {
    let bestMatch: SheetAnalysis | null = null
    let bestScore = 0
    
    for (const orders of ordersSheets) {
      let matchScore = 0
      if (returns.platform && orders.platform && returns.platform === orders.platform) matchScore += 50
      
      const overlap = returns.headers.filter(h => 
        orders.headers.some(oh => oh.toLowerCase() === h.toLowerCase())
      ).length
      matchScore += overlap * 5
      
      const ordersName = orders.name.toLowerCase()
      const returnsName = returns.name.toLowerCase()
      if (ordersName.includes(returnsName.replace('return', '').replace('rto', '').trim()) ||
          returnsName.includes(ordersName.replace('order', '').replace('sale', '').trim())) {
        matchScore += 30
      }
      
      if (matchScore > bestScore) {
        bestScore = matchScore
        bestMatch = orders
      }
    }
    
    if (bestMatch && bestScore > 30) {
      returns.relatedSheetNames = [bestMatch.name]
      bestMatch.relatedSheetNames.push(returns.name)
    }
  }
  
  // Link settlement to orders
  for (const settlement of settlementSheets) {
    let bestMatch: SheetAnalysis | null = null
    let bestScore = 0
    
    for (const orders of ordersSheets) {
      let matchScore = 0
      if (settlement.platform && orders.platform && settlement.platform === orders.platform) matchScore += 40
      
      const overlap = settlement.headers.filter(h => 
        orders.headers.some(oh => oh.toLowerCase() === h.toLowerCase())
      ).length
      matchScore += overlap * 3
      
      if (matchScore > bestScore) {
        bestScore = matchScore
        bestMatch = orders
      }
    }
    
    if (bestMatch && bestScore > 20) {
      settlement.relatedSheetNames = [bestMatch.name]
      bestMatch.relatedSheetNames.push(settlement.name)
    }
  }
  
  return analyses
}

/**
 * Create import plan from workbook analyses
 * Priority: orders > returns > settlement > skus > materials > borrowings > purchases > expenses > suppliers > sku_materials > material_transactions
 */
export function createImportPlan(
  analyses: SheetAnalysis[],
  userPlatformOverride?: PlatformType,
): ImportPlan {
  const warnings: string[] = []
  
  // Filter out zero-score sheets and sort by score
  const validAnalyses = analyses
    .filter(a => a.score > 0)
    .sort((a, b) => b.score - a.score)
  
  if (!validAnalyses.length) {
    return { sheets: [], warnings: ['No readable data sheets found in workbook'] }
  }
  
  // Detect cross-sheet relationships
  detectCrossSheetRelationships(validAnalyses)
  
  const entityPriority: EntityType[] = [
    'orders', 'returns', 'settlement', 'skus', 'materials', 
    'borrowings', 'purchases', 'expenses', 'suppliers', 
    'sku_materials', 'material_transactions'
  ]
  
  const sheets: SheetImportPlan[] = []
  const usedSheetNames = new Set<string>()
  
  for (const entityType of entityPriority) {
    const entitySheets = validAnalyses.filter(a => a.entityType === entityType && !usedSheetNames.has(a.name))
    if (entitySheets.length === 0) continue
    
    // Group by platform
    const byPlatform = new Map<PlatformType, SheetAnalysis[]>()
    for (const a of entitySheets) {
      const platform = userPlatformOverride || a.platform || 'Offline'
      if (!byPlatform.has(platform)) byPlatform.set(platform, [])
      byPlatform.get(platform)!.push(a)
    }
    
    for (const [platform, platformSheets] of byPlatform.entries()) {
      // Sort by entityConfidence desc, then score desc
      platformSheets.sort((a, b) => b.entityConfidence - a.entityConfidence || b.score - a.score)
      
      // Mergeable entities
      const mergeableEntities = ['orders', 'returns', 'settlement', 'skus', 'materials']
      const shouldMerge = mergeableEntities.includes(entityType)
      
      if (shouldMerge && platformSheets.length > 1) {
        const primary = platformSheets[0]
        const mergeable: SheetAnalysis[] = []
        
        for (let i = 1; i < platformSheets.length; i++) {
          if (areSheetsMergeable(primary, platformSheets[i])) {
            mergeable.push(platformSheets[i])
          }
        }
        
        if (mergeable.length > 0) {
          // Compute union mapping
          const mergeSheets = [primary, ...mergeable].map(s => ({
            name: s.name,
            headers: s.headers,
            entityType: s.entityType,
          }))
          const { unionHeaders, unionMapping } = computeUnionMapping(mergeSheets)
          
          // Merge rows
          const mergeData = [primary, ...mergeable].map(s => ({
            name: s.name,
            rows: s.rows,
            headers: s.headers,
            entityType: s.entityType,
          }))
          const { rows: mergedRows, normalizedRows } = mergeSheetsWithUnion(
            mergeData, unionHeaders, unionMapping, platform
          )
          
          sheets.push({
            sheetName: [primary, ...mergeable].map(s => s.name).join(' + '),
            platform,
            docType: primary.docType || 'GENERIC_ORDER_DATA',
            docTypeName: primary.docTypeName,
            rows: mergedRows,
            headers: unionHeaders,
            mapping: unionMapping,
            rowCount: mergedRows.length,
            confidence: primary.confidence,
            isPrimary: true,
            mergeWith: mergeable.map(s => s.name),
            relationship: entityType === 'orders' ? 'orders' : entityType === 'returns' ? 'returns' : entityType === 'settlement' ? 'settlement' : 'standalone',
            entityType,
            entityConfidence: primary.entityConfidence,
            targetTable: getTargetTable(entityType),
            normalizedRows,
          })
          
          warnings.push(`Merged ${mergeable.length} additional sheet(s) with "${primary.name}" for ${entityType} (union mapping)`)
          
          for (const s of [primary, ...mergeable]) usedSheetNames.add(s.name)
          continue
        }
      }
      
      // Handle individually
      for (const sheet of platformSheets) {
        if (usedSheetNames.has(sheet.name)) continue
        
        // Check if sheet has per-row platform values
        const usePerRowPlatform = sheet.platformColumn !== undefined && 
                                  sheet.platformColumn !== null && 
                                  sheet.platformValues && sheet.platformValues.length > 0
        
        const normalizedRows = sheet.rows.map((row, idx) => {
          const rowPlatform = (sheet.platformValues?.[idx] || platform) as PlatformType | undefined
          return normalizeRow(row, sheet.mapping, entityType, rowPlatform)
        })
        
        sheets.push({
          sheetName: sheet.name,
          platform,
          docType: sheet.docType || 'GENERIC_ORDER_DATA',
          docTypeName: sheet.docTypeName,
          rows: sheet.rows,
          headers: sheet.headers,
          mapping: sheet.mapping,
          rowCount: sheet.rowCount,
          confidence: sheet.confidence,
          isPrimary: sheets.filter(s => s.entityType === entityType).length === 0,
          mergeWith: [],
          relationship: entityType === 'orders' ? 'orders' : entityType === 'returns' ? 'returns' : entityType === 'settlement' ? 'settlement' : 'standalone',
          entityType,
          entityConfidence: sheet.entityConfidence,
          targetTable: getTargetTable(entityType),
          normalizedRows,
          // Per-row platform support
          platformColumn: sheet.platformColumn,
          platformValues: sheet.platformValues,
          usePerRowPlatform,
        })
        
        usedSheetNames.add(sheet.name)
      }
    }
  }
  
  // Handle remaining uncategorized sheets
  for (const analysis of validAnalyses) {
    if (usedSheetNames.has(analysis.name)) continue
    if (analysis.score < 25) continue
    
    const nameLower = analysis.name.toLowerCase()
    let inferredEntity: EntityType = 'unknown'
    if (nameLower.includes('sku') || nameLower.includes('product') || nameLower.includes('catalog')) inferredEntity = 'skus'
    else if (nameLower.includes('material') || nameLower.includes('raw') || nameLower.includes('rm ')) inferredEntity = 'materials'
    else if (nameLower.includes('borrow') || nameLower.includes('lend') || nameLower.includes('loan')) inferredEntity = 'borrowings'
    else if (nameLower.includes('purchase') || nameLower.includes('procure') || nameLower.includes('po ')) inferredEntity = 'purchases'
    else if (nameLower.includes('expense') || nameLower.includes('cost') || nameLower.includes('spend')) inferredEntity = 'expenses'
    else if (nameLower.includes('supplier') || nameLower.includes('vendor') || nameLower.includes('party')) inferredEntity = 'suppliers'
    else if (nameLower.includes('bom') || nameLower.includes('recipe') || nameLower.includes('consumption')) inferredEntity = 'sku_materials'
    else if (nameLower.includes('transaction') || nameLower.includes('movement') || nameLower.includes('ledger')) inferredEntity = 'material_transactions'
    else inferredEntity = 'orders'
    
    // Check for per-row platform in uncategorized sheets too
    const usePerRowPlatform = analysis.platformColumn !== undefined && 
                              analysis.platformColumn !== null && 
                              analysis.platformValues && analysis.platformValues.length > 0
    
    const normalizedRows = analysis.rows.map((row, idx) => {
      const rowPlatform = (analysis.platformValues?.[idx] || analysis.platform || 'Offline') as PlatformType | undefined
      return normalizeRow(row, analysis.mapping, inferredEntity, rowPlatform)
    })
    
    sheets.push({
      sheetName: analysis.name,
      platform: analysis.platform || 'Offline',
      docType: analysis.docType || 'GENERIC_ORDER_DATA',
      docTypeName: analysis.docTypeName,
      rows: analysis.rows,
      headers: analysis.headers,
      mapping: analysis.mapping,
      rowCount: analysis.rowCount,
      confidence: analysis.confidence,
      isPrimary: false,
      mergeWith: [],
      relationship: 'standalone',
      entityType: inferredEntity,
      entityConfidence: analysis.entityConfidence || 30,
      targetTable: getTargetTable(inferredEntity),
      normalizedRows,
    })
    
    warnings.push(`Sheet "${analysis.name}" auto-categorized as ${inferredEntity} (low confidence)`)
    usedSheetNames.add(analysis.name)
  }
  
  // Warn about ignored sheets
  for (const a of validAnalyses) {
    if (!usedSheetNames.has(a.name) && a.score > 10) {
      warnings.push(`Sheet "${a.name}" was not imported (low confidence or unclear structure)`)
    }
  }
  
  return { sheets, warnings }
}