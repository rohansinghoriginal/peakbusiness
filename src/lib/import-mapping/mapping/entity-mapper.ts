import { DocumentType, EntityType } from '../types'

/**
 * Map document type to entity type
 * Exported for use in AI inference
 */
export function docTypeToEntityType(docType: DocumentType): EntityType {
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