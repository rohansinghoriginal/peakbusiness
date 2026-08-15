import { NextResponse } from 'next/server'
import { extractText } from 'unpdf'
import * as XLSX from 'xlsx'

import { assert, jsonError, requireUserId } from '@/lib/api'
import {
  createImportPlan,
  detectDocumentAndPlatform,
  deterministicMapping,
  deterministicMappingForEntity,
  inferMappingWithAI,
  parseUnstructuredTextToRows,
  serializeImportRows,
  type ImportMapping,
  type RawRow,
  type SheetImportPlan,
  type ImportPlan,
  type PlatformType,
  type EntityType,
} from '@/lib/import-mapping'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { env } from '@/lib/env'

/* ─── Helpers ─── */

interface ParsedSheetResult {
  sheetName: string
  platform: PlatformType
  docType: string
  docTypeName: string
  headers: string[]
  rows: RawRow[]
  mapping: ImportMapping
  rowCount: number
  confidence: number
  isPrimary: boolean
  relationship: 'orders' | 'returns' | 'settlement' | 'standalone'
  mergeWith: string[]
}

/**
 * Find a matching import template for the given sheet
 */
async function findMatchingTemplate(
  ownerUserId: string,
  entityType: EntityType,
  platform: PlatformType,
  fileName: string,
  sheetName: string,
  headers: string[],
): Promise<{ column_mapping: ImportMapping } | null> {
  try {
    const db = getSupabaseAdmin()
    const { data: templates } = await db
      .from('import_templates')
      .select('column_mapping, file_name_pattern, sheet_name_pattern, platform, doc_type')
      .eq('owner_user_id', ownerUserId)
      .eq('platform', platform)
      .order('usage_count', { ascending: false })
      .limit(10)

    if (!templates || templates.length === 0) return null

    for (const template of templates) {
      // Check file name pattern
      if (template.file_name_pattern) {
        try {
          const regex = new RegExp(template.file_name_pattern, 'i')
          if (!regex.test(fileName)) continue
        } catch {
          // Invalid regex, skip
        }
      }
      
      // Check sheet name pattern
      if (template.sheet_name_pattern) {
        try {
          const regex = new RegExp(template.sheet_name_pattern, 'i')
          if (!regex.test(sheetName)) continue
        } catch {
          // Invalid regex, skip
        }
      }
      
      // Check if template has mappings for these headers
      const templateMapping = template.column_mapping as ImportMapping
      const mappedHeaders = Object.values(templateMapping).filter((v): v is string => Boolean(v))
      const overlap = mappedHeaders.filter(h => headers.includes(h)).length
      
      if (overlap >= Math.min(3, mappedHeaders.length)) {
        // Good match - update usage count
        await db
          .from('import_templates')
          .update({ 
            usage_count: (template as any).usage_count + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq('id', (template as any).id)
        
        return { column_mapping: templateMapping }
      }
    }
  } catch {
    // Template lookup is best-effort
  }
  return null
}

/**
 * Get critical fields that must be mapped for each entity type
 */
function getCriticalFields(entityType: EntityType): string[] {
  const critical: Record<EntityType, string[]> = {
    orders: ['orderId', 'skuCode'],
    returns: ['orderId', 'skuCode'],
    settlement: ['orderId', 'skuCode'],
    skus: ['skuCode'],
    materials: ['materialCode'],
    borrowings: ['counterparty', 'itemName'],
    purchases: ['supplierId', 'materialId'],
    expenses: ['category', 'amount'],
    suppliers: ['supplierName'],
    sku_materials: ['skuCode', 'materialCode'],
    material_transactions: ['materialId', 'txnType'],
    unknown: ['orderId', 'skuCode'],
  }
  return critical[entityType] || critical.unknown
}

/**
 * Parse a single sheet from an Excel workbook
 */
async function parseSheet(
  workbook: XLSX.WorkBook,
  plan: SheetImportPlan,
  fileName: string,
  ownerUserId: string,
): Promise<ParsedSheetResult> {
  // Re-extract the sheet data to ensure we have fresh data
  const worksheet = workbook.Sheets[plan.sheetName]
  if (!worksheet) {
    return {
      sheetName: plan.sheetName,
      platform: plan.platform,
      docType: plan.docType,
      docTypeName: plan.docTypeName,
      headers: plan.headers,
      rows: plan.rows,
      mapping: plan.mapping,
      rowCount: plan.rowCount,
      confidence: plan.confidence,
      isPrimary: plan.isPrimary,
      relationship: plan.relationship,
      mergeWith: plan.mergeWith,
    }
  }

  // Read entire sheet as 2D array to scan for the real header row
  const raw2D = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  })

  if (!raw2D.length) {
    return {
      sheetName: plan.sheetName,
      platform: plan.platform,
      docType: plan.docType,
      docTypeName: plan.docTypeName,
      headers: [],
      rows: [],
      mapping: {},
      rowCount: 0,
      confidence: 0,
      isPrimary: plan.isPrimary,
      relationship: plan.relationship,
      mergeWith: plan.mergeWith,
    }
  }

  // Check for matching import template
  let templateMapping: ImportMapping | null = null
  if (env.openRouterApiKey) {
    // We'll check templates after we have headers
  }
  
  // For merged sheets, we need to re-extract each source sheet
  if (plan.mergeWith.length > 0) {
    const allRows: RawRow[] = [...plan.rows] // Already merged in plan
    const allHeaders = plan.headers
    
    // Use entity-aware deterministic mapping
    let finalMapping = deterministicMappingForEntity(allHeaders, plan.entityType)
    
    // Check for matching template
    const template = await findMatchingTemplate(ownerUserId, plan.entityType, plan.platform, fileName, plan.sheetName, allHeaders)
    if (template) {
      // Apply template mapping (template takes precedence)
      finalMapping = { ...template.column_mapping, ...finalMapping }
    }
    
    // AI inference with context for critical missing fields
    const criticalFields = getCriticalFields(plan.entityType)
    const missingCritical = criticalFields.filter(f => !finalMapping[f])
    
    if (missingCritical.length > 0 && env.openRouterApiKey) {
      const aiMapping = await inferMappingWithAI(
        allHeaders,
        allRows.slice(0, 5),
        env.openRouterApiKey,
        {
          platform: plan.platform,
          docType: plan.docType as any,
          sheetName: plan.sheetName,
          fileName,
        },
      )
      
      for (const [field, column] of Object.entries(aiMapping)) {
        if (!finalMapping[field] && column) {
          finalMapping[field] = column
        }
      }
    }
    
    const detection = detectDocumentAndPlatform(
      allHeaders,
      allRows.slice(0, 5),
      plan.sheetName,
      '',
    )
    
    return {
      sheetName: plan.sheetName,
      platform: plan.platform,
      docType: detection.docType,
      docTypeName: detection.docTypeName,
      headers: allHeaders,
      rows: allRows,
      mapping: finalMapping,
      rowCount: allRows.length,
      confidence: detection.confidence,
      isPrimary: plan.isPrimary,
      relationship: plan.relationship,
      mergeWith: plan.mergeWith,
    }
  }
  
  // Single sheet - detect header row
  const { headerRowIndex: detectedHeaderRowIndex, headers: detectedHeaders } = (() => {
    // Find header row - reuse logic from import-mapping
    let bestIndex = 0
    let bestScore = -1
    let bestHeaders: string[] = []
    
    const rowsToScan = Math.min(raw2D.length, 12)
    for (let i = 0; i < rowsToScan; i++) {
      const row = raw2D[i]
      if (!row || !Array.isArray(row)) continue
      const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean)
      if (cells.length < 2) continue
      
      let rowScore = 0
      let textCells = 0
      for (const cell of cells) {
        const isNumeric = /^[\d.,₹$€£%\-+]+$/.test(cell)
        const isShortText = cell.length <= 50 && !isNumeric
        if (isShortText) { textCells++; rowScore += 2 }
        else if (isNumeric) { rowScore -= 1 }
        else { rowScore += 0.5 }
      }
      if (textCells < 2) continue
      
      // Use entity-aware mapping for header detection
      const mapping = deterministicMappingForEntity(cells, plan.entityType)
      const aliasHits = Object.values(mapping).filter(Boolean).length
      rowScore += aliasHits * 5
      rowScore -= i * 0.1
      
      if (rowScore > bestScore) {
        bestScore = rowScore
        bestIndex = i
        bestHeaders = cells
      }
    }
    return { headerRowIndex: bestIndex, headers: bestHeaders }
  })()

  // Re-read from detected header row
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1')
  range.s.r = detectedHeaderRowIndex
  const adjustedRef = XLSX.utils.encode_range(range)
  const tempSheet = { ...worksheet, '!ref': adjustedRef }
  const rawRows = XLSX.utils.sheet_to_json<RawRow>(tempSheet, { defval: '', raw: false })
  const rows = serializeImportRows(rawRows)
  const actualHeaders = rows.length > 0 ? Object.keys(rows[0]) : detectedHeaders

  // Entity-aware deterministic mapping
  let mapping = deterministicMappingForEntity(actualHeaders, plan.entityType)
  
  // Check for matching template
  const template = await findMatchingTemplate(ownerUserId, plan.entityType, plan.platform, fileName, plan.sheetName, actualHeaders)
  if (template) {
    mapping = { ...template.column_mapping, ...mapping }
  }
  
  // AI inference with rich context for critical missing fields
  const criticalFields = getCriticalFields(plan.entityType)
  const missingCritical = criticalFields.filter(f => !mapping[f])
  
  if (missingCritical.length > 0 && env.openRouterApiKey) {
    const aiMapping = await inferMappingWithAI(
      actualHeaders,
      rows.slice(0, 5),
      env.openRouterApiKey,
      {
        platform: plan.platform,
        docType: plan.docType as any,
        sheetName: plan.sheetName,
        fileName,
      },
    )
    
    for (const [field, column] of Object.entries(aiMapping)) {
      if (!mapping[field] && column) {
        mapping[field] = column
      }
    }
  }

  const detection = detectDocumentAndPlatform(
    actualHeaders,
    rows.slice(0, 5),
    plan.sheetName,
    '',
  )

  return {
    sheetName: plan.sheetName,
    platform: plan.platform,
    docType: detection.docType,
    docTypeName: detection.docTypeName,
    headers: actualHeaders,
    rows,
    mapping,
    rowCount: rows.length,
    confidence: detection.confidence,
    isPrimary: plan.isPrimary,
    relationship: plan.relationship,
    mergeWith: plan.mergeWith,
  }
}

