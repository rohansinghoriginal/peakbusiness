import { createClient } from '@supabase/supabase-js'
import { auth } from '@clerk/nextjs/server'

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
 * Uses Clerk session token for authentication.
 * Use this for ALL regular API routes.
 */
export async function getSupabaseUser() {
  const { getToken } = await auth()
  const token = await getToken({ template: 'supabase' })
  
  if (!token) {
    throw new Error('No Clerk session token available. User must be authenticated.')
  }
  
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

/**
 * Get the current user ID from Clerk (for use in service_role queries that need manual filtering)
 */
export async function getCurrentUserId(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new Error('User not authenticated')
  return userId
}
