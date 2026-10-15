import { cfg, isAdmin, liveBlockers } from '@/lib/config'
import { createReplay, createSearch, errorResponse } from '@/lib/engine'
import { validateSearch } from '@/lib/validate'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return Response.json({ error: 'Expected a JSON body.' }, { status: 400 })
  try {
    if (body.mode === 'replay') {
      if (typeof body.replay_id !== 'string') return Response.json({ error: 'replay_id is required.' }, { status: 400 })
      return Response.json({ id: await createReplay(body.replay_id) }, { status: 201 })
    }
    const v = validateSearch(body, cfg.maxCalls)
    if (!v.ok) return Response.json({ error: 'Please fix the highlighted fields.', errors: v.errors }, { status: 422 })
    if (v.value.mode === 'live') {
      // LIVE needs all of: server opt-in, the operator token, and the user's explicit confirmation of the
      // exact shops they reviewed (shop_ids). Anything missing means no call is placed.
      const blockers = liveBlockers()
      if (blockers.length) return Response.json({ error: `LIVE mode is not configured: ${blockers.join('; ')}.` }, { status: 403 })
      if (!isAdmin(req)) return Response.json({ error: 'The operator token is missing or wrong.' }, { status: 401 })
      if (body.confirm_live !== true) return Response.json({ error: 'Live calls need explicit confirmation.' }, { status: 400 })
    }
    return Response.json({ id: await createSearch(v.value) }, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
