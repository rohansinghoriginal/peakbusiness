import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { env } from '@/lib/env'

/**
 * Server-only admin client (service_role) - bypasses RLS.
 * Use ONLY for: migrations, seeding, admin endpoints, background jobs.
 * Never use in regular user-facing API routes.
 */
export function getSupabaseAdmin() {
  return createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

/**
 * User-scoped client - respects RLS policies.
 * Uses Supabase SSR cookies for authentication.
 * Use this for ALL regular API routes.
 */
export async function getSupabaseUser() {
  const cookieStore = await cookies()

  return createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    })
}

/**
 * Get the current user ID from Supabase (for use in service_role queries)
 */
export async function getCurrentUserId(): Promise<string> {
  const supabase = await getSupabaseUser()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('User not authenticated')
  return user.id
}

/**
 * Get the current Supabase user object
 */
export async function getCurrentUser() {
  const supabase = await getSupabaseUser()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}