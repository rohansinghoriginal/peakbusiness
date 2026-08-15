/**
 * Normalize unit strings to canonical units
 */
export function normalizeUnit(str: string): string {
  const unitMap: Record<string, string> = {
    'pcs': 'PCS', 'pieces': 'PCS', 'piece': 'PCS', 'nos': 'PCS',
    'no': 'PCS', 'each': 'PCS', 'ea': 'PCS',
    'kg': 'KG', 'kilogram': 'KG', 'kilograms': 'KG', 'kgs': 'KG',
    'g': 'G', 'gram': 'G', 'grams': 'G', 'gm': 'G',
    'l': 'L', 'liter': 'L', 'liters': 'L', 'litre': 'L', 'litres': 'L',
    'ml': 'ML', 'milliliter': 'ML', 'milliliters': 'ML',
    'm': 'M', 'meter': 'M', 'meters': 'M', 'metre': 'M', 'metres': 'M',
    'cm': 'CM', 'centimeter': 'CM', 'centimeters': 'CM',
    'mm': 'MM', 'millimeter': 'MM', 'millimeters': 'MM',
    'sqft': 'SQFT', 'sq ft': 'SQFT',
    'sqm': 'SQM', 'sq m': 'SQM',
    'box': 'BOX', 'boxes': 'BOX', 'carton': 'CTN', 'cartons': 'CTN',
    'ctn': 'CTN', 'pkt': 'PKT', 'packet': 'PKT', 'packets': 'PKT',
    'pack': 'PKT', 'packs': 'PKT', 'roll': 'ROLL', 'rolls': 'ROLL',
    'set': 'SET', 'sets': 'SET', 'pair': 'PAIR', 'pairs': 'PAIR',
    'dozen': 'DOZ', 'doz': 'DOZ', 'gross': 'GROSS',
    'unit': 'UNIT', 'units': 'UNIT',
  }

  const lower = str.toLowerCase().trim()
  return unitMap[lower] || str.toUpperCase()
}