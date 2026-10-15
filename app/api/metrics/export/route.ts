import { isAdmin } from '@/lib/config'
import { errorResponse, metricsRows } from '@/lib/engine'
import { toCsv } from '@/lib/metrics'

// Per-call CSV for analysis. Operator-only. No transcripts, no phone numbers.
export async function GET(req: Request) {
  if (!isAdmin(req)) return Response.json({ error: 'The operator token is missing or wrong.' }, { status: 401 })
  const mode = new URL(req.url).searchParams.get('mode') ?? 'live'
  if (!['live', 'simulated', 'replay'].includes(mode)) return Response.json({ error: 'Unknown mode.' }, { status: 400 })
  try {
    return new Response(toCsv(await metricsRows(mode)), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="poochho-${mode}-calls.csv"`, 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    return errorResponse(e)
  }
}
