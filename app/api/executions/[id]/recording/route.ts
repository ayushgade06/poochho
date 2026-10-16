import { getRecording } from '@/lib/bolna'
import { isAdmin } from '@/lib/config'
import { errorResponse, isUuid, recordingId } from '@/lib/engine'

// The audio of an answered LIVE call, for the operator only. Fetched from Bolna at play time and streamed
// through: Bolna's link expires after ~24 hours and is never stored, and its call id never reaches the browser.
export async function GET(req: Request, ctx: RouteContext<'/api/executions/[id]/recording'>) {
  if (!isAdmin(req)) return Response.json({ error: 'The operator token is missing or wrong.' }, { status: 401 })
  const { id } = await ctx.params
  if (!isUuid(id)) return Response.json({ error: 'Not found.' }, { status: 404 })
  try {
    const pid = await recordingId(id)
    const res = pid && (await getRecording(pid))
    if (!res) return Response.json({ error: 'No recording: only answered LIVE calls have one.' }, { status: 404 })
    return new Response(res.body, { headers: { 'Content-Type': res.headers.get('content-type') ?? 'audio/mpeg', 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
