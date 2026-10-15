import { errorResponse, getSearch, isUuid } from '@/lib/engine'

// Anyone holding the (unguessable) search URL can read it: there are no user accounts in this demo.
export async function GET(_req: Request, ctx: RouteContext<'/api/searches/[id]'>) {
  const { id } = await ctx.params
  if (!isUuid(id)) return Response.json({ error: 'Not found.' }, { status: 404 })
  try {
    const s = await getSearch(id)
    return s ? Response.json(s) : Response.json({ error: 'Not found.' }, { status: 404 })
  } catch (e) {
    return errorResponse(e)
  }
}
