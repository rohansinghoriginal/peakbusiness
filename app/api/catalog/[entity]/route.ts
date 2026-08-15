import { NextResponse } from 'next/server'

import { ApiError, assert, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { ensureSkuMaster, type SkuRecord } from '@/lib/sku-master'
import { normalizeSkuKey } from '@/lib/business'

async function handleBom(db: any, ownerUserId: string, request: Request) {
  const { searchParams } = new URL(request.url)
  const skuId = searchParams.get('skuId')

  if (request.method === 'GET') {
    try {
      const ownerUserId = await requireUserId()
      let query = db.from('sku_materials')
        .select('*, materials!inner(*)')
        .eq('owner_user_id', ownerUserId)
      if (skuId) query = query.eq('sku_id', skuId)
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json(data)
    } catch (error) {
      return jsonError(error)
    }
  }

  if (request.method === 'POST') {
    try {
      const ownerUserId = await requireUserId()
      const body = await request.json()
      const skuId = text(body.skuId)
      const materialId = text(body.materialId)
      assert(skuId && materialId, 'SKU and material are required.')

      const { data, error } = await db.from('sku_materials').upsert({
        owner_user_id: ownerUserId,
        sku_id: skuId,
        material_id: materialId,
        qty_per_unit: number(body.qtyPerUnit),
        waste_pct: number(body.wastePct),
      }, { onConflict: 'owner_user_id,sku_id,material_id' }).select().single()
      if (error) throw new ApiError(error.message, 500)
      return NextResponse.json(data)
    } catch (error) {
      return jsonError(error)
    }
  }

  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

async function handleMaterials(db: any, ownerUserId: string, request: Request) {
  if (request.method === 'GET') {
    try {
      const ownerUserId = await requireUserId()
      const { data, error } = await db.from('materials').select().eq('owner_user_id', ownerUserId).order('material_name')
      if (error) throw error
      return NextResponse.json(data)
    } catch (error) {
      return jsonError(error)
    }
  }

  if (request.method === 'POST') {
    try {
      const ownerUserId = await requireUserId()
      const body = await request.json()
      const materialCode = text(body.materialCode)
      const materialName = text(body.materialName)
      assert(materialCode && materialName, 'Material code and name are required.')

      const { data, error } = await db.from('materials').upsert({
        owner_user_id: ownerUserId,
        material_code: materialCode,
        material_name: materialName,
        category: optionalText(body.category),
        unit: text(body.unit) || 'pcs',
        opening_stock: number(body.openingStock),
        reorder_level: number(body.reorderLevel),
        avg_unit_cost: number(body.avgUnitCost),
        preferred_vendor: optionalText(body.preferredVendor),
        notes: optionalText(body.notes),
      }, { onConflict: 'owner_user_id,material_code' }).select().single()
      if (error) throw new ApiError(error.message, 500)
      return NextResponse.json(data)
    } catch (error) {
      return jsonError(error)
    }
  }

  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

async function handleSkus(db: any, ownerUserId: string, request: Request) {
  if (request.method === 'GET') {
    try {
      const ownerUserId = await requireUserId()
      const { data, error } = await db.from('skus').select().eq('owner_user_id', ownerUserId).order('active', { ascending: false }).order('product_name')
      if (error) throw error
      return NextResponse.json(data)
    } catch (error) {
      return jsonError(error)
    }
  }

  if (request.method === 'POST') {
    try {
      const ownerUserId = await requireUserId()
      const body = await request.json()
      const skuCode = text(body.skuCode)
      const productName = text(body.productName)
      assert(skuCode && productName, 'SKU code and product name are required.')

      const platform = text(body.platform) || 'Offline'
      const sellingPrice = number(body.sellingPrice)
      const { sku } = await ensureSkuMaster({
        db: getSupabaseAdmin(),
        ownerUserId,
        platform,
        skuCode,
        productName,
        salePrice: sellingPrice,
        skuByKey: new Map<string, SkuRecord>(),
        updateExisting: true,
        costPerUnit: number(body.costPerUnit),
        openingStock: number(body.openingStock),
        reorderLevel: number(body.reorderLevel),
        category: optionalText(body.category),
        active: body.active !== false,
        notes: optionalText(body.notes),
      })
      const { data, error } = await getSupabaseAdmin().from('skus').select().eq('id', sku.id).eq('owner_user_id', ownerUserId).single()
      if (error) throw new ApiError(error.message, 500)
      return NextResponse.json(data)
    } catch (error) {
      return jsonError(error)
    }
  }

  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const db = getSupabaseAdmin()
  const ownerUserId = await requireUserId()
  const { entity } = await params

  switch (entity) {
    case 'bom':
      return handleBom(db, ownerUserId, request)
    case 'materials':
      return handleMaterials(db, ownerUserId, request)
    case 'skus':
      return handleSkus(db, ownerUserId, request)
    default:
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const db = getSupabaseAdmin()
  const ownerUserId = await requireUserId()
  const { entity } = await params

  switch (entity) {
    case 'bom':
      return handleBom(db, ownerUserId, request)
    case 'materials':
      return handleMaterials(db, ownerUserId, request)
    case 'skus':
      return handleSkus(db, ownerUserId, request)
    default:
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}