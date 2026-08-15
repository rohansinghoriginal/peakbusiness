import { NextResponse } from 'next/server'

import { jsonError, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const url = new URL(request.url)
    
    // Search parameters
    const query = url.searchParams.get('q') || ''
    const platform = url.searchParams.get('platform') || ''
    const status = url.searchParams.get('status') || ''
    const entityType = url.searchParams.get('entityType') || ''
    const skuCode = url.searchParams.get('skuCode') || ''
    const productName = url.searchParams.get('productName') || ''
    const orderId = url.searchParams.get('orderId') || ''
    const customerLocation = url.searchParams.get('customerLocation') || ''
    const dateFrom = url.searchParams.get('dateFrom') || ''
    const dateTo = url.searchParams.get('dateTo') || ''
    const limit = parseInt(url.searchParams.get('limit') || '100', 10)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)
    const sortBy = url.searchParams.get('sortBy') || 'order_date'
    const sortOrder = url.searchParams.get('sortOrder') || 'desc'

    const db = getSupabaseAdmin()

    // Build the query
    let queryBuilder = db
      .from('business_orders')
      .select(`
        *,
        skus!inner(sku_code, product_name, platform, selling_price, cost_per_unit)
      `, { count: 'exact' })
      .eq('owner_user_id', ownerUserId)

    // Text search across multiple fields
    if (query) {
      queryBuilder = queryBuilder.or([
        `order_id.ilike.%${query}%`,
        `line_key.ilike.%${query}%`,
        `skus.sku_code.ilike.%${query}%`,
        `skus.product_name.ilike.%${query}%`,
        `customer_location.ilike.%${query}%`,
        `source_file.ilike.%${query}%`,
        `notes.ilike.%${query}%`
      ].join(','))
    }

    // Specific field filters
    if (platform) {
      queryBuilder = queryBuilder.eq('platform', platform)
    }
    if (status) {
      queryBuilder = queryBuilder.eq('status', status)
    }
    if (entityType) {
      queryBuilder = queryBuilder.eq('entity_type', entityType)
    }
    if (skuCode) {
      queryBuilder = queryBuilder.ilike('skus.sku_code', `%${skuCode}%`)
    }
    if (productName) {
      queryBuilder = queryBuilder.ilike('skus.product_name', `%${productName}%`)
    }
    if (orderId) {
      queryBuilder = queryBuilder.ilike('order_id', `%${orderId}%`)
    }
    if (customerLocation) {
      queryBuilder = queryBuilder.ilike('customer_location', `%${customerLocation}%`)
    }
    if (dateFrom) {
      queryBuilder = queryBuilder.gte('order_date', dateFrom)
    }
    if (dateTo) {
      queryBuilder = queryBuilder.lte('order_date', dateTo)
    }

    // Sorting
    const validSortFields = ['order_date', 'created_at', 'sale_price', 'qty_delivered', 'qty_ordered', 'status', 'platform']
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'order_date'
    const orderDirection = sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc'
    queryBuilder = queryBuilder.order(sortField, { ascending: orderDirection === 'asc' })

    // Pagination
    queryBuilder = queryBuilder.range(offset, offset + limit - 1)

    const { data, error, count } = await queryBuilder

    if (error) throw error

    return NextResponse.json({
      data: data || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit
      },
      filters: {
        query,
        platform,
        status,
        entityType,
        skuCode,
        productName,
        orderId,
        customerLocation,
        dateFrom,
        dateTo,
        sortBy: sortField,
        sortOrder: orderDirection
      }
    })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    
    const {
      query = '',
      platform = '',
      status = '',
      entityType = '',
      skuCode = '',
      productName = '',
      orderId = '',
      customerLocation = '',
      dateFrom = '',
      dateTo = '',
      limit = 100,
      offset = 0,
      sortBy = 'order_date',
      sortOrder = 'desc'
    } = body

    const db = getSupabaseAdmin()

    let queryBuilder = db
      .from('business_orders')
      .select(`
        *,
        skus!inner(sku_code, product_name, platform, selling_price, cost_per_unit)
      `, { count: 'exact' })
      .eq('owner_user_id', ownerUserId)

    if (query) {
      queryBuilder = queryBuilder.or([
        `order_id.ilike.%${query}%`,
        `line_key.ilike.%${query}%`,
        `skus.sku_code.ilike.%${query}%`,
        `skus.product_name.ilike.%${query}%`,
        `customer_location.ilike.%${query}%`,
        `source_file.ilike.%${query}%`,
        `notes.ilike.%${query}%`
      ].join(','))
    }

    if (platform) queryBuilder = queryBuilder.eq('platform', platform)
    if (status) queryBuilder = queryBuilder.eq('status', status)
    if (entityType) queryBuilder = queryBuilder.eq('entity_type', entityType)
    if (skuCode) queryBuilder = queryBuilder.ilike('skus.sku_code', `%${skuCode}%`)
    if (productName) queryBuilder = queryBuilder.ilike('skus.product_name', `%${productName}%`)
    if (orderId) queryBuilder = queryBuilder.ilike('order_id', `%${orderId}%`)
    if (customerLocation) queryBuilder = queryBuilder.ilike('customer_location', `%${customerLocation}%`)
    if (dateFrom) queryBuilder = queryBuilder.gte('order_date', dateFrom)
    if (dateTo) queryBuilder = queryBuilder.lte('order_date', dateTo)

    const validSortFields = ['order_date', 'created_at', 'sale_price', 'qty_delivered', 'qty_ordered', 'status', 'platform']
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'order_date'
    const orderDirection = sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc'
    queryBuilder = queryBuilder.order(sortField, { ascending: orderDirection === 'asc' })

    queryBuilder = queryBuilder.range(offset, offset + limit - 1)

    const { data, error, count } = await queryBuilder

    if (error) throw error

    return NextResponse.json({
      data: data || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit
      }
    })
  } catch (error) {
    return jsonError(error)
  }
}