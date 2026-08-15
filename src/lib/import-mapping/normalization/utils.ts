/**
 * Convert string to Title Case
 */
export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Clean text - trim, remove extra spaces, remove special chars but keep basic punctuation
 */
export function cleanText(str: string): string {
  return str
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-.,()/&]/g, '')
    .trim()
}