/**
 * Normalize category strings to canonical categories
 */
export function normalizeCategory(str: string): string {
  const categoryMap: Record<string, string> = {
    'packaging': 'Packaging', 'packing': 'Packaging', 'pack': 'Packaging',
    'jar': 'Packaging', 'bottle': 'Packaging', 'box': 'Packaging',
    'carton': 'Packaging', 'pouch': 'Packaging', 'bag': 'Packaging',
    'label': 'Packaging', 'sticker': 'Packaging', 'tape': 'Packaging',
    'wrap': 'Packaging', 'raw material': 'Raw Material', 'raw': 'Raw Material',
    'rm': 'Raw Material', 'ingredient': 'Raw Material',
    'consumable': 'Consumable', 'consumables': 'Consumable',
    'shipping': 'Shipping', 'logistics': 'Shipping', 'freight': 'Shipping',
    'transport': 'Shipping', 'delivery': 'Shipping',
    'marketing': 'Marketing', 'ads': 'Marketing', 'advertising': 'Marketing',
    'promotion': 'Marketing', 'marketplace fee': 'Marketplace Fee',
    'commission': 'Marketplace Fee', 'platform fee': 'Marketplace Fee',
    'payment gateway': 'Payment Gateway', 'gateway': 'Payment Gateway',
    'bank charge': 'Bank Charges', 'bank fee': 'Bank Charges',
    'office': 'Office Expense', 'rent': 'Rent', 'electricity': 'Utilities',
    'water': 'Utilities', 'internet': 'Utilities', 'phone': 'Utilities',
    'mobile': 'Utilities', 'salary': 'Salary', 'wages': 'Salary',
    'staff': 'Salary', 'travel': 'Travel', 'fuel': 'Fuel',
    'vehicle': 'Vehicle', 'maintenance': 'Maintenance', 'repair': 'Maintenance',
    'insurance': 'Insurance', 'legal': 'Legal', 'professional': 'Professional Services',
    'accounting': 'Professional Services', 'audit': 'Professional Services',
    'software': 'Software', 'subscription': 'Software', 'saas': 'Software',
    'hosting': 'Software', 'domain': 'Software',
  }

  const lower = str.toLowerCase().trim()
  for (const [key, value] of Object.entries(categoryMap)) {
    if (lower.includes(key)) return value
  }
  return toTitleCase(str)
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