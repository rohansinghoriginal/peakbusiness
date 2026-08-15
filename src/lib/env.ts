function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL').replace(/\/rest\/v1\/?$/, '')
  },
  get supabaseSecretKey() {
    return required('SUPABASE_SECRET_KEY')
  },
  get supabaseAnonKey() {
    return required('SUPABASE_ANON_KEY')
  },
  get openRouterApiKey() {
    return process.env.OPENROUTER_API_KEY || null
  },
}
