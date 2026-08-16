'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

export function AuthGate() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user: userData } }: { data: { user: any } }) => {
      if (userData) router.replace('/overview')
    })
  }, [router])

  return null
}