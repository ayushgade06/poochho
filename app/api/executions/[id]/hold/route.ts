import { isAdmin, liveBlockers } from '@/lib/config'
import { createHold, errorResponse, isUuid } from '@/lib/engine'

// "Hold it": one separate reservation call, only ever started by an explicit user click.
export async function POST(req: Request, ctx: RouteContext<'/api/executions/[id]/hold'>) {
  const { id } = await ctx.params
  if (!isUuid(id)) return Response.json({ error: 'Not found.' }, { status: 404 })
  try {
    return Response.json({ id: await createHold(id, isAdmin(req) && !liveBlockers().length) }, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
