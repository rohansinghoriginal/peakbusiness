import { 
  DocumentType, 
  DocumentAnalysis, 
  PlatformType, 
  RawRow, 
  ImportMapping 
} from '../types'
import { deterministicMapping } from '../mapping/deterministic'
import { fieldAliases } from '../aliases'
import { normalized } from '../utils/normalized'

/**
 * Document type detection based on platform and structure
 */
export function detectDocumentAndPlatform(
  headers: string[],
  sampleRows: RawRow[] = [],
  fileName = '',
  rawTextSnippet = ''
): DocumentAnalysis {
  const normHeaders = headers.map(normalized)
  const allText = [
    fileName.toLowerCase(),
    rawTextSnippet.toLowerCase(),
    headers.join(' ').toLowerCase(),
    sampleRows.map((r) => Object.values(r).join(' ')).join(' ').toLowerCase(),
  ].join(' ')

  let amazonScore = 0, meeshoScore = 0, flipkartScore = 0, shopifyScore = 0, gstScore = 0, genericScore = 0

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
    { platform: 'Amazon' as PlatformType, docType: 'AMAZON_SALES_REPORT' as DocumentType, name: 'Amazon Sales / MTR Report', score: amazonScore },
    { platform: 'Meesho' as PlatformType, docType: 'MEESHO_ORDERS_REPORT' as DocumentType, name: 'Meesho Orders / Settlement', score: meeshoScore },
    { platform: 'Flipkart' as PlatformType, docType: 'FLIPKART_SALES_REPORT' as DocumentType, name: 'Flipkart Sales Ledger', score: flipkartScore },
    { platform: 'Shopify' as PlatformType, docType: 'SHOPIFY_ORDERS_REPORT' as DocumentType, name: 'Shopify Orders Export', score: shopifyScore },
    { platform: 'Offline' as PlatformType, docType: 'GST_TAX_INVOICE' as DocumentType, name: 'GST Tax Invoices / B2B Ledger', score: gstScore },
  ]

  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]

  let docType: DocumentType = 'GENERIC_ORDER_DATA'
  let docTypeName = 'Generic Orders Spreadsheet'
  let detectedPlatform: PlatformType = 'Offline'
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