/**
 * Normalize string for comparison - lowercase, remove non-alphanumeric, collapse spaces
 */
export function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}