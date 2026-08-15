export async function GET() {
  return Response.json({ ok: true, service: 'peak-business', timestamp: new Date().toISOString() })
}
