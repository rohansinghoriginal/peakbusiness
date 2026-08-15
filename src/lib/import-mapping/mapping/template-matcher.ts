import { EntityType, PlatformType, ImportMapping, RawRow } from '../types'
import { getSupabaseAdmin } from '../../supabase-server'
import { normalized } from '../utils/normalized'

export interface ImportTemplate {
  id: string
  name: string
  platform: PlatformType
  doc_type: string
  column_mapping: ImportMapping
  file_name_pattern?: string
  sheet_name_pattern?: string
  usage_count: number
}

/**
 * Find a matching import template for the given sheet
 */
export async function findMatchingTemplate(
  ownerUserId: string,
  entityType: EntityType,
  platform: PlatformType,
  fileName: string,
  sheetName: string,
  headers: string[],
): Promise<ImportMapping | null> {
  try {
    const db = getSupabaseAdmin()
    const { data: templates } = await db
      .from('import_templates')
      .select('id, column_mapping, file_name_pattern, sheet_name_pattern, platform, doc_type, usage_count')
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
            usage_count: template.usage_count + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq('id', template.id)
        
        return templateMapping
      }
    }
  } catch {
    // Template lookup is best-effort
  }
  return null
}

/**
 * Learn a new template from user's mapping correction
 * Called after user saves a corrected mapping
 */
export async function learnTemplateFromCorrection(
  ownerUserId: string,
  entityType: EntityType,
  platform: PlatformType,
  fileName: string,
  sheetName: string,
  headers: string[],
  userMapping: ImportMapping,
): Promise<void> {
  try {
    const db = getSupabaseAdmin()
    
    // Generate patterns from file/sheet names
    const fileNamePattern = fileName
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // escape regex
      .replace(/\d{4}-\d{2}-\d{2}/g, '\\d{4}-\\d{2}-\\d{2}')  // generalize dates
      .replace(/\d+/g, '\\d+')  // generalize numbers
    
    const sheetNamePattern = sheetName
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\d+/g, '\\d+')
    
    // Check if similar template exists
    const { data: existing } = await db
      .from('import_templates')
      .select('id, column_mapping, usage_count')
      .eq('owner_user_id', ownerUserId)
      .eq('platform', platform)
      .eq('doc_type', entityType)
      .limit(5)
    
    let bestMatch: { id: string; column_mapping: ImportMapping; usage_count: number } | null = null
    let bestOverlap = 0
    
    if (existing) {
      for (const tmpl of existing) {
        const tmplMapping = tmpl.column_mapping as ImportMapping
        const mappedHeaders = Object.values(tmplMapping).filter((v): v is string => Boolean(v))
        const userMappedHeaders = Object.values(userMapping).filter((v): v is string => Boolean(v))
        const overlap = mappedHeaders.filter(h => userMappedHeaders.includes(h)).length
        
        if (overlap > bestOverlap) {
          bestOverlap = overlap
          bestMatch = { id: tmpl.id, column_mapping: tmplMapping, usage_count: tmpl.usage_count }
        }
      }
    }
    
    // If good match exists, update it
    if (bestMatch && bestOverlap >= 3) {
      // Merge mappings (user's mapping takes precedence)
      const mergedMapping = { ...bestMatch.column_mapping, ...userMapping }
      
      await db
        .from('import_templates')
        .update({ 
          column_mapping: mergedMapping,
          usage_count: bestMatch.usage_count + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', bestMatch.id)
      return
    }
    
    // Create new template
    const templateName = `Auto: ${platform} ${entityType} (${sheetName})`
    
    await db
      .from('import_templates')
      .insert({
        owner_user_id: ownerUserId,
        name: templateName,
        platform,
        doc_type: entityType,
        file_name_pattern: fileNamePattern,
        sheet_name_pattern: sheetNamePattern,
        column_mapping: userMapping,
        usage_count: 1,
      })
  } catch {
    // Template learning is best-effort
  }
}