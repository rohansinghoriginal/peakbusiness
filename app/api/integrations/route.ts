import { NextResponse } from 'next/server'

import { jsonError, requireUserId } from '@/lib/api'

export async function GET() {
  try {
    await requireUserId()
    return NextResponse.json({
      clerk: { configured: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY), provider: 'Clerk' },
      supabase: { configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY), provider: 'Supabase' },
      openrouter: { configured: Boolean(process.env.OPENROUTER_API_KEY), provider: 'OpenRouter' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
