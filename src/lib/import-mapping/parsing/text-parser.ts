import { RawRow } from '../types'
import { importDate, importNumber, asNumber } from '../../business'

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