/* ─── Route handler ─── */

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    assert(file, 'Please select a file to parse.')

    const fileName = file.name || 'uploaded-document'
    const ext = fileName.toLowerCase().split('.').pop() || ''
    const buffer = Buffer.from(await file.arrayBuffer())

    let results: ParsedSheetResult[] = []
    let warnings: string[] = []

    /* ═════════════════════════════════════════════
       PDF PARSING
       ══════════════════════════════════════════════ */
    if (ext === 'pdf') {
      try {
        // Extract text from PDF using unpdf
        const extracted = await extractText(buffer, { mergePages: true })
        const pdfText = Array.isArray(extracted.text)
          ? extracted.text.join('\n')
          : String(extracted.text || '')
        const rawTextSnippet = pdfText.slice(0, 3000)

        let rows: RawRow[] = []
        let headers: string[] = []

        // Try AI extraction if OpenRouter is configured
        if (env.openRouterApiKey && pdfText.trim().length > 0) {
          try {
            const aiPrompt = `You are a data extractor for an inventory & sales ops app.
Extract order/sales records from this PDF invoice/report text.
Return ONLY valid JSON:
{
  "platform": "Amazon" | "Meesho" | "Flipkart" | "Shopify" | "Offline",
  "docTypeName": "Description of document",
  "orders": [
    {
      "orderId": "string",
      "skuCode": "string",
      "productName": "string",
      "orderDate": "YYYY-MM-DD",
      "qtyOrdered": number,
      "qtyDelivered": number,
      "qtyReturned": number,
      "salePrice": number,
      "status": "Delivered" | "Pending" | "Returned" | "Cancelled",
      "customerLocation": "string"
    }
  ]
}

Document text:
${pdfText.slice(0, 6000)}`

            const aiRes = await fetch(
              'https://openrouter.ai/api/v1/chat/completions',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${env.openRouterApiKey}`,
                  'HTTP-Referer':
                    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
                  'X-Title': 'Peak Business',
                },
                body: JSON.stringify({
                  model: 'openrouter/free',
                  messages: [
                    {
                      role: 'system',
                      content:
                        'You extract order tables into strict JSON format.',
                    },
                    { role: 'user', content: aiPrompt },
                  ],
                  temperature: 0,
                  max_tokens: 2000,
                }),
              },
            )

            if (aiRes.ok) {
              const aiData = await aiRes.json()
              const content = String(
                aiData.choices?.[0]?.message?.content || '',
              )
                .replace(/^```(?:json)?\s*|\s*```$/g, '')
                .trim()
              const parsed = JSON.parse(content)
              if (
                Array.isArray(parsed.orders) &&
                parsed.orders.length > 0
              ) {
                rows = parsed.orders.map(
                  (ord: Record<string, unknown>) => ({
                    'Order ID': ord.orderId,
                    'SKU Code': ord.skuCode,
                    'Product Name': ord.productName,
                    'Order Date': ord.orderDate,
                    'Quantity Ordered': ord.qtyOrdered,
                    'Quantity Delivered':
                      ord.qtyDelivered ?? ord.qtyOrdered,
                    'Quantity Returned': ord.qtyReturned ?? 0,
                    'Sale Price': ord.salePrice,
                    Status: ord.status || 'Delivered',
                    'Customer Location': ord.customerLocation || '',
                  }),
                )
                headers = Object.keys(rows[0])
              }
            }
          } catch {
            // Fall back to local parser below
          }
        }

        // Fallback: heuristic text parsing
        if (!rows.length) {
          const parsed = parseUnstructuredTextToRows(pdfText)
          rows = parsed.rows
          headers = parsed.headers
        }

        assert(rows.length > 0, 'No data rows could be extracted from this PDF.')

        // Deterministic + AI mapping
        let mapping = deterministicMapping(headers)
        let aiMappingUsed = false
        const hasOrderId = Boolean(mapping.orderId || mapping.lineKey)
        const hasProduct = Boolean(mapping.skuCode || mapping.productName)

        if ((!hasOrderId || !hasProduct) && env.openRouterApiKey) {
          const aiMapping = await inferMappingWithAI(
            headers,
            rows.slice(0, 5),
            env.openRouterApiKey,
            { fileName },
          )
          for (const [field, column] of Object.entries(aiMapping)) {
            if (!mapping[field] && column) {
              mapping[field] = column
              aiMappingUsed = true
            }
          }
        }

        const detection = detectDocumentAndPlatform(
          headers,
          rows.slice(0, 5),
          fileName,
          rawTextSnippet,
        )

        const finalMapping: ImportMapping = { ...detection.recommendedMapping }
        for (const [field, column] of Object.entries(mapping)) {
          if (column) finalMapping[field] = column
        }

        results = [{
          sheetName: 'PDF Document',
          platform: detection.detectedPlatform,
          docType: detection.docType,
          docTypeName: detection.docTypeName,
          headers,
          rows: rows.slice(0, 5000),
          mapping: finalMapping,
          rowCount: rows.length,
          confidence: detection.confidence,
          isPrimary: true,
          relationship: 'orders',
          mergeWith: [],
        }]

      } catch (pdfErr) {
        throw new Error(
          `Failed to parse PDF document: ${pdfErr instanceof Error ? pdfErr.message : 'Unknown PDF error'}`,
        )
      }

      /* ══════════════════════════════════════════════
         CSV / TSV / TXT PARSING
         ══════════════════════════════════════════════ */
    } else if (['csv', 'txt', 'tsv'].includes(ext)) {
      const textContent = buffer.toString('utf-8')
      const parsed = parseUnstructuredTextToRows(textContent)
      const rows = parsed.rows
      const headers = parsed.headers
      const rawTextSnippet = parsed.rawTextSnippet

      assert(rows.length > 0, 'No data rows could be extracted from this file.')

      let mapping = deterministicMapping(headers)
      let aiMappingUsed = false
      const hasOrderId = Boolean(mapping.orderId || mapping.lineKey)
      const hasProduct = Boolean(mapping.skuCode || mapping.productName)

      if ((!hasOrderId || !hasProduct) && env.openRouterApiKey) {
        const aiMapping = await inferMappingWithAI(
          headers,
          rows.slice(0, 5),
          env.openRouterApiKey,
          { fileName },
        )
        for (const [field, column] of Object.entries(aiMapping)) {
          if (!mapping[field] && column) {
            mapping[field] = column
            aiMappingUsed = true
          }
        }
      }

      const detection = detectDocumentAndPlatform(
        headers,
        rows.slice(0, 5),
        fileName,
        rawTextSnippet,
      )

      const finalMapping: ImportMapping = { ...detection.recommendedMapping }
      for (const [field, column] of Object.entries(mapping)) {
        if (column) finalMapping[field] = column
      }

      results = [{
        sheetName: 'CSV/TSV Data',
        platform: detection.detectedPlatform,
        docType: detection.docType,
        docTypeName: detection.docTypeName,
        headers,
        rows: rows.slice(0, 5000),
        mapping: finalMapping,
        rowCount: rows.length,
        confidence: detection.confidence,
        isPrimary: true,
        relationship: 'orders',
        mergeWith: [],
      }]

      /* ══════════════════════════════════════════════
         EXCEL (XLSX / XLS) — ENHANCED MULTI-SHEET INTELLIGENCE
         ══════════════════════════════════════════════ */
    } else {
      const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MB limit to mitigate ReDoS on xlsx parsing
      if (buffer.length > MAX_UPLOAD_BYTES) {
        throw new Error('Uploaded spreadsheet is too large. Maximum allowed size is 5 MB.')
      }

      const workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        raw: false,
      })

      assert(
        workbook.SheetNames.length > 0,
        'This spreadsheet does not contain any sheets.',
      )

      // Create intelligent import plan
      const plan: ImportPlan = createImportPlan(workbook)
      warnings = plan.warnings

      // Parse each sheet in the plan
      for (const sheetPlan of plan.sheets) {
        try {
          const result = await parseSheet(workbook, sheetPlan, fileName, ownerUserId)
          // Update fileName in result for context
          results.push(result)
        } catch (sheetErr) {
          warnings.push(`Failed to parse sheet "${sheetPlan.sheetName}": ${sheetErr instanceof Error ? sheetErr.message : 'Unknown error'}`)
        }
      }

      // If no sheets were successfully parsed, fall back to first sheet
      if (!results.length) {
        const fallbackSheet = workbook.SheetNames[0]
        const fallbackPlan: SheetImportPlan = {
          sheetName: fallbackSheet,
          platform: 'Offline',
          docType: 'GENERIC_ORDER_DATA',
          docTypeName: 'Generic Orders Spreadsheet',
          rows: [],
          headers: [],
          mapping: {},
          rowCount: 0,
          confidence: 0,
          isPrimary: true,
          mergeWith: [],
          relationship: 'orders',
          entityType: 'orders',
          entityConfidence: 0,
          targetTable: 'business_orders',
        }
        const result = await parseSheet(workbook, fallbackPlan, fileName, ownerUserId)
        results.push(result)
      }
    }

    // Return the primary sheet by default, but include all parsed sheets
    const primary = results.find(r => r.isPrimary) || results[0]
    const allSheets = results

    return NextResponse.json({
      fileName,
      totalRows: primary?.rowCount || 0,
      headers: primary?.headers || [],
      rows: primary?.rows || [],
      detection: primary ? {
        docType: primary.docType,
        docTypeName: primary.docTypeName,
        detectedPlatform: primary.platform,
        confidence: primary.confidence,
        isValidOrderDoc: primary.rowCount > 0 && primary.headers.length > 0,
        validationSummary: primary.rowCount > 0 ? 'Valid order document detected.' : 'No data rows found.',
        recommendedMapping: primary.mapping,
        selectedSheet: primary.sheetName,
        sheetNames: allSheets.map(s => s.sheetName),
        headerRowIndex: 0,
        aiMappingUsed: Object.keys(primary.mapping).length > 0,
      } : null,
      mapping: primary?.mapping || {},
      rawTextSnippet: '',
      sheetNames: allSheets.map(s => s.sheetName),
      selectedSheet: primary?.sheetName,
      headerRowIndex: 0,
      aiMappingUsed: Object.keys(primary?.mapping || {}).length > 0,
      // NEW: Multi-sheet results
      allSheets: allSheets.map(s => ({
        sheetName: s.sheetName,
        platform: s.platform,
        docType: s.docType,
        docTypeName: s.docTypeName,
        rowCount: s.rowCount,
        confidence: s.confidence,
        relationship: s.relationship,
        isPrimary: s.isPrimary,
        mergeWith: s.mergeWith,
        headers: s.headers,
        rows: s.rows,
        mapping: s.mapping,
      })),
      warnings: warnings.length > 0 ? warnings : undefined,
    })
  } catch (error) {
    return jsonError(error)
  }
}