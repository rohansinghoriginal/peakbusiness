import { getCurrentUserId } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId()
  if (!userId) throw new ApiError('You must be signed in to use this resource.', 401)
  return userId
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  console.error(error)
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
}

export function assert(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new ApiError(message, status)
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function optionalText(value: unknown): string | null {
  const parsed = text(value)
  return parsed || null
}

export function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function date(value: unknown): string {
  const parsed = text(value)
  if (parsed && /^\d{4}-\d{2}-\d{2}$/.test(parsed)) return parsed
  return new Date().toISOString().slice(0, 10)
}

export function databaseError(error: { message?: string } | null): never {
  throw new ApiError(error?.message || 'The database could not complete that request.', 500)
}