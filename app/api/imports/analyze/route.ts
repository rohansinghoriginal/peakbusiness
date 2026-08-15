import { NextResponse } from 'next/server'

import { assert, jsonError, requireUserId, text } from '@/lib/api'
import { detectDocumentAndPlatform, type ImportMapping, type RawRow } from '@/lib/import-mapping'
import { env } from '@/lib/env'

function extractJsonObject(content: string) {
  const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error('AI response was not JSON')
  }
}

export async function POST(request: Request) {
  try {
    await requireUserId()
    const body = await request.json()
    const headers = Array.isArray(body.headers) ? body.headers.map(String).filter(Boolean).slice(0, 100) : []
    const sampleRows = (Array.isArray(body.samples) ? body.samples.slice(0, 5) : []) as RawRow[]
    const fileName = text(body.fileName)
    const rawTextSnippet = text(body.rawTextSnippet)

    assert(headers.length, 'Upload a report with a header row first.')

    const detection = detectDocumentAndPlatform(headers, sampleRows, fileName, rawTextSnippet)

    if (!env.openRouterApiKey) {
      return NextResponse.json({
        ...detection,
        mapping: detection.recommendedMapping,
        provider: 'deterministic-rules',
      })
    }

    try {
      const prompt = `Analyze this business/order report.
Headers: ${JSON.stringify(headers)}
File name: "${fileName}"
Sample rows: ${JSON.stringify(sampleRows)}

Tasks:
1. Map headers to canonical keys: orderId, lineKey, skuCode, productName, orderDate, qtyOrdered, qtyDelivered, qtyReturned, salePrice, status, deliveryDate, returnDate, refundAmount, customerLocation.
2. Determine target platform: "Amazon", "Meesho", "Flipkart", "Shopify", or "Offline".
3. Return strict JSON only:
{"platform":"Amazon|Meesho|Flipkart|Shopify|Offline","docTypeName":"Description of report","mapping":{"canonicalKey":"exact header name"}}`

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.openRouterApiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'Peak Business',
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [
            { role: 'system', content: 'You output strict JSON only. Never include prose.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
          max_tokens: 800,
        }),
      })

      if (!response.ok) {
        return NextResponse.json({
          ...detection,
          mapping: detection.recommendedMapping,
          provider: 'deterministic-rules',
        })
      }

      const payload = await response.json()
      const content = String(payload.choices?.[0]?.message?.content || '').trim()
      if (!content) {
        return NextResponse.json({
          ...detection,
          mapping: detection.recommendedMapping,
          provider: 'deterministic-rules',
        })
      }

      const parsed = extractJsonObject(content)
      const aiMapping = parsed?.mapping && typeof parsed.mapping === 'object' ? (parsed.mapping as ImportMapping) : {}
      const acceptedMapping = Object.fromEntries(
        Object.entries(aiMapping).filter(([, header]) => typeof header === 'string' && headers.includes(header)),
      )

      const detectedPlatform =
        parsed?.platform && ['Amazon', 'Meesho', 'Flipkart', 'Shopify', 'Offline'].includes(parsed.platform)
          ? parsed.platform
          : detection.detectedPlatform

      return NextResponse.json({
        ...detection,
        detectedPlatform,
        docTypeName: parsed?.docTypeName || detection.docTypeName,
        mapping: { ...detection.recommendedMapping, ...acceptedMapping },
        provider: 'openrouter-ai',
      })
    } catch {
      return NextResponse.json({
        ...detection,
        mapping: detection.recommendedMapping,
        provider: 'deterministic-rules',
      })
    }
  } catch (error) {
    return jsonError(error)
  }
}
