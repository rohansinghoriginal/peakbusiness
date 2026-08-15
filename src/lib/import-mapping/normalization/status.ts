/**
 * Normalize status strings to canonical statuses
 */
export function normalizeStatus(str: string): string {
  const statusMap: Record<string, string> = {
    'delivered': 'Delivered', 'complete': 'Delivered', 'completed': 'Delivered',
    'fulfilled': 'Delivered', 'shipped': 'Shipped', 'dispatched': 'Shipped',
    'in transit': 'In Transit', 'transit': 'In Transit',
    'pending': 'Pending', 'processing': 'Pending', 'confirmed': 'Pending',
    'cancelled': 'Cancelled', 'canceled': 'Cancelled', 'cancel': 'Cancelled',
    'returned': 'Returned', 'return': 'Returned', 'rto': 'Returned',
    'refunded': 'Returned', 'partially returned': 'Partially Returned',
    'open': 'Open', 'settled': 'Settled', 'closed': 'Closed',
    'paid': 'Paid', 'unpaid': 'Unpaid', 'partial': 'Partial',
    'borrowed': 'Borrowed', 'lent': 'Lent',
    'received': 'Received', 'issued': 'Issued', 'consumed': 'Consumed',
    'waste': 'Waste', 'adjustment': 'Adjustment', 'opening': 'Opening Correction',
  }

  const lower = str.toLowerCase().trim()
  return statusMap[lower] || toTitleCase(str)
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