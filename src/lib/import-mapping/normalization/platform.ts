/**
 * Normalize platform strings to canonical platform names
 */
export function normalizePlatform(str: string): string {
  const platformMap: Record<string, string> = {
    'amazon': 'Amazon', 'amzn': 'Amazon', 'fba': 'Amazon', 'easy ship': 'Amazon',
    'meesho': 'Meesho', 'fashnear': 'Meesho',
    'flipkart': 'Flipkart', 'fk': 'Flipkart', 'ekart': 'Flipkart',
    'shopify': 'Shopify', 'myshopify': 'Shopify',
    'offline': 'Offline', 'retail': 'Offline', 'store': 'Offline',
    'wholesale': 'Offline', 'b2b': 'Offline', 'export': 'Export',
  }

  const lower = str.toLowerCase().trim()
  return platformMap[lower] || toTitleCase(str)
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