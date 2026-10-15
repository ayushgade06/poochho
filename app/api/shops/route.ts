import { errorResponse, listShops } from '@/lib/engine'

// Shops the user can review before any call. Never returns phone numbers.
export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get('mode') === 'live' ? 'live' : 'simulated'
  try {
    return Response.json({ shops: await listShops(mode) })
  } catch (e) {
    return errorResponse(e)
  }
}
