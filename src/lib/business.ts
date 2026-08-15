export type RecordRow = Record<string, unknown>

export function asNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatCurrency(value: unknown, locale = 'en-IN', currency = 'INR') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(asNumber(value))
}

export function formatNumber(value: unknown, locale = 'en-IN') {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(asNumber(value))
}

export function toDateInput(value: unknown) {
  return String(value || new Date().toISOString()).slice(0, 10)
}

export function stableLineKey(orderId: string, skuId: string, explicit?: string) {
  return explicit?.trim() || `${orderId.trim()}::${skuId}`
}

export function sum(rows: RecordRow[], selector: (row: RecordRow) => unknown) {
  return rows.reduce((total, row) => total + asNumber(selector(row)), 0)
}

/* ═══════════════════════════════════════════════════════════════════════════
   IMPORT UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function fromExcelSerial(serial: number) {
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000)
  const date = new Date(utc)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function importNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const cleaned = String(value ?? '')
    .replace(/[,₹$€£%\s]/g, '')
    .replace(/[^0-9.-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return fallback
  const parsed = asNumber(cleaned)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function importDate(value: unknown): string {
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

export function normalizeImportStatus(value: unknown): string {
  const status = String(value ?? '').trim()
  if (!status) return 'Delivered'
  const lower = status.toLowerCase()
  if (lower.includes('return')) return 'Returned'
  if (lower.includes('cancel')) return 'Cancelled'
  if (lower.includes('deliver') || lower.includes('complete') || lower.includes('fulfill') || lower.includes('shipped')) {
    return 'Delivered'
  }
  if (lower.includes('pack')) return 'Packed'
  if (lower.includes('pending') || lower.includes('process')) return 'Pending'
  return status
}

export function skuLookupKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * Canonical, case-insensitive identity for a SKU code used as the dedup key.
 * Normalization = trim whitespace, strip invisible/control characters,
 * collapse internal whitespace, lowercase. Visible punctuation (e.g. hyphens,
 * underscores) is preserved — two different normalized strings are two
 * different SKUs (exact match only, no fuzzy/similarity matching).
 */
export function normalizeSkuKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function valueFor(row: Record<string, unknown>, field: string, mapping?: Record<string, string | undefined>) {
  const configured = mapping?.[field]
  if (configured && Object.prototype.hasOwnProperty.call(row, configured)) return row[configured]

  // Fallback: try to find by alias
  const aliases: Record<string, string[]> = {
    orderId: ['order id', 'order_id', 'order number', 'order no', 'amazon order id', 'sale order number', 'sub order no', 'sub order number', 'sub-order id', 'order', 'invoice number', 'invoice no', 'bill no', 'name'],
    lineKey: ['line item id', 'line item', 'order item id', 'order_item_id', 'item id', 'sub order id', 'sub order no', 'sub_order_no', 'line key', 'line id'],
    skuCode: ['sku', 'sku code', 'seller sku', 'seller-sku', 'seller sku id', 'merchant sku', 'product sku', 'sku id', 'item sku', 'style id', 'product id', 'fsn', 'asin', 'item code'],
    productName: ['product name', 'product title', 'item name', 'item title', 'title', 'listing title', 'product', 'sku name', 'item description', 'description', 'product name / title', 'lineitem name'],
    orderDate: ['order date', 'purchase date', 'order created date', 'order date/time', 'order date and time', 'sale date', 'created date', 'date', 'invoice date', 'bill date', 'created at'],
    qtyOrdered: ['quantity', 'qty', 'quantity ordered', 'ordered quantity', 'order qty', 'units', 'item quantity', 'qty ordered', 'lineitem quantity', 'item-quantity'],
    qtyDelivered: ['quantity delivered', 'delivered quantity', 'shipped quantity', 'fulfilled quantity', 'quantity shipped', 'qty delivered', 'qty shipped', 'delivered qty', 'dispatched quantity'],
    qtyReturned: ['quantity returned', 'returned quantity', 'returns', 'qty returned', 'return quantity', 'return qty', 'rto qty'],
    salePrice: ['sale price', 'selling price', 'sale price/unit', 'selling price/unit', 'item price', 'product sale price', 'amount', 'unit price', 'price', 'meesho price', 'final_invoice_amount', 'lineitem price', 'taxable value', 'total amount', 'principal-amount'],
    status: ['status', 'order status', 'item status', 'shipment status', 'flipkart_status', 'financial status', 'fulfillment status'],
    deliveryDate: ['delivery date', 'delivered date', 'shipment date', 'ship date', 'fulfillment date', 'dispatch date'],
    returnDate: ['return date', 'returned date'],
    refundAmount: ['refund amount', 'refund', 'return amount', 'refunded amount', 'reversal amount'],
    customerLocation: ['customer location', 'customer city/state', 'ship city', 'ship-city', 'shipping city', 'ship to city', 'customer city', 'customer state', 'place of supply', 'city', 'state'],
  }

  const key = Object.keys(row).find((candidate) => {
    const candidateNormalized = candidate.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    return aliases[field]?.some(
      (alias) => candidateNormalized === alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || candidateNormalized.includes(alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()),
    )
  })
  return key ? row[key] : undefined
}
