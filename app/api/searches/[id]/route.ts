import { isAdmin } from '@/lib/config'
import { errorResponse, getSearch, isUuid } from '@/lib/engine'

// Anyone holding the (unguessable) search URL can read it: there are no user accounts in this demo. For LIVE
// searches, transcripts, notes and raw errors need the operator token.
export async function GET(req: Request, ctx: RouteContext<'/api/searches/[id]'>) {
  const { id } = await ctx.params
  if (!isUuid(id)) return Response.json({ error: 'Not found.' }, { status: 404 })
  try {
    const s = await getSearch(id, isAdmin(req))
    return s ? Response.json(s) : Response.json({ error: 'Not found.' }, { status: 404 })
  } catch (e) {
    return errorResponse(e)
  }
}
