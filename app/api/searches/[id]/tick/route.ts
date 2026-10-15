import { isAdmin } from '@/lib/config'
import { errorResponse, getSearch, isUuid, tick } from '@/lib/engine'

// Advances one search: due SIMULATED/REPLAY steps, queued LIVE dispatch, provider polling, watchdog.
// Idempotent and safe to call from several tabs at once.
export async function POST(req: Request, ctx: RouteContext<'/api/searches/[id]/tick'>) {
  const { id } = await ctx.params
  if (!isUuid(id)) return Response.json({ error: 'Not found.' }, { status: 404 })
  try {
    await tick(id)
    const s = await getSearch(id, isAdmin(req))
    return s ? Response.json(s) : Response.json({ error: 'Not found.' }, { status: 404 })
  } catch (e) {
    return errorResponse(e)
  }
}
