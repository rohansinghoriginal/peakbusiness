import { asNumber } from './business'
import * as XLSX from 'xlsx'

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
}

export const fieldAliases: Record<string, string[]> = {
  orderId: [
    'order id',
    'order_id',
    'order number',
    'order no',
    'amazon order id',
    'sale order number',
    'sub order no',
    'sub order number',
    'sub-order id',
    'order',
    'invoice number',
    'invoice no',
    'bill no',
    'name',
  ],
  lineKey: [
    'line item id',
    'line item',
    'order item id',
    'order_item_id',
    'item id',
    'sub order id',
    'sub order no',
    'sub_order_no',
    'line key',
    'line id',
  ],
  skuCode: [
    'sku',
    'sku code',
    'seller sku',
    'seller-sku',
    'seller sku id',
    'merchant sku',
    'product sku',
    'sku id',
    'item sku',
    'style id',
    'product id',
    'fsn',
    'asin',
    'item code',
  ],
  productName: [
    'product name',
    'product title',
    'item name',
    'item title',
    'title',
    'listing title',
    'product',
    'sku name',
    'item description',
    'description',
    'product name / title',
    'lineitem name',
  ],
  orderDate: [
    'order date',
    'purchase date',
    'order created date',
    'order date/time',
    'order date and time',
    'sale date',
    'created date',
    'date',
    'invoice date',
    'bill date',
    'created at',
  ],
  qtyOrdered: [
    'quantity',
    'qty',
    'quantity ordered',
    'ordered quantity',
    'order qty',
    'units',
    'item quantity',
    'qty ordered',
    'lineitem quantity',
    'item-quantity',
  ],
  qtyDelivered: [
    'quantity delivered',
    'delivered quantity',
    'shipped quantity',
    'fulfilled quantity',
    'quantity shipped',
    'qty delivered',
    'qty shipped',
    'delivered qty',
    'dispatched quantity',
  ],
  qtyReturned: [
    'quantity returned',
    'returned quantity',
    'returns',
    'qty returned',
    'return quantity',
    'return qty',
    'rto qty',
  ],
  salePrice: [
    'sale price',
    'selling price',
    'sale price/unit',
    'selling price/unit',
    'item price',
    'product sale price',
    'amount',
    'unit price',
    'price',
    'meesho price',
    'final_invoice_amount',
    'lineitem price',
    'taxable value',
    'total amount',
    'principal-amount',
  ],
  status: ['status', 'order status', 'item status', 'shipment status', 'flipkart_status', 'financial status', 'fulfillment status'],
  deliveryDate: ['delivery date', 'delivered date', 'shipment date', 'ship date', 'fulfillment date', 'dispatch date'],
  returnDate: ['return date', 'returned date'],
  refundAmount: ['refund amount', 'refund', 'return amount', 'refunded amount', 'reversal amount'],
  customerLocation: [
    'customer location',
    'customer city/state',
    'ship city',
    'ship-city',
    'shipping city',
    'ship to city',
    'customer city',
    'customer state',
    'place of supply',
    'city',
    'state',
  ],
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENTITY-SPECIFIC FIELD ALIASES & SCORING
   ═══════════════════════════════════════════════════════════════════════════ */

export const entityFieldAliases: Record<EntityType, Record<string, string[]>> = {
  orders: {
    orderId: fieldAliases.orderId,
    lineKey: fieldAliases.lineKey,
    skuCode: fieldAliases.skuCode,
    productName: fieldAliases.productName,
    orderDate: fieldAliases.orderDate,
    qtyOrdered: fieldAliases.qtyOrdered,
    qtyDelivered: fieldAliases.qtyDelivered,
    qtyReturned: fieldAliases.qtyReturned,
    salePrice: fieldAliases.salePrice,
    status: fieldAliases.status,
    deliveryDate: fieldAliases.deliveryDate,
    returnDate: fieldAliases.returnDate,
    refundAmount: fieldAliases.refundAmount,
    customerLocation: fieldAliases.customerLocation,
  },
  returns: {
    orderId: fieldAliases.orderId,
    lineKey: fieldAliases.lineKey,
    skuCode: fieldAliases.skuCode,
    productName: fieldAliases.productName,
    orderDate: fieldAliases.orderDate,
    qtyReturned: fieldAliases.qtyReturned,
    returnDate: fieldAliases.returnDate,
    refundAmount: fieldAliases.refundAmount,
    status: fieldAliases.status,
    returnReason: ['return reason', 'reason for return', 'rto reason', 'cancellation reason'],
    customerLocation: fieldAliases.customerLocation,
  },
  settlement: {
    orderId: fieldAliases.orderId,
    lineKey: fieldAliases.lineKey,
    skuCode: fieldAliases.skuCode,
    productName: fieldAliases.productName,
    orderDate: fieldAliases.orderDate,
    salePrice: ['net amount', 'settlement amount', 'payout amount', 'disbursement amount', 'final amount'],
    fee: ['fee', 'commission', 'marketplace fee', 'platform fee', 'service fee', 'transaction fee'],
    tax: ['tax', 'gst', 'tcs', 'tds', 'tax amount'],
    status: ['status', 'settlement status', 'payout status'],
    settlementDate: ['settlement date', 'payout date', 'disbursement date', 'payment date'],
  },
  skus: {
    skuCode: ['sku', 'sku code', 'seller sku', 'seller-sku', 'merchant sku', 'product sku', 'sku id', 'item sku', 'style id', 'product id', 'fsn', 'asin', 'item code'],
    productName: ['product name', 'product title', 'item name', 'item title', 'title', 'listing title', 'product', 'sku name', 'item description', 'description'],
    platform: ['platform', 'channel', 'marketplace', 'sales channel'],
    sellingPrice: ['selling price', 'sale price', 'price', 'mrp', 'list price', 'unit price', 'standard price'],
    costPerUnit: ['cost', 'cost per unit', 'unit cost', 'purchase cost', 'landed cost', 'cost price'],
    openingStock: ['opening stock', 'initial stock', 'stock', 'quantity', 'qty', 'opening qty'],
    reorderLevel: ['reorder level', 'reorder point', 'min stock', 'minimum stock', 'alert level'],
    category: ['category', 'product category', 'type', 'product type'],
    active: ['active', 'status', 'is active', 'enabled'],
  },
  materials: {
    materialCode: ['material code', 'material id', 'material sku', 'item code', 'raw material code', 'rm code'],
    materialName: ['material name', 'material', 'item name', 'raw material name', 'rm name'],
    category: ['category', 'material category', 'type', 'material type'],
    unit: ['unit', 'uom', 'unit of measure', 'measurement unit'],
    openingStock: ['opening stock', 'initial stock', 'stock', 'quantity', 'qty', 'opening qty'],
    reorderLevel: ['reorder level', 'reorder point', 'min stock', 'minimum stock', 'alert level'],
    avgUnitCost: ['avg unit cost', 'average cost', 'unit cost', 'cost per unit', 'standard cost'],
    preferredVendor: ['preferred vendor', 'supplier', 'vendor', 'preferred supplier'],
  },
  borrowings: {
    direction: ['direction', 'type', 'borrow/lend', 'transaction type'],
    txnDate: ['date', 'transaction date', 'txn date', 'borrow date', 'lend date'],
    counterparty: ['counterparty', 'party', 'person', 'company', 'friend', 'name', 'borrower', 'lender'],
    itemType: ['item type', 'type', 'item category', 'material/product'],
    itemCode: ['item code', 'item id', 'sku', 'material code', 'product code'],
    itemName: ['item name', 'item', 'product name', 'material name', 'description'],
    quantity: ['quantity', 'qty', 'amount', 'units'],
    unitCost: ['unit cost', 'cost', 'price per unit', 'rate'],
    dueDate: ['due date', 'return date', 'expected return', 'deadline'],
    returnDate: ['return date', 'actual return date', 'returned date'],
    settlementStatus: ['settlement status', 'status', 'settled', 'open', 'closed'],
  },
  purchases: {
    purchaseDate: ['purchase date', 'date', 'order date', 'invoice date'],
    supplierId: ['supplier', 'vendor', 'supplier name', 'vendor name', 'supplier id', 'vendor id'],
    materialId: ['material', 'material code', 'item code', 'raw material', 'product'],
    quantity: ['quantity', 'qty', 'ordered qty', 'units'],
    unit: ['unit', 'uom', 'unit of measure'],
    unitPrice: ['unit price', 'price', 'rate', 'cost per unit', 'purchase price'],
    gstRate: ['gst', 'gst rate', 'tax rate', 'tax %'],
    transportCost: ['transport', 'freight', 'shipping', 'transport cost', 'delivery cost'],
    invoiceNo: ['invoice no', 'invoice number', 'bill no', 'bill number', 'po number'],
  },
  expenses: {
    expenseDate: ['date', 'expense date', 'transaction date'],
    category: ['category', 'expense category', 'type', 'expense type'],
    amount: ['amount', 'cost', 'expense amount', 'total', 'value'],
    description: ['description', 'details', 'narration', 'purpose', 'reason', 'note'],
    platform: ['platform', 'channel', 'marketplace', 'sales channel'],
  },
  suppliers: {
    supplierName: ['supplier name', 'vendor name', 'company name', 'name', 'supplier', 'vendor'],
    address: ['address', 'location', 'full address', 'street address'],
    gstin: ['gstin', 'gst number', 'gst id', 'gstno', 'gst no'],
    phone: ['phone', 'mobile', 'contact', 'telephone', 'phone number'],
    email: ['email', 'e-mail', 'email address', 'mail'],
    defaultGstRate: ['default gst', 'gst rate', 'tax rate', 'standard gst'],
    defaultTransportCost: ['default transport', 'transport cost', 'freight', 'standard transport'],
  },
  sku_materials: {
    skuCode: fieldAliases.skuCode,
    materialCode: ['material code', 'material id', 'material sku', 'item code', 'raw material code', 'rm code'],
    qtyPerUnit: ['qty per unit', 'quantity per unit', 'units per', 'consumption', 'usage per unit', 'qty/unit'],
    wastePct: ['waste %', 'waste percentage', 'wastage', 'loss %', 'waste pct'],
  },
  material_transactions: {
    txnDate: ['date', 'transaction date', 'txn date'],
    materialId: ['material', 'material code', 'item code', 'raw material', 'material id'],
    txnType: ['type', 'transaction type', 'movement type', 'txn type', 'in/out'],
    qtyIn: ['qty in', 'quantity in', 'received', 'inward', 'stock in', 'in qty'],
    qtyOut: ['qty out', 'quantity out', 'issued', 'outward', 'stock out', 'consumed', 'out qty'],
    unitCost: ['unit cost', 'cost', 'rate', 'price'],
    reference: ['reference', 'ref', 'order id', 'po number', 'invoice no', 'batch'],
    source: ['source', 'origin', 'from', 'transaction source'],
  },
  unknown: {},
}

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function skuLookupKey(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * Entity-aware deterministic mapping using entity-specific field aliases.
 * Much faster than AI - uses local alias matching with entity context.
 */
export function deterministicMappingForEntity(
  headers: string[],
  entityType: EntityType = 'orders'
): ImportMapping {
  const aliases = entityFieldAliases[entityType] || fieldAliases
  const normalizedHeaders = headers.map((header) => ({ original: header, normalized: normalized(header) }))
  const mapping: ImportMapping = {}
  const used = new Set<string>()

  for (const [field, fieldAliasesList] of Object.entries(aliases)) {
    const exact = normalizedHeaders.find(
      (header) => !used.has(header.original) && fieldAliasesList.some((alias) => header.normalized === normalized(alias)),
    )
    const fuzzy =
      exact ||
      normalizedHeaders.find(
        (header) =>
          !used.has(header.original) && fieldAliasesList.some((alias) => header.normalized.includes(normalized(alias))),
      )
    if (fuzzy) {
      mapping[field] = fuzzy.original
      used.add(fuzzy.original)
    }
  }

  return mapping
}

/**
 * Legacy deterministic mapping for backward compatibility (orders only)
 */
export function deterministicMapping(headers: string[]): ImportMapping {
  return deterministicMappingForEntity(headers, 'orders')
}

/**
 * Automatically inspects document headers, sample cells, file name, and text snippets
 * to identify document type, target sales platform, confidence score, and verification readiness.
 */
export function detectDocumentAndPlatform(
  headers: string[],
  sampleRows: RawRow[] = [],
  fileName = '',
  rawTextSnippet = '',
): DocumentAnalysis {
  const normHeaders = headers.map(normalized)
  const allText = [
    fileName.toLowerCase(),
    rawTextSnippet.toLowerCase(),
    headers.join(' ').toLowerCase(),
    sampleRows.map((r) => Object.values(r).join(' ')).join(' ').toLowerCase(),
  ].join(' ')

  let amazonScore = 0
  let meeshoScore = 0
  let flipkartScore = 0
  let shopifyScore = 0
  let gstScore = 0
  let genericScore = 0

  // 1. Amazon signatures
  if (normHeaders.some((h) => h.includes('amazon order id') || h === 'asin' || h === 'seller sku' || h === 'easy ship' || h === 'fba')) amazonScore += 50
  if (normHeaders.some((h) => h.includes('principal amount') || h.includes('item status') || h.includes('ship city'))) amazonScore += 25
  if (allText.includes('amazon') || allText.includes('amzn') || allText.includes('fba') || allText.includes('easy ship') || allText.includes('merchant tax report') || allText.includes('mtr')) amazonScore += 30

  // 2. Meesho signatures
  if (normHeaders.some((h) => h.includes('sub order no') || h.includes('sub_order_no') || h.includes('meesho price') || h.includes('supplier discounted price'))) meeshoScore += 55
  if (normHeaders.some((h) => h.includes('return reason') || h.includes('dispatch date') || h.includes('customer state'))) meeshoScore += 25
  if (allText.includes('meesho') || allText.includes('fashnear') || allText.includes('supplier settlement') || allText.includes('sub order')) meeshoScore += 30

  // 3. Flipkart signatures
  if (normHeaders.some((h) => h.includes('order item id') || h === 'fsn' || h.includes('flipkart status') || h.includes('listing id'))) flipkartScore += 55
  if (normHeaders.some((h) => h.includes('final invoice amount') || h.includes('service profile') || h.includes('tier'))) flipkartScore += 25
  if (allText.includes('flipkart') || allText.includes('fk') || allText.includes('ekart') || allText.includes('marketplace seller')) flipkartScore += 30

  // 4. Shopify signatures
  if (normHeaders.some((h) => h.includes('lineitem name') || h.includes('lineitem sku') || h.includes('financial status') || h.includes('fulfillment status'))) shopifyScore += 55
  if (normHeaders.some((h) => h.includes('lineitem price') || h.includes('lineitem quantity') || h.includes('discount amount'))) shopifyScore += 25
  if (allText.includes('shopify') || allText.includes('shopify_orders') || allText.includes('myshopify')) shopifyScore += 30

  // 5. GST / B2B Invoice signatures
  if (normHeaders.some((h) => h.includes('gstin') || h.includes('place of supply') || h.includes('taxable value') || h.includes('integrated tax'))) gstScore += 50
  if (allText.includes('gstr') || allText.includes('tax invoice') || allText.includes('b2b') || allText.includes('b2c')) gstScore += 25

  // 6. Generic Sales / Order structure
  const mapping = deterministicMapping(headers)
  const hasOrderId = Boolean(mapping.orderId || mapping.lineKey)
  const hasProduct = Boolean(mapping.skuCode || mapping.productName)
  const hasPrice = Boolean(mapping.salePrice)
  const hasDate = Boolean(mapping.orderDate)

  if (hasOrderId) genericScore += 30
  if (hasProduct) genericScore += 30
  if (hasPrice) genericScore += 20
  if (hasDate) genericScore += 15

  // Determine winning platform & doc type
  const scores = [
    { platform: 'Amazon' as const, docType: 'AMAZON_SALES_REPORT' as const, name: 'Amazon Sales / MTR Report', score: amazonScore },
    { platform: 'Meesho' as const, docType: 'MEESHO_ORDERS_REPORT' as const, name: 'Meesho Orders / Settlement', score: meeshoScore },
    { platform: 'Flipkart' as const, docType: 'FLIPKART_SALES_REPORT' as const, name: 'Flipkart Sales Ledger', score: flipkartScore },
    { platform: 'Shopify' as const, docType: 'SHOPIFY_ORDERS_REPORT' as const, name: 'Shopify Orders Export', score: shopifyScore },
    { platform: 'Offline' as const, docType: 'GST_TAX_INVOICE' as const, name: 'GST Tax Invoices / B2B Ledger', score: gstScore },
  ]

  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]

  let docType: DocumentType = 'GENERIC_ORDER_DATA'
  let docTypeName = 'Generic Orders Spreadsheet'
  let detectedPlatform: 'Amazon' | 'Meesho' | 'Flipkart' | 'Shopify' | 'Offline' = 'Offline'
  let confidence = Math.min(Math.max(genericScore, 40), 90)

  if (top.score >= 40) {
    docType = top.docType
    docTypeName = top.name
    detectedPlatform = top.platform
    confidence = Math.min(top.score + 20, 99)
  } else if (hasOrderId && hasProduct) {
    docType = 'GENERIC_ORDER_DATA'
    docTypeName = 'Generic Orders Spreadsheet'
    detectedPlatform = 'Offline'
    confidence = Math.min(genericScore, 85)
  } else {
    docType = 'UNRECOGNIZED'
    docTypeName = 'Unrecognized / Non-Order Document'
    detectedPlatform = 'Offline'
    confidence = 10
  }

  const isValidOrderDoc = hasOrderId && hasProduct
  let validationSummary = ''
  if (isValidOrderDoc) {
    validationSummary = `Valid order document verified. Mapped Order ID and Product identifiers successfully.`
  } else if (!hasOrderId && !hasProduct) {
    validationSummary = `Missing essential Order ID and SKU/Product columns. Please check if this is an order report.`
  } else if (!hasOrderId) {
    validationSummary = `Found product columns, but could not detect an Order ID or Invoice number column.`
  } else {
    validationSummary = `Found Order IDs, but could not detect a SKU or Product name column.`
  }

  return {
    docType,
    docTypeName,
    detectedPlatform,
    confidence,
    isValidOrderDoc,
    validationSummary,
    recommendedMapping: mapping,
  }
}

/**
 * Universal text/PDF row extractor.
 * Converts multi-line unstructured text, PDF table text, or CSV/TSV into tabular RawRow records.
 */
export function parseUnstructuredTextToRows(text: string): { rows: RawRow[]; headers: string[]; rawTextSnippet: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (!lines.length) return { rows: [], headers: [], rawTextSnippet: '' }

  const rawTextSnippet = lines.slice(0, 15).join('\n')

  // Check if it's tab-separated or comma-separated
  const hasTabs = lines.some((l) => l.includes('\t'))
  const delimiter = hasTabs ? '\t' : lines[0].includes(',') ? ',' : null

  if (delimiter) {
    const rawHeaders = lines[0].split(delimiter).map((h) => h.replace(/^["']|["']$/g, '').trim())
    const rows: RawRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(delimiter).map((p) => p.replace(/^["']|["']$/g, '').trim())
      if (parts.length < 2) continue
      const row: RawRow = {}
      rawHeaders.forEach((h, idx) => {
        row[h || `col_${idx + 1}`] = parts[idx] ?? ''
      })
      rows.push(row)
    }
    return { rows, headers: rawHeaders, rawTextSnippet }
  }

  // Heuristic invoice / line item parser for text/PDF
  // Match lines containing an order/invoice number, product description, quantity, and price
  const rows: RawRow[] = []
  const orderIdPattern = /(?:order|inv|bill|#)[\s:-]*([a-z0-9\-_]{4,30})/i
  const datePattern = /(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4})/
  const pricePattern = /(?:₹|rs\.?|inr|\$)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/i

  let currentOrderId = 'ORDER-1'
  let currentDate = new Date().toISOString().slice(0, 10)

  for (const line of lines) {
    const orderMatch = line.match(orderIdPattern)
    if (orderMatch) currentOrderId = orderMatch[1]

    const dateMatch = line.match(datePattern)
    if (dateMatch) currentDate = importDate(dateMatch[1])

    // Check if line looks like an item row: has words followed by numbers
    const tokens = line.split(/\s{2,}|\s*\|\s*/).filter(Boolean)
    if (tokens.length >= 2) {
      const numericIndex = tokens.findIndex((t) => pricePattern.test(t) && !isNaN(Number(t.replace(/[^\d.]/g, ''))))
      if (numericIndex > 0) {
        const itemDesc = tokens.slice(0, numericIndex).join(' ')
        const price = importNumber(tokens[numericIndex])
        const qty = numericIndex + 1 < tokens.length ? importNumber(tokens[numericIndex + 1], 1) : 1

        rows.push({
          'Order ID': currentOrderId,
          'Order Date': currentDate,
          'Product Name': itemDesc,
          'SKU Code': itemDesc.split(/\s+/)[0]?.toUpperCase() || 'ITEM',
          'Quantity Ordered': qty,
          'Sale Price': price,
          'Status': 'Delivered',
        })
      }
    }
  }

  const defaultHeaders = ['Order ID', 'Order Date', 'Product Name', 'SKU Code', 'Quantity Ordered', 'Sale Price', 'Status']
  return {
    rows,
    headers: rows.length ? Object.keys(rows[0]) : defaultHeaders,
    rawTextSnippet,
  }
}

export function valueFor(row: RawRow, field: string, mapping?: ImportMapping) {
  const configured = mapping?.[field]
  if (configured && Object.prototype.hasOwnProperty.call(row, configured)) return row[configured]

  const key = Object.keys(row).find((candidate) => {
    const candidateNormalized = normalized(candidate)
    return fieldAliases[field]?.some(
      (alias) => candidateNormalized === normalized(alias) || candidateNormalized.includes(normalized(alias)),
    )
  })
  return key ? row[key] : undefined
}

export function importNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const cleaned = String(value ?? '')
    .replace(/[,₹$€£%\s]/g, '')
    .replace(/[^0-9.-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return fallback
  const parsed = asNumber(cleaned)
  return Number.isFinite(parsed) ? parsed : fallback
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function fromExcelSerial(serial: number) {
  // Excel's day 0 is 1899-12-30 in the Windows date system.
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000)
  const date = new Date(utc)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function importDate(value: unknown) {
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

export function normalizeImportStatus(value: unknown) {
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

export function serializeImportRows(rows: RawRow[]): RawRow[] {
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

/* ═══════════════════════════════════════════════════════════════════════════
   MULTI-SHEET INTELLIGENCE & AI FIELD INFERENCE
   ═══════════════════════════════════════════════════════════════════════════ */

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
  // Entity classification
  entityType: EntityType
  entityConfidence: number
  // Cross-sheet relationship
  isOrdersSheet: boolean
  isReturnsSheet: boolean
  isSettlementSheet: boolean
  relatedSheetNames: string[]
}

/**
 * Score a sheet's headers + sample data on a 0-100 scale for how likely it
 * contains order / sales data.  Used to pick the best sheet in a multi-sheet
 * workbook.
 */
export function scoreSheetForOrderData(headers: string[], sampleRows: RawRow[], sheetName = ''): number {
  if (!headers.length) return 0

  const normHeaders = headers.map(normalized)

  // Penalty: sheets named like metadata / summary
  const skipPatterns = [
    'summary', 'config', 'notes', 'metadata', 'instructions', 'readme', 'help', 'settings', 'template',
    'cover', 'index', 'toc', 'legend', 'key', 'about', 'info', 'dashboard', 'report', 'pivot',
    'chart', 'graph', 'analysis', 'kpi', 'metrics', 'overview', 'master', 'settings', 'template'
  ]
  const nameNorm = normalized(sheetName)
  if (skipPatterns.some((p) => nameNorm === p || nameNorm.includes(p))) return 0

  // Count how many of our known field alias groups get a match
  const mapping = deterministicMapping(headers)
  let fieldHits = 0
  const criticalFields = ['orderId', 'lineKey', 'skuCode', 'productName', 'salePrice', 'orderDate', 'qtyOrdered', 'status']
  for (const field of criticalFields) {
    if (mapping[field]) fieldHits++
  }

  // At least orderId/lineKey AND (skuCode OR productName) to be useful
  const hasIdentifier = Boolean(mapping.orderId || mapping.lineKey)
  const hasProduct = Boolean(mapping.skuCode || mapping.productName)

  let score = fieldHits * 12 // up to ~96 for all 8 fields

  // Bonus for critical pair
  if (hasIdentifier && hasProduct) score += 10
  else if (!hasIdentifier && !hasProduct) score = Math.min(score, 15)

  // Bonus for reasonable row count
  if (sampleRows.length >= 2) score += 5
  if (sampleRows.length >= 5) score += 5
  if (sampleRows.length >= 20) score += 5

  // Penalty for very few columns (likely not a data sheet)
  if (headers.length < 3) score = Math.max(score - 30, 0)
  if (headers.length < 2) return 0

  // Bonus: sample data has values that look like order IDs, dates, prices
  if (sampleRows.length > 0) {
    const sampleValues = sampleRows.slice(0, 5).flatMap((r) => Object.values(r).map((v) => String(v ?? '')))
    const hasDateLike = sampleValues.some((v) => /\d{4}[\/-]\d{2}[\/-]\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4}/.test(v))
    const hasPriceLike = sampleValues.some((v) => /^[₹$€£]?\s?\d+([.,]\d+)?$/.test(v.trim()))
    const hasIdLike = sampleValues.some((v) => /^[A-Z0-9]{3,}[\-_]/.test(v) || /^\d{6,}$/.test(v) || /^#?\d{4,}$/.test(v))
    if (hasDateLike) score += 5
    if (hasPriceLike) score += 5
    if (hasIdLike) score += 5
  }

  // Sheet name bonuses for common order sheet names
  const nameLower = sheetName.toLowerCase()
  const orderSheetNames = ['order', 'sale', 'sales', 'transaction', 'transactions', 'invoice', 'invoices', 'data', 'raw', 'ledger', 'register', 'book']
  const returnSheetNames = ['return', 'rto', 'refund', 'reversal', 'cancel', 'cancelled']
  const settlementSheetNames = ['settlement', 'payout', 'disbursement', 'payment', 'reconciliation']
  
  if (orderSheetNames.some(n => nameLower.includes(n))) score += 15
  if (returnSheetNames.some(n => nameLower.includes(n))) score += 10
  if (settlementSheetNames.some(n => nameLower.includes(n))) score += 8

  return Math.min(score, 100)
}

/**
 * Detect platform from sheet content
 */
export function detectPlatformFromSheet(headers: string[], sampleRows: RawRow[], sheetName = ''): { platform: PlatformType; confidence: number } {
  const normHeaders = headers.map(normalized)
  const allText = [
    sheetName.toLowerCase(),
    headers.join(' ').toLowerCase(),
    sampleRows.map((r) => Object.values(r).join(' ')).join(' ').toLowerCase(),
  ].join(' ')

  let amazonScore = 0, meeshoScore = 0, flipkartScore = 0, shopifyScore = 0

  // Amazon signatures
  if (normHeaders.some((h) => h.includes('amazon order id') || h === 'asin' || h === 'seller sku' || h === 'easy ship' || h === 'fba')) amazonScore += 50
  if (normHeaders.some((h) => h.includes('principal amount') || h.includes('item status') || h.includes('ship city'))) amazonScore += 25
  if (allText.includes('amazon') || allText.includes('amzn') || allText.includes('fba') || allText.includes('easy ship') || allText.includes('merchant tax report') || allText.includes('mtr')) amazonScore += 30

  // Meesho signatures
  if (normHeaders.some((h) => h.includes('sub order no') || h.includes('sub_order_no') || h.includes('meesho price') || h.includes('supplier discounted price'))) meeshoScore += 55
  if (normHeaders.some((h) => h.includes('return reason') || h.includes('dispatch date') || h.includes('customer state'))) meeshoScore += 25
  if (allText.includes('meesho') || allText.includes('fashnear') || allText.includes('supplier settlement') || allText.includes('sub order')) meeshoScore += 30

  // Flipkart signatures
  if (normHeaders.some((h) => h.includes('order item id') || h === 'fsn' || h.includes('flipkart status') || h.includes('listing id'))) flipkartScore += 55
  if (normHeaders.some((h) => h.includes('final invoice amount') || h.includes('service profile') || h.includes('tier'))) flipkartScore += 25
  if (allText.includes('flipkart') || allText.includes('fk') || allText.includes('ekart') || allText.includes('marketplace seller')) flipkartScore += 30

  // Shopify signatures
  if (normHeaders.some((h) => h.includes('lineitem name') || h.includes('lineitem sku') || h.includes('financial status') || h.includes('fulfillment status'))) shopifyScore += 55
  if (normHeaders.some((h) => h.includes('lineitem price') || h.includes('lineitem quantity') || h.includes('discount amount'))) shopifyScore += 25
  if (allText.includes('shopify') || allText.includes('shopify_orders') || allText.includes('myshopify')) shopifyScore += 30

  const scores = [
    { platform: 'Amazon' as PlatformType, score: amazonScore },
    { platform: 'Meesho' as PlatformType, score: meeshoScore },
    { platform: 'Flipkart' as PlatformType, score: flipkartScore },
    { platform: 'Shopify' as PlatformType, score: shopifyScore },
  ]
  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  
  if (top.score >= 40) {
    return { platform: top.platform, confidence: Math.min(top.score + 15, 99) }
  }
  return { platform: 'Offline', confidence: 50 }
}

/**
 * Detect sheet type (orders, returns, settlement)
 */
export function detectSheetType(headers: string[], sampleRows: RawRow[], sheetName = ''): { isOrders: boolean; isReturns: boolean; isSettlement: boolean } {
  const normHeaders = headers.map(normalized)
  const allText = [
    sheetName.toLowerCase(),
    headers.join(' ').toLowerCase(),
    sampleRows.map((r) => Object.values(r).join(' ')).join(' ').toLowerCase(),
  ].join(' ')

  const isReturns = normHeaders.some(h => 
    h.includes('return') || h.includes('rto') || h.includes('refund') || h.includes('reversal') || h.includes('cancel')
  ) || allText.includes('return') || allText.includes('rto') || allText.includes('refund')
  
  const isSettlement = normHeaders.some(h => 
    h.includes('settlement') || h.includes('payout') || h.includes('disbursement') || h.includes('reconciliation') || 
    h.includes('net amount') || h.includes('total amount') || h.includes('fee') || h.includes('commission')
  ) || allText.includes('settlement') || allText.includes('payout') || allText.includes('disbursement')
  
  const isOrders = !isReturns && !isSettlement && (
    normHeaders.some(h => h.includes('order') || h.includes('sale') || h.includes('invoice') || h.includes('transaction')) ||
    normHeaders.some(h => h.includes('sku') || h.includes('product') || h.includes('item'))
  )

  return { isOrders, isReturns, isSettlement }
}

/**
 * Classify a sheet into an entity type with confidence score.
 * Priority: orders > returns > settlement > skus > materials > borrowings > purchases > expenses > suppliers > sku_materials > material_transactions
 */
export function classifySheetEntity(
  headers: string[],
  sampleRows: RawRow[],
  sheetName = ''
): { entityType: EntityType; entityConfidence: number; scores: Record<EntityType, number> } {
  const normHeaders = headers.map(normalized)
  const nameLower = sheetName.toLowerCase()
  const allText = [
    nameLower,
    headers.join(' ').toLowerCase(),
    sampleRows.map((r) => Object.values(r).join(' ')).join(' ').toLowerCase(),
  ].join(' ')

  const scores: Record<EntityType, number> = {
    orders: 0,
    returns: 0,
    settlement: 0,
    skus: 0,
    materials: 0,
    borrowings: 0,
    purchases: 0,
    expenses: 0,
    suppliers: 0,
    sku_materials: 0,
    material_transactions: 0,
    unknown: 0,
  }

  // Helper to score against entity field aliases
  const scoreEntity = (entityType: EntityType): number => {
    const aliases = entityFieldAliases[entityType]
    if (!aliases || Object.keys(aliases).length === 0) return 0

    let fieldHits = 0
    let totalFields = 0
    for (const [field, fieldAliases] of Object.entries(aliases)) {
      totalFields++
      const hasMatch = normHeaders.some(h => 
        fieldAliases.some(alias => h.includes(normalized(alias)) || normalized(alias).includes(h))
      )
      if (hasMatch) fieldHits++
    }

    // Base score from field matches
    let score = totalFields > 0 ? Math.round((fieldHits / totalFields) * 70) : 0

    // Sheet name bonuses
    const nameKeywords: Record<EntityType, string[]> = {
      orders: ['order', 'sale', 'sales', 'transaction', 'transactions', 'invoice', 'invoices', 'ledger', 'register', 'book', 'data', 'raw'],
      returns: ['return', 'rto', 'refund', 'reversal', 'cancel', 'cancelled', 'returned'],
      settlement: ['settlement', 'payout', 'disbursement', 'payment', 'reconciliation', 'net amount', 'fee', 'commission'],
      skus: ['sku', 'product', 'catalog', 'master', 'item', 'listing', 'inventory'],
      materials: ['material', 'raw', 'rm ', 'packaging', 'consumable'],
      borrowings: ['borrow', 'lend', 'loan', 'borrowed', 'lent', 'counterparty', 'party'],
      purchases: ['purchase', 'procurement', 'buy', 'invoice', 'po', 'purchase order', 'supplier invoice'],
      expenses: ['expense', 'expenditure', 'cost', 'spending', 'opex', 'operating'],
      suppliers: ['supplier', 'vendor', 'party master', 'supplier list', 'vendor list'],
      sku_materials: ['bom', 'bill of material', 'recipe', 'sku material', 'material mapping', 'consumption'],
      material_transactions: ['material transaction', 'stock movement', 'material ledger', 'rm transaction', 'material txn'],
      unknown: [],
    }

    const keywords = nameKeywords[entityType] || []
    for (const kw of keywords) {
      if (nameLower.includes(kw)) score += 15
    }

    // Data pattern bonuses
    if (sampleRows.length > 0) {
      const sampleValues = sampleRows.slice(0, 5).flatMap((r) => Object.values(r).map((v) => String(v ?? '')))
      const hasDateLike = sampleValues.some((v) => /\d{4}[\/-]\d{2}[\/-]\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4}/.test(v))
      const hasPriceLike = sampleValues.some((v) => /^[₹$€£]?\s?\d+([.,]\d+)?$/.test(v.trim()))
      const hasIdLike = sampleValues.some((v) => /^[A-Z0-9]{3,}[\-_]/.test(v) || /^\d{6,}$/.test(v) || /^#?\d{4,}$/.test(v))
      const hasQtyLike = sampleValues.some((v) => /^\d+(\.\d+)?$/.test(v.trim()) && Number(v) < 10000)

      if (entityType === 'orders' || entityType === 'returns' || entityType === 'settlement') {
        if (hasDateLike) score += 5
        if (hasPriceLike) score += 5
        if (hasIdLike) score += 5
      }
      if (entityType === 'skus' || entityType === 'materials') {
        if (hasIdLike) score += 10
        if (hasQtyLike) score += 5
      }
      if (entityType === 'borrowings') {
        if (hasDateLike) score += 5
        if (hasIdLike) score += 5
      }
      if (entityType === 'purchases') {
        if (hasDateLike) score += 5
        if (hasPriceLike) score += 5
        if (hasIdLike) score += 5
      }
      if (entityType === 'expenses') {
        if (hasDateLike) score += 5
        if (hasPriceLike) score += 5
      }
      if (entityType === 'suppliers') {
        if (hasIdLike) score += 5
      }
      if (entityType === 'sku_materials') {
        if (hasQtyLike) score += 5
      }
      if (entityType === 'material_transactions') {
        if (hasDateLike) score += 5
        if (hasQtyLike) score += 5
      }
    }

    // Column count penalty/bonus
    if (headers.length < 3) score = Math.max(score - 20, 0)
    if (headers.length >= 5 && headers.length <= 20) score += 5

    return Math.min(score, 100)
  }

  // Score all entity types
  for (const entityType of Object.keys(scores) as EntityType[]) {
    scores[entityType] = scoreEntity(entityType)
  }

  // Special handling: check for returns/settlement first (more specific)
  if (scores.returns > scores.orders && scores.returns >= 40) {
    scores.orders = Math.max(scores.orders - 10, 0)
  }
  if (scores.settlement > scores.orders && scores.settlement >= 40) {
    scores.orders = Math.max(scores.orders - 10, 0)
  }

  // Find top entity type
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  
  // Require minimum confidence
  let entityType: EntityType = 'unknown'
  let confidence = 0
  
  if (top[1] >= 35) {
    entityType = top[0] as EntityType
    confidence = top[1]
  } else if (scores.orders >= 25) {
    // Fallback: if it looks like order data but low confidence
    entityType = 'orders'
    confidence = scores.orders
  } else if (scores.skus >= 25) {
    entityType = 'skus'
    confidence = scores.skus
  } else if (scores.materials >= 25) {
    entityType = 'materials'
    confidence = scores.materials
  }

  return { entityType, entityConfidence: confidence, scores }
}

/**
 * Scan the first N rows of raw 2D sheet data to find the actual header row.
 * Handles title rows, blank rows, and logos/images at the top.
 */
export function detectHeaderRow(
  sheetArray: unknown[][],
  maxScanRows = 12,
): { headerRowIndex: number; headers: string[] } {
  let bestIndex = 0
  let bestScore = -1
  let bestHeaders: string[] = []

  const rowsToScan = Math.min(sheetArray.length, maxScanRows)
  for (let i = 0; i < rowsToScan; i++) {
    const row = sheetArray[i]
    if (!row || !Array.isArray(row)) continue

    const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean)
    if (cells.length < 2) continue // skip sparse rows (titles, logos, blank)

    // Score this row as a potential header:
    // - more non-empty text cells is better
    // - cells that are short text (< 50 chars) are more header-like
    // - cells that are purely numeric are data, not headers
    let rowScore = 0
    let textCells = 0
    for (const cell of cells) {
      const isNumeric = /^[\d.,₹$€£%\-+]+$/.test(cell)
      const isShortText = cell.length <= 50 && !isNumeric
      if (isShortText) {
        textCells++
        rowScore += 2
      } else if (isNumeric) {
        rowScore -= 1 // numeric cells penalize – likely data row
      } else {
        rowScore += 0.5 // longer text, mild bonus
      }
    }

    // Must have at least 2 text-like cells to be a header candidate
    if (textCells < 2) continue

    // Bonus for matching known field aliases
    const mapping = deterministicMapping(cells)
    const aliasHits = Object.values(mapping).filter(Boolean).length
    rowScore += aliasHits * 5

    // Slight preference for earlier rows (all else equal)
    rowScore -= i * 0.1

    if (rowScore > bestScore) {
      bestScore = rowScore
      bestIndex = i
      bestHeaders = cells
    }
  }

  return { headerRowIndex: bestIndex, headers: bestHeaders }
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
    }
  }

  const sampleRows = rows.slice(0, 10)
  const score = scoreSheetForOrderData(headers, sampleRows, sheetName)
  const { platform, confidence } = detectPlatformFromSheet(headers, sampleRows, sheetName)
  const { isOrders, isReturns, isSettlement } = detectSheetType(headers, sampleRows, sheetName)
  const { entityType, entityConfidence } = classifySheetEntity(headers, sampleRows, sheetName)
  const mapping = deterministicMapping(headers)
  const detection = detectDocumentAndPlatform(headers, sampleRows, sheetName, '')

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
  }
}

/**
 * Detect cross-sheet relationships (e.g., Orders + Returns in same workbook)
 */
export function detectCrossSheetRelationships(analyses: SheetAnalysis[]): SheetAnalysis[] {
  // Find returns sheets that belong to orders sheets
  const returnsSheets = analyses.filter(a => a.isReturnsSheet)
  const ordersSheets = analyses.filter(a => a.isOrdersSheet)
  
  for (const returns of returnsSheets) {
    // Find matching orders sheet by platform or column similarity
    let bestMatch: SheetAnalysis | null = null
    let bestScore = 0
    
    for (const orders of ordersSheets) {
      let matchScore = 0
      // Same platform
      if (returns.platform && orders.platform && returns.platform === orders.platform) matchScore += 50
      // Similar column structure
      const overlap = returns.headers.filter(h => 
        orders.headers.some(oh => oh.toLowerCase() === h.toLowerCase())
      ).length
      matchScore += overlap * 5
      // Sheet name proximity (e.g., "Orders" and "Returns" or "January" and "January Returns")
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
  
  // Detect settlement sheets related to orders
  const settlementSheets = analyses.filter(a => a.isSettlementSheet)
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
 * Rank and select sheets for import from a multi-sheet workbook.
 * Returns a plan: which sheets to import, which platform each maps to,
 * and whether sheets should be merged or imported separately.
 */
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
  mergeWith: string[] // Other sheet names to merge with (same platform, same structure)
  relationship: 'orders' | 'returns' | 'settlement' | 'standalone'
  // New entity-specific fields
  entityType: EntityType
  entityConfidence: number
  targetTable: string // Database table name for this entity
  normalizedRows?: RawRow[] // Rows after field normalization
}

/**
 * Get the target database table for an entity type
 */
function getTargetTable(entityType: EntityType): string {
  const tableMap: Record<EntityType, string> = {
    orders: 'business_orders',
    returns: 'business_orders', // Returns go to same table with status='Returned'
    settlement: 'sales_import_batches', // Settlement goes to import batches
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

export function createImportPlan(
  workbook: XLSX.WorkBook,
  userPlatformOverride?: PlatformType,
): ImportPlan {
  const warnings: string[] = []
  
  // Analyze all sheets
  const analyses = workbook.SheetNames.map(name => analyzeSheet(workbook, name))
    .filter(a => a.score > 0)
    .sort((a, b) => b.score - a.score)
  
  if (!analyses.length) {
    return { sheets: [], warnings: ['No readable data sheets found in workbook'] }
  }
  
  // Detect cross-sheet relationships
  detectCrossSheetRelationships(analyses)
  
  // Process each sheet based on its entity type
  // Priority: orders > returns > settlement > skus > materials > borrowings > purchases > expenses > suppliers > sku_materials > material_transactions
  const entityPriority: EntityType[] = [
    'orders', 'returns', 'settlement', 'skus', 'materials', 
    'borrowings', 'purchases', 'expenses', 'suppliers', 
    'sku_materials', 'material_transactions'
  ]
  
  const sheets: SheetImportPlan[] = []
  const usedSheetNames = new Set<string>()
  
  // Process sheets by entity type priority
  for (const entityType of entityPriority) {
    const entitySheets = analyses.filter(a => a.entityType === entityType && !usedSheetNames.has(a.name))
    
    if (entitySheets.length === 0) continue
    
    // Group by platform for this entity type
    const byPlatform = new Map<PlatformType, SheetAnalysis[]>()
    for (const a of entitySheets) {
      const platform = userPlatformOverride || a.platform || 'Offline'
      if (!byPlatform.has(platform)) byPlatform.set(platform, [])
      byPlatform.get(platform)!.push(a)
    }
    
    for (const [platform, platformSheets] of byPlatform.entries()) {
      // Sort by entityConfidence desc, then score desc
      platformSheets.sort((a, b) => b.entityConfidence - a.entityConfidence || b.score - a.score)
      
      // For orders/returns/settlement, merge same-structure sheets
      const mergeableEntities = ['orders', 'returns', 'settlement', 'skus', 'materials']
      const shouldMerge = mergeableEntities.includes(entityType)
      
      if (shouldMerge && platformSheets.length > 1) {
        // Check which sheets can be merged (same structure)
        const primary = platformSheets[0]
        const mergeable: SheetAnalysis[] = []
        
        for (let i = 1; i < platformSheets.length; i++) {
          const sheet = platformSheets[i]
          const overlap = primary.headers.filter(h => 
            sheet.headers.some(sh => sh.toLowerCase() === h.toLowerCase())
          ).length
          const similarity = overlap / Math.max(primary.headers.length, sheet.headers.length)
          if (similarity >= 0.7 && sheet.rowCount > 0) {
            mergeable.push(sheet)
          }
        }
        
        if (mergeable.length > 0) {
          // Merge all compatible sheets
          const allRows = [primary, ...mergeable].flatMap(s => s.rows)
          const allSheets = [primary, ...mergeable]
          const combinedMapping = deterministicMapping(primary.headers)
          
          // Apply normalization to merged rows
          const normalizedRows = allRows.map(row => normalizeRow(row, combinedMapping, entityType, platform))
          
          sheets.push({
            sheetName: allSheets.map(s => s.name).join(' + '),
            platform,
            docType: primary.docType || 'GENERIC_ORDER_DATA',
            docTypeName: primary.docTypeName,
            rows: allRows,
            headers: primary.headers,
            mapping: primary.mapping,
            rowCount: allRows.length,
            confidence: primary.confidence,
            isPrimary: true,
            mergeWith: mergeable.map(s => s.name),
            relationship: entityType === 'orders' ? 'orders' : entityType === 'returns' ? 'returns' : entityType === 'settlement' ? 'settlement' : 'standalone',
            entityType,
            entityConfidence: primary.entityConfidence,
            targetTable: getTargetTable(entityType),
            normalizedRows,
          })
          
          warnings.push(`Merged ${mergeable.length} additional sheet(s) with "${primary.name}" for ${entityType} (same structure)`)
          
          // Mark all as used
          for (const s of allSheets) usedSheetNames.add(s.name)
          continue
        }
      }
      
      // Handle each sheet individually
      for (const sheet of platformSheets) {
        if (usedSheetNames.has(sheet.name)) continue
        
        // Apply normalization to rows
        const normalizedRows = sheet.rows.map(row => normalizeRow(row, sheet.mapping, entityType, platform))
        
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
        })
        
        usedSheetNames.add(sheet.name)
      }
    }
  }
  
  // Handle any remaining uncategorized sheets with decent scores
  for (const analysis of analyses) {
    if (usedSheetNames.has(analysis.name)) continue
    if (analysis.score < 25) continue // Skip low-confidence sheets
    
    // Try to infer entity from sheet name
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
    else inferredEntity = 'orders' // Default to orders for uncategorized
    
    const normalizedRows = analysis.rows.map(row => normalizeRow(row, analysis.mapping, inferredEntity, analysis.platform || 'Offline'))
    
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
  for (const a of analyses) {
    if (!usedSheetNames.has(a.name) && a.score > 10) {
      warnings.push(`Sheet "${a.name}" was not imported (low confidence or unclear structure)`)
    }
  }
  
  return { sheets, warnings }
}

/**
 * Import XLSX module dynamically for server-side use
 */
async function getXLSX() {
  const XLSX = await import('xlsx')
  return XLSX.default || XLSX
}

/**
 * Extract sheet data (moved here for reuse)
 */
function extractSheetData(
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

  const { headerRowIndex, headers } = detectHeaderRow(raw2D as unknown[][])

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

/* ═══════════════════════════════════════════════════════════════════════════
   FIELD NORMALIZATION (Preserves IDs, normalizes names/cities/regions)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Fields that should NEVER be normalized (preserve as-is for PK/FK integrity)
 */
const ID_FIELDS = new Set([
  'orderId', 'lineKey', 'skuCode', 'materialCode', 'itemCode',
  'supplierId', 'materialId', 'skuId', 'counterparty', 'itemId',
  'invoiceNo', 'billNo', 'poNumber', 'reference', 'batch', 'fsn', 'asin',
])

/**
 * Fields that should be normalized (names, locations, descriptions)
 */
const NORMALIZABLE_FIELDS = new Set([
  'productName', 'materialName', 'itemName', 'supplierName', 'counterparty',
  'customerLocation', 'city', 'state', 'address', 'category', 'description',
  'notes', 'reference', 'itemType', 'unit', 'platform', 'status',
  'returnReason', 'settlementStatus', 'txnType', 'direction',
])

/**
 * Normalize a text value: trim, title case for names, standardize locations
 * PRESERVES IDs exactly as-is
 */
export function normalizeFieldValue(
  field: string,
  value: unknown,
  platform?: PlatformType
): unknown {
  if (value === null || value === undefined || value === '') return value

  // NEVER normalize ID fields - preserve exact values for PK/FK integrity
  if (ID_FIELDS.has(field)) {
    return String(value).trim()
  }

  const str = String(value).trim()
  if (!str) return value

  // Normalize based on field type
  const lowerField = field.toLowerCase()

  // Names: Title case, clean up extra spaces
  if (lowerField.includes('name') || lowerField.includes('title') || 
      lowerField.includes('product') || lowerField.includes('material') ||
      lowerField.includes('item') || lowerField.includes('supplier') ||
      lowerField.includes('counterparty') || lowerField.includes('party')) {
    return toTitleCase(str)
  }

  // Locations: Standardize city/state format
  if (lowerField.includes('location') || lowerField.includes('city') || 
      lowerField.includes('state') || lowerField.includes('address') ||
      lowerField.includes('place') || lowerField.includes('ship')) {
    return normalizeLocation(str, platform)
  }

  // Categories: Standardize known categories
  if (lowerField.includes('category') || lowerField.includes('type')) {
    return normalizeCategory(str)
  }

  // Units: Standardize units
  if (lowerField.includes('unit') || lowerField === 'uom') {
    return normalizeUnit(str)
  }

  // Status: Standardize status values
  if (lowerField.includes('status') || lowerField.includes('direction') ||
      lowerField.includes('settlement')) {
    return normalizeStatus(str)
  }

  // Platform: Standardize platform names
  if (lowerField.includes('platform') || lowerField.includes('channel') ||
      lowerField.includes('marketplace')) {
    return normalizePlatform(str)
  }

  // Descriptions/Notes: Clean up but preserve content
  if (lowerField.includes('description') || lowerField.includes('note') ||
      lowerField.includes('narration') || lowerField.includes('reason') ||
      lowerField.includes('reference') || lowerField.includes('ref')) {
    return cleanText(str)
  }

  // Default: just trim and clean
  return cleanText(str)
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeLocation(str: string, platform?: PlatformType): string {
  // Common city/state mappings
  const cityAliases: Record<string, string> = {
    'bangalore': 'Bengaluru',
    'bengaluru': 'Bengaluru',
    'blr': 'Bengaluru',
    'mumbai': 'Mumbai',
    'bombay': 'Mumbai',
    'delhi': 'New Delhi',
    'new delhi': 'New Delhi',
    'kolkata': 'Kolkata',
    'calcutta': 'Kolkata',
    'chennai': 'Chennai',
    'madras': 'Chennai',
    'hyderabad': 'Hyderabad',
    'pune': 'Pune',
    'ahmedabad': 'Ahmedabad',
    'surat': 'Surat',
    'jaipur': 'Jaipur',
    'lucknow': 'Lucknow',
    'kanpur': 'Kanpur',
    'nagpur': 'Nagpur',
    'indore': 'Indore',
    'thane': 'Thane',
    'bhopal': 'Bhopal',
    'visakhapatnam': 'Visakhapatnam',
    'vizag': 'Visakhapatnam',
    'patna': 'Patna',
    'vadodara': 'Vadodara',
    'ghaziabad': 'Ghaziabad',
    'ludhiana': 'Ludhiana',
    'agra': 'Agra',
    'nashik': 'Nashik',
    'faridabad': 'Faridabad',
    'meerut': 'Meerut',
    'rajkot': 'Rajkot',
    'kalyan': 'Kalyan',
    'vasai': 'Vasai-Virar',
    'varanasi': 'Varanasi',
    'srinagar': 'Srinagar',
    'aurangabad': 'Aurangabad',
    'dhanbad': 'Dhanbad',
    'amritsar': 'Amritsar',
    'navi mumbai': 'Navi Mumbai',
    'allahabad': 'Prayagraj',
    'prayagraj': 'Prayagraj',
    'howrah': 'Howrah',
    'ranchi': 'Ranchi',
    'gwalior': 'Gwalior',
    'jabalpur': 'Jabalpur',
    'coimbatore': 'Coimbatore',
    'vijayawada': 'Vijayawada',
    'jodhpur': 'Jodhpur',
    'madurai': 'Madurai',
    'raipur': 'Raipur',
    'kota': 'Kota',
    'guwahati': 'Guwahati',
    'chandigarh': 'Chandigarh',
    'solapur': 'Solapur',
    'hubli': 'Hubballi-Dharwad',
    'hubballi': 'Hubballi-Dharwad',
    'dharwad': 'Hubballi-Dharwad',
    'mysore': 'Mysuru',
    'mysuru': 'Mysuru',
    'tiruchirappalli': 'Tiruchirappalli',
    'trichy': 'Tiruchirappalli',
    'bareilly': 'Bareilly',
    'aligarh': 'Aligarh',
    'tiruppur': 'Tiruppur',
    'moradabad': 'Moradabad',
    'jalandhar': 'Jalandhar',
    'bhubaneswar': 'Bhubaneswar',
    'salem': 'Salem',
    'warangal': 'Warangal',
    'guntur': 'Guntur',
    'bhiwandi': 'Bhiwandi',
    'saharanpur': 'Saharanpur',
    'gorakhpur': 'Gorakhpur',
    'bikaner': 'Bikaner',
    'amravati': 'Amravati',
    'noida': 'Noida',
    'jamshedpur': 'Jamshedpur',
    'bhilai': 'Bhilai',
    'cuttack': 'Cuttack',
    'firozabad': 'Firozabad',
    'kochi': 'Kochi',
    'nellore': 'Nellore',
    'bhavnagar': 'Bhavnagar',
    'dehradun': 'Dehradun',
    'durgapur': 'Durgapur',
    'asansol': 'Asansol',
    'rourkela': 'Rourkela',
    'nanded': 'Nanded',
    'kolhapur': 'Kolhapur',
    'ajmer': 'Ajmer',
    'akola': 'Akola',
    'gulbarga': 'Kalaburagi',
    'kalaburagi': 'Kalaburagi',
    'jamnagar': 'Jamnagar',
    'ujjain': 'Ujjain',
    'loni': 'Loni',
    'siliguri': 'Siliguri',
    'jhansi': 'Jhansi',
    'ulhasnagar': 'Ulhasnagar',
    'sangli': 'Sangli-Miraj',
    'miraj': 'Sangli-Miraj',
    'belgaum': 'Belagavi',
    'belagavi': 'Belagavi',
    'malegaon': 'Malegaon',
    'jalarpet': 'Jolarpettai',
    'ambattur': 'Ambattur',
    'tirunelveli': 'Tirunelveli',
    'malappuram': 'Malappuram',
    'ambala': 'Ambala',
    'chandrapur': 'Chandrapur',
    'firozpur': 'Firozpur',
    'satna': 'Satna',
    'rohtak': 'Rohtak',
    'korba': 'Korba',
    'bharuch': 'Bharuch',
    'anantapur': 'Anantapur',
    'bihar': 'Bihar',
    'haryana': 'Haryana',
    'punjab': 'Punjab',
    'rajasthan': 'Rajasthan',
    'gujarat': 'Gujarat',
    'maharashtra': 'Maharashtra',
    'karnataka': 'Karnataka',
    'tamil nadu': 'Tamil Nadu',
    'tamilnadu': 'Tamil Nadu',
    'andhra pradesh': 'Andhra Pradesh',
    'telangana': 'Telangana',
    'west bengal': 'West Bengal',
    'uttar pradesh': 'Uttar Pradesh',
    'madhya pradesh': 'Madhya Pradesh',
    'odisha': 'Odisha',
    'orissa': 'Odisha',
    'kerala': 'Kerala',
    'jharkhand': 'Jharkhand',
    'assam': 'Assam',
    'chhattisgarh': 'Chhattisgarh',
    'uttarakhand': 'Uttarakhand',
    'himachal pradesh': 'Himachal Pradesh',
    'goa': 'Goa',
    'tripura': 'Tripura',
    'manipur': 'Manipur',
    'meghalaya': 'Meghalaya',
    'nagaland': 'Nagaland',
    'arunachal pradesh': 'Arunachal Pradesh',
    'mizoram': 'Mizoram',
    'sikkim': 'Sikkim',
  }

  // Try to parse as "City, State" or "City - State"
  const parts = str.split(/[,;|-]/).map(p => p.trim())
  if (parts.length >= 2) {
    const city = cityAliases[parts[0].toLowerCase()] || toTitleCase(parts[0])
    const state = cityAliases[parts[1].toLowerCase()] || toTitleCase(parts[1])
    return `${city}, ${state}`
  }

  // Single location - try to match
  const lower = str.toLowerCase()
  if (cityAliases[lower]) return cityAliases[lower]
  return toTitleCase(str)
}

function normalizeCategory(str: string): string {
  const categoryMap: Record<string, string> = {
    'packaging': 'Packaging',
    'packing': 'Packaging',
    'pack': 'Packaging',
    'jar': 'Packaging',
    'bottle': 'Packaging',
    'box': 'Packaging',
    'carton': 'Packaging',
    'pouch': 'Packaging',
    'bag': 'Packaging',
    'label': 'Packaging',
    'sticker': 'Packaging',
    'tape': 'Packaging',
    'wrap': 'Packaging',
    'raw material': 'Raw Material',
    'raw': 'Raw Material',
    'rm': 'Raw Material',
    'ingredient': 'Raw Material',
    'consumable': 'Consumable',
    'consumables': 'Consumable',
    'shipping': 'Shipping',
    'logistics': 'Shipping',
    'freight': 'Shipping',
    'transport': 'Shipping',
    'delivery': 'Shipping',
    'marketing': 'Marketing',
    'ads': 'Marketing',
    'advertising': 'Marketing',
    'promotion': 'Marketing',
    'marketplace fee': 'Marketplace Fee',
    'commission': 'Marketplace Fee',
    'platform fee': 'Marketplace Fee',
    'payment gateway': 'Payment Gateway',
    'gateway': 'Payment Gateway',
    'bank charge': 'Bank Charges',
    'bank fee': 'Bank Charges',
    'office': 'Office Expense',
    'rent': 'Rent',
    'electricity': 'Utilities',
    'water': 'Utilities',
    'internet': 'Utilities',
    'phone': 'Utilities',
    'mobile': 'Utilities',
    'salary': 'Salary',
    'wages': 'Salary',
    'staff': 'Salary',
    'travel': 'Travel',
    'fuel': 'Fuel',
    'vehicle': 'Vehicle',
    'maintenance': 'Maintenance',
    'repair': 'Maintenance',
    'insurance': 'Insurance',
    'legal': 'Legal',
    'professional': 'Professional Services',
    'accounting': 'Professional Services',
    'audit': 'Professional Services',
    'software': 'Software',
    'subscription': 'Software',
    'saas': 'Software',
    'hosting': 'Software',
    'domain': 'Software',
  }

  const lower = str.toLowerCase().trim()
  for (const [key, value] of Object.entries(categoryMap)) {
    if (lower.includes(key)) return value
  }
  return toTitleCase(str)
}

function normalizeUnit(str: string): string {
  const unitMap: Record<string, string> = {
    'pcs': 'PCS',
    'pieces': 'PCS',
    'piece': 'PCS',
    'nos': 'PCS',
    'no': 'PCS',
    'each': 'PCS',
    'ea': 'PCS',
    'kg': 'KG',
    'kilogram': 'KG',
    'kilograms': 'KG',
    'kgs': 'KG',
    'g': 'G',
    'gram': 'G',
    'grams': 'G',
    'gm': 'G',
    'l': 'L',
    'liter': 'L',
    'liters': 'L',
    'litre': 'L',
    'litres': 'L',
    'ml': 'ML',
    'milliliter': 'ML',
    'milliliters': 'ML',
    'm': 'M',
    'meter': 'M',
    'meters': 'M',
    'metre': 'M',
    'metres': 'M',
    'cm': 'CM',
    'centimeter': 'CM',
    'centimeters': 'CM',
    'mm': 'MM',
    'millimeter': 'MM',
    'millimeters': 'MM',
    'sqft': 'SQFT',
    'sq ft': 'SQFT',
    'sqm': 'SQM',
    'sq m': 'SQM',
    'box': 'BOX',
    'boxes': 'BOX',
    'carton': 'CTN',
    'cartons': 'CTN',
    'ctn': 'CTN',
    'pkt': 'PKT',
    'packet': 'PKT',
    'packets': 'PKT',
    'pack': 'PKT',
    'packs': 'PKT',
    'roll': 'ROLL',
    'rolls': 'ROLL',
    'set': 'SET',
    'sets': 'SET',
    'pair': 'PAIR',
    'pairs': 'PAIR',
    'dozen': 'DOZ',
    'doz': 'DOZ',
    'gross': 'GROSS',
    'unit': 'UNIT',
    'units': 'UNIT',
  }

  const lower = str.toLowerCase().trim()
  return unitMap[lower] || str.toUpperCase()
}

function normalizeStatus(str: string): string {
  const statusMap: Record<string, string> = {
    'delivered': 'Delivered',
    'complete': 'Delivered',
    'completed': 'Delivered',
    'fulfilled': 'Delivered',
    'shipped': 'Shipped',
    'dispatched': 'Shipped',
    'in transit': 'In Transit',
    'transit': 'In Transit',
    'pending': 'Pending',
    'processing': 'Pending',
    'confirmed': 'Pending',
    'cancelled': 'Cancelled',
    'canceled': 'Cancelled',
    'cancel': 'Cancelled',
    'returned': 'Returned',
    'return': 'Returned',
    'rto': 'Returned',
    'refunded': 'Returned',
    'partially returned': 'Partially Returned',
    'open': 'Open',
    'settled': 'Settled',
    'closed': 'Closed',
    'paid': 'Paid',
    'unpaid': 'Unpaid',
    'partial': 'Partial',
    'borrowed': 'Borrowed',
    'lent': 'Lent',
    'received': 'Received',
    'issued': 'Issued',
    'consumed': 'Consumed',
    'waste': 'Waste',
    'adjustment': 'Adjustment',
    'opening': 'Opening Correction',
  }

  const lower = str.toLowerCase().trim()
  return statusMap[lower] || toTitleCase(str)
}

function normalizePlatform(str: string): string {
  const platformMap: Record<string, string> = {
    'amazon': 'Amazon',
    'amzn': 'Amazon',
    'fba': 'Amazon',
    'easy ship': 'Amazon',
    'meesho': 'Meesho',
    'fashnear': 'Meesho',
    'flipkart': 'Flipkart',
    'fk': 'Flipkart',
    'ekart': 'Flipkart',
    'shopify': 'Shopify',
    'myshopify': 'Shopify',
    'offline': 'Offline',
    'retail': 'Offline',
    'store': 'Offline',
    'wholesale': 'Offline',
    'b2b': 'Offline',
    'export': 'Export',
  }

  const lower = str.toLowerCase().trim()
  return platformMap[lower] || toTitleCase(str)
}

function cleanText(str: string): string {
  return str
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-.,()/&]/g, '')
    .trim()
}

/**
 * Normalize all fields in a row based on entity type
 */
export function normalizeRow(
  row: RawRow,
  mapping: ImportMapping,
  entityType: EntityType,
  platform?: PlatformType
): RawRow {
  const normalizedRow: RawRow = {}
  
  for (const [canonicalField, sourceColumn] of Object.entries(mapping)) {
    if (!sourceColumn) continue
    const value = row[sourceColumn]
    if (value === undefined) continue
    
    // Normalize the value
    normalizedRow[canonicalField] = normalizeFieldValue(canonicalField, value, platform)
  }
  
  // Also pass through any unmapped fields that might be IDs
  for (const [sourceColumn, value] of Object.entries(row)) {
    const isMapped = Object.values(mapping).includes(sourceColumn)
    if (!isMapped && ID_FIELDS.has(sourceColumn.toLowerCase().replace(/[^a-z]/g, ''))) {
      normalizedRow[sourceColumn] = String(value).trim()
    }
  }
  
  return normalizedRow
}

/**
 * Ask OpenRouter AI to infer column→field mapping for non-standard headers.
 * Returns a partial ImportMapping; callers should merge with deterministic results.
 */
export async function inferMappingWithAI(
  headers: string[],
  sampleRows: RawRow[],
  apiKey: string,
  context?: {
    platform?: PlatformType
    docType?: DocumentType
    sheetName?: string
    fileName?: string
  },
): Promise<ImportMapping> {
  try {
    const entityType = context?.docType ? docTypeToEntityType(context.docType) : 'orders'
    const aliases = entityFieldAliases[entityType] || fieldAliases
    
    const sampleDisplay = sampleRows.slice(0, 5).map((row) => {
      const entries = Object.entries(row).slice(0, 20)
      return entries.map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')
    }).join('\n---\n')

    const platformContext = context?.platform 
      ? `\nPLATFORM CONTEXT: This document is from ${context.platform} (${context.docType || 'unknown type'}).`
      : ''
    const sheetContext = context?.sheetName 
      ? `\nSHEET NAME: "${context.sheetName}"`
      : ''
    const fileContext = context?.fileName 
      ? `\nFILE NAME: "${context.fileName}"`
      : ''

    // Build entity-specific target fields
    const targetFields = buildEntityTargetFields(entityType)

    const prompt = `You are an expert column-mapping assistant for a multi-platform e-commerce business management system.

Given these ACTUAL spreadsheet column headers:
${JSON.stringify(headers)}

And sample data rows (up to 5):
${sampleDisplay}${platformContext}${sheetContext}${fileContext}

TASK: Map these columns to our CANONICAL TARGET FIELDS for ${entityType.toUpperCase()}.

TARGET FIELDS (use EXACT keys in JSON output):
${targetFields}

ENTITY-SPECIFIC HINTS:
${getEntityHints(entityType)}

PLATFORM-SPECIFIC HINTS (for orders/returns/settlement):
- Amazon: Look for "Amazon Order ID", "ASIN", "Seller SKU", "Principal Amount", "Easy Ship", "FBA"
- Meesho: Look for "Sub Order No", "Meesho Price", "Supplier Discounted Price", "Return Reason"
- Flipkart: Look for "Order Item ID", "FSN", "Flipkart Status", "Listing ID", "Final Invoice Amount"
- Shopify: Look for "Lineitem Name", "Lineitem SKU", "Financial Status", "Fulfillment Status"
- GST/Offline: Look for "GSTIN", "Taxable Value", "Integrated Tax", "Place of Supply", "Invoice Number"

RULES:
1. Only include mappings where you are confident (>80% sure)
2. Return ONLY valid JSON – no markdown, no explanation, no prose
3. Keys must be EXACT target field names above
4. Values must be EXACT column headers from the input
5. If a target field has no clear match, OMIT it entirely
6. A single source column can map to multiple target fields if appropriate

Format: { "${Object.keys(aliases)[0]}": "Actual Column Name", ... }`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'Peak Business',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [
          { role: 'system', content: `You map spreadsheet columns to ${entityType} management fields. Return only valid JSON.` },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: 800,
      }),
    })

    if (!response.ok) return {}

    const data = await response.json()
    const content = String(data.choices?.[0]?.message?.content || '')
      .replace(/^```(?:json)?\s*|\s*```$/g, '')
      .trim()

    if (!content) return {}

    const parsed = JSON.parse(content) as Record<string, string>

    // Validate: only keep mappings where the value is an actual header in the file
    const headerSet = new Set(headers)
    const validMapping: ImportMapping = {}
    const validFields = new Set(Object.keys(aliases))

    for (const [field, column] of Object.entries(parsed)) {
      if (validFields.has(field) && typeof column === 'string' && headerSet.has(column)) {
        validMapping[field] = column
      }
    }

    return validMapping
  } catch {
    // AI inference is best-effort; never block import on failure
    return {}
  }
}

/**
 * Map document type to entity type
 */
function docTypeToEntityType(docType: DocumentType): EntityType {
  const map: Record<DocumentType, EntityType> = {
    'AMAZON_SALES_REPORT': 'orders',
    'MEESHO_ORDERS_REPORT': 'orders',
    'FLIPKART_SALES_REPORT': 'orders',
    'SHOPIFY_ORDERS_REPORT': 'orders',
    'GST_TAX_INVOICE': 'orders',
    'GENERIC_ORDER_DATA': 'orders',
    'UNRECOGNIZED': 'orders',
  }
  return map[docType] || 'orders'
}

/**
 * Build entity-specific target fields description for AI prompt
 */
function buildEntityTargetFields(entityType: EntityType): string {
  const fields = entityFieldAliases[entityType] || fieldAliases
  const descriptions: Record<string, string> = {
    // Orders
    orderId: 'The order number, invoice number, bill number, or unique transaction identifier',
    lineKey: 'Line item ID, sub-order ID, or item-level identifier (different from orderId)',
    skuCode: 'Product code, SKU, ASIN, FSN, item code, barcode, or unique product identifier',
    productName: 'Product name, title, item description, or item name',
    orderDate: 'Date of order, purchase, sale, or invoice',
    qtyOrdered: 'Quantity ordered, qty, units, or count',
    qtyDelivered: 'Quantity delivered, shipped, or dispatched',
    qtyReturned: 'Quantity returned, RTO qty, or return count',
    salePrice: 'Selling price, unit price, item price, or amount per unit',
    status: 'Order status, shipment status, or delivery status (e.g., Delivered, Returned, Cancelled, Pending)',
    deliveryDate: 'Delivery date, ship date, or dispatch date',
    returnDate: 'Return date',
    refundAmount: 'Refund amount, reversal, or return amount',
    customerLocation: 'Customer city, state, ship-to address, or location',
    // Returns
    returnReason: 'Reason for return, cancellation, or RTO',
    // Settlement
    fee: 'Marketplace fee, commission, or platform fee',
    tax: 'Tax amount (GST, TCS, TDS)',
    settlementDate: 'Settlement date, payout date, or disbursement date',
    // SKUs
    platform: 'Sales platform/channel (Amazon, Meesho, Flipkart, Shopify, Offline)',
    sellingPrice: 'Standard selling price / MRP / list price',
    costPerUnit: 'Cost per unit / purchase cost / landed cost',
    openingStock: 'Opening stock quantity',
    reorderLevel: 'Reorder level / minimum stock alert level',
    category: 'Product category or type',
    active: 'Whether SKU is active (true/false)',
    // Materials
    materialCode: 'Material code, raw material SKU, or item code',
    materialName: 'Material name, raw material name, or item name',
    unit: 'Unit of measure (PCS, KG, L, M, etc.)',
    avgUnitCost: 'Average unit cost / standard cost',
    preferredVendor: 'Preferred vendor/supplier name',
    // Borrowings
    direction: 'Direction: "borrowed" (from someone) or "lent" (to someone)',
    txnDate: 'Transaction date / borrow date / lend date',
    counterparty: 'Counterparty name (person or company)',
    itemType: 'Item type: Material, Product, SKU, etc.',
    itemCode: 'Item code / SKU / material code',
    itemName: 'Item name / description',
    quantity: 'Quantity borrowed or lent',
    unitCost: 'Unit cost / value per unit',
    dueDate: 'Due date for return',
    settlementStatus: 'Settlement status: Open, Settled, Partial',
    // Purchases
    purchaseDate: 'Purchase date / invoice date',
    supplierId: 'Supplier / vendor name',
    gstRate: 'GST rate percentage',
    transportCost: 'Transport / freight / shipping cost',
    invoiceNo: 'Invoice number / bill number / PO number',
    // Expenses
    expenseDate: 'Expense date / transaction date',
    amount: 'Expense amount / cost / value',
    description: 'Description / narration / purpose',
    // Suppliers
    supplierName: 'Supplier / vendor / company name',
    address: 'Full address / location',
    gstin: 'GSTIN / GST number',
    phone: 'Phone / mobile / contact number',
    email: 'Email address',
    defaultGstRate: 'Default GST rate percentage',
    defaultTransportCost: 'Default transport / freight cost',
    // SKU Materials (BOM)
    qtyPerUnit: 'Quantity per unit / consumption per unit / usage per unit',
    wastePct: 'Waste percentage / wastage % / loss %',
    // Material Transactions
    txnType: 'Transaction type: ADJUSTMENT, OPENING_CORRECTION, WASTE, RECEIVED, ISSUED, CONSUMED',
    qtyIn: 'Quantity in / received / inward',
    qtyOut: 'Quantity out / issued / outward / consumed',
    reference: 'Reference / order ID / PO number / batch',
    source: 'Source / origin / transaction source',
  }

  return Object.entries(fields)
    .map(([field]) => `- ${field}: ${descriptions[field] || field}`)
    .join('\n')
}

/**
 * Get entity-specific hints for AI
 */
function getEntityHints(entityType: EntityType): string {
  const hints: Record<EntityType, string> = {
    orders: 'Look for order identifiers, product identifiers, quantities, prices, dates, and statuses.',
    returns: 'Look for return-specific fields: return reason, return date, refund amount, RTO indicators.',
    settlement: 'Look for settlement fields: net amount, fees, taxes, settlement date, payout status.',
    skus: 'Look for product master data: SKU codes, names, prices, costs, stock levels, categories, platforms.',
    materials: 'Look for raw material data: material codes, names, units, costs, stock levels, vendors.',
    borrowings: 'Look for lending/borrowing records: counterparty, item, quantity, dates, direction, settlement.',
    purchases: 'Look for purchase orders/invoices: supplier, material, quantity, price, GST, transport, invoice no.',
    expenses: 'Look for expense records: date, category, amount, description, platform.',
    suppliers: 'Look for supplier master data: name, address, GSTIN, contact, default rates.',
    sku_materials: 'Look for BOM/recipe data: SKU, material, quantity per unit, waste percentage.',
    material_transactions: 'Look for material stock movements: material, date, type (in/out), quantities, reference.',
    unknown: 'Look for any recognizable business data fields.',
  }
  return hints[entityType] || hints.unknown
}
