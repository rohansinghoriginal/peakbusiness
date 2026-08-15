import { 
  EntityType, 
  DocumentType, 
  PlatformType, 
  RawRow, 
  ImportMapping 
} from '../types'
import { entityFieldAliases, fieldAliases } from '../aliases'
import { docTypeToEntityType } from '../mapping/entity-mapper'

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

/**
 * Ask OpenRouter AI to infer column→field mapping for non-standard headers.
 * Returns a partial ImportMapping; callers should merge with deterministic results.
 * 
 * FIX: Now accepts entityType directly instead of inferring from docType
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
    entityType?: EntityType  // NEW: explicit entity type from classification
  },
): Promise<ImportMapping> {
  try {
    // Use explicit entityType if provided, otherwise fall back to docType mapping
    const entityType = context?.entityType || docTypeToEntityType(context?.docType || 'GENERIC_ORDER_DATA')
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