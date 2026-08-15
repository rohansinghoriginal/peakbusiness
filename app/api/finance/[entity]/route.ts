import { NextResponse } from 'next/server'

import { assert, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

async function handleBorrowings(request: Request, ownerUserId: string) {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('borrowings').select().eq('owner_user_id', ownerUserId).order('txn_date', { ascending: false }).limit(250)
  if (error) throw error
  return NextResponse.json(data)
}

async function handleExpenses(request: Request, ownerUserId: string) {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('business_expenses').select().eq('owner_user_id', ownerUserId).order('expense_date', { ascending: false }).limit(250)
  if (error) throw error
  return NextResponse.json(data)
}

async function handlePurchases(request: Request, ownerUserId: string) {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('material_purchases').select('*, materials(*), suppliers(*)').eq('owner_user_id', ownerUserId).order('purchase_date', { ascending: false }).limit(250)
  if (error) throw error
  return NextResponse.json(data)
}

export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const ownerUserId = await requireUserId()
    const { entity } = await params

    switch (entity) {
      case 'borrowings':
        return handleBorrowings(request, ownerUserId)
      case 'expenses':
        return handleExpenses(request, ownerUserId)
      case 'purchases':
        return handlePurchases(request, ownerUserId)
      default:
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const { entity } = await params
    const db = getSupabaseAdmin()

    switch (entity) {
      case 'borrowings': {
        const { counterparty, item_name, direction, txn_date, item_type, item_code, quantity, unit_cost, due_date, settlement_status } = body
        assert(counterparty && item_name && txn_date, 'Required fields missing.')

        const { data, error } = await db.from('borrowings').insert({
          owner_user_id: ownerUserId,
          counterparty: text(counterparty),
          item_name: text(item_name),
          direction: String(direction ?? 'borrowed'),
          txn_date,
          item_type: text(item_type) || 'Material',
          item_code: optionalText(item_code),
          quantity: Math.max(0, number(quantity, 1)),
          unit_cost: Math.max(0, number(unit_cost)),
          due_date: optionalText(due_date),
          settlement_status: text(settlement_status) || 'Open',
          notes: optionalText(body.notes),
        }).select().single()
        if (error) throw error
        return NextResponse.json(data)
      }

      case 'expenses': {
        const { amount, category, expense_date, description, platform } = body
        assert(category && amount > 0 && expense_date, 'Required fields missing.')

        const { data, error } = await db.from('business_expenses').insert({
          owner_user_id: ownerUserId,
          expense_date,
          category: text(category),
          amount: Math.max(0, number(amount)),
          description: optionalText(description),
          platform: optionalText(platform),
        }).select().single()
        if (error) throw error
        return NextResponse.json(data)
      }

      case 'purchases': {
        const { material_id, supplier_id, purchase_date, quantity, unit, unit_price, gst_rate, transport_cost, invoice_no } = body
        assert(material_id && supplier_id && purchase_date && quantity, 'Required fields missing.')

        const { data: mat, error: matErr } = await db.from('materials').select('unit').eq('id', material_id).eq('owner_user_id', ownerUserId).maybeSingle()
        if (matErr) throw matErr
        if (!mat) throw new Error('Material not found')

        const { data: sup, error: supErr } = await db.from('suppliers').select('id').eq('id', supplier_id).eq('owner_user_id', ownerUserId).maybeSingle()
        if (supErr) throw supErr
        if (!sup) throw new Error('Supplier not found')

        const unitVal = text(unit) || mat.unit || 'pcs'
        const unitPrice = Math.max(0, number(unit_price))
        const gstRate = Math.max(0, number(gst_rate))
        const transportCost = Math.max(0, number(transport_cost))
        const qty = Math.max(0, number(quantity, 1))

        const subtotal = qty * unitPrice
        const gstAmount = subtotal * (gstRate / 100)
        const totalAmount = subtotal + gstAmount + transportCost

        const { data, error } = await db.from('material_purchases').insert({
          owner_user_id: ownerUserId,
          purchase_date,
          supplier_id,
          material_id,
          quantity: qty,
          unit: unitVal,
          unit_price: unitPrice,
          subtotal,
          gst_rate: gstRate,
          gst_amount: gstAmount,
          transport_cost: transportCost,
          total_amount: totalAmount,
          invoice_no: optionalText(invoice_no),
          notes: optionalText(body.notes),
        }).select().single()
        if (error) throw error
        return NextResponse.json(data)
      }

      default:
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } catch (error) {
    return jsonError(error)
  }
}