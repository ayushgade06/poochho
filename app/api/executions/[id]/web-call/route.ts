import { isAdmin, webCallEnabled } from '@/lib/config'
import { errorResponse, isUuid, startWebCall, withinDailyCap } from '@/lib/engine'

// Judge mode: the browser asks for its one-time Bolna web-call session when the judge clicks "Answer the call".
// Open to anyone holding the search's unguessable URL, so it is capped per visitor and per day (the operator is
// not). The session's SIP credentials expire in about two minutes and are never stored.
export async function POST(req: Request, ctx: RouteContext<'/api/executions/[id]/web-call'>) {
  if (!webCallEnabled()) return Response.json({ error: 'Judge mode is not enabled.' }, { status: 403 })
  const { id } = await ctx.params
  if (!isUuid(id)) return Response.json({ error: 'Not found.' }, { status: 404 })
  try {
    const session = await startWebCall(id, async () => isAdmin(req) || withinDailyCap('judge', req)) // 429 once the caps are used up
    return Response.json(session, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
