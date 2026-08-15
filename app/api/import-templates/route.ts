import { NextResponse } from 'next/server'

import { assert, jsonError, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const { data, error } = await getSupabaseAdmin()
      .from('import_templates')
      .select('*')
      .eq('owner_user_id', ownerUserId)
      .order('usage_count', { ascending: false })
      .order('updated_at', { ascending: false })

    if (error) throw error
    return NextResponse.json(data || [])
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    
    const name = text(body.name)
    const platform = text(body.platform)
    const columnMapping = body.columnMapping && typeof body.columnMapping === 'object' ? body.columnMapping : {}
    
    assert(name, 'Template name is required')
    assert(platform, 'Platform is required')
    assert(Object.keys(columnMapping).length > 0, 'At least one column mapping is required')

    const db = getSupabaseAdmin()
    
    // If this is set as default, unset other defaults for this platform
    if (body.isDefault) {
      await db
        .from('import_templates')
        .update({ is_default: false })
        .eq('owner_user_id', ownerUserId)
        .eq('platform', platform)
        .eq('is_default', true)
    }

    const { data, error } = await db
      .from('import_templates')
      .insert({
        owner_user_id: ownerUserId,
        name,
        description: text(body.description) || null,
        platform,
        doc_type: text(body.docType) || null,
        file_name_pattern: text(body.fileNamePattern) || null,
        sheet_name_pattern: text(body.sheetNamePattern) || null,
        column_mapping: columnMapping,
        header_row_index: body.headerRowIndex ? Number(body.headerRowIndex) : null,
        is_default: body.isDefault || false,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const id = text(body.id)
    
    assert(id, 'Template ID is required')

    const db = getSupabaseAdmin()
    
    // If setting as default, unset other defaults for this platform
    if (body.isDefault === true) {
      const platform = text(body.platform)
      if (platform) {
        await db
          .from('import_templates')
          .update({ is_default: false })
          .eq('owner_user_id', ownerUserId)
          .eq('platform', platform)
          .eq('is_default', true)
      }
    }

    const updates: Record<string, unknown> = {}
    if (body.name !== undefined) updates.name = text(body.name)
    if (body.description !== undefined) updates.description = text(body.description) || null
    if (body.platform !== undefined) updates.platform = text(body.platform)
    if (body.docType !== undefined) updates.doc_type = text(body.docType) || null
    if (body.fileNamePattern !== undefined) updates.file_name_pattern = text(body.fileNamePattern) || null
    if (body.sheetNamePattern !== undefined) updates.sheet_name_pattern = text(body.sheetNamePattern) || null
    if (body.columnMapping !== undefined) updates.column_mapping = body.columnMapping
    if (body.headerRowIndex !== undefined) updates.header_row_index = body.headerRowIndex ? Number(body.headerRowIndex) : null
    if (body.isDefault !== undefined) updates.is_default = body.isDefault
    
    updates.updated_at = new Date().toISOString()

    const { data, error } = await db
      .from('import_templates')
      .update(updates)
      .eq('id', id)
      .eq('owner_user_id', ownerUserId)
      .select()
      .single()

    if (error) throw error
    if (!data) throw new Error('Template not found')

    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    
    assert(id, 'Template ID is required')

    const { error } = await getSupabaseAdmin()
      .from('import_templates')
      .delete()
      .eq('id', id)
      .eq('owner_user_id', ownerUserId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    return jsonError(error)
  }
}